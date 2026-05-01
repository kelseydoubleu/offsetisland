// ════════════════════════════════════════════════════════════════════
// ISLAND GENERATION — ELEVATION-FIRST TERRAIN
// ════════════════════════════════════════════════════════════════════
// Philosophy: generate a continuous elevation field FIRST using ridge noise
// (gives proper peaks + valleys + ridges, not plateaus). Biomes are then
// *derived* from elevation + moisture + position, so the mountain biome is
// naturally where elevation is high, with foothills feathering out.

import { hash2, fbm, ridgeNoise } from '../utils/noise.js';
import { GRID_RADIUS, MAX_ELEV } from '../utils/projection.js';

// ── COASTLINE ───────────────────────────────────────────────────────
// Composed of irregular landmasses, each with its own off-grid position,
// rotation, and per-angle radius noise. Capes, bays, and peninsulas
// emerge naturally per-region.

/**
 * Irregular blob shape test — true if (gx,gy) is inside a region whose
 * radius varies with angle.
 */
function blob(gx, gy, cx, cy, rot, baseR, squash, noiseAmp, noiseSeed) {
  const dx = gx - cx;
  const dy = gy - cy;
  // Rotate into the blob's local frame
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  // Apply squash to local frame
  const sx = lx;
  const sy = ly * squash;
  const r = Math.sqrt(sx * sx + sy * sy);
  if (r > baseR + noiseAmp + 2) return false;  // early reject
  const ang = Math.atan2(sy, sx);
  // Per-angle noise: combine two octaves traveling around the perimeter
  const angSample1 = Math.cos(ang * 3 + noiseSeed * 0.7) * Math.cos(ang * 5 + noiseSeed * 1.3);
  const angSample2 = fbm(Math.cos(ang) * 3 + cx * 0.1, Math.sin(ang) * 3 + cy * 0.1, 3, noiseSeed) - 0.5;
  // Also vary radius slightly with position for additional surface-level wobble
  const localNoise = fbm(gx * 0.18, gy * 0.18, 3, noiseSeed * 1.7) - 0.5;
  const wobble = angSample1 * 0.6 + angSample2 * 1.2 + localNoise * 0.8;
  const effectiveR = baseR + wobble * noiseAmp;
  return r < effectiveR;
}

/**
 * Test if a grid cell is land (vs ocean).
 * FIVE landmasses + scatter:
 *   Major land (north-east biased, big, tilted ~20°)
 *   Long peninsula (rotated ~70°, narrow, reaches south)
 *   Mid-size island (south-west, tilted ~35°)
 *   Small dense island (south-east)
 *   Long thin island (far west, vertical-ish)
 * Plus organic islets where noise field allows.
 */
export function isLand(gx, gy) {
  if (blob(gx, gy, -2, -8,  0.35, 10.5, 0.65, 5.5, 11)) return true;   // big northern landmass
  if (blob(gx, gy,  8, -1,  1.2,   5.0, 0.55, 3.2, 23)) return true;   // peninsula reaching down
  if (blob(gx, gy, -9,  5,  0.5,   6.5, 0.70, 4.0, 37)) return true;   // SW landmass
  if (blob(gx, gy, 11,  7, -0.3,   4.0, 0.85, 2.5, 53)) return true;   // SE small island
  if (blob(gx, gy,-13, -4,  1.5,   4.5, 0.45, 2.8, 71)) return true;   // far W long thin

  // Organic small islets — scattered tiles where local noise field exceeds
  // a threshold within a defined "scatter zone"
  const scatterZone = (
    (gx > -16 && gx < 14 && gy > 8 && gy < 17) ||   // southern open sea
    (gx > 5 && gx < 16 && gy > -10 && gy < -2)       // northeast pockets
  );
  if (scatterZone) {
    const islN = fbm(gx * 0.32, gy * 0.32, 3, 91);
    if (islN > 0.66) return true;
  }

  return false;
}

/**
 * Distance from tile to nearest water (coast distance).
 * Returns 0 if the tile is water, 1-5 for land tiles.
 */
export function coastDistance(gx, gy) {
  if (!isLand(gx, gy)) return 0;
  for (let r = 1; r <= 4; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!isLand(gx + dx, gy + dy)) {
          return Math.sqrt(dx * dx + dy * dy);
        }
      }
    }
  }
  return 5;
}

// ── ELEVATION ───────────────────────────────────────────────────────

/**
 * Raw elevation field — continuous across island, 0..1.
 * This is the star of the show. Mountains are emergent from this, not imposed.
 */
export function elevationRaw(gx, gy) {
  // Big ridge structure — concentrated in the north-center, runs like a spine
  const ridgeCore = ridgeNoise(gx * 0.09, gy * 0.09, 4, 3);
  // Offset ridge to bias it northward
  const ridgeBias = Math.max(0, (-gy + 4) / 20);
  const bigRidge = ridgeCore * (0.35 + ridgeBias * 0.9);

  // Medium hills — spread everywhere but quieter
  const hills = fbm(gx * 0.14, gy * 0.14, 4, 7) * 0.35;

  // Small-scale detail — local roughness
  const detail = fbm(gx * 0.32, gy * 0.32, 3, 11) * 0.15;

  // Coast falloff — near coast, elevation tapers to 0 (realistic shoreline)
  const cd = coastDistance(gx, gy);
  const coastFall = Math.min(1, cd / 3);

  const raw = (bigRidge + hills + detail) * coastFall;
  return Math.max(0, Math.min(1, raw));
}

/**
 * Map elevation 0..1 → integer elevation units with a slight power curve
 * so peaks punch up and low ground stays low (more dramatic terrain).
 */
export function elevationAt(gx, gy) {
  const raw = elevationRaw(gx, gy);
  if (raw < 0.08) return 0;
  const t = (raw - 0.08) / 0.92;
  return Math.max(0, Math.round(Math.pow(t, 1.15) * MAX_ELEV));
}

// ── BIOMES ──────────────────────────────────────────────────────────

/**
 * Derive biome from elevation + moisture + position.
 * Returns null for water tiles (tiles outside land).
 */
export function biomeFor(gx, gy) {
  if (!isLand(gx, gy)) return null;
  const cd = coastDistance(gx, gy);
  const elev = elevationAt(gx, gy);

  // Coastal low ground → beach
  if (cd <= 1.25 && elev <= 1) return 'beach';

  // High ground → mountain. Threshold of 8 keeps proper peaks as mountains
  // without overrunning the midrange terrain.
  if (elev >= 8) return 'mountain';

  // Interior water bodies (lakes)
  const basinNoise = fbm(gx * 0.10, gy * 0.10, 3, 41);
  if (cd >= 2 && basinNoise > 0.62 && elev <= 5) return 'water';

  // Moisture noise — determines forest vs desert vs lowlands
  const moisture = fbm(gx * 0.17, gy * 0.17, 4, 23);
  const westBias = Math.max(0, (-gx + 2) / 14);      // more moisture west
  const eastDry = Math.max(0, (gx + gy - 2) / 16);   // drier east/southeast

  // Forest — moist mid-elevations
  if (elev >= 1 && elev <= 7 && moisture + westBias * 0.3 > 0.70) return 'forest';

  // Desert — dry low-to-mid elevations in the east
  if (elev <= 5 && (1 - moisture) + eastDry * 0.35 > 0.68) return 'desert';

  // Wider beach tolerance on low coastal ground
  if (cd <= 1.6 && elev <= 2) return 'beach';

  return 'lowlands';
}

// ── ISLAND GENERATION ───────────────────────────────────────────────

/**
 * Generate all island tiles and store them in state.island.tiles.
 * Also performs post-processing: small-island reclassification,
 * water cluster flattening, and selective elevation smoothing.
 */
export function generateIsland(state) {
  state.island.tiles = [];

  // Generate raw tiles
  for (let gx = -GRID_RADIUS; gx <= GRID_RADIUS; gx++) {
    for (let gy = -GRID_RADIUS; gy <= GRID_RADIUS; gy++) {
      const biome = biomeFor(gx, gy);
      if (!biome) continue;
      const elev = elevationAt(gx, gy);
      state.island.tiles.push({
        gx, gy, biome, elev,
        built: false,
        buildId: null,
        id: `${gx >= 0 ? '+' : ''}${gx}·${gy >= 0 ? '+' : ''}${gy}`
      });
    }
  }

  // ─── SMALL-ISLAND RECLASSIFICATION ──────────────────────────────────
  // Tiny landmasses (under 6 connected non-water tiles) can't realistically
  // support forest, desert, or mountain — they're just exposed rock + sand.
  reclassifySmallIslands(state);

  // ─── POST-PROCESS: flatten water clusters ─────────────────────────────
  flattenWaterClusters(state);

  // ─── SELECTIVE ELEVATION SMOOTHING ──────────────────────────────────
  smoothElevation(state);

  // Index tiles by key for fast lookup
  state.island.tilesByKey = new Map();
  for (const t of state.island.tiles) {
    state.island.tilesByKey.set(t.gx + ':' + t.gy, t);
  }

  // Snapshot original water tiles for reservoir drain/refill
  state.island.waterPool = state.island.tiles
    .filter(t => t.biome === 'water')
    .map(t => {
      const basin = fbm(t.gx * 0.10, t.gy * 0.10, 3, 41);
      return {
        gx: t.gx, gy: t.gy, id: t.id, origElev: t.elev,
        drainOrder: (1 - basin) * 1000 + hash2(t.gx, t.gy, 99) * 50
      };
    })
    .sort((a, b) => b.drainOrder - a.drainOrder);

  state.island.totalWaterTiles = state.island.waterPool.length;

  return state;
}

/**
 * Force entire small clusters (< 6 tiles) to beach.
 */
function reclassifySmallIslands(state) {
  const lookup = new Map();
  for (const t of state.island.tiles) lookup.set(t.gx + ':' + t.gy, t);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const seenLand = new Set();

  for (const seed of state.island.tiles) {
    if (seed.biome === 'water') continue;
    const sk = seed.gx + ':' + seed.gy;
    if (seenLand.has(sk)) continue;

    // Flood-fill non-water cluster
    const cluster = [];
    const stack = [seed];
    while (stack.length) {
      const c = stack.pop();
      const ck = c.gx + ':' + c.gy;
      if (seenLand.has(ck)) continue;
      seenLand.add(ck);
      cluster.push(c);
      for (const [dx, dy] of N4) {
        const nb = lookup.get((c.gx + dx) + ':' + (c.gy + dy));
        if (nb && nb.biome !== 'water' && !seenLand.has(nb.gx + ':' + nb.gy)) {
          stack.push(nb);
        }
      }
    }

    // Reclassify small clusters as beach
    if (cluster.length < 6) {
      for (const t of cluster) {
        t.biome = 'beach';
        t.elev = Math.min(t.elev, 1);
      }
    }
  }
}

/**
 * Every connected water cluster should share ONE surface elevation
 * (a lake has a flat surface).
 */
function flattenWaterClusters(state) {
  const byKey = new Map();
  for (const t of state.island.tiles) byKey.set(t.gx + ':' + t.gy, t);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

  const visited = new Set();
  for (const seed of state.island.tiles) {
    if (seed.biome !== 'water') continue;
    const seedKey = seed.gx + ':' + seed.gy;
    if (visited.has(seedKey)) continue;

    // Flood-fill this connected water cluster (4-connected)
    const cluster = [];
    const stack = [seed];
    while (stack.length) {
      const curr = stack.pop();
      const ck = curr.gx + ':' + curr.gy;
      if (visited.has(ck)) continue;
      visited.add(ck);
      cluster.push(curr);
      for (const [dx, dy] of N4) {
        const nb = byKey.get((curr.gx + dx) + ':' + (curr.gy + dy));
        if (nb && nb.biome === 'water' && !visited.has(nb.gx + ':' + nb.gy)) {
          stack.push(nb);
        }
      }
    }

    // Lowest non-water neighbor (8-connected) across the ENTIRE cluster
    let minNbElev = Infinity;
    for (const w of cluster) {
      for (const [dx, dy] of N8) {
        const nb = byKey.get((w.gx + dx) + ':' + (w.gy + dy));
        if (nb && nb.biome !== 'water' && nb.elev < minNbElev) {
          minNbElev = nb.elev;
        }
      }
    }
    if (minNbElev === Infinity) minNbElev = 1;

    const surfaceElev = Math.max(0, minNbElev - 1);
    for (const w of cluster) w.elev = surfaceElev;
  }
}

/**
 * Selective elevation smoothing — real topography rolls.
 * Neighbor tiles rarely differ by more than 2 elevation units.
 */
function smoothElevation(state) {
  const smoothMap = new Map();
  for (const t of state.island.tiles) smoothMap.set(t.gx + ':' + t.gy, t);
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const t of state.island.tiles) {
      if (t.biome === 'water') continue;
      // Preserve mountain ridges — they should stay sharp
      if (t.elev >= 8) continue;

      // Check if any direct neighbor is water — coastal cliff exception
      let coastal = false;
      for (const [dx, dy] of N4) {
        const n = smoothMap.get((t.gx + dx) + ':' + (t.gy + dy));
        if (n && n.biome === 'water') { coastal = true; break; }
      }
      if (coastal) continue;

      // Find lowest land neighbor
      let minNb = Infinity;
      for (const [dx, dy] of N4) {
        const n = smoothMap.get((t.gx + dx) + ':' + (t.gy + dy));
        if (n && n.biome !== 'water') minNb = Math.min(minNb, n.elev);
      }
      if (minNb === Infinity) continue;

      // If we're more than 2 above, drop toward neighbor
      if (t.elev - minNb > 2) {
        t.elev = minNb + 2;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

// ── TILE LOOKUP HELPERS ─────────────────────────────────────────────

/**
 * Get tile by coordinates from the tilesByKey map.
 */
export function getTile(state, gx, gy) {
  return state.island.tilesByKey?.get(gx + ':' + gy) || null;
}

/**
 * Count tiles of a specific biome.
 */
export function countTilesByBiome(state, biome) {
  let n = 0;
  if (state.island.tiles) {
    for (const t of state.island.tiles) {
      if (t.biome === biome) n++;
    }
  }
  return n;
}
