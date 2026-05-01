// ════════════════════════════════════════════════════════════════════
// SALVAGE PANEL RENDERER
// Displays recovered materials available for reuse in new builds.
// ════════════════════════════════════════════════════════════════════

import { ISLAND_MATERIALS, getSalvageTotal } from '../state/index.js';

const $ = id => document.getElementById(id);

// Update the salvage panel display
export function updateSalvagePanel(state) {
  const timberTotal = getSalvageTotal(state, 'timber');
  const stoneTotal = getSalvageTotal(state, 'stone');
  const brickTotal = getSalvageTotal(state, 'brick');

  // Update display values
  const timberEl = $('sv-timber');
  const stoneEl = $('sv-stone');
  const brickEl = $('sv-brick');

  if (timberEl) {
    timberEl.textContent = `${timberTotal.toLocaleString()} ${ISLAND_MATERIALS.timber?.unit || 'bf'}`;
  }
  if (stoneEl) {
    stoneEl.textContent = `${stoneTotal.toLocaleString()} ${ISLAND_MATERIALS.stone?.unit || 'cu ft'}`;
  }
  if (brickEl) {
    brickEl.textContent = `${brickTotal.toLocaleString()} ${ISLAND_MATERIALS.brick?.unit || 'units'}`;
  }

  // Show/hide panel based on whether there's any salvage
  const panel = $('salvage-panel');
  if (panel) {
    const hasSalvage = timberTotal > 0 || stoneTotal > 0 || brickTotal > 0;
    panel.classList.toggle('has-salvage', hasSalvage);
  }
}

// Toggle salvage panel visibility
export function toggleSalvagePanel() {
  const panel = $('salvage-panel');
  if (panel) {
    panel.classList.toggle('open');
  }
}

// Open salvage panel
export function openSalvagePanel() {
  const panel = $('salvage-panel');
  if (panel) {
    panel.classList.add('open');
  }
}

// Close salvage panel
export function closeSalvagePanel() {
  const panel = $('salvage-panel');
  if (panel) {
    panel.classList.remove('open');
  }
}

// Render detailed salvage breakdown (by author)
export function renderSalvageDetail(state) {
  const body = $('sv-body');
  if (!body) return;

  const inv = state.island.salvageInventory || {};
  const authors = Object.keys(inv);

  if (authors.length === 0) {
    body.innerHTML = `
      <div class="sv-empty">
        <div class="sv-empty-text">No salvage recovered yet.</div>
        <div class="sv-empty-hint">Materials are recovered when buildings are demolished according to their death plan.</div>
      </div>
    `;
    return;
  }

  let html = '';

  // Summary row
  const totals = { timber: 0, stone: 0, brick: 0 };
  for (const author in inv) {
    totals.timber += inv[author].timber || 0;
    totals.stone += inv[author].stone || 0;
    totals.brick += inv[author].brick || 0;
  }

  html += `
    <div class="sv-summary">
      <div class="sv-row"><span class="sv-key">TIMBER</span><span class="sv-val">${totals.timber.toLocaleString()} bf</span></div>
      <div class="sv-row"><span class="sv-key">STONE</span><span class="sv-val">${totals.stone.toLocaleString()} cu ft</span></div>
      <div class="sv-row"><span class="sv-key">BRICK</span><span class="sv-val">${totals.brick.toLocaleString()} units</span></div>
    </div>
  `;

  // Per-author breakdown
  if (authors.length > 1) {
    html += `<div class="sv-breakdown">`;
    for (const author of authors) {
      const a = inv[author];
      const hasAny = (a.timber || 0) + (a.stone || 0) + (a.brick || 0) > 0;
      if (!hasAny) continue;

      html += `
        <div class="sv-author">
          <div class="sv-author-name">${author}</div>
          <div class="sv-author-mats">
            ${a.timber > 0 ? `<span class="sv-mat timber">${a.timber} bf</span>` : ''}
            ${a.stone > 0 ? `<span class="sv-mat stone">${a.stone} cu ft</span>` : ''}
            ${a.brick > 0 ? `<span class="sv-mat brick">${a.brick} units</span>` : ''}
          </div>
        </div>
      `;
    }
    html += `</div>`;
  }

  // Note about usage
  html += `
    <div class="sv-note">
      Salvage materials have zero transport carbon when used in new builds.
    </div>
  `;

  body.innerHTML = html;
}
