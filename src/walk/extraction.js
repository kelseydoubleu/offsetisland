// ════════════════════════════════════════════════════════════════════
// EXTRACTION VISUALS — Quarry Pits + Dump Piles
// ════════════════════════════════════════════════════════════════════
// Visible marks of resource extraction and waste dumping.
// Where stone has been quarried, pits cut into mountain tiles.
// Where waste has been dumped, organic mounds appear.

import * as THREE from 'three';
import { hash2 } from '../utils/noise.js';
import { tileDepletion, tileDumpFraction, isDumpSite, getDumpSiteFillFraction } from '../state/extraction.js';

// ─── HELPER: BAKE FACE SHADING ─────────────────────────────────────
// Bake face shading for mound geometry — sun-from-upper-left look
function bakeMound(geo) {
  const ng = geo.index ? geo.toNonIndexed() : geo;
  ng.computeVertexNormals();
  const sun = new THREE.Vector3(0.5, 1.0, 0.3).normalize();
  const pos = ng.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i+1), by = pos.getY(i+1), bz = pos.getZ(i+1);
    const cx = pos.getX(i+2), cy = pos.getY(i+2), cz = pos.getZ(i+2);

    // Compute face normal
    const ux = bx-ax, uy = by-ay, uz = bz-az;
    const vx = cx-ax, vy = cy-ay, vz = cz-az;
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
    nx /= len; ny /= len; nz /= len;

    const dot = Math.max(0, nx*sun.x + ny*sun.y + nz*sun.z);
    const brightness = 0.55 + dot * 0.55;

    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3 + 0] = brightness;
      colors[(i + k) * 3 + 1] = brightness;
      colors[(i + k) * 3 + 2] = brightness;
    }
  }

  ng.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return ng;
}

// ─── HELPER: IRREGULAR MOUND SHAPE ─────────────────────────────────
// Sphere with vertices pulled down on bottom and randomly displaced
function makeMound(radius, height, seed) {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0) {
      pos.setY(i, 0);  // flatten bottom
    } else {
      pos.setY(i, y * (height / radius));
    }
    // Small random horizontal jitter for organic feel
    const h1 = hash2(seed + i, 1, 880);
    const h2 = hash2(seed, i + 1, 881);
    pos.setX(i, pos.getX(i) + (h1 - 0.5) * radius * 0.18);
    pos.setZ(i, pos.getZ(i) + (h2 - 0.5) * radius * 0.18);
  }

  pos.needsUpdate = true;
  return geo;
}

// ─── QUARRY PITS ───────────────────────────────────────────────────
// Where stone has been quarried, cut visible pits into mountain tiles.
// Pit size scales with depletion fraction.
export function createQuarryPits(state, root, tileSize, elevToWalkY, tintColor, figGround) {
  const halfTile = tileSize / 2;

  const pitMat = new THREE.MeshBasicMaterial({
    color: tintColor(figGround(0x4A4D52, 0.65), 1.0),
    side: THREE.DoubleSide
  });

  const pitEdgeMat = new THREE.LineBasicMaterial({
    color: 0x1A1A18,
    transparent: true,
    opacity: 0.6
  });

  for (const t of state.island.tiles) {
    if (t.biome !== 'mountain' || t.populated) continue;

    const depl = tileDepletion(state, t);
    if (depl < 0.05) continue;

    const baseY = elevToWalkY(t.elev);
    const pitR = 3 + depl * 8;
    const pitDepth = 0.6 + depl * 2.5;
    const tCx = t.gx * tileSize;
    const tCz = t.gy * tileSize;

    // Slight per-tile offset so multiple pits don't all sit dead-center
    const offX = (hash2(t.gx, t.gy, 940) - 0.5) * (halfTile - pitR - 1) * 0.4;
    const offZ = (hash2(t.gx, t.gy, 941) - 0.5) * (halfTile - pitR - 1) * 0.4;

    // Build a simple inverted-cone pit: floor (small disc) + sloped walls
    const pitGeo = new THREE.CylinderGeometry(pitR * 0.5, pitR, pitDepth, 8, 1, true);
    const pitFloorGeo = new THREE.CircleGeometry(pitR * 0.5, 8);

    const pitWalls = new THREE.Mesh(pitGeo, pitMat);
    pitWalls.position.set(tCx + offX, baseY - pitDepth / 2 + 0.02, tCz + offZ);
    root.add(pitWalls);

    const pitFloor = new THREE.Mesh(pitFloorGeo, pitMat);
    pitFloor.rotation.x = -Math.PI / 2;
    pitFloor.position.set(tCx + offX, baseY - pitDepth + 0.04, tCz + offZ);
    root.add(pitFloor);

    // Edge outlines — top rim and bottom rim
    const topRingPts = [];
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      topRingPts.push(new THREE.Vector3(Math.cos(ang) * pitR, 0, Math.sin(ang) * pitR));
    }
    topRingPts.push(topRingPts[0].clone());
    const topRingGeo = new THREE.BufferGeometry().setFromPoints(topRingPts);
    const topRing = new THREE.Line(topRingGeo, pitEdgeMat);
    topRing.position.set(tCx + offX, baseY + 0.06, tCz + offZ);
    root.add(topRing);

    const botRingPts = [];
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      botRingPts.push(new THREE.Vector3(Math.cos(ang) * pitR * 0.5, 0, Math.sin(ang) * pitR * 0.5));
    }
    botRingPts.push(botRingPts[0].clone());
    const botRingGeo = new THREE.BufferGeometry().setFromPoints(botRingPts);
    const botRing = new THREE.Line(botRingGeo, pitEdgeMat);
    botRing.position.set(tCx + offX, baseY - pitDepth + 0.08, tCz + offZ);
    root.add(botRing);
  }
}

// ─── DUMP PILES ────────────────────────────────────────────────────
// Visible piles of soil/debris at designated dump sites (landfills).
// Sculpted irregular mound shape with per-face brightness variation.
// Dump sites have much larger piles that grow as waste accumulates.
export function createDumpPiles(state, root, tileSize, elevToWalkY, tintColor, figGround, obstacles) {
  const halfTile = tileSize / 2;

  // Two-tone brown for soil — more natural than a flat single-color cone
  const pileMatA = new THREE.MeshBasicMaterial({
    color: tintColor(figGround(0x8A6F4A, 0.78), 1.0),
    vertexColors: true
  });

  const pileMatB = new THREE.MeshBasicMaterial({
    color: tintColor(figGround(0x9C7C56, 0.80), 1.0),
    vertexColors: true
  });

  const pileEdgeMat = new THREE.LineBasicMaterial({
    color: 0x1A1A18,
    transparent: true,
    opacity: 0.5
  });

  const debrisMat = new THREE.MeshBasicMaterial({
    color: tintColor(figGround(0x7A6238, 0.72), 1.0)
  });

  // Darker material for construction debris
  const debrisMatDark = new THREE.MeshBasicMaterial({
    color: tintColor(figGround(0x5A4A28, 0.70), 1.0)
  });

  for (const t of state.island.tiles) {
    if (t.biome === 'water') continue;

    // Check if this is a designated dump site
    const isDump = isDumpSite(state, t);

    // For dump sites, use the dedicated fill fraction; otherwise use regular dump fraction
    const dumpFrac = isDump ? getDumpSiteFillFraction(state, t) : tileDumpFraction(state, t);
    if (dumpFrac < 0.02) continue;

    const baseY = elevToWalkY(t.elev);

    // Dump sites get MUCH larger piles (fill most of the tile)
    // Regular tiles get smaller piles
    let pileR, pileH;
    if (isDump) {
      // Dump site: large landfill pile that grows with fill fraction
      // At full capacity, nearly fills the tile
      pileR = 4 + dumpFrac * 10;   // 4m to 14m radius
      pileH = 1.5 + dumpFrac * 6;  // 1.5m to 7.5m height
    } else {
      // Regular tile: smaller pile
      pileR = 1.8 + dumpFrac * 4.5;
      pileH = 0.7 + dumpFrac * 2.8;
    }

    // For dump sites, center the pile; for regular tiles, slight offset
    let wx, wz;
    if (isDump) {
      wx = t.gx * tileSize;
      wz = t.gy * tileSize;
    } else {
      const dxN = (hash2(t.gx, t.gy, 920) - 0.5) * 0.4;
      const dzN = (hash2(t.gx, t.gy, 921) - 0.5) * 0.4;
      wx = t.gx * tileSize + dxN * (halfTile - pileR);
      wz = t.gy * tileSize + dzN * (halfTile - pileR);
    }

    // Main mound — irregular blob with face shading
    const seed = t.gx * 1000 + t.gy;
    const mainGeo = bakeMound(makeMound(pileR, pileH, seed));
    const mat = (hash2(t.gx, t.gy, 922) > 0.5) ? pileMatA : pileMatB;
    const main = new THREE.Mesh(mainGeo, mat);
    main.position.set(wx, baseY + 0.02, wz);
    main.rotation.y = hash2(t.gx, t.gy, 925) * Math.PI * 2;
    root.add(main);

    // Edge outline — selective edges only
    const mainEdges = new THREE.EdgesGeometry(mainGeo, 22);
    const mainOutline = new THREE.LineSegments(mainEdges, pileEdgeMat);
    mainOutline.position.copy(main.position);
    mainOutline.rotation.copy(main.rotation);
    root.add(mainOutline);

    // Secondary smaller mounds — more for dump sites
    const secondaryThreshold = isDump ? 0.15 : 0.35;
    if (dumpFrac > secondaryThreshold) {
      // More mounds for dump sites
      const offCount = isDump
        ? Math.min(6, Math.floor(2 + dumpFrac * 5))
        : (dumpFrac > 0.7 ? 3 : 2);

      for (let k = 0; k < offCount; k++) {
        const sR = pileR * (0.35 + hash2(t.gx, t.gy, 930 + k) * 0.35);
        const sH = pileH * (0.40 + hash2(t.gx, t.gy, 931 + k) * 0.35);
        const ang = hash2(t.gx, t.gy, 932 + k) * Math.PI * 2;
        const spreadDist = isDump ? 0.8 + hash2(t.gx, t.gy, 933 + k) * 0.7 : 0.7 + hash2(t.gx, t.gy, 933 + k) * 0.6;
        const offX = Math.cos(ang) * pileR * spreadDist;
        const offZ = Math.sin(ang) * pileR * spreadDist;

        const sGeo = bakeMound(makeMound(sR, sH, seed + 100 + k));
        const sPile = new THREE.Mesh(sGeo, mat);
        sPile.position.set(wx + offX, baseY + 0.02, wz + offZ);
        sPile.rotation.y = hash2(t.gx, t.gy, 935 + k) * Math.PI * 2;
        root.add(sPile);

        const sEdges = new THREE.EdgesGeometry(sGeo, 22);
        const sOutline = new THREE.LineSegments(sEdges, pileEdgeMat);
        sOutline.position.copy(sPile.position);
        sOutline.rotation.copy(sPile.rotation);
        root.add(sOutline);
      }
    }

    // Loose soil debris around the base — more for dump sites
    const debrisCount = isDump
      ? Math.round(8 + dumpFrac * 20)
      : Math.round(4 + dumpFrac * 8);

    for (let k = 0; k < debrisCount; k++) {
      const ang = hash2(t.gx + k, t.gy, 940) * Math.PI * 2;
      const dist = pileR * (1.05 + hash2(t.gx, t.gy + k, 941) * 0.5);
      const dx = Math.cos(ang) * dist;
      const dz = Math.sin(ang) * dist;
      const ds = isDump
        ? 0.3 + hash2(t.gx, t.gy + k, 942) * 0.5
        : 0.2 + hash2(t.gx, t.gy + k, 942) * 0.3;

      const dGeo = new THREE.TetrahedronGeometry(ds);
      const debris = new THREE.Mesh(dGeo, k % 3 === 0 ? debrisMatDark : debrisMat);
      debris.position.set(wx + dx, baseY + ds * 0.4, wz + dz);
      debris.rotation.set(
        hash2(t.gx + k, t.gy, 943) * Math.PI * 2,
        hash2(t.gx, t.gy + k, 944) * Math.PI * 2,
        hash2(t.gx + k, t.gy + k, 945) * Math.PI * 2
      );
      root.add(debris);
    }

    // For dump sites, add construction debris (boards, pipes)
    if (isDump && dumpFrac > 0.2) {
      const constructionCount = Math.floor(dumpFrac * 8);
      for (let k = 0; k < constructionCount; k++) {
        const ang = hash2(t.gx + k, t.gy + k, 950) * Math.PI * 2;
        const dist = pileR * (0.5 + hash2(t.gx, t.gy + k, 951) * 0.6);
        const dx = Math.cos(ang) * dist;
        const dz = Math.sin(ang) * dist;

        // Random board or pipe shape
        const isBoard = hash2(t.gx + k, t.gy, 952) > 0.4;
        let debrisGeo;
        if (isBoard) {
          // Flat board
          const bw = 0.8 + hash2(t.gx, t.gy + k, 953) * 1.2;
          const bh = 0.1 + hash2(t.gx + k, t.gy + k, 954) * 0.15;
          const bd = 0.2 + hash2(t.gx + k, t.gy, 955) * 0.3;
          debrisGeo = new THREE.BoxGeometry(bw, bh, bd);
        } else {
          // Pipe/rod
          const pLen = 0.6 + hash2(t.gx, t.gy + k, 956) * 1.0;
          const pRad = 0.05 + hash2(t.gx + k, t.gy, 957) * 0.1;
          debrisGeo = new THREE.CylinderGeometry(pRad, pRad, pLen, 6);
        }

        const yOffset = pileH * (0.3 + hash2(t.gx + k, t.gy + k, 958) * 0.4);
        const debrisPiece = new THREE.Mesh(debrisGeo, debrisMatDark);
        debrisPiece.position.set(wx + dx, baseY + yOffset, wz + dz);
        debrisPiece.rotation.set(
          hash2(t.gx + k, t.gy, 959) * Math.PI * 0.3,
          hash2(t.gx, t.gy + k, 960) * Math.PI * 2,
          hash2(t.gx + k, t.gy + k, 961) * Math.PI * 0.3
        );
        root.add(debrisPiece);
      }
    }

    // Add to obstacles for collision detection
    obstacles.push({ x: wx, z: wz, r: pileR * 0.85 });
  }
}
