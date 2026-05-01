// ════════════════════════════════════════════════════════════════════
// ISO DUMP PILE RENDERER — Landfill visualization for SVG map view
// ════════════════════════════════════════════════════════════════════
// Renders growing dump piles at designated landfill sites.
// Piles grow larger as more waste accumulates.

import { gridToScreen, TILE_W, TILE_H, ELEV_UNIT } from '../utils/projection.js';
import { isDumpSite, getDumpSiteFillFraction } from '../state/extraction.js';

// Dump pile colors
const DUMP_COLORS = {
  atlas: {
    base: '#8A6F4A',     // Brown dirt base
    mid: '#9C7C56',      // Mid-tone
    top: '#7A5F3A',      // Darker top/shadow
    debris: '#6A5030'    // Scattered debris
  },
  figure: {
    base: '#6A6560',
    mid: '#7A756A',
    top: '#5A5550',
    debris: '#4A4540'
  }
};

// Render a single dump pile at a tile
function renderDumpPile(tile, sx, cy, mode, fillFraction) {
  if (fillFraction <= 0) return '';

  const isFigure = mode.includes('figure');
  const colors = isFigure ? DUMP_COLORS.figure : DUMP_COLORS.atlas;

  // Scale pile size based on fill fraction (0-1)
  // At full capacity, pile is quite large
  const maxRadius = TILE_W * 0.7;
  const maxHeight = TILE_H * 1.2;

  const radius = 8 + fillFraction * (maxRadius - 8);
  const height = 4 + fillFraction * (maxHeight - 4);

  // Center position with slight offset for organic feel
  const cx = sx;

  let svg = '';

  // Ground shadow
  const shadowW = radius * 1.2;
  const shadowH = radius * 0.4;
  svg += `<ellipse cx="${cx}" cy="${cy + 2}" rx="${shadowW}" ry="${shadowH}"
           fill="rgba(0,0,0,0.15)"/>`;

  // Main mound - isometric rendering
  // Draw as a series of stacked ellipses to create 3D mound effect

  // Base ellipse (widest)
  const baseW = radius;
  const baseH = radius * 0.35;
  svg += `<ellipse cx="${cx}" cy="${cy}" rx="${baseW}" ry="${baseH}"
           fill="${colors.base}" stroke="#1A1A18" stroke-width="0.5"/>`;

  // Stack layers for 3D effect
  const layers = Math.max(2, Math.floor(fillFraction * 5) + 1);
  for (let i = 1; i <= layers; i++) {
    const t = i / layers;
    const layerY = cy - height * t * 0.8;
    const layerW = baseW * (1 - t * 0.6);
    const layerH = baseH * (1 - t * 0.5);
    const layerColor = i === layers ? colors.top : colors.mid;

    svg += `<ellipse cx="${cx}" cy="${layerY}" rx="${layerW}" ry="${layerH}"
             fill="${layerColor}" stroke="#1A1A18" stroke-width="0.3"/>`;
  }

  // Add debris/texture dots for larger piles
  if (fillFraction > 0.2) {
    const debrisCount = Math.floor(fillFraction * 12);
    for (let i = 0; i < debrisCount; i++) {
      // Pseudo-random based on index
      const angle = (i / debrisCount) * Math.PI * 2 + i * 0.7;
      const dist = radius * (0.3 + (i % 3) * 0.25);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist * 0.35; // Flatten for isometric
      const r = 1 + (i % 2);

      svg += `<circle cx="${cx + dx}" cy="${cy + dy - height * 0.2}" r="${r}"
               fill="${colors.debris}" opacity="0.7"/>`;
    }
  }

  // Add construction debris shapes for fuller dumps
  if (fillFraction > 0.5) {
    // Scattered rectangles (boards, panels)
    const debrisShapes = Math.floor(fillFraction * 6);
    for (let i = 0; i < debrisShapes; i++) {
      const angle = (i / debrisShapes) * Math.PI * 2 + 0.3;
      const dist = radius * (0.5 + (i % 2) * 0.3);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist * 0.35;
      const w = 3 + (i % 3) * 2;
      const h = 1.5 + (i % 2);
      const rot = angle * 30;

      svg += `<rect x="${cx + dx - w/2}" y="${cy + dy - height * 0.15 - h/2}"
               width="${w}" height="${h}" fill="${colors.debris}"
               transform="rotate(${rot} ${cx + dx} ${cy + dy - height * 0.15})"
               opacity="0.6"/>`;
    }
  }

  return svg;
}

// Render all dump piles on the map
export function renderAllDumpPiles(state, mode) {
  const dumpsGroup = document.getElementById('dumps-layer');
  if (!dumpsGroup) {
    // Create dumps layer if it doesn't exist
    const worldGroup = document.getElementById('world');
    if (worldGroup) {
      const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      layer.setAttribute('id', 'dumps-layer');
      // Insert before buildings layer
      const buildingsLayer = document.getElementById('buildings-layer');
      if (buildingsLayer) {
        worldGroup.insertBefore(layer, buildingsLayer);
      } else {
        worldGroup.appendChild(layer);
      }
    }
    return;
  }

  dumpsGroup.innerHTML = '';

  const isPlan = mode === 'plan' || mode === 'figureplan';
  if (isPlan) return; // No dump visualization in plan view

  // Only render dump sites
  if (!state.island.dumpSites || state.island.dumpSites.length === 0) return;

  for (const key of state.island.dumpSites) {
    const [gx, gy] = key.split(':').map(Number);
    const tile = state.island.tiles.find(t => t.gx === gx && t.gy === gy);
    if (!tile) continue;

    const fillFraction = getDumpSiteFillFraction(state, tile);
    if (fillFraction <= 0) continue;

    const pos = gridToScreen(tile.gx, tile.gy, mode);
    const elev = tile.elev * ELEV_UNIT;
    const cx = pos.sx;
    const cy = pos.sy - elev;

    const pileSvg = renderDumpPile(tile, cx, cy, mode, fillFraction);
    if (pileSvg) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'dump-pile');
      g.setAttribute('data-tile', `${tile.gx}:${tile.gy}`);
      g.setAttribute('data-fill', fillFraction.toFixed(2));
      g.innerHTML = pileSvg;
      dumpsGroup.appendChild(g);
    }
  }
}

// Export single pile renderer for potential use elsewhere
export { renderDumpPile };
