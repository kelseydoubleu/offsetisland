// ════════════════════════════════════════════════════════════════════
// ROADS + PATHFINDING
// ════════════════════════════════════════════════════════════════════
// Roads are emergent from builds: committing a build automatically connects
// the parcel to the nearest existing built tile by the cheapest path, and
// that path's cost gets deducted from the ledger. Roads cost labor + stone,
// with modifiers by biome and elevation.

const ROAD_N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Create a normalized road segment key from two tiles.
 * Always sorts alphabetically so a→b and b→a produce the same key.
 */
export function roadKey(a, b) {
  const ka = a.gx + ':' + a.gy;
  const kb = b.gx + ':' + b.gy;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * Cost of the graph edge from tile a → tile b.
 * Returns Infinity if the edge can't be traversed.
 */
export function edgeCost(a, b) {
  if (!a || !b) return Infinity;
  if (a.biome === 'water' || b.biome === 'water') return Infinity;
  const elevDiff = Math.abs(a.elev - b.elev);
  if (elevDiff > 3) return Infinity;  // too steep to grade a road

  let cost = 1;                       // base distance
  cost += elevDiff * 1.8;             // climb penalty
  // Biome modifier — roughly reads as "cost to clear a lane through this"
  if (b.biome === 'mountain') cost += 3;
  else if (b.biome === 'forest') cost += 1.5;
  else if (b.biome === 'desert') cost += 0.3;
  else if (b.biome === 'beach') cost += 0.2;
  return cost;
}

/**
 * Resource cost breakdown for a list of road segments.
 * Returns deltas against the ledger: what this road will consume when committed.
 */
export function roadResourceCost(path) {
  let labor = 0, stone = 0, timber = 0, sand = 0, energy = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const elevDiff = Math.abs(a.elev - b.elev);
    labor += 2 + elevDiff * 2;
    if (b.biome === 'mountain') { stone += 6; labor += 4; }
    else if (b.biome === 'forest') { timber += 4; labor += 2; }
    else { stone += 2; }
  }
  return {
    labor: Math.round(labor),
    stone: Math.round(stone),
    timber: Math.round(timber),
    sand: Math.round(sand),
    energy: Math.round(energy)
  };
}

/**
 * Dijkstra pathfinding from start tile to ANY tile in endKeys.
 * Returns { path, cost } or null if no path exists.
 */
export function findPath(state, startTile, endKeys) {
  if (!startTile) return null;
  if (endKeys.has(startTile.gx + ':' + startTile.gy)) {
    return { path: [startTile], cost: 0 };
  }

  const byKey = state.island.tilesByKey;
  const dist = new Map();
  const prev = new Map();
  const startKey = startTile.gx + ':' + startTile.gy;
  dist.set(startKey, 0);

  // Min-heap via array + sort. Fine at ~900 nodes.
  const heap = [{ d: 0, key: startKey, tile: startTile }];

  while (heap.length) {
    heap.sort((a, b) => a.d - b.d);
    const { d, key, tile } = heap.shift();
    if (d > (dist.get(key) ?? Infinity)) continue;
    if (endKeys.has(key)) {
      // Reconstruct path
      const path = [tile];
      let k = key;
      while (prev.has(k)) {
        const p = prev.get(k);
        path.unshift(p.tile);
        k = p.key;
      }
      return { path, cost: d };
    }
    for (const [dx, dy] of ROAD_N4) {
      const nb = byKey.get((tile.gx + dx) + ':' + (tile.gy + dy));
      if (!nb) continue;
      const c = edgeCost(tile, nb);
      if (!isFinite(c)) continue;
      const nbKey = nb.gx + ':' + nb.gy;
      const nd = d + c;
      if (nd < (dist.get(nbKey) ?? Infinity)) {
        dist.set(nbKey, nd);
        prev.set(nbKey, { tile, key });
        heap.push({ d: nd, key: nbKey, tile: nb });
      }
    }
  }
  return null;
}

/**
 * All tile-keys that are currently "reachable by road network".
 * A new build can connect to any of these. If none exist, the island
 * is fresh and the first build can land anywhere.
 */
export function networkKeys(state) {
  const s = new Set();
  for (const b of state.island.builds) {
    if (b.primaryTile) {
      s.add(b.primaryTile.gx + ':' + b.primaryTile.gy);
    }
  }
  // A road's endpoints also count as network nodes
  for (const rk of state.island.roads) {
    const [aK, bK] = rk.split('|');
    s.add(aK);
    s.add(bK);
  }
  return s;
}

/**
 * Convert a path of tiles into road segment keys.
 */
export function pathToSegments(path) {
  const segs = [];
  for (let i = 0; i < path.length - 1; i++) {
    segs.push(roadKey(path[i], path[i + 1]));
  }
  return segs;
}

/**
 * Seeds the starter network: a coastal "founding pier" + one inland
 * settlement connected by road.
 */
export function seedStarterNetwork(state) {
  const byKey = state.island.tilesByKey;
  if (!byKey) return;

  // Pick a beach tile with low-elevation lowlands neighbors — a natural landing
  let pier = null;
  for (const t of state.island.tiles) {
    if (t.biome !== 'beach') continue;
    let inlandOk = 0;
    for (const [dx, dy] of ROAD_N4) {
      const n = byKey.get((t.gx + dx) + ':' + (t.gy + dy));
      if (n && n.biome !== 'water' && n.elev <= 3) inlandOk++;
    }
    // Prefer south-facing beaches (closer to viewer) and some inland depth
    if (inlandOk >= 2) {
      if (!pier || (t.gx + t.gy) > (pier.gx + pier.gy)) pier = t;
    }
  }
  if (!pier) return;

  // Find an inland "founders' outpost" 3-5 tiles inland along a low-cost path
  let outpost = null;
  const candidates = state.island.tiles.filter(t =>
    t.biome !== 'water' && t.biome !== 'beach' &&
    Math.abs(t.gx - pier.gx) + Math.abs(t.gy - pier.gy) >= 3 &&
    Math.abs(t.gx - pier.gx) + Math.abs(t.gy - pier.gy) <= 6 &&
    t.elev <= 4
  );

  let bestCost = Infinity;
  for (const c of candidates) {
    const path = findPath(state, pier, new Set([c.gx + ':' + c.gy]));
    if (path && path.cost < bestCost) {
      bestCost = path.cost;
      outpost = c;
    }
  }
  if (!outpost) return;

  // Commit both builds as seed
  const pierBuild = {
    id: 1,
    name: 'Founding pier',
    primaryTile: { gx: pier.gx, gy: pier.gy },
    tiles: [{ gx: pier.gx, gy: pier.gy }],
    method: 'human',
    author: 'system',
    authorSpecies: 'human',
    committedDay: 1,
    materialReq: { timber: 10, stone: 20, brick: 0 },
    laborReq: 40,
    embodiedCarbon: 0.6,
    status: 'committed',
    condition: 1.0,
    lastMaintainedDay: 1,
    deathPlan: 'demolish-salvage',
    aiSpec: { primary_material: 'stone', secondary_material: 'timber', floors: 1 }
  };

  const outpostBuild = {
    id: 2,
    name: "Founders' outpost",
    primaryTile: { gx: outpost.gx, gy: outpost.gy },
    tiles: [{ gx: outpost.gx, gy: outpost.gy }],
    method: 'human',
    author: 'system',
    authorSpecies: 'human',
    committedDay: 1,
    materialReq: { timber: 40, stone: 20, brick: 0 },
    laborReq: 30,
    embodiedCarbon: 0.5,
    status: 'committed',
    condition: 1.0,
    lastMaintainedDay: 1,
    deathPlan: 'demolish-salvage',
    aiSpec: { primary_material: 'timber', secondary_material: 'stone', floors: 1 }
  };

  state.island.builds.push(pierBuild, outpostBuild);
  state.island.nextBuildId = Math.max(state.island.nextBuildId || 1, 3);
  pier.built = true;
  pier.buildId = 1;
  outpost.built = true;
  outpost.buildId = 2;

  // Road between them
  const road = findPath(state, pier, new Set([outpost.gx + ':' + outpost.gy]));
  if (road) {
    for (const seg of pathToSegments(road.path)) {
      state.island.roads.add(seg);
    }
  }

  // Deduct the seed costs from the ledger
  if (state.ledger) {
    state.ledger.labor -= 70;
    state.ledger.stone -= 40;
    state.ledger.timber -= 50;
    state.ledger.sand -= 30;
  }
}
