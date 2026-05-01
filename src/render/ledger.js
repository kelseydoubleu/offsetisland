// ════════════════════════════════════════════════════════════════════
// HIDDEN LEDGER RENDERER — Visualize consequences
// ════════════════════════════════════════════════════════════════════
// The hidden ledger reveals what's behind every build:
// - Material sourcing threads (where did it come from?)
// - Waste deposit markers (where did the waste go?)
// - Carbon footprint hazes
// - Value system critiques (the hidden truth)

import { gridToScreen, TILE_W, TILE_H, ELEV_UNIT } from '../utils/projection.js';

let ledgerVisible = false;

export function isLedgerVisible() {
  return ledgerVisible;
}

export function toggleLedger() {
  ledgerVisible = !ledgerVisible;
  document.body.classList.toggle('ledger-visible', ledgerVisible);
  return ledgerVisible;
}

export function setLedgerVisible(visible) {
  ledgerVisible = visible;
  document.body.classList.toggle('ledger-visible', visible);
}

// Render sourcing threads for all builds
export function renderSourcingThreads(state, mode) {
  const threadsGroup = document.getElementById('sourcing-threads');
  if (!threadsGroup) return;

  threadsGroup.innerHTML = '';

  if (!ledgerVisible) return;

  const isPlan = mode === 'plan' || mode === 'figureplan';

  for (const build of state.island.builds) {
    if (!build.draws) continue;

    const buildPos = gridToScreen(build.primaryTile.gx, build.primaryTile.gy, mode);
    const buildTile = state.island.tiles.find(t =>
      t.gx === build.primaryTile.gx && t.gy === build.primaryTile.gy
    );
    const buildElev = isPlan ? 0 : (buildTile?.elev || 0) * ELEV_UNIT;

    for (const draw of build.draws) {
      const sourceTile = state.island.tiles.find(t =>
        t.gx === draw.fromTile.gx && t.gy === draw.fromTile.gy
      );
      if (!sourceTile) continue;

      const sourcePos = gridToScreen(draw.fromTile.gx, draw.fromTile.gy, mode);
      const sourceElev = isPlan ? 0 : sourceTile.elev * ELEV_UNIT;

      // Draw thread line
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', sourcePos.sx);
      line.setAttribute('y1', sourcePos.sy - sourceElev);
      line.setAttribute('x2', buildPos.sx);
      line.setAttribute('y2', buildPos.sy - buildElev);
      line.setAttribute('class', `thread-${draw.material}`);
      line.setAttribute('stroke', getMaterialColor(draw.material));
      line.setAttribute('stroke-width', Math.max(1, Math.log(draw.amount + 1) * 0.5));
      line.setAttribute('stroke-opacity', '0.6');
      line.setAttribute('stroke-dasharray', '4 2');
      threadsGroup.appendChild(line);

      // Source marker
      const sourceMarker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      sourceMarker.setAttribute('cx', sourcePos.sx);
      sourceMarker.setAttribute('cy', sourcePos.sy - sourceElev);
      sourceMarker.setAttribute('r', 3);
      sourceMarker.setAttribute('fill', getMaterialColor(draw.material));
      sourceMarker.setAttribute('fill-opacity', '0.7');
      threadsGroup.appendChild(sourceMarker);
    }
  }
}

// Render waste deposit markers
export function renderWasteMarkers(state, mode) {
  const wasteGroup = document.getElementById('waste-markers');
  if (!wasteGroup) return;

  wasteGroup.innerHTML = '';

  if (!ledgerVisible) return;

  const isPlan = mode === 'plan' || mode === 'figureplan';

  // Collect all waste deposits
  const wasteByTile = new Map();

  for (const build of state.island.builds) {
    if (!build.wasteDestinations) continue;

    for (const waste of build.wasteDestinations) {
      const key = `${waste.toTile.gx}:${waste.toTile.gy}`;
      if (!wasteByTile.has(key)) {
        wasteByTile.set(key, { tile: waste.toTile, total: 0, types: [] });
      }
      const entry = wasteByTile.get(key);
      entry.total += waste.amount;
      entry.types.push(waste.wasteType);
    }
  }

  // Render markers
  for (const [key, data] of wasteByTile) {
    const tile = state.island.tiles.find(t =>
      t.gx === data.tile.gx && t.gy === data.tile.gy
    );
    if (!tile) continue;

    const pos = gridToScreen(data.tile.gx, data.tile.gy, mode);
    const elev = isPlan ? 0 : tile.elev * ELEV_UNIT;

    // Waste pile indicator
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'waste-marker');

    // Background haze
    const haze = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    haze.setAttribute('cx', pos.sx);
    haze.setAttribute('cy', pos.sy - elev);
    const hazeSize = Math.min(TILE_W, Math.sqrt(data.total) * 2);
    haze.setAttribute('rx', hazeSize);
    haze.setAttribute('ry', hazeSize * 0.5);
    haze.setAttribute('fill', 'var(--accent)');
    haze.setAttribute('fill-opacity', '0.2');
    g.appendChild(haze);

    // Icon
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    icon.setAttribute('x', pos.sx);
    icon.setAttribute('y', pos.sy - elev + 3);
    icon.setAttribute('text-anchor', 'middle');
    icon.setAttribute('font-size', '10');
    icon.setAttribute('fill', 'var(--accent)');
    icon.textContent = '◆';
    g.appendChild(icon);

    // Amount label
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', pos.sx);
    label.setAttribute('y', pos.sy - elev + 14);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '7');
    label.setAttribute('font-family', 'var(--font)');
    label.setAttribute('fill', 'var(--ink)');
    label.textContent = `${Math.round(data.total)} cu ft`;
    g.appendChild(label);

    wasteGroup.appendChild(g);
  }
}

// Render carbon haze over high-carbon buildings
export function renderCarbonHaze(state, mode) {
  const hazeGroup = document.getElementById('carbon-haze');
  if (!hazeGroup) return;

  hazeGroup.innerHTML = '';

  if (!ledgerVisible) return;

  const isPlan = mode === 'plan' || mode === 'figureplan';

  for (const build of state.island.builds) {
    const totalCarbon = (build.embodiedCarbon || 0) + (build.transportCarbon || 0);
    if (totalCarbon < 0.5) continue; // Skip low-carbon builds

    const tile = state.island.tiles.find(t =>
      t.gx === build.primaryTile.gx && t.gy === build.primaryTile.gy
    );
    if (!tile) continue;

    const pos = gridToScreen(build.primaryTile.gx, build.primaryTile.gy, mode);
    const elev = isPlan ? 0 : tile.elev * ELEV_UNIT;

    // Carbon cloud
    const cloud = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    cloud.setAttribute('cx', pos.sx);
    cloud.setAttribute('cy', pos.sy - elev - 15);
    const cloudSize = Math.min(50, totalCarbon * 10);
    cloud.setAttribute('rx', cloudSize);
    cloud.setAttribute('ry', cloudSize * 0.4);
    cloud.setAttribute('fill', '#3A3A38');
    cloud.setAttribute('fill-opacity', Math.min(0.4, totalCarbon * 0.1));
    cloud.setAttribute('class', 'carbon-cloud');
    hazeGroup.appendChild(cloud);
  }
}

// Render critique labels on buildings
export function renderCritiques(state, mode) {
  const critiqueGroup = document.getElementById('critiques');
  if (!critiqueGroup) return;

  critiqueGroup.innerHTML = '';

  if (!ledgerVisible) return;

  const isPlan = mode === 'plan' || mode === 'figureplan';

  for (const build of state.island.builds) {
    if (!build.valueSystemCritique) continue;

    const tile = state.island.tiles.find(t =>
      t.gx === build.primaryTile.gx && t.gy === build.primaryTile.gy
    );
    if (!tile) continue;

    const pos = gridToScreen(build.primaryTile.gx, build.primaryTile.gy, mode);
    const elev = isPlan ? 0 : tile.elev * ELEV_UNIT;

    // Critique tag
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'critique-tag');

    // Background
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', pos.sx - 50);
    bg.setAttribute('y', pos.sy - elev - 35);
    bg.setAttribute('width', 100);
    bg.setAttribute('height', 18);
    bg.setAttribute('rx', 2);
    bg.setAttribute('fill', 'var(--paper)');
    bg.setAttribute('stroke', 'var(--accent)');
    bg.setAttribute('stroke-width', '0.5');
    g.appendChild(bg);

    // Truncated critique text
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', pos.sx);
    text.setAttribute('y', pos.sy - elev - 23);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '7');
    text.setAttribute('font-family', 'var(--font)');
    text.setAttribute('fill', 'var(--accent)');

    const critique = build.valueSystemCritique;
    text.textContent = critique.length > 20 ? critique.slice(0, 18) + '…' : critique;
    g.appendChild(text);

    critiqueGroup.appendChild(g);
  }
}

// Get material thread color
function getMaterialColor(material) {
  const colors = {
    timber: '#5A8A58',
    stone: '#7A8590',
    brick: '#B88060'
  };
  return colors[material] || '#888';
}

// Full ledger render - call this from main render
export function renderHiddenLedger(state, mode) {
  renderSourcingThreads(state, mode);
  renderWasteMarkers(state, mode);
  renderCarbonHaze(state, mode);
  renderCritiques(state, mode);
}
