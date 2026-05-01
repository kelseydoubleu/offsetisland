// ════════════════════════════════════════════════════════════════════
// ISO SCATTER — Trees, Rocks, Grass for SVG Isometric View
// ════════════════════════════════════════════════════════════════════
// Renders biome-specific scatter elements on tile surfaces.

import { hash2 } from '../utils/noise.js';
import { TILE_W, TILE_H } from '../utils/projection.js';

// ─── SCATTER POSITIONS ────────────────────────────────────────────────
// Generate N positions inside the tile's diamond top face.
function scatterPositions(t, cx, cy, count, seedBase) {
  const positions = [];
  const padW = TILE_W * 0.78;
  const padH = TILE_H * 0.78;
  for (let i = 0; i < count; i++) {
    let attempts = 0;
    while (attempts < 6) {
      const u = hash2(t.gx, t.gy, seedBase + i * 3.7) * 2 - 1;
      const v = hash2(t.gx, t.gy, seedBase + i * 3.7 + 0.5) * 2 - 1;
      if (Math.abs(u) + Math.abs(v) <= 1) {
        positions.push({ x: cx + u * padW, y: cy + v * padH });
        break;
      }
      attempts++;
      seedBase += 0.07;
    }
  }
  return positions;
}

// ─── FOREST SCATTER ────────────────────────────────────────────────────
// Dense canopy with varied tree sizes. 18-22 per tile.
function scatterForest(t, cx, cy, isFigure, scatterScale = 1) {
  const baseN = 18 + Math.floor(hash2(t.gx, t.gy, 100) * 5);
  const n = Math.max(0, Math.floor(baseN * scatterScale));
  if (n === 0) return '';
  const pos = scatterPositions(t, cx, cy, n, 51);
  pos.sort((a, b) => a.y - b.y);

  let s = '';
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    const r = hash2(p.x, p.y, 23);
    let sz, fill, stroke, hasTrunk;
    if (r < 0.40) {
      sz = 1.6 + hash2(p.x, p.y, 7) * 0.6;
      fill = isFigure ? '#9A9690' : '#7BB088';
      stroke = isFigure ? '#5A5550' : '#4A7A55';
      hasTrunk = false;
    } else if (r < 0.80) {
      sz = 2.6 + hash2(p.x, p.y, 7) * 0.8;
      fill = isFigure ? '#7A766B' : '#5A9468';
      stroke = isFigure ? '#3A3A38' : '#3A6840';
      hasTrunk = true;
    } else {
      sz = 3.6 + hash2(p.x, p.y, 7) * 1.2;
      fill = isFigure ? '#5A5550' : '#3F7A4D';
      stroke = isFigure ? '#1A1A18' : '#234A2C';
      hasTrunk = true;
    }
    const ax = p.x.toFixed(1), ay = (p.y - sz).toFixed(1);
    const blx = (p.x - sz * 0.65).toFixed(1), bly = (p.y + sz * 0.4).toFixed(1);
    const brx = (p.x + sz * 0.65).toFixed(1), bry = (p.y + sz * 0.4).toFixed(1);
    s += `<path d="M ${ax} ${ay} L ${brx} ${bry} L ${blx} ${bly} Z" fill="${fill}" stroke="${stroke}" stroke-width="0.35" opacity="${isFigure ? '0.85' : '0.94'}"/>`;
    if (hasTrunk) {
      const trunkColor = isFigure ? '#3A3A38' : '#3A2A1A';
      s += `<line x1="${p.x.toFixed(1)}" y1="${(p.y + sz * 0.4).toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${(p.y + sz * 0.75).toFixed(1)}" stroke="${trunkColor}" stroke-width="0.5" opacity="0.85"/>`;
    }
  }
  return s;
}

// ─── LOWLANDS SCATTER ────────────────────────────────────────────────────
// Just occasional grass marks.
function scatterLowlands(t, cx, cy, isFigure, scatterScale = 1) {
  // Skip scatter for depleted tiles with higher probability
  if (hash2(t.gx, t.gy, 115) < 0.55 + (1 - scatterScale) * 0.4) return '';
  const baseN = 1 + Math.floor(hash2(t.gx, t.gy, 110) * 2);
  const n = Math.max(0, Math.floor(baseN * scatterScale));
  if (n === 0) return '';
  const pos = scatterPositions(t, cx, cy, n, 81);
  let s = '';
  const stroke = isFigure ? '#6A6A65' : '#5A6F2A';
  for (const p of pos) {
    const h = 1.8 + hash2(p.x, p.y, 11) * 1.0;
    for (let i = -1; i <= 1; i++) {
      const x = (p.x + i * 0.9).toFixed(1);
      s += `<line x1="${x}" y1="${(p.y).toFixed(1)}" x2="${x}" y2="${(p.y - h).toFixed(1)}" stroke="${stroke}" stroke-width="0.5" opacity="${isFigure ? '0.55' : '0.75'}" stroke-linecap="round"/>`;
    }
  }
  return s;
}

// ─── MOUNTAIN SCATTER ────────────────────────────────────────────────────
// Scree dots plus scattered alpine evergreens on lower flanks.
// Treeline at elev 12 — above that, just scree.
function scatterMountain(t, cx, cy, isFigure, scatterScale = 1) {
  const baseN = 2 + Math.floor(hash2(t.gx, t.gy, 130) * 2);
  const n = Math.max(0, Math.floor(baseN * scatterScale));
  if (n === 0) return '';
  const pos = scatterPositions(t, cx, cy, n, 130);
  let s = '';
  const fill = isFigure ? '#3A3A38' : '#3A3540';
  for (const p of pos) {
    const r = 0.6 + hash2(p.x, p.y, 13) * 0.5;
    s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(2)}" fill="${fill}" opacity="${isFigure ? '0.5' : '0.7'}"/>`;
  }
  // Alpine evergreens — only below treeline AND only on ~60% of tiles, scaled by depletion.
  if (t.elev < 12 && hash2(t.gx, t.gy, 160) > 0.4 && scatterScale > 0.2) {
    const baseTreeN = 2 + Math.floor(hash2(t.gx, t.gy, 161) * 3);
    const treeN = Math.max(0, Math.floor(baseTreeN * scatterScale));
    if (treeN === 0) return s;
    const treePos = scatterPositions(t, cx, cy, treeN, 165);
    treePos.sort((a, b) => a.y - b.y);
    const treeFill   = isFigure ? '#5A5550' : '#2C5538';
    const treeStroke = isFigure ? '#1A1A18' : '#1A3424';
    const trunkColor = isFigure ? '#3A3A38' : '#2A1A12';
    for (const p of treePos) {
      const sz = 2.0 + hash2(p.x, p.y, 167) * 0.8;
      const ax = p.x.toFixed(1), ay = (p.y - sz).toFixed(1);
      const blx = (p.x - sz * 0.55).toFixed(1), bly = (p.y + sz * 0.4).toFixed(1);
      const brx = (p.x + sz * 0.55).toFixed(1), bry = (p.y + sz * 0.4).toFixed(1);
      s += `<path d="M ${ax} ${ay} L ${brx} ${bry} L ${blx} ${bly} Z" fill="${treeFill}" stroke="${treeStroke}" stroke-width="0.3" opacity="${isFigure ? '0.8' : '0.92'}"/>`;
      s += `<line x1="${p.x.toFixed(1)}" y1="${(p.y + sz * 0.4).toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${(p.y + sz * 0.7).toFixed(1)}" stroke="${trunkColor}" stroke-width="0.4" opacity="0.8"/>`;
    }
  }
  return s;
}

// ─── DESERT SCATTER ────────────────────────────────────────────────────
// Fan dune strokes + sparse pebbles.
function scatterDesert(t, cx, cy, isFigure, scatterScale = 1) {
  const baseN = 3 + Math.floor(hash2(t.gx, t.gy, 140) * 3);
  const n = Math.max(0, Math.floor(baseN * scatterScale));
  if (n === 0) return '';
  const pos = scatterPositions(t, cx, cy, n, 91);
  let s = '';
  const duneStroke = isFigure ? '#5A5550' : '#A07840';
  const pebbleFill = isFigure ? '#5A5550' : '#8B6435';
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    if (i % 3 === 0) {
      const w = 4 + hash2(p.x, p.y, 17) * 2;
      s += `<path d="M ${(p.x - w).toFixed(1)} ${p.y.toFixed(1)} Q ${p.x.toFixed(1)} ${(p.y - 1.5).toFixed(1)} ${(p.x + w).toFixed(1)} ${p.y.toFixed(1)}" fill="none" stroke="${duneStroke}" stroke-width="0.5" opacity="${isFigure ? '0.4' : '0.6'}"/>`;
    } else {
      s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="0.6" fill="${pebbleFill}" opacity="${isFigure ? '0.4' : '0.55'}"/>`;
    }
  }
  return s;
}

// ─── BEACH SCATTER ────────────────────────────────────────────────────
// Small light grain dots.
function scatterBeach(t, cx, cy, isFigure, scatterScale = 1) {
  const baseN = 8 + Math.floor(hash2(t.gx, t.gy, 150) * 4);
  const n = Math.max(0, Math.floor(baseN * scatterScale));
  if (n === 0) return '';
  const pos = scatterPositions(t, cx, cy, n, 71);
  let s = '';
  const fill = isFigure ? '#7A766B' : '#C9B968';
  for (const p of pos) {
    const r = 0.4 + hash2(p.x, p.y, 19) * 0.4;
    s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(2)}" fill="${fill}" opacity="${isFigure ? '0.55' : '0.7'}"/>`;
  }
  return s;
}

// ─── WATER BOATS ────────────────────────────────────────────────────
// Occasional small boats on water tiles.
function scatterWater(t, cx, cy, isFigure) {
  // Only ~15% of water tiles get a boat
  if (hash2(t.gx, t.gy, 200) > 0.15) return '';

  const w = 5;
  const h = 1.6;
  const hullFill = isFigure ? '#1A1A18' : '#3C3A33';
  const lineColor = isFigure ? '#F0EEE8' : '#ECECE8';

  const hull = `<path d="M ${(cx - w).toFixed(1)} ${cy.toFixed(1)} Q ${cx.toFixed(1)} ${(cy + h).toFixed(1)} ${(cx + w).toFixed(1)} ${cy.toFixed(1)} Z" fill="${hullFill}" stroke="${lineColor}" stroke-width="0.4" opacity="0.85"/>`;
  const mast = `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(cy - 4).toFixed(1)}" stroke="${lineColor}" stroke-width="0.5" opacity="0.85"/>`;
  const sx = cx, sy = cy - 4;
  const sail = `<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${(sx + 2.5).toFixed(1)} ${(sy + 2.5).toFixed(1)} L ${sx.toFixed(1)} ${(sy + 2.5).toFixed(1)} Z" fill="${lineColor}" opacity="0.7"/>`;

  return hull + mast + sail;
}

// ─── SCATTER CACHE ────────────────────────────────────────────────────────
// Cache scatter SVG to avoid regenerating on every render
const _scatterCache = new Map();
const MAX_CACHE_SIZE = 500;

function getScatterCacheKey(tile, mode, depletion) {
  // Round depletion to nearest 0.1 to limit cache entries
  const depRounded = Math.round(depletion * 10);
  return `${tile.gx}:${tile.gy}:${mode}:${depRounded}`;
}

// ─── BIOME SCATTER DISPATCHER ────────────────────────────────────────────
// Returns SVG fragment of biome-specific detail marks for one tile.
// depletion: 0 = untouched, 1 = fully depleted (no scatter)
export function biomeScatter(tile, cx, cy, mode, depletion = 0) {
  // Check cache first
  const cacheKey = getScatterCacheKey(tile, mode, depletion);
  if (_scatterCache.has(cacheKey)) {
    return _scatterCache.get(cacheKey);
  }

  const isFigure = mode.includes('figure');
  const b = tile.biome;

  // Scale factor for scatter count based on depletion (1 = full, 0 = none)
  const scatterScale = Math.max(0, 1 - depletion);
  if (scatterScale < 0.1) {
    _scatterCache.set(cacheKey, '');
    return '';
  }

  let result = '';
  if (b === 'forest')   result = scatterForest(tile, cx, cy, isFigure, scatterScale);
  else if (b === 'lowlands') result = scatterLowlands(tile, cx, cy, isFigure, scatterScale);
  else if (b === 'mountain') result = scatterMountain(tile, cx, cy, isFigure, scatterScale);
  else if (b === 'desert')   result = scatterDesert(tile, cx, cy, isFigure, scatterScale);
  else if (b === 'beach')    result = scatterBeach(tile, cx, cy, isFigure, scatterScale);
  else if (b === 'water')    result = scatterWater(tile, cx, cy, isFigure);

  // Cache result (with size limit)
  if (_scatterCache.size >= MAX_CACHE_SIZE) {
    // Clear oldest entries (simple strategy: clear half)
    const keys = Array.from(_scatterCache.keys());
    for (let i = 0; i < keys.length / 2; i++) {
      _scatterCache.delete(keys[i]);
    }
  }
  _scatterCache.set(cacheKey, result);

  return result;
}
