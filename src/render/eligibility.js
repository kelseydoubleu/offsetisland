// ════════════════════════════════════════════════════════════════════
// TILE ELIGIBILITY VISUALIZATION
// Shows which tiles can be clicked during sourcing mode
// ════════════════════════════════════════════════════════════════════

import { gridToScreen, TILE_W, TILE_H, ELEV_UNIT } from '../utils/projection.js';
import { ISLAND_MATERIALS, tileRemainingYield, tileDumpRemaining } from '../state/index.js';

// Material to biome mapping
const MATERIAL_BIOMES = {
  timber: 'forest',
  stone: 'mountain',
  clay: 'lowlands',
  water: 'water'
};

// Material colors for markers
const MATERIAL_COLORS = {
  timber: '#5A8A58',
  stone: '#7A8590',
  clay: '#C49070',
  water: '#7BC4D8',
  waste: '#E84B7A'
};

// Render eligibility markers on tiles during sourcing
export function renderEligibilityMarkers(state, mode, activeMaterial, buildTile, draws, wasteDeposits) {
  const markersGroup = document.getElementById('eligibility-markers');
  if (!markersGroup) return;

  markersGroup.innerHTML = '';

  if (!activeMaterial) return;

  const isPlan = mode === 'plan' || mode === 'figureplan';
  const isWaste = activeMaterial === 'waste';

  // Build tile marker (magenta crosshair)
  if (buildTile) {
    const buildPos = gridToScreen(buildTile.gx, buildTile.gy, mode);
    const tile = state.island.tiles.find(t => t.gx === buildTile.gx && t.gy === buildTile.gy);
    const buildElev = isPlan ? 0 : (tile?.elev || 0) * ELEV_UNIT;

    const crosshair = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    crosshair.setAttribute('class', 'build-target-marker');
    crosshair.innerHTML = `
      <circle cx="${buildPos.sx}" cy="${buildPos.sy - buildElev}" r="12"
              fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="4 2"/>
      <line x1="${buildPos.sx - 8}" y1="${buildPos.sy - buildElev}"
            x2="${buildPos.sx + 8}" y2="${buildPos.sy - buildElev}"
            stroke="var(--accent)" stroke-width="2"/>
      <line x1="${buildPos.sx}" y1="${buildPos.sy - buildElev - 8}"
            x2="${buildPos.sx}" y2="${buildPos.sy - buildElev + 8}"
            stroke="var(--accent)" stroke-width="2"/>
    `;
    markersGroup.appendChild(crosshair);
  }

  // Already-picked source tiles (checkmarks)
  const pickedSources = new Set();
  for (const d of (draws || [])) {
    if (!d.fromSalvage) {
      pickedSources.add(`${d.tile.gx}:${d.tile.gy}`);
    }
  }

  // Already-picked waste tiles (down arrows)
  const pickedWaste = new Set();
  for (const w of (wasteDeposits || [])) {
    pickedWaste.add(`${w.tile.gx}:${w.tile.gy}`);
  }

  // Render markers for all tiles
  for (const tile of state.island.tiles) {
    const key = `${tile.gx}:${tile.gy}`;
    const pos = gridToScreen(tile.gx, tile.gy, mode);
    const elev = isPlan ? 0 : tile.elev * ELEV_UNIT;

    // Skip build tile
    if (buildTile && tile.gx === buildTile.gx && tile.gy === buildTile.gy) continue;

    // Check if already picked
    if (!isWaste && pickedSources.has(key)) {
      // Show checkmark for picked source
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      marker.setAttribute('class', 'source-picked-marker');
      marker.innerHTML = `
        <circle cx="${pos.sx}" cy="${pos.sy - elev}" r="8"
                fill="${MATERIAL_COLORS[activeMaterial]}" fill-opacity="0.9"/>
        <text x="${pos.sx}" y="${pos.sy - elev + 3}"
              text-anchor="middle" font-size="10" fill="#fff" font-weight="bold">✓</text>
      `;
      markersGroup.appendChild(marker);
      continue;
    }

    if (isWaste && pickedWaste.has(key)) {
      // Show down arrow for picked waste
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      marker.setAttribute('class', 'waste-picked-marker');
      marker.innerHTML = `
        <circle cx="${pos.sx}" cy="${pos.sy - elev}" r="8"
                fill="${MATERIAL_COLORS.waste}" fill-opacity="0.9"/>
        <text x="${pos.sx}" y="${pos.sy - elev + 3}"
              text-anchor="middle" font-size="10" fill="#fff" font-weight="bold">▼</text>
      `;
      markersGroup.appendChild(marker);
      continue;
    }

    // Check eligibility
    let isEligible = false;
    let color = MATERIAL_COLORS[activeMaterial] || '#888';

    if (isWaste) {
      // Waste: any non-water, non-built tile with dump capacity
      if (tile.biome !== 'water' && !tile.built) {
        const remaining = tileDumpRemaining(state, tile);
        if (remaining > 0) {
          isEligible = true;
        }
      }
    } else {
      // Material: correct biome, not built, has yield
      const requiredBiome = MATERIAL_BIOMES[activeMaterial];
      if (tile.biome === requiredBiome && !tile.built) {
        const remaining = tileRemainingYield(state, tile, activeMaterial);
        if (remaining > 0) {
          isEligible = true;
        }
      }
    }

    if (isEligible) {
      // Pulsing dot for eligible tiles
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      marker.setAttribute('class', 'eligible-marker');
      marker.innerHTML = `
        <circle cx="${pos.sx}" cy="${pos.sy - elev}" r="5"
                fill="${color}" fill-opacity="0.8">
          <animate attributeName="r" values="4;7;4" dur="1.4s" repeatCount="indefinite"/>
          <animate attributeName="fill-opacity" values="0.8;0.4;0.8" dur="1.4s" repeatCount="indefinite"/>
        </circle>
      `;
      markersGroup.appendChild(marker);
    }
  }
}

// Clear all eligibility markers
export function clearEligibilityMarkers() {
  const markersGroup = document.getElementById('eligibility-markers');
  if (markersGroup) {
    markersGroup.innerHTML = '';
  }
  // Also clear live threads
  const threadsGroup = document.getElementById('sourcing-threads');
  if (threadsGroup) {
    threadsGroup.innerHTML = '';
  }
}

// Render live sourcing threads during sourcing mode
export function renderLiveSourcingThreads(state, mode, buildTile, draws, wasteDeposits) {
  const threadsGroup = document.getElementById('sourcing-threads');
  if (!threadsGroup) return;

  threadsGroup.innerHTML = '';

  if (!buildTile) return;

  const isPlan = mode === 'plan' || mode === 'figureplan';

  // Get build tile position
  const buildPos = gridToScreen(buildTile.gx, buildTile.gy, mode);
  const buildTileData = state.island.tiles.find(t => t.gx === buildTile.gx && t.gy === buildTile.gy);
  const buildElev = isPlan ? 0 : (buildTileData?.elev || 0) * ELEV_UNIT;

  // Draw material sourcing threads
  for (const draw of (draws || [])) {
    if (draw.fromSalvage) continue; // Skip salvage draws

    const sourceTile = state.island.tiles.find(t =>
      t.gx === draw.tile.gx && t.gy === draw.tile.gy
    );
    if (!sourceTile) continue;

    const sourcePos = gridToScreen(draw.tile.gx, draw.tile.gy, mode);
    const sourceElev = isPlan ? 0 : sourceTile.elev * ELEV_UNIT;

    // Create thread group
    const threadGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    threadGroup.setAttribute('class', 'live-thread');

    // Thread line with animation
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', sourcePos.sx);
    line.setAttribute('y1', sourcePos.sy - sourceElev);
    line.setAttribute('x2', buildPos.sx);
    line.setAttribute('y2', buildPos.sy - buildElev);
    line.setAttribute('stroke', MATERIAL_COLORS[draw.material] || '#888');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-opacity', '0.7');
    line.setAttribute('stroke-dasharray', '6 3');

    // Animate dash offset for flowing effect
    const animate = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    animate.setAttribute('attributeName', 'stroke-dashoffset');
    animate.setAttribute('values', '0;-18');
    animate.setAttribute('dur', '0.8s');
    animate.setAttribute('repeatCount', 'indefinite');
    line.appendChild(animate);

    threadGroup.appendChild(line);

    // Amount label at midpoint
    const midX = (sourcePos.sx + buildPos.sx) / 2;
    const midY = (sourcePos.sy - sourceElev + buildPos.sy - buildElev) / 2;

    const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    labelBg.setAttribute('x', midX - 20);
    labelBg.setAttribute('y', midY - 7);
    labelBg.setAttribute('width', 40);
    labelBg.setAttribute('height', 14);
    labelBg.setAttribute('rx', 2);
    labelBg.setAttribute('fill', '#fff');
    labelBg.setAttribute('fill-opacity', '0.9');
    labelBg.setAttribute('stroke', MATERIAL_COLORS[draw.material] || '#888');
    labelBg.setAttribute('stroke-width', '0.5');
    threadGroup.appendChild(labelBg);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', midX);
    label.setAttribute('y', midY + 3);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '8');
    label.setAttribute('font-family', 'var(--font)');
    label.setAttribute('fill', MATERIAL_COLORS[draw.material] || '#888');
    label.setAttribute('font-weight', '500');

    const unit = ISLAND_MATERIALS[draw.material]?.unit || '';
    label.textContent = `${draw.amount.toLocaleString()}`;
    threadGroup.appendChild(label);

    threadsGroup.appendChild(threadGroup);
  }

  // Draw waste deposit threads (in magenta)
  for (const waste of (wasteDeposits || [])) {
    const wasteTile = state.island.tiles.find(t =>
      t.gx === waste.tile.gx && t.gy === waste.tile.gy
    );
    if (!wasteTile) continue;

    const wastePos = gridToScreen(waste.tile.gx, waste.tile.gy, mode);
    const wasteElev = isPlan ? 0 : wasteTile.elev * ELEV_UNIT;

    // Thread line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', buildPos.sx);
    line.setAttribute('y1', buildPos.sy - buildElev);
    line.setAttribute('x2', wastePos.sx);
    line.setAttribute('y2', wastePos.sy - wasteElev);
    line.setAttribute('stroke', MATERIAL_COLORS.waste);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-opacity', '0.6');
    line.setAttribute('stroke-dasharray', '4 4');

    // Animate
    const animate = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    animate.setAttribute('attributeName', 'stroke-dashoffset');
    animate.setAttribute('values', '0;16');
    animate.setAttribute('dur', '1s');
    animate.setAttribute('repeatCount', 'indefinite');
    line.appendChild(animate);

    threadsGroup.appendChild(line);

    // Waste marker at destination
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    marker.innerHTML = `
      <circle cx="${wastePos.sx}" cy="${wastePos.sy - wasteElev}" r="10"
              fill="${MATERIAL_COLORS.waste}" fill-opacity="0.2"/>
      <text x="${wastePos.sx}" y="${wastePos.sy - wasteElev + 3}"
            text-anchor="middle" font-size="8" fill="${MATERIAL_COLORS.waste}" font-weight="bold">▼</text>
      <text x="${wastePos.sx}" y="${wastePos.sy - wasteElev + 14}"
            text-anchor="middle" font-size="7" fill="${MATERIAL_COLORS.waste}">${waste.amount.toLocaleString()}</text>
    `;
    threadsGroup.appendChild(marker);
  }
}
