// ════════════════════════════════════════════════════════════════════
// NATURE SCATTER — Trees, Rocks, Grass, Palms
// ════════════════════════════════════════════════════════════════════
// Procedural nature generation for the walk view. Creates instanced
// meshes for performance with organic variety through per-instance
// jitter and multiple geometry types.

import * as THREE from 'three';
import { hash2 } from '../utils/noise.js';
import { tileDepletion } from '../state/extraction.js';

// ─── HELPERS ────────────────────────────────────────────────────────

// Pseudo-random for geometry operations
const prand = (n, seed = 1) => {
  const s = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// Deform a sphere by jittering each vertex along its normal
function blobify(geo, jitterAmount = 0.18, seed = 1) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const len = Math.sqrt(x*x + y*y + z*z) || 1;
    const nx = x / len, ny = y / len, nz = z / len;
    const j = (prand(i * 17.3, seed) - 0.5) * jitterAmount;
    pos.setXYZ(i, x + nx * len * j, y + ny * len * j, z + nz * len * j);
  }
  return geo;
}

// Bake per-face shading into vertex colors for sun-lit look
function bakeFaceShading(geo, sunDir = new THREE.Vector3(0.5, 1.0, 0.3).normalize()) {
  const ng = geo.index ? geo.toNonIndexed() : geo;
  ng.computeVertexNormals();
  const pos = ng.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i+1), by = pos.getY(i+1), bz = pos.getZ(i+1);
    const cx = pos.getX(i+2), cy = pos.getY(i+2), cz = pos.getZ(i+2);

    const ux = bx-ax, uy = by-ay, uz = bz-az;
    const vx = cx-ax, vy = cy-ay, vz = cz-az;
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
    nx /= len; ny /= len; nz /= len;

    const dot = Math.max(0, nx*sunDir.x + ny*sunDir.y + nz*sunDir.z);
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

// Build clustered canopy from multiple sub-blobs
function buildClusterCanopy(blobs) {
  const subGeos = [];
  for (const b of blobs) {
    const g = bakeFaceShading(blobify(
      new THREE.IcosahedronGeometry(b.r, 1),
      b.jitter || 0.15,
      b.seed || 1
    ));
    g.translate(b.x, b.y, b.z);
    subGeos.push(g);
  }

  let totalVerts = 0;
  for (const g of subGeos) totalVerts += g.attributes.position.count;

  const posBuf = new Float32Array(totalVerts * 3);
  const colBuf = new Float32Array(totalVerts * 3);
  let off = 0;

  for (const g of subGeos) {
    const p = g.attributes.position.array;
    const c = g.attributes.color.array;
    posBuf.set(p, off);
    colBuf.set(c, off);
    off += p.length;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(posBuf, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colBuf, 3));
  return merged;
}

// ─── MAIN SCATTER FUNCTION ──────────────────────────────────────────
export function scatterNature(state, terrainGroup, tileSize, elevToWalkY, tintColor, figGround, obstacles) {
  const dummy = new THREE.Object3D();
  const halfTile = tileSize / 2;

  // ── TREES (forest biome) ────────────────────────────────────────
  {
    // Trunk geometry and materials
    const trunkGeo = bakeFaceShading(new THREE.CylinderGeometry(0.30, 0.55, 4.5, 7));
    trunkGeo.translate(0, 2.25, 0);
    const trunkMatWarm = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x6B4A2E, 0.72), 1.0), vertexColors: true });
    const trunkMatCool = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x4F3826, 0.62), 1.0), vertexColors: true });
    const trunkMatGray = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x6A5C50, 0.78), 1.0), vertexColors: true });

    // TYPE A — Round leafy (medium tree)
    const typeACanopy = buildClusterCanopy([
      { x:  0.0, y: 6.5, z:  0.0, r: 1.7, jitter: 0.22, seed: 11 },
      { x:  1.4, y: 6.0, z:  0.4, r: 1.3, jitter: 0.25, seed: 12 },
      { x: -1.2, y: 5.8, z: -0.6, r: 1.4, jitter: 0.22, seed: 13 },
      { x:  0.3, y: 7.4, z: -1.0, r: 1.2, jitter: 0.28, seed: 14 },
      { x: -0.8, y: 7.6, z:  0.8, r: 1.1, jitter: 0.24, seed: 15 },
      { x:  1.0, y: 7.0, z: -1.2, r: 1.0, jitter: 0.26, seed: 16 },
      { x: -1.5, y: 6.6, z:  1.0, r: 1.0, jitter: 0.24, seed: 17 }
    ]);
    const typeAMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x88B070, 0.82), 1.0), vertexColors: true });

    // TYPE B — Tall column
    const typeBCanopy = buildClusterCanopy([
      { x:  0.0, y: 5.5, z:  0.0, r: 1.4, jitter: 0.22, seed: 21 },
      { x:  0.6, y: 6.4, z: -0.3, r: 1.3, jitter: 0.24, seed: 22 },
      { x: -0.5, y: 6.8, z:  0.5, r: 1.2, jitter: 0.22, seed: 23 },
      { x:  0.2, y: 7.7, z: -0.6, r: 1.3, jitter: 0.25, seed: 24 },
      { x: -0.7, y: 8.2, z:  0.3, r: 1.1, jitter: 0.23, seed: 25 },
      { x:  0.5, y: 8.8, z:  0.4, r: 1.0, jitter: 0.26, seed: 26 },
      { x: -0.3, y: 9.4, z: -0.4, r: 0.95, jitter: 0.24, seed: 27 },
      { x:  0.4, y: 10.0, z:  0.2, r: 0.85, jitter: 0.28, seed: 28 },
      { x: -0.2, y: 10.6, z: -0.1, r: 0.7, jitter: 0.30, seed: 29 }
    ]);
    const typeBMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x5E8E5E, 0.78), 1.0), vertexColors: true });

    // TYPE C — Compact bushy
    const typeCCanopy = buildClusterCanopy([
      { x:  0.0, y: 4.5, z:  0.0, r: 1.5, jitter: 0.26, seed: 41 },
      { x:  1.6, y: 4.2, z:  0.3, r: 1.3, jitter: 0.28, seed: 42 },
      { x: -1.5, y: 4.4, z: -0.4, r: 1.4, jitter: 0.26, seed: 43 },
      { x:  0.4, y: 4.8, z:  1.6, r: 1.2, jitter: 0.28, seed: 44 },
      { x: -0.6, y: 4.6, z: -1.5, r: 1.2, jitter: 0.30, seed: 45 },
      { x:  0.2, y: 5.4, z: -0.2, r: 1.0, jitter: 0.25, seed: 46 }
    ]);
    const typeCMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0xA8B860, 0.85), 1.0), vertexColors: true });

    // Place trees
    const treesByType = { A: [], B: [], C: [] };

    for (const t of state.island.tiles) {
      if (t.biome !== 'forest' || t.populated) continue;

      // Get depletion and scale tree count accordingly
      const depletion = tileDepletion(state, t);
      const scatterScale = Math.max(0, 1 - depletion);
      if (scatterScale < 0.1) continue; // Skip fully depleted tiles

      const baseY = elevToWalkY(t.elev);
      const placed = [];
      const baseTreeCount = 12;
      const treeCount = Math.max(0, Math.floor(baseTreeCount * scatterScale)); // Reduced by depletion
      if (treeCount === 0) continue;

      for (let i = 0; i < treeCount; i++) {
        const typeRoll = hash2(i, t.gx + t.gy, 750);
        const type = typeRoll < 0.50 ? 'A' : (typeRoll < 0.80 ? 'B' : 'C');
        const sc = 0.75 + hash2(i, t.gx, 712) * 0.55;
        const heightMul = type === 'B' ? 1.15 : (type === 'C' ? 0.75 : 1.0);
        const treeR = 1.4 * sc * (type === 'C' ? 1.3 : 1.0);

        const tileCenterX = t.gx * tileSize;
        const tileCenterZ = t.gy * tileSize;
        const maxOffset = Math.max(0, halfTile - treeR - 0.5);

        let wx, wz, ok = false;
        for (let attempt = 0; attempt < 6 && !ok; attempt++) {
          const dxN = (hash2(t.gx + i + attempt*3, t.gy, 710) - 0.5) * 2;
          const dzN = (hash2(t.gx, t.gy + i + attempt*3, 711) - 0.5) * 2;
          wx = tileCenterX + dxN * maxOffset;
          wz = tileCenterZ + dzN * maxOffset;
          ok = true;
          for (const p of placed) {
            const ddx = wx - p.x, ddz = wz - p.z;
            const minD = treeR + p.r;
            if (ddx*ddx + ddz*ddz < minD * minD) { ok = false; break; }
          }
        }
        if (!ok) continue;
        placed.push({ x: wx, z: wz, r: treeR });

        const yRot = hash2(i, t.gy, 713) * Math.PI * 2;
        const tilt = (hash2(i, t.gx + t.gy, 714) - 0.5) * 0.12;
        const sxJit = 0.85 + hash2(i, t.gx + 7, 715) * 0.4;
        const syJit = 0.85 + hash2(i, t.gy + 7, 716) * 0.4;
        const szJit = 0.85 + hash2(i, t.gx + t.gy + 7, 717) * 0.4;
        const trunkRoll = hash2(i, t.gx * 3 + t.gy, 760);
        const trunkVariant = trunkRoll < 0.45 ? 'warm' : (trunkRoll < 0.80 ? 'cool' : 'gray');

        treesByType[type].push({
          x: wx, y: baseY, z: wz,
          scale: sc, heightMul, yRot, tilt,
          sxJit, syJit, szJit, trunkVariant
        });
        obstacles.push({ x: wx, z: wz, r: 0.7 * sc });
      }
    }

    // Build instanced meshes
    const buildInstancedTree = (instances, geo, mat) => {
      if (instances.length === 0) return;
      const mesh = new THREE.InstancedMesh(geo, mat, instances.length);
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        dummy.position.set(inst.x, inst.y, inst.z);
        dummy.rotation.set(inst.tilt, inst.yRot, 0);
        dummy.scale.set(
          inst.scale * inst.sxJit,
          inst.scale * inst.heightMul * inst.syJit,
          inst.scale * inst.szJit
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      terrainGroup.add(mesh);
    };

    // Trunks by color variant
    const allTrees = [...treesByType.A, ...treesByType.B, ...treesByType.C];
    buildInstancedTree(allTrees.filter(t => t.trunkVariant === 'warm'), trunkGeo, trunkMatWarm);
    buildInstancedTree(allTrees.filter(t => t.trunkVariant === 'cool'), trunkGeo, trunkMatCool);
    buildInstancedTree(allTrees.filter(t => t.trunkVariant === 'gray'), trunkGeo, trunkMatGray);

    // Canopies by type
    buildInstancedTree(treesByType.A, typeACanopy, typeAMat);
    buildInstancedTree(treesByType.B, typeBCanopy, typeBMat);
    buildInstancedTree(treesByType.C, typeCCanopy, typeCMat);
  }

  // ── ROCKS (mountain biome) ────────────────────────────────────────
  {
    const rockGeo = bakeFaceShading(new THREE.IcosahedronGeometry(1.0, 0));
    const rockMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x808A98, 0.82), 1.0), vertexColors: true });

    let rockCount = 0;
    const rockTiles = [];
    for (const t of state.island.tiles) {
      if (t.biome === 'mountain' && !t.populated) {
        const depletion = tileDepletion(state, t);
        const scatterScale = Math.max(0, 1 - depletion);
        if (scatterScale < 0.1) continue;
        const tileRockCount = Math.max(0, Math.floor(24 * scatterScale));
        rockCount += tileRockCount;
        rockTiles.push({ tile: t, count: tileRockCount, depletion });
      }
    }

    if (rockCount > 0) {
      const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
      let idx = 0;

      for (const { tile: t, count: tileRockCount } of rockTiles) {
        const baseY = elevToWalkY(t.elev);

        for (let i = 0; i < tileRockCount; i++) {
          const isBig = hash2(i, t.gx + t.gy, 763) > 0.50;
          const sc = isBig
            ? 2.0 + hash2(i, t.gx, 764) * 3.5
            : 0.6 + hash2(i, t.gx, 764) * 1.4;
          const radius = sc * 0.95;

          const tileCenterX = t.gx * tileSize;
          const tileCenterZ = t.gy * tileSize;
          const maxOffset = Math.max(0, halfTile - radius - 0.5);
          const dxN = (hash2(t.gx + i*7, t.gy + i, 765) - 0.5) * 2;
          const dzN = (hash2(t.gx + i, t.gy + i*7, 766) - 0.5) * 2;
          const wx = tileCenterX + dxN * maxOffset;
          const wz = tileCenterZ + dzN * maxOffset;

          dummy.position.set(wx, baseY + sc * 0.4, wz);
          dummy.rotation.set(
            hash2(i, t.gx, 767) * Math.PI * 2,
            hash2(i, t.gy, 768) * Math.PI * 2,
            hash2(i, t.gx + t.gy, 769) * Math.PI * 2
          );
          const aspectX = 0.85 + hash2(i, t.gx, 756) * 0.5;
          const aspectY = 0.55 + hash2(i, t.gy, 757) * 0.6;
          const aspectZ = 0.85 + hash2(i, t.gx + t.gy, 758) * 0.5;
          dummy.scale.set(sc * aspectX, sc * aspectY, sc * aspectZ);
          dummy.updateMatrix();
          rockMesh.setMatrixAt(idx++, dummy.matrix);

          if (sc > 1.6) {
            obstacles.push({ x: wx, z: wz, r: radius * 0.85 });
          }
        }
      }
      rockMesh.count = idx;
      rockMesh.instanceMatrix.needsUpdate = true;
      terrainGroup.add(rockMesh);
    }
  }

  // ── GRASS TUFTS (lowlands biome) ────────────────────────────────────
  {
    const tuftLineMat = new THREE.LineBasicMaterial({
      color: tintColor(figGround(0x8E7A30, 0.62), 1.0),
      linewidth: 1
    });

    const linePts = [];
    for (const t of state.island.tiles) {
      if (t.biome !== 'lowlands' || t.populated) continue;

      // Get depletion and scale tuft count accordingly
      const depletion = tileDepletion(state, t);
      const scatterScale = Math.max(0, 1 - depletion);
      if (scatterScale < 0.1) continue;

      const baseY = elevToWalkY(t.elev);
      const baseTuftsPerTile = 20;
      const tuftsPerTile = Math.max(0, Math.floor(baseTuftsPerTile * scatterScale));

      for (let i = 0; i < tuftsPerTile; i++) {
        const cdx = (hash2(t.gx + i*3, t.gy + i, 730) - 0.5) * 0.95 * tileSize;
        const cdz = (hash2(t.gx + i, t.gy + i*3, 731) - 0.5) * 0.95 * tileSize;
        const cx = t.gx * tileSize + cdx;
        const cz = t.gy * tileSize + cdz;
        const tuftScale = 0.7 + hash2(i, t.gx, 732) * 0.8;
        const blades = 6;

        for (let b = 0; b < blades; b++) {
          const bdx = (hash2(i*7 + b, t.gx + i, 740) - 0.5) * 0.7;
          const bdz = (hash2(i*7 + b, t.gy + i, 741) - 0.5) * 0.7;
          const height = (1.0 + hash2(i + b, t.gx, 742) * 0.8) * tuftScale;
          const splayX = (hash2(i + b, t.gx, 743) - 0.5) * 0.45 * height;
          const splayZ = (hash2(i + b, t.gy, 744) - 0.5) * 0.45 * height;
          linePts.push(cx + bdx, baseY + 0.01, cz + bdz);
          linePts.push(cx + bdx + splayX, baseY + 0.01 + height, cz + bdz + splayZ);
        }
      }
    }

    if (linePts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
      const tuftLines = new THREE.LineSegments(geo, tuftLineMat);
      terrainGroup.add(tuftLines);
    }
  }

  // ── BUSHES (lowlands + forest) ──────────────────────────────────────
  {
    const bushGeo = new THREE.SphereGeometry(1.5, 7, 5);
    bushGeo.scale(1, 0.7, 1);
    const bushMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x88A868, 0.85), 1.0) });
    const bushMatDark = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x6E8A55, 0.78), 1.0) });

    let bushCount = 0;
    const bushTiles = [];
    for (const t of state.island.tiles) {
      if (t.populated) continue;

      // Get depletion and scale bush count accordingly
      const depletion = tileDepletion(state, t);
      const scatterScale = Math.max(0, 1 - depletion);
      if (scatterScale < 0.1) continue;

      let baseCount = 0;
      if (t.biome === 'lowlands' && hash2(t.gx, t.gy, 770) > 0.55) baseCount = 4;
      else if (t.biome === 'forest' && hash2(t.gx, t.gy, 771) > 0.7) baseCount = 2;

      if (baseCount > 0) {
        const scaledCount = Math.max(0, Math.floor(baseCount * scatterScale));
        bushCount += scaledCount;
        bushTiles.push({ tile: t, count: scaledCount });
      }
    }

    if (bushCount > 0) {
      const bushMesh = new THREE.InstancedMesh(bushGeo, bushMat, bushCount);
      const bushMeshDark = new THREE.InstancedMesh(bushGeo, bushMatDark, bushCount);
      let idx = 0, idxDark = 0;

      for (const { tile: t, count } of bushTiles) {
        if (count === 0) continue;

        const baseY = elevToWalkY(t.elev);
        const placed = [];

        for (let i = 0; i < count; i++) {
          const sc = 0.6 + hash2(i, t.gx, 772) * 0.7;
          const r = 1.5 * sc;
          const tileCenterX = t.gx * tileSize;
          const tileCenterZ = t.gy * tileSize;
          const maxOffset = Math.max(0, halfTile - r - 0.5);

          let wx, wz, ok = false;
          for (let attempt = 0; attempt < 5 && !ok; attempt++) {
            const dxN = (hash2(t.gx + i*4 + attempt*2, t.gy, 773) - 0.5) * 2;
            const dzN = (hash2(t.gx, t.gy + i*4 + attempt*2, 774) - 0.5) * 2;
            wx = tileCenterX + dxN * maxOffset;
            wz = tileCenterZ + dzN * maxOffset;
            ok = true;
            for (const p of placed) {
              const ddx = wx - p.x, ddz = wz - p.z;
              const minD = r + p.r;
              if (ddx*ddx + ddz*ddz < minD * minD) { ok = false; break; }
            }
          }
          if (!ok) continue;
          placed.push({ x: wx, z: wz, r });

          dummy.position.set(wx, baseY + sc * 0.5, wz);
          dummy.rotation.y = hash2(i, t.gy, 775) * Math.PI * 2;
          dummy.scale.set(sc, sc, sc);
          dummy.updateMatrix();

          if (hash2(i, t.gx + t.gy, 776) > 0.5) {
            bushMesh.setMatrixAt(idx++, dummy.matrix);
          } else {
            bushMeshDark.setMatrixAt(idxDark++, dummy.matrix);
          }
        }
      }

      bushMesh.count = idx;
      bushMeshDark.count = idxDark;
      bushMesh.instanceMatrix.needsUpdate = true;
      bushMeshDark.instanceMatrix.needsUpdate = true;
      if (idx > 0) terrainGroup.add(bushMesh);
      if (idxDark > 0) terrainGroup.add(bushMeshDark);
    }
  }

  // ── PALM TREES (beach biome) ──────────────────────────────────────
  {
    const palmGeo = new THREE.CylinderGeometry(0.3, 0.4, 6, 5);
    palmGeo.translate(0, 3, 0);
    const palmMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0xB89060, 0.78), 1.0) });
    const fronds = new THREE.SphereGeometry(2.2, 6, 4);
    fronds.scale(1, 0.4, 1);
    fronds.translate(0, 6, 0);
    const frondsMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x7A9050, 0.80), 1.0) });

    let palmCount = 0;
    const palmTiles = [];
    for (const t of state.island.tiles) {
      if (t.biome !== 'beach' || t.populated) continue;
      if (hash2(t.gx, t.gy, 702) <= 0.85) continue;

      // Check depletion - skip palm if tile is heavily depleted
      const depletion = tileDepletion(state, t);
      if (depletion > 0.5) continue; // Skip palms on depleted beach tiles

      palmTiles.push(t);
      palmCount++;
    }

    if (palmCount > 0) {
      const palmMesh = new THREE.InstancedMesh(palmGeo, palmMat, palmCount);
      const frondMesh = new THREE.InstancedMesh(fronds, frondsMat, palmCount);
      let idx = 0;

      for (const t of palmTiles) {

        const baseY = elevToWalkY(t.elev);
        const dx = (hash2(t.gx, t.gy, 740) - 0.5) * 0.5 * tileSize;
        const dz = (hash2(t.gx, t.gy, 741) - 0.5) * 0.5 * tileSize;

        dummy.position.set(t.gx * tileSize + dx, baseY, t.gy * tileSize + dz);
        dummy.rotation.set((hash2(t.gx, t.gy, 742) - 0.5) * 0.25, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();

        palmMesh.setMatrixAt(idx, dummy.matrix);
        frondMesh.setMatrixAt(idx, dummy.matrix);
        idx++;
      }

      palmMesh.instanceMatrix.needsUpdate = true;
      frondMesh.instanceMatrix.needsUpdate = true;
      terrainGroup.add(palmMesh, frondMesh);
    }
  }

  // ── DESERT DUNE FANS ──────────────────────────────────────────────
  {
    const fanMat = new THREE.LineBasicMaterial({
      color: tintColor(figGround(0xC8A858, 0.65), 1.0),
      linewidth: 1
    });

    const linePts = [];
    for (const t of state.island.tiles) {
      if (t.biome !== 'desert' || t.populated) continue;

      // Get depletion and scale fan count accordingly
      const depletion = tileDepletion(state, t);
      const scatterScale = Math.max(0, 1 - depletion);
      if (scatterScale < 0.1) continue;

      const baseY = elevToWalkY(t.elev);
      const baseFansPerTile = 12;
      const fansPerTile = Math.max(0, Math.floor(baseFansPerTile * scatterScale));

      for (let i = 0; i < fansPerTile; i++) {
        const cdx = (hash2(t.gx + i*2, t.gy + i, 780) - 0.5) * 0.9 * tileSize;
        const cdz = (hash2(t.gx + i, t.gy + i*2, 781) - 0.5) * 0.9 * tileSize;
        const cx = t.gx * tileSize + cdx;
        const cz = t.gy * tileSize + cdz;
        const fanScale = 0.5 + hash2(i, t.gx, 782) * 0.6;
        const blades = 4;

        for (let b = 0; b < blades; b++) {
          const angle = (b / blades) * Math.PI * 0.6 - Math.PI * 0.3;
          const height = (0.8 + hash2(i + b, t.gx, 783) * 0.6) * fanScale;
          const tipX = Math.sin(angle) * height * 0.3;
          const tipZ = Math.cos(angle) * height * 0.3;
          linePts.push(cx, baseY + 0.01, cz);
          linePts.push(cx + tipX, baseY + 0.01 + height, cz + tipZ);
        }
      }
    }

    if (linePts.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
      const fanLines = new THREE.LineSegments(geo, fanMat);
      terrainGroup.add(fanLines);
    }
  }

  // ── MOUNTAIN PEAKS (high elevation) ───────────────────────────────
  // Tall irregular rock formations on the highest mountain tiles
  {
    const peakGeo = bakeFaceShading(new THREE.IcosahedronGeometry(1, 0));
    const peakRockMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x808A98, 0.82), 1.0), vertexColors: true });
    const peakSnowMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0xC8CFD8, 0.92), 1.0), vertexColors: true });

    let peakCount = 0;
    const peakTiles = [];
    for (const t of state.island.tiles) {
      if (t.biome === 'mountain' && !t.populated && t.elev >= 8 && hash2(t.gx, t.gy, 880) > 0.55) {
        // Get depletion - reduce peak count for depleted tiles
        const depletion = tileDepletion(state, t);
        const scatterScale = Math.max(0, 1 - depletion);
        if (scatterScale < 0.2) continue; // Skip heavily depleted high mountain tiles

        const baseStones = 4;
        const scaledStones = Math.max(1, Math.floor(baseStones * scatterScale));
        peakCount += scaledStones;
        peakTiles.push({ tile: t, stoneCount: scaledStones });
      }
    }

    if (peakCount > 0) {
      const peakRockMesh = new THREE.InstancedMesh(peakGeo, peakRockMat, peakCount);
      const peakSnowMesh = new THREE.InstancedMesh(peakGeo, peakSnowMat, peakCount);
      let idx = 0, idxSnow = 0;

      for (const { tile: t, stoneCount } of peakTiles) {
        const baseY = elevToWalkY(t.elev);
        const isSnowy = t.elev >= 10;
        const cdxN = (hash2(t.gx, t.gy, 881) - 0.5) * 0.4;
        const cdzN = (hash2(t.gx, t.gy, 882) - 0.5) * 0.4;
        const cx = t.gx * tileSize + cdxN * tileSize;
        const cz = t.gy * tileSize + cdzN * tileSize;
        const numStones = Math.min(stoneCount, 2 + Math.floor(hash2(t.gx, t.gy, 887) * 3));

        for (let s = 0; s < numStones; s++) {
          const isMain = s === 0;
          const baseSize = isMain ? 5 + hash2(t.gx, t.gy, 883) * 4 : 3 + hash2(t.gx + s, t.gy, 883) * 3;
          const heightMult = isMain ? 1.8 + hash2(t.gx, t.gy, 884) * (t.elev / 12) * 1.2 : 1.2 + hash2(t.gx + s, t.gy, 884) * 0.8;
          const wobbleX = 0.7 + hash2(t.gx + s, t.gy, 885) * 0.5;
          const wobbleZ = 0.7 + hash2(t.gx, t.gy + s, 886) * 0.5;

          let wx, wz;
          if (isMain) {
            wx = cx; wz = cz;
          } else {
            const sa = (s / numStones) * Math.PI * 2 + hash2(t.gx, t.gy + s, 888) * 1.5;
            const sr = baseSize * 0.7 + hash2(t.gx + s, t.gy, 889) * baseSize * 0.4;
            wx = cx + Math.cos(sa) * sr;
            wz = cz + Math.sin(sa) * sr;
          }

          const margin = baseSize * Math.max(wobbleX, wobbleZ);
          const tCx = t.gx * tileSize, tCz = t.gy * tileSize;
          wx = Math.max(tCx - halfTile + margin, Math.min(tCx + halfTile - margin, wx));
          wz = Math.max(tCz - halfTile + margin, Math.min(tCz + halfTile - margin, wz));

          const totalH = baseSize * heightMult;
          dummy.position.set(wx, baseY + totalH * 0.4, wz);
          dummy.rotation.set(
            hash2(t.gx + s, t.gy, 890) * Math.PI * 2,
            hash2(t.gx, t.gy + s, 891) * Math.PI * 2,
            hash2(t.gx + s, t.gy + s, 892) * Math.PI * 2
          );
          dummy.scale.set(baseSize * wobbleX, totalH, baseSize * wobbleZ);
          dummy.updateMatrix();

          if (isSnowy) {
            peakSnowMesh.setMatrixAt(idxSnow++, dummy.matrix);
          } else {
            peakRockMesh.setMatrixAt(idx++, dummy.matrix);
          }
          obstacles.push({ x: wx, z: wz, r: baseSize * 0.85 });
        }
      }

      peakRockMesh.count = idx;
      peakSnowMesh.count = idxSnow;
      peakRockMesh.instanceMatrix.needsUpdate = true;
      peakSnowMesh.instanceMatrix.needsUpdate = true;
      if (idx > 0) terrainGroup.add(peakRockMesh);
      if (idxSnow > 0) terrainGroup.add(peakSnowMesh);
    }
  }

  // ── ALPINE EVERGREENS (mountain, lower elevation) ─────────────────
  {
    const trunkGeo = bakeFaceShading(new THREE.CylinderGeometry(0.30, 0.55, 4.5, 7));
    trunkGeo.translate(0, 2.25, 0);
    const alpineLowerGeo = bakeFaceShading(new THREE.ConeGeometry(2.0, 4.5, 5));
    alpineLowerGeo.translate(0, 4.0, 0);
    const alpineUpperGeo = bakeFaceShading(new THREE.ConeGeometry(1.3, 3.6, 4));
    alpineUpperGeo.translate(0, 6.4, 0);

    const trunkMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x6B4A2E, 0.72), 1.0), vertexColors: true });
    const alpineLowerMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x4F8068, 0.75), 1.0), vertexColors: true });
    const alpineUpperMat = new THREE.MeshBasicMaterial({ color: tintColor(figGround(0x68957E, 0.80), 1.0), vertexColors: true });

    let alpineCount = 0;
    const alpineTiles = [];
    for (const t of state.island.tiles) {
      if (t.biome === 'mountain' && !t.populated && t.elev < 10 && hash2(t.gx, t.gy, 718) > 0.7) {
        // Get depletion and scale tree count accordingly
        const depletion = tileDepletion(state, t);
        const scatterScale = Math.max(0, 1 - depletion);
        if (scatterScale < 0.2) continue;

        const baseTreeCount = 2;
        const scaledCount = Math.max(0, Math.floor(baseTreeCount * scatterScale));
        if (scaledCount > 0) {
          alpineCount += scaledCount;
          alpineTiles.push({ tile: t, count: scaledCount });
        }
      }
    }

    if (alpineCount > 0) {
      const aTrunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, alpineCount);
      const aLowerMesh = new THREE.InstancedMesh(alpineLowerGeo, alpineLowerMat, alpineCount);
      const aUpperMesh = new THREE.InstancedMesh(alpineUpperGeo, alpineUpperMat, alpineCount);
      let idx = 0;

      for (const { tile: t, count } of alpineTiles) {
        const baseY = elevToWalkY(t.elev);
        for (let i = 0; i < count; i++) {
          const dx = (hash2(t.gx + i, t.gy, 720) - 0.5) * 0.6 * tileSize;
          const dz = (hash2(t.gx, t.gy + i, 721) - 0.5) * 0.6 * tileSize;
          const sc = 0.85 + hash2(i, t.gx, 722) * 0.5;
          dummy.position.set(t.gx * tileSize + dx, baseY, t.gy * tileSize + dz);
          dummy.rotation.y = hash2(i, t.gy, 723) * Math.PI * 2;
          dummy.scale.set(sc, sc * 1.3, sc);
          dummy.updateMatrix();
          aTrunkMesh.setMatrixAt(idx, dummy.matrix);
          aLowerMesh.setMatrixAt(idx, dummy.matrix);
          aUpperMesh.setMatrixAt(idx, dummy.matrix);
          idx++;
        }
      }

      aTrunkMesh.instanceMatrix.needsUpdate = true;
      aLowerMesh.instanceMatrix.needsUpdate = true;
      aUpperMesh.instanceMatrix.needsUpdate = true;
      terrainGroup.add(aTrunkMesh, aLowerMesh, aUpperMesh);
    }
  }
}
