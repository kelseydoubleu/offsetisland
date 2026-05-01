// ════════════════════════════════════════════════════════════════════
// WEATHER EFFECTS — Rain, Snow, Mist, Foam
// ════════════════════════════════════════════════════════════════════
// Dynamic weather particles and effects for the walk view.

import * as THREE from 'three';
import { hash2 } from '../utils/noise.js';

// ─── FOAM STRIPS ────────────────────────────────────────────────────
// White foam lines at shoreline edges where water meets land
export function createFoamStrips(state, root, tileSize, elevToWalkY, tintColor, figGround, oceanSet) {
  if (!oceanSet) return [];

  const foamStrips = [];
  const foamMat = new THREE.LineBasicMaterial({
    color: tintColor(figGround(0xF0EDE5, 0.92), 1.0),
    transparent: true,
    opacity: 0.7
  });

  // Find shoreline edges
  for (const t of state.island.tiles) {
    if (t.biome === 'water') continue;
    const key = t.gx + ':' + t.gy;

    // Check neighbors for water
    const neighbors = [
      [t.gx + 1, t.gy],
      [t.gx - 1, t.gy],
      [t.gx, t.gy + 1],
      [t.gx, t.gy - 1]
    ];

    for (const [nx, ny] of neighbors) {
      const nKey = nx + ':' + ny;
      const neighbor = state.island.tilesByKey?.get(nKey);
      if (!neighbor || neighbor.biome !== 'water') continue;
      if (!oceanSet.has(nKey)) continue;  // Only ocean, not ponds

      // Create foam line on this edge
      const baseY = 0.15;
      const halfTile = tileSize / 2;
      const points = [];

      // Determine edge direction
      const dx = nx - t.gx;
      const dy = ny - t.gy;

      const cx = t.gx * tileSize;
      const cz = t.gy * tileSize;

      // Create wavy line along edge
      const segments = 8;
      for (let i = 0; i <= segments; i++) {
        const frac = i / segments;
        let px, pz;

        if (dx !== 0) {
          // East/west edge
          px = cx + dx * halfTile;
          pz = cz + (frac - 0.5) * tileSize;
        } else {
          // North/south edge
          px = cx + (frac - 0.5) * tileSize;
          pz = cz + dy * halfTile;
        }

        // Add wave offset
        const waveOffset = Math.sin(frac * Math.PI * 3 + hash2(t.gx, t.gy, 850)) * 0.8;
        if (dx !== 0) {
          px += waveOffset * 0.3;
        } else {
          pz += waveOffset * 0.3;
        }

        points.push(new THREE.Vector3(px, baseY, pz));
      }

      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const foam = new THREE.Line(geo, foamMat.clone());
      foam.userData = { phase: hash2(t.gx, t.gy, 851) * Math.PI * 2 };
      root.add(foam);
      foamStrips.push(foam);
    }
  }

  return foamStrips;
}

// ─── SNOW PARTICLES ─────────────────────────────────────────────────
export function createSnowParticles(root, camera, tintColor) {
  const flakeCount = 1200;
  const positions = new Float32Array(flakeCount * 3);

  const camX = camera?.position.x || 0;
  const camY = camera?.position.y || 5;
  const camZ = camera?.position.z || 0;

  for (let i = 0; i < flakeCount; i++) {
    positions[i * 3] = camX + (Math.random() - 0.5) * 500;
    positions[i * 3 + 1] = camY - 20 + Math.random() * 130;
    positions[i * 3 + 2] = camZ + (Math.random() - 0.5) * 500;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // Soft circle texture
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.PointsMaterial({
    size: 1.2,
    map: tex,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    sizeAttenuation: true,
    color: tintColor(0xFFFFFF, 1.0)
  });

  const snow = new THREE.Points(geo, mat);
  snow.userData = { role: 'snow', basePositions: positions.slice() };
  root.add(snow);

  return snow;
}

// ─── RAIN PARTICLES ─────────────────────────────────────────────────
export function createRainParticles(root, camera, condition, tintColor) {
  const dropCount = condition === 'storm' ? 1800 : 1000;
  const dropLen = condition === 'storm' ? 3.0 : 2.0;
  const positions = new Float32Array(dropCount * 6);

  const camX = camera?.position.x || 0;
  const camY = camera?.position.y || 5;
  const camZ = camera?.position.z || 0;

  for (let i = 0; i < dropCount; i++) {
    const x = camX + (Math.random() - 0.5) * 400;
    const y = camY - 30 + Math.random() * 130;
    const z = camZ + (Math.random() - 0.5) * 400;
    positions[i * 6] = x;
    positions[i * 6 + 1] = y;
    positions[i * 6 + 2] = z;
    positions[i * 6 + 3] = x;
    positions[i * 6 + 4] = y - dropLen;
    positions[i * 6 + 5] = z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.LineBasicMaterial({
    color: tintColor(0xC8D5E0, 1.0),
    transparent: true,
    opacity: condition === 'storm' ? 0.55 : 0.4,
    depthWrite: false
  });

  const rain = new THREE.LineSegments(geo, mat);
  rain.userData = { role: 'rain', basePositions: positions.slice(), dropLen };
  root.add(rain);

  return rain;
}

// ─── MIST PUFFS ─────────────────────────────────────────────────────
export function createMistPuffs(root, state, condition, tileSize, tintColor, phase) {
  let puffCount = 0;
  let altitudeMin = 4, altitudeMax = 8;
  let puffOpacity = 0.32;
  let puffSize = [40, 70];

  if (condition === 'fog') {
    puffCount = 80;
    altitudeMin = 1; altitudeMax = 12;
    puffOpacity = 0.50;
    puffSize = [40, 80];
  } else if (condition === 'storm') {
    puffCount = 60;
    altitudeMin = 30; altitudeMax = 80;
    puffOpacity = 0.38;
    puffSize = [50, 100];
  } else if (condition === 'rain') {
    puffCount = 40;
    altitudeMin = 25; altitudeMax = 70;
    puffOpacity = 0.28;
    puffSize = [45, 85];
  } else if (condition === 'overcast') {
    puffCount = 30;
    altitudeMin = 60; altitudeMax = 130;
    puffOpacity = 0.20;
    puffSize = [60, 110];
  } else if (condition === 'cloudy') {
    puffCount = 18;
    altitudeMin = 80; altitudeMax = 160;
    puffOpacity = 0.18;
    puffSize = [55, 100];
  }

  if (puffCount === 0) return [];

  // Soft radial gradient texture
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(252, 248, 240, 0.65)');
  grad.addColorStop(0.25, 'rgba(252, 248, 240, 0.45)');
  grad.addColorStop(0.5, 'rgba(252, 248, 240, 0.22)');
  grad.addColorStop(0.7, 'rgba(252, 248, 240, 0.08)');
  grad.addColorStop(0.85, 'rgba(252, 248, 240, 0.02)');
  grad.addColorStop(1, 'rgba(252, 248, 240, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  // Find island center
  let cx = 0, cy = 0, n = 0;
  for (const t of state.island.tiles) {
    if (t.biome === 'water') continue;
    cx += t.gx; cy += t.gy; n++;
  }
  if (n) { cx /= n; cy /= n; }
  cx *= tileSize;
  cy *= tileSize;

  // Tint based on phase
  let puffTint = 0xFFFFFF;
  if (phase === 'dawn') puffTint = 0xFFE8D8;
  else if (phase === 'dusk') puffTint = 0xF8D8C0;
  else if (phase === 'evening') puffTint = 0xC8C8E0;
  else if (phase === 'night') puffTint = 0x9098C0;
  else if (phase === 'predawn') puffTint = 0xA8A8C8;
  if (condition === 'storm') puffTint = 0x707880;

  const mistMat = new THREE.SpriteMaterial({
    map: tex,
    color: puffTint,
    transparent: true,
    opacity: puffOpacity,
    depthWrite: false,
    fog: true
  });

  const mists = [];
  for (let i = 0; i < puffCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 400;
    const baseX = cx + Math.cos(angle) * dist;
    const baseZ = cy + Math.sin(angle) * dist;
    const baseY = altitudeMin + Math.random() * (altitudeMax - altitudeMin);
    const size = puffSize[0] + Math.random() * (puffSize[1] - puffSize[0]);
    const mistPhase = Math.random() * Math.PI * 2;
    const driftRange = 20 + Math.random() * 30;
    const speed = 0.5 + Math.random() * 0.5;

    // Create 3 layered sprites per puff
    const layers = [];
    for (let l = 0; l < 3; l++) {
      const sprite = new THREE.Sprite(mistMat.clone());
      sprite.scale.set(size * (0.7 + l * 0.15), size * (0.7 + l * 0.15), 1);
      sprite.position.set(baseX + (l - 1) * 6, baseY + (l - 1) * 2, baseZ + (l - 1) * 4);
      root.add(sprite);
      layers.push(sprite);
    }

    mists.push({
      layers,
      baseX,
      baseY,
      baseZ,
      phase: mistPhase,
      driftRange,
      speed
    });
  }

  return mists;
}

// ─── UPDATE WEATHER ANIMATIONS ──────────────────────────────────────
export function updateWeather(dt, camera, snow, rain, mists, foamStrips, t) {
  // Snow animation
  if (snow) {
    const cam = camera.position;
    const pos = snow.geometry.attributes.position;
    const arr = pos.array;

    for (let i = 0; i < pos.count; i++) {
      arr[i * 3 + 1] -= 3 * dt;  // Drift down
      arr[i * 3] += Math.sin(t * 0.5 + i * 0.3) * 0.4 * dt;
      arr[i * 3 + 2] += Math.cos(t * 0.4 + i * 0.5) * 0.4 * dt;

      const dx = arr[i * 3] - cam.x;
      const dy = arr[i * 3 + 1] - cam.y;
      const dz = arr[i * 3 + 2] - cam.z;

      if (dy < -80 || Math.abs(dx) > 300 || Math.abs(dz) > 300) {
        arr[i * 3] = cam.x + (Math.random() - 0.5) * 600;
        arr[i * 3 + 1] = cam.y + 100 + Math.random() * 80;
        arr[i * 3 + 2] = cam.z + (Math.random() - 0.5) * 600;
      }
    }
    pos.needsUpdate = true;
  }

  // Rain animation
  if (rain) {
    const cam = camera.position;
    const pos = rain.geometry.attributes.position;
    const arr = pos.array;
    const fall = 60 * dt;
    const dropLen = rain.userData.dropLen;

    for (let i = 0; i < pos.count; i += 2) {
      arr[i * 3 + 1] -= fall;
      arr[(i + 1) * 3 + 1] -= fall;

      const dy = arr[i * 3 + 1] - cam.y;
      const dx = arr[i * 3] - cam.x;
      const dz = arr[i * 3 + 2] - cam.z;

      if (dy < -80 || Math.abs(dx) > 250 || Math.abs(dz) > 250) {
        const newX = cam.x + (Math.random() - 0.5) * 500;
        const newZ = cam.z + (Math.random() - 0.5) * 500;
        const newY = cam.y + 100 + Math.random() * 60;
        arr[i * 3] = newX;
        arr[i * 3 + 1] = newY;
        arr[i * 3 + 2] = newZ;
        arr[(i + 1) * 3] = newX;
        arr[(i + 1) * 3 + 1] = newY - dropLen;
        arr[(i + 1) * 3 + 2] = newZ;
      }
    }
    pos.needsUpdate = true;
  }

  // Mist animation
  if (mists) {
    for (const m of mists) {
      const dx = Math.sin(t * 0.08 * m.speed + m.phase) * m.driftRange;
      const dz = Math.cos(t * 0.06 * m.speed + m.phase) * m.driftRange * 0.7;
      const dy = Math.sin(t * 0.3 + m.phase) * 0.8;

      if (m.layers) {
        for (let l = 0; l < m.layers.length; l++) {
          const sp = m.layers[l];
          const layerPhase = m.phase + l * 1.3;
          const lx = Math.sin(t * 0.08 * m.speed + layerPhase) * m.driftRange;
          const lz = Math.cos(t * 0.06 * m.speed + layerPhase) * m.driftRange * 0.7;
          sp.position.x = m.baseX + lx + (l - 1) * 6;
          sp.position.z = m.baseZ + lz + (l - 1) * 4;
          sp.position.y = m.baseY + dy + (l - 1) * 2;
        }
      }
    }
  }

  // Foam strip animation
  if (foamStrips) {
    for (const f of foamStrips) {
      const pulse = 0.58 + Math.sin(t * 2.5 + f.userData.phase) * 0.27;
      f.material.opacity = pulse;
    }
  }
}
