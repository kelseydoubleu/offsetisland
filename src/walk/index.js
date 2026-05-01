// ════════════════════════════════════════════════════════════════════
// WALK MODULE — First-Person 3D Viewer
// ════════════════════════════════════════════════════════════════════
// Renders the island as a 3D scene with first-person controls,
// weather effects, and internal game time integration.

import * as THREE from 'three';
import { getVisualTime } from '../game/index.js';
import { hash2 } from '../utils/noise.js';
import { tileDepletion } from '../state/extraction.js';
import { scatterNature } from './nature.js';
import {
  createFoamStrips,
  createSnowParticles,
  createRainParticles,
  createMistPuffs,
  updateWeather
} from './weather.js';
import { createQuarryPits, createDumpPiles } from './extraction.js';
import { createBuildings } from './buildings.js';

// ─── CONSTANTS ──────────────────────────────────────────────────────
const METERS_PER_UNIT = 3.3;
const METERS_PER_TILE = 40;
const METERS_PER_ELEV = 1.7;

const WALK_CONFIG = {
  eyeHeight: 1.7,
  walkSpeed: 5,
  runSpeed: 10,
  jumpVelocity: 5.5,
  gravity: -18,
  mouseSens: 0.0022,
  fov: 70
};

// ─── MATERIAL CACHE ─────────────────────────────────────────────────
// Cache materials by color to reduce GPU memory and draw calls
const terrainMaterialCache = new Map();

function getCachedTerrainMaterial(colorHex) {
  if (!terrainMaterialCache.has(colorHex)) {
    terrainMaterialCache.set(colorHex, new THREE.MeshBasicMaterial({
      color: colorHex,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    }));
  }
  return terrainMaterialCache.get(colorHex);
}

// Clear terrain cache when rebuilding scene
function clearTerrainCache() {
  terrainMaterialCache.forEach(m => m.dispose());
  terrainMaterialCache.clear();
}

// ─── WALK STATE ─────────────────────────────────────────────────────
export const WALK = {
  active: false,
  scene: null,
  camera: null,
  renderer: null,
  group: null,
  islandData: null,
  velocity: { x: 0, y: 0, z: 0 },
  yaw: 0,
  pitch: 0,
  keys: {},
  onGround: false,
  rafId: null,
  lastTime: 0,
  fps: 0,
  fpsAcc: 0, fpsCount: 0, fpsLast: 0,
  pointerLocked: false,
  flyMode: false,
  figureGround: false,
  env: null,
  mood: null,
  waterFrame: 0, // Frame counter for throttling water animation
  _inputBound: false,
  _obstacles: [],
  _waterTiles: [],
  _foamStrips: [],
  flocks: [],
  mists: [],
  waves: [],
  _snow: null,
  _rain: null,
  _oceanSet: null,
  _animTime: 0,
  _bobPhase: 0
};

// ─── ELEVATION HELPERS ──────────────────────────────────────────────
export function elevToWalkY(elev) {
  const e = Math.max(0, elev || 0);
  if (e <= 4) return e * METERS_PER_ELEV;
  const base = 4 * METERS_PER_ELEV;
  const extra = (e - 4) * 3.2;
  return base + extra;
}

// ─── GAME ENVIRONMENT ────────────────────────────────────────────────
// Uses internal game time instead of real-world NYC time

// Simple weather cycle based on game day
function getWeatherForDay(day) {
  // Cycle through weather patterns every few days
  const cycle = day % 10;
  if (cycle === 0) return { condition: 'rain', cloudCover: 0.9, precipitation: 0.5 };
  if (cycle === 5) return { condition: 'fog', cloudCover: 0.6, precipitation: 0 };
  if (cycle === 3 || cycle === 7) return { condition: 'cloudy', cloudCover: 0.5, precipitation: 0 };
  if (cycle === 8) return { condition: 'overcast', cloudCover: 0.8, precipitation: 0 };
  return { condition: 'clear', cloudCover: 0.2, precipitation: 0 };
}

export function getGameEnvironment() {
  const visualTime = getVisualTime();
  const weatherData = getWeatherForDay(visualTime.day);

  return {
    hour: visualTime.hour,
    phase: visualTime.phase,
    weather: {
      temperature: 18, // Default mild temperature
      humidity: 60,
      precipitation: weatherData.precipitation,
      cloudCover: weatherData.cloudCover,
      code: 0
    },
    condition: weatherData.condition
  };
}

// Legacy alias for compatibility
export async function nycEnvironment() {
  return getGameEnvironment();
}

// ─── MOOD CALCULATION ───────────────────────────────────────────────
export function moodForEnvironment(env) {
  const { phase, condition } = env;

  const phaseColors = {
    predawn: { top: 0x1A2B4A, mid: 0x4A4868, bot: 0xC58A88 },
    dawn: { top: 0x6896C8, mid: 0xE8B898, bot: 0xFFD590 },
    day: { top: 0xB8D5E8, mid: 0xE8E0D0, bot: 0xF8E8C0 },
    dusk: { top: 0x4A6890, mid: 0xC88858, bot: 0xE8703A },
    evening: { top: 0x2A3858, mid: 0x6A5878, bot: 0xA88068 },
    night: { top: 0x0A1530, mid: 0x1A2845, bot: 0x2A3858 },
  };

  let { top, mid, bot } = phaseColors[phase] || phaseColors.day;

  const blend = (hex, target, k) => {
    const a = new THREE.Color(hex);
    const b = new THREE.Color(target);
    return a.lerp(b, k).getHex();
  };

  let fogStart = 1500, fogEnd = 3000;
  let fogColor = mid;
  let oceanColor = 0x1F5980;

  if (condition === 'overcast' || condition === 'cloudy') {
    const k = condition === 'overcast' ? 0.55 : 0.3;
    top = blend(top, 0x9098A0, k);
    mid = blend(mid, 0xB0B0AC, k * 0.8);
    bot = blend(bot, 0xC0BCB4, k * 0.6);
    fogColor = mid;
    fogStart = condition === 'overcast' ? 1100 : 1300;
    fogEnd = condition === 'overcast' ? 2600 : 2800;
  } else if (condition === 'rain') {
    top = blend(top, 0x707880, 0.65);
    mid = blend(mid, 0x88898A, 0.55);
    bot = blend(bot, 0x9C9890, 0.5);
    fogColor = mid;
    fogStart = 700; fogEnd = 2200;
    oceanColor = blend(oceanColor, 0x404858, 0.4);
  } else if (condition === 'storm') {
    top = blend(top, 0x303440, 0.7);
    mid = blend(mid, 0x484C54, 0.7);
    bot = blend(bot, 0x686460, 0.6);
    fogColor = mid;
    fogStart = 500; fogEnd = 1800;
    oceanColor = blend(oceanColor, 0x2A3038, 0.55);
  } else if (condition === 'fog') {
    top = blend(top, 0xC8C5C0, 0.7);
    mid = blend(mid, 0xD4D0C8, 0.85);
    bot = blend(bot, 0xDCD8D0, 0.85);
    fogColor = mid;
    fogStart = 300; fogEnd = 1100;
  } else if (condition === 'snow') {
    top = blend(top, 0xE0E4EA, 0.55);
    mid = blend(mid, 0xEDECEA, 0.6);
    bot = blend(bot, 0xF0EEEA, 0.6);
    fogColor = mid;
    fogStart = 700; fogEnd = 2400;
  }

  if (phase === 'night') {
    fogColor = top;
    fogStart = Math.min(fogStart, 600);
    fogEnd = Math.min(fogEnd, 2000);
    oceanColor = 0x0A1830;
  }

  let lightTint = 0xFFFFFF, lightBrightness = 1.0;
  if (phase === 'predawn') { lightTint = 0x7888B0; lightBrightness = 0.50; }
  else if (phase === 'dawn') { lightTint = 0xFFE8D0; lightBrightness = 0.92; }
  else if (phase === 'day') { lightTint = 0xFFFFFF; lightBrightness = 1.0; }
  else if (phase === 'dusk') { lightTint = 0xFFD8B8; lightBrightness = 0.85; }
  else if (phase === 'evening') { lightTint = 0x8898C0; lightBrightness = 0.50; }
  else if (phase === 'night') { lightTint = 0x5868A8; lightBrightness = 0.32; }

  if (condition === 'storm') lightBrightness *= 0.7;
  else if (condition === 'overcast') lightBrightness *= 0.85;
  else if (condition === 'rain') lightBrightness *= 0.78;

  return { top, mid, bot, fogColor, fogStart, fogEnd, oceanColor, lightTint, lightBrightness };
}

// ─── SMOOTH ATMOSPHERE TRANSITIONS ──────────────────────────────────
// Lerp speed: higher = faster transitions
const ATMOSPHERE_LERP_SPEED = 0.08; // Smooth but noticeable

function updateAtmosphereSmooth(env) {
  if (!WALK.scene || !WALK.mood) return;

  // Toggle body class for UI styling based on time of day
  const isDaytime = env.phase === 'day' || env.phase === 'dawn';
  document.body.classList.toggle('walk-daytime', isDaytime);
  document.body.classList.toggle('walk-nighttime', !isDaytime);

  const targetMood = moodForEnvironment(env);
  const currentMood = WALK.mood;

  // Helper to lerp colors
  const lerpColor = (current, target, t) => {
    const c = new THREE.Color(current);
    const tgt = new THREE.Color(target);
    return c.lerp(tgt, t).getHex();
  };

  // Lerp all mood values smoothly
  currentMood.top = lerpColor(currentMood.top, targetMood.top, ATMOSPHERE_LERP_SPEED);
  currentMood.mid = lerpColor(currentMood.mid, targetMood.mid, ATMOSPHERE_LERP_SPEED);
  currentMood.bot = lerpColor(currentMood.bot, targetMood.bot, ATMOSPHERE_LERP_SPEED);
  currentMood.fogColor = lerpColor(currentMood.fogColor, targetMood.fogColor, ATMOSPHERE_LERP_SPEED);
  currentMood.fogStart += (targetMood.fogStart - currentMood.fogStart) * ATMOSPHERE_LERP_SPEED;
  currentMood.fogEnd += (targetMood.fogEnd - currentMood.fogEnd) * ATMOSPHERE_LERP_SPEED;
  currentMood.lightBrightness += (targetMood.lightBrightness - currentMood.lightBrightness) * ATMOSPHERE_LERP_SPEED;
  currentMood.lightTint = lerpColor(currentMood.lightTint || 0xFFFFFF, targetMood.lightTint, ATMOSPHERE_LERP_SPEED);

  // Apply fog changes
  if (WALK.scene.fog) {
    WALK.scene.fog.color.setHex(currentMood.fogColor);
    WALK.scene.fog.near = currentMood.fogStart;
    WALK.scene.fog.far = currentMood.fogEnd;
  }

  // Update renderer clear color to match fog
  if (WALK.renderer) {
    WALK.renderer.setClearColor(currentMood.fogColor, 1);
  }

  // Update sky gradient canvas (background texture)
  const canvas = WALK._skyCanvas;
  if (canvas && WALK.scene.background) {
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#' + currentMood.top.toString(16).padStart(6, '0'));
    grad.addColorStop(0.5, '#' + currentMood.mid.toString(16).padStart(6, '0'));
    grad.addColorStop(1, '#' + currentMood.bot.toString(16).padStart(6, '0'));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    WALK.scene.background.needsUpdate = true;
  }

  // Update sky dome vertex colors (the large sphere)
  if (WALK.group) {
    const skyMesh = WALK.group.children.find(c => c.userData?.role === 'sky');
    if (skyMesh && skyMesh.geometry) {
      const pos = skyMesh.geometry.attributes.position;
      const colorAttr = skyMesh.geometry.attributes.color;
      if (pos && colorAttr) {
        const top = new THREE.Color(currentMood.top);
        const mid = new THREE.Color(currentMood.mid);
        const bot = new THREE.Color(currentMood.bot);
        const fogC = new THREE.Color(currentMood.fogColor);

        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i) / 2700; // -1 to +1
          let c;
          if (y > 0.1) {
            const k = Math.pow(Math.min(1, (y - 0.1) / 0.9), 0.8);
            c = mid.clone().lerp(top, k);
          } else if (y > -0.15) {
            const k = (y + 0.15) / 0.25;
            c = bot.clone().lerp(mid, Math.pow(k, 0.7));
          } else if (y > -0.5) {
            const k = (y + 0.5) / 0.35;
            c = fogC.clone().lerp(bot, Math.pow(k, 0.6));
          } else {
            c = fogC.clone();
          }
          colorAttr.setXYZ(i, c.r, c.g, c.b);
        }
        colorAttr.needsUpdate = true;
      }
    }

    // Update hemisphere light intensity and color
    const hemi = WALK.group.children.find(c => c.isHemisphereLight);
    if (hemi) {
      // Brighter overall: 0.4 base + 0.5 * brightness for more daytime light
      hemi.intensity = 0.4 + currentMood.lightBrightness * 0.5;
      hemi.color.setHex(currentMood.lightTint);
    }

    // Update ocean color (infinite ocean)
    const ocean = WALK.group.children.find(c => c.userData?.role === 'world_ocean');
    if (ocean && ocean.material) {
      const targetOcean = targetMood.oceanColor;
      const currentOcean = ocean.material.color.getHex();
      const newOcean = lerpColor(currentOcean, targetOcean, ATMOSPHERE_LERP_SPEED);
      ocean.material.color.setHex(newOcean);

      // Update all water tile meshes to match ocean color
      const waterGroup = WALK.group.children.find(c => c.name === 'water');
      if (waterGroup) {
        waterGroup.traverse(child => {
          if (child.isMesh && child.material && (child.userData?.kind === 'water' || child.userData?.kind === 'pond')) {
            child.material.color.setHex(newOcean);
          }
        });
      }
    }
  }
}

// ─── SCENE BUILDER ──────────────────────────────────────────────────
export function buildThreeScene(state, mood) {
  if (!mood) {
    mood = {
      top: 0xB8D5E8, mid: 0xE8E0D0, bot: 0xF8E8C0,
      fogColor: 0xE8DFC8, fogStart: 1500, fogEnd: 3000,
      oceanColor: 0x1F5980, lightTint: 0xFFFFFF, lightBrightness: 1.0
    };
  }

  const root = new THREE.Group();
  root.name = 'OffcutWorld';

  const terrainGroup = new THREE.Group(); terrainGroup.name = 'terrain';
  const waterGroup = new THREE.Group(); waterGroup.name = 'water';
  const buildingsRoot = new THREE.Group(); buildingsRoot.name = 'buildings';
  root.add(terrainGroup, waterGroup, buildingsRoot);

  const tintR = ((mood.lightTint >> 16) & 0xff) / 255;
  const tintG = ((mood.lightTint >> 8) & 0xff) / 255;
  const tintB = (mood.lightTint & 0xff) / 255;
  const lightB = mood.lightBrightness;

  // Brightness boost for daytime (1.0 at night, 1.3 at full day)
  const brightnessBoost = 0.85 + lightB * 0.45;

  const tintColor = (hex, factor) => {
    const c = new THREE.Color(hex);
    c.r = Math.min(1, c.r * factor * tintR * brightnessBoost);
    c.g = Math.min(1, c.g * factor * tintG * brightnessBoost);
    c.b = Math.min(1, c.b * factor * tintB * brightnessBoost);
    return c.getHex();
  };

  const figureGround = WALK.figureGround;
  // Brighter base colors for better daytime visibility
  const colors = figureGround ? {
    forest: 0xE8E5DE,
    mountain: 0xE2DFD8,
    lowlands: 0xEEEAE0,
    beach: 0xF4F1E7,
    desert: 0xE8E5DC,
    water: 0x1A2838
  } : {
    forest: 0xB8E0B8,    // Brighter green
    mountain: 0xB0BCC8,  // Brighter gray-blue
    lowlands: 0xF0E090,  // Brighter yellow
    beach: 0xF8F0B0,     // Brighter sand
    desert: 0xF0C080,    // Brighter orange
    water: 0x7BC4D8
  };

  const edgeMat = new THREE.LineBasicMaterial({
    color: figureGround ? 0x9C9890 : 0x1A1A18,
    linewidth: 1,
    depthWrite: false,
    transparent: true,
    opacity: 0.85
  });

  const tileSize = METERS_PER_TILE;
  const halfTile = tileSize / 2;

  // Collect all tile edge lines for batch rendering
  const tileEdgeLines = [];

  // Classify ocean vs inland water
  const oceanSet = new Set();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of state.island.tiles) {
    if (t.gx < minX) minX = t.gx; if (t.gx > maxX) maxX = t.gx;
    if (t.gy < minY) minY = t.gy; if (t.gy > maxY) maxY = t.gy;
  }
  const stack = [];
  for (const t of state.island.tiles) {
    if (t.biome !== 'water') continue;
    if (t.gx === minX || t.gx === maxX || t.gy === minY || t.gy === maxY) {
      oceanSet.add(t.gx + ':' + t.gy);
      stack.push(t);
    }
  }
  while (stack.length) {
    const t = stack.pop();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const k = (t.gx+dx) + ':' + (t.gy+dy);
      if (oceanSet.has(k)) continue;
      const nb = state.island.tilesByKey?.get(k);
      if (!nb || nb.biome !== 'water') continue;
      oceanSet.add(k);
      stack.push(nb);
    }
  }
  WALK._oceanSet = oceanSet;

  // Shared water material (reused for all water tiles)
  const waterMat = new THREE.MeshBasicMaterial({ color: mood.oceanColor });

  // Build terrain
  for (const t of state.island.tiles) {
    const x = t.gx * tileSize;
    const z = t.gy * tileSize;
    const elev = elevToWalkY(t.elev);
    let tileColor = colors[t.biome] || 0xE8D87C;
    const isSnowCap = (t.biome === 'mountain' && t.elev >= 10);
    if (isSnowCap) tileColor = 0xCDD4DC;

    // Get tile depletion (0 = untouched, 1 = fully depleted)
    const depletion = tileDepletion(state, t);

    // Per-tile jitter
    const c = new THREE.Color(tileColor);
    const jitter = 0.92 + hash2(t.gx, t.gy, 900) * 0.16;
    c.r = Math.min(1, c.r * jitter);
    c.g = Math.min(1, c.g * jitter);
    c.b = Math.min(1, c.b * jitter);

    // Blend toward exposed earth color based on depletion
    if (depletion > 0) {
      // Dusty tan/brown - exposed stripped earth
      const depletedColor = new THREE.Color(0xB8A080);
      // More aggressive blend for visibility
      const blendFactor = depletion * (0.5 + depletion * 0.5);
      c.lerp(depletedColor, blendFactor);
    }

    tileColor = c.getHex();

    if (t.biome === 'water') {
      const isOcean = oceanSet.has(t.gx + ':' + t.gy);
      if (!isOcean) {
        // Inland pond - use shared water material
        const geo = new THREE.PlaneGeometry(tileSize, tileSize);
        const mesh = new THREE.Mesh(geo, waterMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, Math.max(0.15, elev - 0.5), z);
        mesh.userData = { kind: 'pond', tile: t.id };
        waterGroup.add(mesh);
        continue;
      }

      // Ocean water - use shared water material
      const SEGS = 4;
      const geo = new THREE.PlaneGeometry(tileSize, tileSize, SEGS, SEGS);
      const mesh = new THREE.Mesh(geo, waterMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.1, z);
      mesh.userData = { kind: 'water', tile: t.id, animPhase: hash2(t.gx, t.gy, 830) * Math.PI * 2 };
      waterGroup.add(mesh);
      const basePos = new Float32Array(geo.attributes.position.array);
      mesh.userData.basePos = basePos;
      mesh.userData.tileX = x;
      mesh.userData.tileZ = z;
      if (!WALK._waterTiles) WALK._waterTiles = [];
      WALK._waterTiles.push(mesh);
    } else {
      // Terrain prism
      const baseDepth = 4;
      const totalH = elev + baseDepth;
      const geo = new THREE.BoxGeometry(tileSize, totalH, tileSize);

      // Face materials: [+X, -X, +Y (top), -Y (bottom), +Z, -Z]
      // Brighter values for daytime visibility
      // Use cached materials for better performance
      const matTerrain = [
        getCachedTerrainMaterial(tintColor(tileColor, 0.92)),  // +X side
        getCachedTerrainMaterial(tintColor(tileColor, 0.88)),  // -X side
        getCachedTerrainMaterial(tintColor(tileColor, 1.05)),  // +Y top (slight boost)
        getCachedTerrainMaterial(tintColor(tileColor, 0.70)),  // -Y bottom
        getCachedTerrainMaterial(tintColor(tileColor, 0.85)),  // +Z side
        getCachedTerrainMaterial(tintColor(tileColor, 0.95)),  // -Z side
      ];

      const mesh = new THREE.Mesh(geo, matTerrain);
      mesh.position.set(x, totalH / 2 - baseDepth, z);
      mesh.userData = { kind: 'terrain', biome: t.biome, tile: t.id };
      terrainGroup.add(mesh);

      // Edges at exact tile boundaries (depthTest:false prevents z-fighting)
      const yTop = elev;
      const yBot = -baseDepth;
      const x0 = x - halfTile, x1 = x + halfTile;
      const z0 = z - halfTile, z1 = z + halfTile;

      // Top rectangle edges
      tileEdgeLines.push(
        x0, yTop, z0,  x1, yTop, z0,  // front edge
        x1, yTop, z0,  x1, yTop, z1,  // right edge
        x1, yTop, z1,  x0, yTop, z1,  // back edge
        x0, yTop, z1,  x0, yTop, z0   // left edge
      );

      // Vertical corner edges
      tileEdgeLines.push(
        x0, yBot, z0,  x0, yTop, z0,  // front-left
        x1, yBot, z0,  x1, yTop, z0,  // front-right
        x1, yBot, z1,  x1, yTop, z1,  // back-right
        x0, yBot, z1,  x0, yTop, z1   // back-left
      );

      // Bottom rectangle edges
      tileEdgeLines.push(
        x0, yBot, z0,  x1, yBot, z0,  // front edge
        x1, yBot, z0,  x1, yBot, z1,  // right edge
        x1, yBot, z1,  x0, yBot, z1,  // back edge
        x0, yBot, z1,  x0, yBot, z0   // left edge
      );
    }
  }

  // Create single LineSegments for all tile edges
  if (tileEdgeLines.length > 0) {
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(tileEdgeLines, 3));
    const tileOutlines = new THREE.LineSegments(edgeGeo, edgeMat);
    tileOutlines.renderOrder = 1;
    terrainGroup.add(tileOutlines);
  }

  // ── INTER-TILE BOUNDARY EDGES ─────────────────────────────────────
  // Draw edge lines where a tile meets a taller neighbor
  const boundaryLines = [];

  for (const t of state.island.tiles) {
    if (t.biome === 'water') continue;

    const x = t.gx * tileSize;
    const z = t.gy * tileSize;
    const elev = elevToWalkY(t.elev);

    // Check each neighbor direction: [dx, dy, corner1offset, corner2offset]
    const neighbors = [
      [1, 0, [halfTile, elev, -halfTile], [halfTile, elev, halfTile]],   // +X neighbor
      [-1, 0, [-halfTile, elev, -halfTile], [-halfTile, elev, halfTile]], // -X neighbor
      [0, 1, [-halfTile, elev, halfTile], [halfTile, elev, halfTile]],   // +Z neighbor
      [0, -1, [-halfTile, elev, -halfTile], [halfTile, elev, -halfTile]]  // -Z neighbor
    ];

    for (const [dx, dy, c1, c2] of neighbors) {
      const nKey = (t.gx + dx) + ':' + (t.gy + dy);
      const neighbor = state.island.tilesByKey?.get(nKey);

      // Draw edge if neighbor is taller
      if (neighbor && neighbor.biome !== 'water') {
        const neighborElev = elevToWalkY(neighbor.elev);
        if (neighborElev > elev + 0.1) {
          // Neighbor is taller - draw edge at our top surface
          boundaryLines.push(
            x + c1[0], c1[1] + 0.02, z + c1[2],
            x + c2[0], c2[1] + 0.02, z + c2[2]
          );
        }
      }
    }
  }

  if (boundaryLines.length > 0) {
    const boundaryGeo = new THREE.BufferGeometry();
    boundaryGeo.setAttribute('position', new THREE.Float32BufferAttribute(boundaryLines, 3));
    const boundaryEdges = new THREE.LineSegments(boundaryGeo, edgeMat);
    boundaryEdges.renderOrder = 2;
    terrainGroup.add(boundaryEdges);
  }

  // Figure-ground mode helper: returns color or grayscale based on mode
  const figGround = (colorHex, grayLevel) => {
    return figureGround ? Math.round(grayLevel * 255) * 0x010101 : colorHex;
  };

  // Clear obstacles for fresh scatter
  WALK._obstacles = [];

  // Scatter nature (trees, rocks, grass, palms) - skip in figure-ground mode
  if (!figureGround) {
    scatterNature(state, terrainGroup, tileSize, elevToWalkY, tintColor, figGround, WALK._obstacles);
  }

  // ── EXTRACTION VISUALS ─────────────────────────────────────────────
  // Quarry pits on depleted mountain tiles, dump piles where waste deposited
  if (!figureGround) {
    createQuarryPits(state, terrainGroup, tileSize, elevToWalkY, tintColor, figGround);
    createDumpPiles(state, terrainGroup, tileSize, elevToWalkY, tintColor, figGround, WALK._obstacles);
  }

  // ── BUILDINGS ──────────────────────────────────────────────────────
  // 3D buildings on tiles with built/populated structures
  createBuildings(state, root, tileSize, elevToWalkY, mood, figureGround);

  // Create birds
  const flocks = [];
  const birdGeo = new THREE.BufferGeometry();
  const bv = new Float32Array([
    -1.2, 0.0, 0.0, -0.4, 0.3, 0.0, 0, 0.0, 0.0,
    0, 0.0, 0.0, 0.4, 0.3, 0.0, 1.2, 0.0, 0.0
  ]);
  birdGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x1A1A18, side: THREE.DoubleSide });

  let cx = 0, cy = 0, n = 0;
  for (const t of state.island.tiles) {
    if (t.biome === 'water') continue;
    cx += t.gx; cy += t.gy; n++;
  }
  if (n) { cx /= n; cy /= n; }
  cx *= METERS_PER_TILE;
  cy *= METERS_PER_TILE;

  const FLOCK_COUNT = 4;
  const BIRDS_PER = 6;
  for (let f = 0; f < FLOCK_COUNT; f++) {
    const flockGroup = new THREE.Group();
    const radius = 180 + f * 70;
    const altitude = 60 + (f % 2) * 30;
    const phaseBase = f * 1.7;
    const speed = 0.15 + f * 0.04;
    const offsetX = (hash2(f, 1, 800) - 0.5) * 200;
    const offsetZ = (hash2(f, 2, 801) - 0.5) * 200;
    const birds = [];
    for (let i = 0; i < BIRDS_PER; i++) {
      const m = new THREE.Mesh(birdGeo, birdMat);
      const bs = 2.2 + hash2(f, i, 802) * 0.8;
      m.scale.setScalar(bs);
      flockGroup.add(m);
      birds.push({ mesh: m, phase: phaseBase + i * 0.4, baseScale: bs });
    }
    flocks.push({
      group: flockGroup, birds, radius, altitude, speed,
      center: { x: cx + offsetX, z: cy + offsetZ }
    });
    root.add(flockGroup);
  }
  WALK.flocks = flocks;

  // ── HEMISPHERE LIGHT ────────────────────────────────────────────
  // Sky color, ground color, intensity - brighter for daytime
  const hemiIntensity = 0.4 + (mood?.lightBrightness || 1.0) * 0.5;
  const hemi = new THREE.HemisphereLight(0xC8DBE8, 0xE8D8B8, hemiIntensity);
  root.add(hemi);

  // ── SKY DOME ────────────────────────────────────────────────────
  // Large inverted sphere with vertex-color gradient based on mood
  if (!figureGround) {
    const skyGeo = new THREE.SphereGeometry(2700, 32, 16);
    const colors = [];
    const top = new THREE.Color(mood.top);
    const mid = new THREE.Color(mood.mid);
    const bot = new THREE.Color(mood.bot);
    const fogC = new THREE.Color(mood.fogColor);
    const pos = skyGeo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 2700;   // -1 (bottom) to +1 (top)
      let c;
      if (y > 0.1) {
        // Above horizon — blend mid → top
        const k = Math.pow(Math.min(1, (y - 0.1) / 0.9), 0.8);
        c = mid.clone().lerp(top, k);
      } else if (y > -0.15) {
        // Horizon band — bot → mid
        const k = (y + 0.15) / 0.25;
        c = bot.clone().lerp(mid, Math.pow(k, 0.7));
      } else if (y > -0.5) {
        // Below horizon — fade to fog color
        const k = (y + 0.5) / 0.35;
        c = fogC.clone().lerp(bot, Math.pow(k, 0.6));
      } else {
        c = fogC.clone();
      }
      colors.push(c.r, c.g, c.b);
    }

    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.userData = { role: 'sky' };
    sky.renderOrder = -1;
    root.add(sky);
  }

  // ── INFINITE OCEAN ──────────────────────────────────────────────
  // Large disc at sea level extending past the island
  {
    let cxL = 0, czL = 0, nL = 0;
    for (const t of state.island.tiles) {
      cxL += t.gx; czL += t.gy; nL++;
    }
    if (nL) { cxL /= nL; czL /= nL; }
    cxL *= tileSize;
    czL *= tileSize;

    const oceanGeo = new THREE.CircleGeometry(2800, 96);
    const ocean = new THREE.Mesh(oceanGeo, waterMat);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(cxL, -3, czL);
    ocean.userData = { role: 'world_ocean' };
    ocean.renderOrder = -0.5;
    root.add(ocean);
  }

  // ── FOAM STRIPS ─────────────────────────────────────────────────
  if (!figureGround) {
    WALK._foamStrips = createFoamStrips(state, root, tileSize, elevToWalkY, tintColor, figGround, WALK._oceanSet);
  }

  // ── WEATHER EFFECTS ─────────────────────────────────────────────
  if (!figureGround && WALK.env) {
    const condition = WALK.env.condition;

    if (condition === 'snow') {
      WALK._snow = createSnowParticles(root, WALK.camera, tintColor);
    }

    if (condition === 'rain' || condition === 'storm') {
      WALK._rain = createRainParticles(root, WALK.camera, condition, tintColor);
    }

    // Mist for fog, storm, rain, overcast, cloudy
    if (['fog', 'storm', 'rain', 'overcast', 'cloudy'].includes(condition)) {
      WALK.mists = createMistPuffs(root, state, condition, tileSize, tintColor, WALK.env.phase);
    }
  }

  return root;
}

// ─── GROUND HEIGHT SAMPLING ─────────────────────────────────────────
export function sampleGroundHeight(x, z) {
  const gx = Math.round(x / METERS_PER_TILE);
  const gy = Math.round(z / METERS_PER_TILE);
  const t = WALK.islandData?.tilesByKey?.get(gx + ':' + gy);
  if (!t || t.biome === 'water') return 0;
  return elevToWalkY(t.elev);
}

export function isOnWater(x, z) {
  const gx = Math.round(x / METERS_PER_TILE);
  const gy = Math.round(z / METERS_PER_TILE);
  const t = WALK.islandData?.tilesByKey?.get(gx + ':' + gy);
  if (!t) return true;
  return t.biome === 'water';
}

// ─── WALK INITIALIZATION ────────────────────────────────────────────
export async function ensureWalkInitialized(state) {
  if (WALK.scene) return;

  WALK.figureGround = (state.viewStyle === 'mono');

  let env, mood;
  try {
    env = getGameEnvironment();
    mood = moodForEnvironment(env);
    WALK.env = env;
    WALK.mood = mood;
    console.log('Game env:', env);
  } catch (err) {
    console.warn('Env fetch failed:', err.message);
    mood = null;
  }

  const canvas = document.getElementById('walk-canvas');
  if (!canvas) return;

  const W = canvas.clientWidth;
  const H = canvas.clientHeight;

  WALK.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  WALK.renderer.setSize(W, H, false);
  WALK.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  if (WALK.figureGround) {
    mood = {
      top: 0xF0EEE8, mid: 0xF0EEE8, bot: 0xF0EEE8,
      fogColor: 0xF0EEE8, fogStart: 1500, fogEnd: 3000,
      oceanColor: 0x1A2838, lightTint: 0xFFFFFF, lightBrightness: 1.0
    };
    WALK.mood = mood;
  }

  const clearC = mood ? mood.fogColor : 0xE8E0D0;
  WALK.renderer.setClearColor(clearC, 1);

  WALK.scene = new THREE.Scene();

  // Create gradient sky canvas for smooth transitions
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 2;
  skyCanvas.height = 512;
  const skyCtx = skyCanvas.getContext('2d');
  const grad = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
  grad.addColorStop(0, '#' + (mood?.top || 0xB8D5E8).toString(16).padStart(6, '0'));
  grad.addColorStop(0.5, '#' + (mood?.mid || 0xE8E0D0).toString(16).padStart(6, '0'));
  grad.addColorStop(1, '#' + (mood?.bot || 0xF8E8C0).toString(16).padStart(6, '0'));
  skyCtx.fillStyle = grad;
  skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);

  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  WALK._skyCanvas = skyCanvas;
  WALK.scene.background = skyTexture;
  WALK.scene.fog = new THREE.Fog(clearC, mood?.fogStart || 600, mood?.fogEnd || 2400);

  WALK.camera = new THREE.PerspectiveCamera(WALK_CONFIG.fov, W / H, 0.1, 3000);

  WALK.group = buildThreeScene(state, mood);
  if (WALK.group) WALK.scene.add(WALK.group);

  WALK.islandData = state.island;

  // Start in fly mode overlooking the island
  const start = pickFlyStartPosition(state);
  WALK.camera.position.set(start.x, start.y, start.z);
  WALK.yaw = start.yaw;
  WALK.pitch = start.pitch;
  WALK.flyMode = true; // Start in fly mode
  WALK.velocity = { x: 0, y: 0, z: 0 };

  window.addEventListener('resize', onWalkResize);
}

function pickWalkStartPosition(state) {
  const tiles = state.island.tiles;
  let cx = 0, cy = 0, n = 0;
  for (const t of tiles) {
    if (t.biome === 'water') continue;
    cx += t.gx; cy += t.gy; n++;
  }
  if (n) { cx /= n; cy /= n; }

  const biomeRank = (b) => {
    if (b === 'lowlands' || b === 'beach' || b === 'desert') return 0;
    if (b === 'forest') return 1;
    if (b === 'mountain') return 3;
    return 2;
  };

  let best = null, bestKey = Infinity;
  for (const t of tiles) {
    if (t.biome === 'water') continue;
    if (t.populated) continue;
    const dx = t.gx - cx, dy = t.gy - cy;
    const dist = dx*dx + dy*dy;
    const key = biomeRank(t.biome) * 1000 + dist;
    if (key < bestKey) { bestKey = key; best = t; }
  }
  if (!best) return { x: 0, y: 1, z: 0 };
  return {
    x: best.gx * METERS_PER_TILE,
    y: elevToWalkY(best.elev) + 0.5,
    z: best.gy * METERS_PER_TILE
  };
}

// Start position for fly mode - overlooking the island from above
function pickFlyStartPosition(state) {
  const tiles = state.island.tiles;
  let cx = 0, cz = 0, n = 0;
  let maxElev = 0;
  for (const t of tiles) {
    if (t.biome === 'water') continue;
    cx += t.gx; cz += t.gy; n++;
    if (t.elev > maxElev) maxElev = t.elev;
  }
  if (n) { cx /= n; cz /= n; }

  // Position camera offset from center, looking toward island
  const offsetDist = 120; // Distance from center
  const height = 80 + elevToWalkY(maxElev); // Above the highest point

  return {
    x: (cx - 3) * METERS_PER_TILE, // Offset to southwest
    y: height,
    z: (cz - 3) * METERS_PER_TILE,
    yaw: Math.PI * 0.25, // Looking northeast toward center
    pitch: -0.4 // Looking down at the island
  };
}

function onWalkResize() {
  if (!WALK.renderer || !WALK.camera) return;
  const canvas = document.getElementById('walk-canvas');
  if (!canvas) return;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  WALK.renderer.setSize(W, H, false);
  WALK.camera.aspect = W / H;
  WALK.camera.updateProjectionMatrix();
}

// ─── INPUT HANDLERS ─────────────────────────────────────────────────
export function setupWalkInputHandlers() {
  if (WALK._inputBound) return;
  WALK._inputBound = true;

  const overlay = document.getElementById('walk-overlay');
  if (overlay) {
    overlay.addEventListener('click', () => {
      if (WALK.active) enterWalkMode();
    });
  }

  const canvas = document.getElementById('walk-canvas');
  if (canvas) {
    canvas.addEventListener('click', () => {
      if (WALK.active && !WALK.pointerLocked && !WALK._noPointerLock) enterWalkMode();
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      WALK._dragging = true;
      WALK._lastDragX = e.clientX;
      WALK._lastDragY = e.clientY;
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  document.addEventListener('mouseup', () => {
    if (WALK._dragging) {
      WALK._dragging = false;
      const c = document.getElementById('walk-canvas');
      if (c) c.style.cursor = 'crosshair';
    }
  });

  document.addEventListener('pointerlockchange', () => {
    WALK.pointerLocked = (document.pointerLockElement === document.getElementById('walk-canvas'));
    const ov = document.getElementById('walk-overlay');
    const hud = document.getElementById('walk-hud');
    if (ov) ov.style.display = WALK.pointerLocked ? 'none' : 'flex';
    if (hud) hud.style.display = WALK.pointerLocked ? 'block' : 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!WALK.active) return;
    if (WALK.pointerLocked) {
      WALK.yaw -= e.movementX * WALK_CONFIG.mouseSens;
      WALK.pitch -= e.movementY * WALK_CONFIG.mouseSens;
    } else if (WALK._dragging) {
      const dx = e.clientX - WALK._lastDragX;
      const dy = e.clientY - WALK._lastDragY;
      WALK._lastDragX = e.clientX;
      WALK._lastDragY = e.clientY;
      WALK.yaw -= dx * WALK_CONFIG.mouseSens * 1.4;
      WALK.pitch -= dy * WALK_CONFIG.mouseSens * 1.4;
    } else return;
    const lim = Math.PI / 2 - 0.05;
    WALK.pitch = Math.max(-lim, Math.min(lim, WALK.pitch));
  });

  document.addEventListener('keydown', (e) => {
    if (!WALK.active) return;
    WALK.keys[e.code] = true;
    if (e.code === 'KeyF') {
      e.preventDefault();
      toggleFlyMode();
    }
    if (e.code === 'Space' && WALK.onGround && !WALK.flyMode) {
      WALK.velocity.y = WALK_CONFIG.jumpVelocity;
      WALK.onGround = false;
    }
  });

  document.addEventListener('keyup', (e) => {
    WALK.keys[e.code] = false;
  });
}

function enterWalkMode() {
  const canvas = document.getElementById('walk-canvas');
  if (!canvas) return;

  // Disable pointer lock - use click-drag to look instead
  // This keeps the cursor visible and feels more natural
  WALK._noPointerLock = true;
  document.getElementById('walk-overlay').style.display = 'none';
  document.getElementById('walk-hud').style.display = 'block';
  canvas.style.cursor = 'crosshair';
}

function toggleFlyMode() {
  WALK.flyMode = !WALK.flyMode;
  WALK.velocity.y = 0;
  if (WALK.flyMode) {
    WALK.camera.position.y += 30;
  }
}

// ─── ANIMATION LOOP ─────────────────────────────────────────────────
export function startWalkLoop() {
  if (WALK.rafId) return;
  WALK.lastTime = performance.now();
  WALK.fpsLast = WALK.lastTime;
  WALK.fpsAcc = 0; WALK.fpsCount = 0;

  const tick = (now) => {
    if (!WALK.active) { WALK.rafId = null; return; }
    WALK.rafId = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - WALK.lastTime) / 1000);
    WALK.lastTime = now;
    updateWalk(dt);
    WALK.renderer.render(WALK.scene, WALK.camera);

    // Update minimap and atmosphere every 500ms
    WALK.fpsAcc += dt; WALK.fpsCount++;
    if (now - WALK.fpsLast > 500) {
      WALK.fpsAcc = 0; WALK.fpsCount = 0; WALK.fpsLast = now;

      // Update minimap
      drawMinimap();

      // Smoothly update atmosphere colors
      const currentEnv = getGameEnvironment();
      WALK.env = currentEnv;
      updateAtmosphereSmooth(currentEnv);
    }
  };
  WALK.rafId = requestAnimationFrame(tick);
}

export function stopWalkLoop() {
  if (WALK.rafId) cancelAnimationFrame(WALK.rafId);
  WALK.rafId = null;
}

// ─── MINIMAP ─────────────────────────────────────────────────────────
// Draws all tiles top-down with player marker and view cone.
function drawMinimap() {
  const canvas = document.getElementById('walk-minimap-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;

  const tiles = WALK.islandData?.tiles;
  if (!tiles || !tiles.length) return;

  // Determine island bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of tiles) {
    if (t.gx < minX) minX = t.gx;
    if (t.gx > maxX) maxX = t.gx;
    if (t.gy < minZ) minZ = t.gy;
    if (t.gy > maxZ) maxZ = t.gy;
  }

  const padding = 8;
  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const scale = Math.min((W - padding * 2) / spanX, (H - padding * 2) / spanZ);
  const offX = padding + (W - padding * 2 - spanX * scale) / 2 - minX * scale;
  const offZ = padding + (H - padding * 2 - spanZ * scale) / 2 - minZ * scale;

  ctx.clearRect(0, 0, W, H);

  // Tile colors matching atlas palette
  const tileColors = {
    water: '#7BC4D8',
    forest: '#A8D5A8',
    mountain: '#9BA8B5',
    lowlands: '#E8D87C',
    beach: '#F2E5A0',
    desert: '#E8B068'
  };

  const tilePx = Math.max(2, scale);
  for (const t of tiles) {
    ctx.fillStyle = tileColors[t.biome] || '#E8D87C';
    const x = t.gx * scale + offX;
    const y = t.gy * scale + offZ;
    ctx.fillRect(x - tilePx / 2, y - tilePx / 2, tilePx, tilePx);
  }

  // Built/populated markers — small dark dots
  ctx.fillStyle = '#1A1A18';
  for (const t of tiles) {
    if (t.populated || t.built) {
      const x = t.gx * scale + offX;
      const y = t.gy * scale + offZ;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, tilePx * 0.18), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Player position
  const playerGX = WALK.camera.position.x / METERS_PER_TILE;
  const playerGZ = WALK.camera.position.z / METERS_PER_TILE;
  const px = playerGX * scale + offX;
  const py = playerGZ * scale + offZ;

  // View cone — faint accent fan pointing in look direction
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-WALK.yaw);
  ctx.fillStyle = 'rgba(232, 75, 122, 0.22)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const coneR = 18;
  const coneA = 0.6;
  ctx.arc(0, 0, coneR, -Math.PI / 2 - coneA, -Math.PI / 2 + coneA);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Player dot
  ctx.beginPath();
  ctx.arc(px, py, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#E84B7A';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#1A1A18';
  ctx.stroke();
}

function updateWalk(dt) {
  // Apply yaw/pitch to camera
  const cosP = Math.cos(WALK.pitch), sinP = Math.sin(WALK.pitch);
  const cosY = Math.cos(WALK.yaw), sinY = Math.sin(WALK.yaw);
  const fwd = new THREE.Vector3(-sinY * cosP, sinP, -cosY * cosP);
  const right = new THREE.Vector3(cosY, 0, -sinY);
  const lookAt = WALK.camera.position.clone().add(fwd);
  WALK.camera.lookAt(lookAt);

  // Arrow keys turn
  const TURN_RATE = 1.7;
  if (WALK.keys['ArrowLeft']) WALK.yaw += TURN_RATE * dt;
  if (WALK.keys['ArrowRight']) WALK.yaw -= TURN_RATE * dt;
  if (WALK.keys['ArrowUp']) WALK.pitch += TURN_RATE * 0.7 * dt;
  if (WALK.keys['ArrowDown']) WALK.pitch -= TURN_RATE * 0.7 * dt;
  const lim = Math.PI / 2 - 0.05;
  WALK.pitch = Math.max(-lim, Math.min(lim, WALK.pitch));

  // Recompute look
  const cosY2 = Math.cos(WALK.yaw), sinY2 = Math.sin(WALK.yaw);
  const cosP2 = Math.cos(WALK.pitch), sinP2 = Math.sin(WALK.pitch);
  const fwd2 = new THREE.Vector3(-sinY2 * cosP2, sinP2, -cosY2 * cosP2);
  const right2 = new THREE.Vector3(cosY2, 0, -sinY2);

  // Movement
  const flying = WALK.flyMode;
  const speed = (WALK.keys['ShiftLeft'] || WALK.keys['ShiftRight'])
    ? (flying ? WALK_CONFIG.runSpeed * 4 : WALK_CONFIG.runSpeed)
    : (flying ? WALK_CONFIG.runSpeed * 2 : WALK_CONFIG.walkSpeed);

  const moveDir = new THREE.Vector3(0, 0, 0);
  if (flying) {
    if (WALK.keys['KeyW']) moveDir.add(fwd2);
    if (WALK.keys['KeyS']) moveDir.sub(fwd2);
    if (WALK.keys['KeyD']) moveDir.add(right2);
    if (WALK.keys['KeyA']) moveDir.sub(right2);
    if (WALK.keys['Space']) moveDir.y += 1;
    if (WALK.keys['KeyC'] || WALK.keys['ControlLeft']) moveDir.y -= 1;
  } else {
    const fwdH = new THREE.Vector3(-sinY2, 0, -cosY2);
    if (WALK.keys['KeyW']) moveDir.add(fwdH);
    if (WALK.keys['KeyS']) moveDir.sub(fwdH);
    if (WALK.keys['KeyD']) moveDir.add(right2);
    if (WALK.keys['KeyA']) moveDir.sub(right2);
  }

  const lookAt2 = WALK.camera.position.clone().add(fwd2);
  WALK.camera.lookAt(lookAt2);

  if (moveDir.lengthSq() > 0.001) {
    moveDir.normalize().multiplyScalar(speed * dt);
    let newX = WALK.camera.position.x + moveDir.x;
    let newZ = WALK.camera.position.z + moveDir.z;

    if (!flying) {
      if (isOnWater(newX, WALK.camera.position.z)) newX = WALK.camera.position.x;
      if (isOnWater(newX, newZ)) newZ = WALK.camera.position.z;
    }

    WALK.camera.position.x = newX;
    WALK.camera.position.z = newZ;
    if (flying) WALK.camera.position.y += moveDir.y;
  }

  if (flying) {
    WALK.velocity.y = 0;
    WALK.onGround = false;
  } else {
    if (!WALK.onGround) {
      WALK.velocity.y += WALK_CONFIG.gravity * dt;
    }
    WALK.camera.position.y += WALK.velocity.y * dt;

    const groundY = sampleGroundHeight(WALK.camera.position.x, WALK.camera.position.z);
    const targetY = groundY + WALK_CONFIG.eyeHeight;

    if (WALK.camera.position.y <= targetY && WALK.velocity.y <= 0) {
      WALK.camera.position.y = targetY;
      WALK.velocity.y = 0;
      WALK.onGround = true;
    } else {
      WALK.onGround = false;
    }
  }

  // Animate birds
  WALK._animTime = (WALK._animTime || 0) + dt;
  const t = WALK._animTime;

  if (WALK.flocks) {
    for (const fl of WALK.flocks) {
      for (const b of fl.birds) {
        const ang = b.phase + t * fl.speed;
        const x = fl.center.x + Math.cos(ang) * fl.radius;
        const z = fl.center.z + Math.sin(ang) * fl.radius;
        const y = fl.altitude + Math.sin(t * 0.6 + b.phase) * 6;
        b.mesh.position.set(x, y, z);
        b.mesh.lookAt(x - Math.sin(ang), y, z + Math.cos(ang));
        const flap = 0.85 + Math.sin(t * 6 + b.phase * 2) * 0.18;
        b.mesh.scale.y = flap * b.baseScale;
      }
    }
  }

  // Animate water (throttled to every 3rd frame for performance)
  WALK.waterFrame = (WALK.waterFrame + 1) % 3;
  if (WALK.waterFrame === 0 && WALK._waterTiles) {
    for (const wt of WALK._waterTiles) {
      const pos = wt.geometry.attributes.position;
      const base = wt.userData.basePos;
      const phase = wt.userData.animPhase;
      const tileX = wt.userData.tileX;
      const tileZ = wt.userData.tileZ;
      for (let i = 0; i < pos.count; i++) {
        const bx = base[i*3];
        const by = base[i*3 + 1];
        const wx = tileX + bx;
        const wz = tileZ + by;
        const wave = Math.sin(wx * 0.04 + t * 1.3 + phase) * 0.35
                   + Math.sin(wz * 0.06 + t * 1.7 + phase * 1.3) * 0.25
                   + Math.sin((wx + wz) * 0.03 + t * 0.9) * 0.2;
        pos.setZ(i, wave);
      }
      pos.needsUpdate = true;
    }
  }
}

// ─── ACTIVATION / DEACTIVATION ──────────────────────────────────────
export async function activateWalkMode(state) {
  if (WALK.active) return;

  const walkWrap = document.getElementById('walk-wrap');
  const walkLoading = document.getElementById('walk-loading');
  const walkOverlay = document.getElementById('walk-overlay');
  const walkHud = document.getElementById('walk-hud');

  if (walkWrap) walkWrap.style.display = 'block';
  if (walkLoading) walkLoading.style.display = 'flex';
  if (walkOverlay) walkOverlay.style.display = 'none';
  if (walkHud) walkHud.style.display = 'none';

  try {
    await ensureWalkInitialized(state);
  } catch (err) {
    if (walkLoading) {
      walkLoading.innerHTML = `<div style="color:var(--accent);font-size:11px;">Failed to load 3D: ${err.message}</div>`;
    }
    return;
  }

  // Check if buildings need to be refreshed (e.g., after new build commit)
  if (state._walkBuildingsStale && WALK.group) {
    refreshWalkBuildings(state);
    state._walkBuildingsStale = false;
  }

  WALK.active = true;
  setupWalkInputHandlers();

  if (walkLoading) walkLoading.style.display = 'none';
  if (walkOverlay) walkOverlay.style.display = 'flex';

  onWalkResize();
  startWalkLoop();
}

// Refresh buildings in the walk scene (after new build commit)
export function refreshWalkBuildings(state) {
  if (!WALK.group) return;

  const tileSize = METERS_PER_TILE;
  const mood = WALK.mood;
  const figureGround = WALK.figureGround;

  // Helper to dispose a group's geometry/materials
  const disposeGroup = (group) => {
    group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  };

  // Find and remove old buildings group
  const oldBuildings = WALK.group.getObjectByName('buildings');
  if (oldBuildings) {
    WALK.group.remove(oldBuildings);
    disposeGroup(oldBuildings);
  }

  // Find terrain group and remove nature instances (trees, rocks, etc.)
  // These need to be recreated so newly-built tiles don't have trees
  const terrainGroup = WALK.group.getObjectByName('terrain');
  if (terrainGroup) {
    // Remove all instanced meshes (nature elements) from terrain
    const toRemove = [];
    terrainGroup.traverse(obj => {
      if (obj.isInstancedMesh) {
        toRemove.push(obj);
      }
    });
    for (const obj of toRemove) {
      terrainGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }

    // Re-scatter nature (with updated tile.populated info)
    const tintColor = (hex, factor) => {
      const c = new THREE.Color(hex);
      const tintR = ((mood?.lightTint >> 16) & 0xff) / 255 || 1;
      const tintG = ((mood?.lightTint >> 8) & 0xff) / 255 || 1;
      const tintB = (mood?.lightTint & 0xff) / 255 || 1;
      const lightB = mood?.lightBrightness || 1;
      c.r = Math.min(1, c.r * factor * tintR * lightB);
      c.g = Math.min(1, c.g * factor * tintG * lightB);
      c.b = Math.min(1, c.b * factor * tintB * lightB);
      return c.getHex();
    };
    const figGround = (hex) => figureGround ? 0xE8E6E0 : hex;

    WALK._obstacles = [];
    if (!figureGround) {
      scatterNature(state, terrainGroup, tileSize, elevToWalkY, tintColor, figGround, WALK._obstacles);
    }
  }

  // Create new buildings
  createBuildings(state, WALK.group, tileSize, elevToWalkY, mood, figureGround);
  console.log('Walk buildings and nature refreshed');
}

export function deactivateWalkMode() {
  if (!WALK.active) return;
  WALK.active = false;
  stopWalkLoop();

  if (document.pointerLockElement) {
    document.exitPointerLock();
  }

  // Remove time-of-day classes
  document.body.classList.remove('walk-daytime', 'walk-nighttime');

  const walkWrap = document.getElementById('walk-wrap');
  const walkLoading = document.getElementById('walk-loading');
  const walkOverlay = document.getElementById('walk-overlay');
  const walkHud = document.getElementById('walk-hud');

  if (walkWrap) walkWrap.style.display = 'none';
  if (walkLoading) walkLoading.style.display = 'none';
  if (walkOverlay) walkOverlay.style.display = 'none';
  if (walkHud) walkHud.style.display = 'none';

  WALK.velocity.y = 0;
}
