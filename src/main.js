// ════════════════════════════════════════════════════════════════════
// OFFCUT WORLD — MAIN ENTRY POINT
// ════════════════════════════════════════════════════════════════════

// ── STATE MODULE IMPORTS ────────────────────────────────────────────
import {
  ISLAND_MATERIALS,
  DEATH_PLANS,
  initializeThesisState,
  tileDistance,
  tileRemainingYield,
  getSalvageTotal
} from './state/index.js';

import { tileDepletion } from './state/extraction.js';

// ── ISLAND MODULE IMPORTS ───────────────────────────────────────────
import {
  generateIsland,
  seedStarterNetwork,
  countTilesByBiome,
  getTile
} from './island/index.js';

import { prepopulateIsland, getAgentNames, getAgentInfo, getBuildsByAgent } from './island/prepopulate.js';

// ── PROJECTION IMPORTS ──────────────────────────────────────────────
import {
  TILE_W, TILE_H, ELEV_UNIT,
  gridToScreen
} from './utils/projection.js';

// ── RENDER IMPORTS ──────────────────────────────────────────────────
import { biomeScatter } from './render/scatter.js';
import {
  toggleLedger,
  isLedgerVisible,
  renderHiddenLedger
} from './render/ledger.js';
import { updateSalvagePanel } from './render/salvage.js';
import { renderAllIsoBuildings } from './render/buildings.js';
import { renderAllDumpPiles } from './render/dumps.js';
import {
  openBuildProfile,
  closeBuildProfile,
  calculateBuildGrade
} from './render/buildProfile.js';

// ── WALK MODULE IMPORTS ─────────────────────────────────────────────
import {
  activateWalkMode,
  deactivateWalkMode
} from './walk/index.js';

// ── BUILD MODULE IMPORTS ────────────────────────────────────────────
import {
  BUILD,
  openBuildModal,
  closeBuildModal,
  openDesignScreen,
  closeDesignScreen,
  openBuildWizard,
  openAiModal,
  closeAiModal,
  openImportModal,
  closeImportModal,
  openReportCard,
  closeReportCard,
  initBuildHandlers,
  selectSourceTile,
  toggleTileSelection,
  clearTileSelection,
  isSourcingActive,
  handleSourcingTileClick
} from './build/index.js';

// ── EXPORT MODULE IMPORTS ──────────────────────────────────────────
import { exportToRhino } from './export/rhino.js';

// ── GAME LOOP IMPORTS ───────────────────────────────────────────────
import {
  setGlobalState,
  setRenderCallback,
  initVisualCycle,
  getVisualTime,
  STEEL_WEEKLY_IMPORT,
  STEEL_MAX_STOCKPILE,
  GAME
} from './game/index.js';

// ════════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ════════════════════════════════════════════════════════════════════

const state = {
  screen: 'landing',
  viewMode: 'atlas',
  viewAngle: 'iso',
  viewStyle: 'color',
  user: null,
  hoveredTile: null,
  selectedTile: null,
  pan: { x: 0, y: 0 },
  zoom: 1,
  island: {
    name: 'OFFCUT WORLD',
    tiles: [],
    builds: [],
    roads: new Set(),
    nextBuildId: 1,
    laborPool: {
      base: 100,           // Founding settlers: 100 hrs/day
      fromBuildings: 0,    // Additional from housing
      allocated: {}        // buildId → hours/day allocated
    }
  },
  ledger: {
    timber: 10000,
    stone: 12000,
    sand: 5000,
    labor: 10000,
    energy: 10000,
    steel: 100  // Imported weekly
  }
};

// Initialize thesis state
initializeThesisState(state);

// Saved zoom state for restoring after tile selection
let savedZoomState = null;
let zoomAnimationFrame = null;

// ════════════════════════════════════════════════════════════════════
// DOM ELEMENTS
// ════════════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// Screens
const landingScreen = $('landing');
const loginScreen = $('login');
const islandScreen = $('island');

// SVG elements
const mapSvg = $('map-svg');
const tilesGroup = $('tiles');
const worldGroup = $('world');

// ════════════════════════════════════════════════════════════════════
// TILE EVENT DELEGATION (performance optimization)
// ════════════════════════════════════════════════════════════════════

// Helper to find tile from event target
function getTileFromEvent(e) {
  let el = e.target;
  while (el && el !== tilesGroup) {
    if (el.classList?.contains('tile')) {
      const gx = parseInt(el.dataset.gx);
      const gy = parseInt(el.dataset.gy);
      return state.island.tiles.find(t => t.gx === gx && t.gy === gy);
    }
    el = el.parentElement;
  }
  return null;
}

// Single set of event listeners for all tiles
if (tilesGroup) {
  tilesGroup.addEventListener('mouseenter', (e) => {
    const tile = getTileFromEvent(e);
    if (tile) onTileHover(tile);
  }, true);

  tilesGroup.addEventListener('mouseleave', (e) => {
    const tile = getTileFromEvent(e);
    if (tile) onTileLeave();
  }, true);

  tilesGroup.addEventListener('click', (e) => {
    const tile = getTileFromEvent(e);
    if (tile) onTileClick(tile);
  });
}

// ════════════════════════════════════════════════════════════════════
// SCREEN NAVIGATION
// ════════════════════════════════════════════════════════════════════

function setScreen(name) {
  state.screen = name;
  $$('.screen').forEach(s => s.classList.remove('active'));
  const screen = $(name);
  if (screen) screen.classList.add('active');

  if (name === 'island') {
    renderIsland();
    updateLegendCounts();
  }
}

// Landing → Login
$('enter-btn')?.addEventListener('click', () => setScreen('login'));

// Track login mode
let isCreatingNewAgent = false;

// Login flow helpers
function showLoginForm(isNewAgent = false) {
  isCreatingNewAgent = isNewAgent;
  const overlay = $('login-form-overlay');
  const title = $('login-form-title');
  const fieldSelect = $('field-agent-select');
  const fieldInput = $('field-agent-input');
  const pinWarning = $('pin-warning');

  if (overlay) {
    overlay.style.display = 'flex';
    title.textContent = isNewAgent ? 'CREATE AGENT' : 'LOGIN';

    // Toggle between select (existing) and input (new)
    if (fieldSelect) fieldSelect.style.display = isNewAgent ? 'none' : 'block';
    if (fieldInput) fieldInput.style.display = isNewAgent ? 'block' : 'none';
    if (pinWarning) pinWarning.style.display = isNewAgent ? 'block' : 'none';
  }
}

function hideLoginForm() {
  const overlay = $('login-form-overlay');
  if (overlay) overlay.style.display = 'none';
  // Clear form
  if ($('username')) $('username').value = '';
  if ($('agent-select')) $('agent-select').selectedIndex = 0;
  $$('.pin').forEach(p => p.value = '');
  if ($('login-error')) $('login-error').textContent = '';
}

// Populate agent select dropdown with real agents from prepopulate
function populateAgentSelect() {
  const select = $('agent-select');
  if (!select) return;

  // Use the real agent names from prepopulate module
  const agentNames = getAgentNames();

  // Clear existing options (except the first placeholder)
  while (select.options.length > 1) {
    select.remove(1);
  }

  // Add agent options with their style as title
  agentNames.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    const info = getAgentInfo(name);
    if (info?.style) {
      option.title = info.style;
    }
    select.appendChild(option);
  });
}
populateAgentSelect();

// Valid PIN for all agents
const VALID_PIN = '0614';

// Login page buttons
$('login-existing-btn')?.addEventListener('click', () => showLoginForm(false));
$('login-create-btn')?.addEventListener('click', () => showLoginForm(true));
$('login-form-close')?.addEventListener('click', hideLoginForm);

// Login → Island
$('login-submit')?.addEventListener('click', () => {
  // Get username from select (existing) or input (new)
  let username;
  if (isCreatingNewAgent) {
    username = $('username')?.value?.trim();
    if (!username) {
      $('login-error').textContent = 'Enter agent name';
      return;
    }
  } else {
    username = $('agent-select')?.value;
    if (!username) {
      $('login-error').textContent = 'Select an agent';
      return;
    }
  }

  const pins = Array.from($$('.pin')).map(p => p.value);
  const pin = pins.join('');

  if (pin.length < 4) {
    $('login-error').textContent = 'Enter 4-digit PIN';
    return;
  }

  // Validate PIN
  if (pin !== VALID_PIN) {
    $('login-error').textContent = 'Invalid PIN';
    $$('.pin').forEach(p => p.value = '');
    $$('.pin')[0]?.focus();
    return;
  }

  state.user = { name: username, pin };
  const userEl = $('i-user');
  if (userEl) userEl.textContent = username;
  hideLoginForm();
  // Go directly to walk/explore mode as default
  setScreen('island');

  // Properly activate walk mode with synced toggles
  state.viewAngle = 'walk';
  updateViewMode();

  // Update toggle buttons to show walk/explore as active
  $$('.vt-btn').forEach(b => b.classList.remove('active'));
  $$('.vt-btn').forEach(b => {
    if (b.dataset.viewId === 'walk') b.classList.add('active');
  });

  // Show walk view, hide map
  const mapWrap = $('map-wrap');
  if (mapWrap) mapWrap.style.display = 'none';
  document.body.classList.add('walk-active');
  activateWalkMode(state);
});

// PIN field navigation
$$('.pin').forEach((input, i, all) => {
  input.addEventListener('input', () => {
    if (input.value && i < all.length - 1) {
      all[i + 1].focus();
    }
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !input.value && i > 0) {
      all[i - 1].focus();
    }
  });
});

// Logout
$('logout-btn')?.addEventListener('click', () => {
  state.user = null;
  if ($('username')) $('username').value = '';
  $$('.pin').forEach(p => p.value = '');
  document.body.classList.remove('walk-active');
  deactivateWalkMode();
  setScreen('landing');
});

// ════════════════════════════════════════════════════════════════════
// VIEW TOGGLES
// ════════════════════════════════════════════════════════════════════

// View toggle handler (shared by both old and new UI)
function handleViewToggle(viewId, clickedBtn) {
  // Update all view toggle buttons (both old and new)
  $$('.vt-btn').forEach(b => b.classList.remove('active'));
  if (clickedBtn) clickedBtn.classList.add('active');
  // Also update corresponding button in the other toggle
  $$('.vt-btn').forEach(b => {
    if (b.dataset.viewId === viewId) b.classList.add('active');
  });

  // Deactivate walk mode if leaving it
  if (state.viewAngle === 'walk' && viewId !== 'walk') {
    deactivateWalkMode();
  }

  // Hide connections when leaving network view
  if (state.viewAngle === 'network' && viewId !== 'network') {
    hideConnectionsOverlay();
    document.body.classList.remove('connections-active');
    selectedConnectionsBuild = null;
  }

  state.viewAngle = viewId;
  updateViewMode();

  // Show/hide walk view
  const walkWrap = $('walk-wrap');
  const mapWrap = $('map-wrap');
  if (viewId === 'walk') {
    mapWrap.style.display = 'none';
    document.body.classList.add('walk-active');
    hideConnectionsOverlay();
    activateWalkMode(state);
  } else if (viewId === 'network') {
    // Network/Connections view - show island with connection threads
    walkWrap.style.display = 'none';
    mapWrap.style.display = 'block';
    document.body.classList.remove('walk-active');
    document.body.classList.add('connections-active');
    renderIsland();
    // Show connections overlay after a brief delay to let tiles render
    requestAnimationFrame(() => {
      showConnectionsOverlay();
    });
  } else {
    walkWrap.style.display = 'none';
    mapWrap.style.display = 'block';
    document.body.classList.remove('walk-active');
    document.body.classList.remove('connections-active');
    hideConnectionsOverlay();
    renderIsland();
  }
}

// Old view toggle (hidden)
$$('#view-toggle .vt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    handleViewToggle(btn.dataset.viewId, btn);
  });
});

// New birdseye view toggle
$$('.birdseye-view-toggle .vt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    handleViewToggle(btn.dataset.viewId, btn);
  });
});

// Style toggle (color/mono)
$$('#style-toggle .sw-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const style = btn.dataset.style;
    $$('#style-toggle .sw-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    state.viewStyle = style;
    updateViewMode();
    renderIsland();
  });
});

// Hidden ledger toggle
$('ledger-toggle')?.addEventListener('click', () => {
  const visible = toggleLedger();
  $('ledger-toggle')?.classList.toggle('active', visible);
  renderIsland();
});

function updateViewMode() {
  // Compose viewMode from angle + style
  if (state.viewAngle === 'iso' && state.viewStyle === 'color') {
    state.viewMode = 'atlas';
  } else if (state.viewAngle === 'plan' && state.viewStyle === 'color') {
    state.viewMode = 'plan';
  } else if (state.viewAngle === 'iso' && state.viewStyle === 'mono') {
    state.viewMode = 'figure';
  } else if (state.viewAngle === 'plan' && state.viewStyle === 'mono') {
    state.viewMode = 'figureplan';
  } else {
    state.viewMode = state.viewAngle;
  }

  // Update body class for CSS (preserve ledger-visible if set)
  const hasLedger = document.body.classList.contains('ledger-visible');
  const hasSourcing = document.body.classList.contains('sourcing-active');
  document.body.className = `view-${state.viewMode}`;
  if (hasLedger) document.body.classList.add('ledger-visible');
  if (hasSourcing) document.body.classList.add('sourcing-active');
}

// ════════════════════════════════════════════════════════════════════
// ISO RENDERER
// ════════════════════════════════════════════════════════════════════

// Biome colors - hex values for blending support
const BIOME_COLORS = {
  atlas: {
    forest: '#7EB488',
    mountain: '#94A0AC',
    lowlands: '#E8D87C',
    beach: '#F2E8A8',
    desert: '#D8A858',
    water: '#7BC4D8'
  },
  figure: {
    forest: '#8a8a82',
    mountain: '#a5a59d',
    lowlands: '#c2bea8',
    beach: '#d5d0b8',
    desert: '#b8b0a0',
    water: '#6a6a65'
  }
};

// Depleted tile colors - exposed earth/stripped land appearance
const DEPLETED_COLORS = {
  atlas: '#B8A080',  // Dusty tan/brown - exposed earth
  figure: '#8A8580'  // Neutral gray-brown
};

function getBiomeColor(biome, mode, depletion = 0) {
  const isFigure = mode.includes('figure');
  const palette = isFigure ? BIOME_COLORS.figure : BIOME_COLORS.atlas;
  const baseColor = palette[biome] || '#888';

  // If no depletion, return original color
  if (depletion <= 0) return baseColor;

  // Depleted color - exposed earth/stripped land
  const depletedColor = isFigure ? DEPLETED_COLORS.figure : DEPLETED_COLORS.atlas;

  // Parse colors to RGB
  const parseColor = (c) => {
    const hex = c.replace('#', '');
    return {
      r: parseInt(hex.substring(0, 2), 16) / 255,
      g: parseInt(hex.substring(2, 4), 16) / 255,
      b: parseInt(hex.substring(4, 6), 16) / 255
    };
  };

  const base = parseColor(baseColor);
  const depleted = parseColor(depletedColor);

  // More aggressive blend - depletion shows clearly even at low levels
  // Use squared depletion for more dramatic effect at higher levels
  const d = Math.min(1, depletion);
  const blendFactor = d * (0.5 + d * 0.5); // At 50% depletion, blend is ~0.375; at 100%, blend is 1.0

  const r = Math.round((base.r * (1 - blendFactor) + depleted.r * blendFactor) * 255);
  const g = Math.round((base.g * (1 - blendFactor) + depleted.g * blendFactor) * 255);
  const b = Math.round((base.b * (1 - blendFactor) + depleted.b * blendFactor) * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function getHatchPattern(biome, mode) {
  const prefix = mode.includes('figure') ? 'fg-' : 'p-';
  return `url(#${prefix}${biome})`;
}

// Get side face colors for elevation (darker left, lighter right)
function getSideColor(biome, mode, depletion = 0) {
  const isFigure = mode.includes('figure');

  // Side colors by biome - left is shadowed (darker), right is lit (slightly lighter)
  const sideColors = {
    atlas: {
      forest:   { left: '#6A9468', right: '#8AB488' },
      mountain: { left: '#7A8590', right: '#A0AAB5' },
      lowlands: { left: '#C8B060', right: '#E8D87C' },
      beach:    { left: '#D8C878', right: '#F2E5A0' },
      desert:   { left: '#C89048', right: '#E8B068' },
      water:    { left: '#4A7090', right: '#7BC4D8' }
    },
    figure: {
      forest:   { left: '#3A3A38', right: '#5A5A58' },
      mountain: { left: '#4A4A48', right: '#6A6A68' },
      lowlands: { left: '#5A5A58', right: '#7A7A78' },
      beach:    { left: '#6A6A68', right: '#8A8A88' },
      desert:   { left: '#5A5A58', right: '#7A7A78' },
      water:    { left: '#2A2A28', right: '#3A3A38' }
    }
  };

  const palette = isFigure ? sideColors.figure : sideColors.atlas;
  const baseColors = palette[biome] || { left: '#666', right: '#888' };

  // If no depletion, return original colors
  if (depletion <= 0) return baseColors;

  // Depleted side colors - exposed earth appearance (darker/lighter variants)
  const depletedTarget = isFigure
    ? { left: '#6A6560', right: '#8A857A' }  // Gray-brown figure mode
    : { left: '#9A8868', right: '#C8B898' }; // Dusty tan atlas mode

  const blendColor = (baseHex, depletedHex, d) => {
    const parseHex = (h) => ({
      r: parseInt(h.substring(1, 3), 16) / 255,
      g: parseInt(h.substring(3, 5), 16) / 255,
      b: parseInt(h.substring(5, 7), 16) / 255
    });
    const base = parseHex(baseHex);
    const depleted = parseHex(depletedHex);
    // More aggressive blend for visibility
    const blendFactor = d * (0.5 + d * 0.5);
    const r = Math.round((base.r * (1 - blendFactor) + depleted.r * blendFactor) * 255);
    const g = Math.round((base.g * (1 - blendFactor) + depleted.g * blendFactor) * 255);
    const b = Math.round((base.b * (1 - blendFactor) + depleted.b * blendFactor) * 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  const d = Math.min(1, depletion);
  return {
    left: blendColor(baseColors.left, depletedTarget.left, d),
    right: blendColor(baseColors.right, depletedTarget.right, d)
  };
}

// Cache for sorted tiles (avoid re-sorting every render)
let _sortedTilesCache = null;
let _sortedTilesCacheKey = '';

function getSortedTiles(isPlan) {
  const key = `${isPlan}-${state.island.tiles.length}`;
  if (_sortedTilesCache && _sortedTilesCacheKey === key) {
    return _sortedTilesCache;
  }

  _sortedTilesCache = [...state.island.tiles].sort((a, b) => {
    if (isPlan) return 0;
    const depthA = a.gx + a.gy;
    const depthB = b.gx + b.gy;
    if (depthA !== depthB) return depthA - depthB;
    return a.elev - b.elev;
  });
  _sortedTilesCacheKey = key;
  return _sortedTilesCache;
}

function renderIsland() {
  if (!tilesGroup || !state.island.tiles.length) return;

  const mode = state.viewMode;
  const isPlan = mode === 'plan' || mode === 'figureplan';

  // Pristine mode: show original island without builds or depletion (landing page)
  const isPristine = state.screen === 'landing';

  // Clear existing tiles
  tilesGroup.innerHTML = '';

  // Get cached sorted tiles
  const sortedTiles = getSortedTiles(isPlan);

  // Use DocumentFragment for batch DOM operations
  const fragment = document.createDocumentFragment();

  for (const tile of sortedTiles) {
    const { gx, gy, biome, elev, built } = tile;
    const { sx, sy } = gridToScreen(gx, gy, mode);
    const elevOffset = isPlan ? 0 : elev * ELEV_UNIT;

    // Get tile depletion (0 = untouched, 1 = fully depleted)
    // In pristine mode, always show as untouched
    const depletion = isPristine ? 0 : tileDepletion(state, tile);

    // In pristine mode, treat all tiles as unbuilt
    const showAsBuilt = isPristine ? false : built;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `tile ${biome} ${showAsBuilt ? 'built' : 'empty'}${depletion > 0.5 ? ' depleted' : ''}`);
    g.setAttribute('data-id', tile.id);
    g.setAttribute('data-gx', gx);
    g.setAttribute('data-gy', gy);

    if (isPlan) {
      // Plan view: squares
      const size = 18;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', sx - size);
      rect.setAttribute('y', sy - size);
      rect.setAttribute('width', size * 2);
      rect.setAttribute('height', size * 2);
      rect.setAttribute('fill', getBiomeColor(biome, mode, depletion));
      rect.setAttribute('stroke', 'var(--ink)');
      rect.setAttribute('stroke-width', '0.5');
      g.appendChild(rect);
    } else {
      // Iso view: diamond with elevation
      const top = sy - elevOffset;

      // Side faces for elevation (draw FIRST so top face renders on top)
      if (elev > 0) {
        const sideColor = getSideColor(biome, mode, depletion);

        // Left side (darker - in shadow)
        const leftSide = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        leftSide.setAttribute('d', `M${sx - TILE_W},${top} L${sx},${top + TILE_H} L${sx},${top + TILE_H + elevOffset} L${sx - TILE_W},${top + elevOffset} Z`);
        leftSide.setAttribute('fill', sideColor.left);
        leftSide.setAttribute('stroke', 'rgba(255,255,255,0.3)');
        leftSide.setAttribute('stroke-width', '0.5');
        leftSide.setAttribute('stroke-linejoin', 'round');
        g.appendChild(leftSide);

        // Right side (lighter - lit)
        const rightSide = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        rightSide.setAttribute('d', `M${sx + TILE_W},${top} L${sx},${top + TILE_H} L${sx},${top + TILE_H + elevOffset} L${sx + TILE_W},${top + elevOffset} Z`);
        rightSide.setAttribute('fill', sideColor.right);
        rightSide.setAttribute('stroke', 'rgba(255,255,255,0.3)');
        rightSide.setAttribute('stroke-width', '0.5');
        rightSide.setAttribute('stroke-linejoin', 'round');
        g.appendChild(rightSide);
      }

      // Top face (diamond) - draw on top of side faces
      const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      diamond.setAttribute('d', `M${sx},${top - TILE_H} L${sx + TILE_W},${top} L${sx},${top + TILE_H} L${sx - TILE_W},${top} Z`);
      diamond.setAttribute('fill', getBiomeColor(biome, mode, depletion));
      diamond.setAttribute('stroke', 'rgba(255,255,255,0.4)');
      diamond.setAttribute('stroke-width', '0.5');
      diamond.setAttribute('stroke-linejoin', 'round');
      g.appendChild(diamond);

      // Hatch overlay — reduce opacity based on depletion
      const hatchOpacity = 1 - depletion; // Full depletion = no hatch
      if ((biome !== 'water' || mode.includes('figure')) && hatchOpacity > 0.1) {
        const hatch = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hatch.setAttribute('d', `M${sx},${top - TILE_H} L${sx + TILE_W},${top} L${sx},${top + TILE_H} L${sx - TILE_W},${top} Z`);
        hatch.setAttribute('fill', getHatchPattern(biome, mode));
        hatch.setAttribute('stroke', 'none');
        hatch.setAttribute('opacity', hatchOpacity.toFixed(2));
        g.appendChild(hatch);
      }

      // Biome scatter (trees, rocks, grass, boats) — only for unbuilt tiles, reduced by depletion
      // Skip scatter entirely if tile is fully depleted
      // In pristine mode, always show scatter (no builds to clear tiles)
      if (!showAsBuilt && depletion < 0.95) {
        const scatterSvg = biomeScatter(tile, sx, top, mode, depletion);
        if (scatterSvg) {
          const scatterGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          scatterGroup.setAttribute('class', 'tile-scatter');
          // Fade scatter based on depletion
          if (depletion > 0) {
            scatterGroup.setAttribute('opacity', (1 - depletion * 0.8).toFixed(2));
          }
          scatterGroup.innerHTML = scatterSvg;
          g.appendChild(scatterGroup);
        }
      }

      // Built marker (simple dot - detailed building rendered separately)
      // Skip in pristine mode
      if (!isPristine && showAsBuilt && !tile.populated?.geo && !tile.populated?.isoImage && !tile.populated?.spec) {
        // Only show simple marker if no detailed geometry, isoImage, or spec
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        marker.setAttribute('cx', sx);
        marker.setAttribute('cy', top);
        marker.setAttribute('r', 4);
        marker.setAttribute('fill', 'var(--accent)');
        g.appendChild(marker);
      }
    }

    // Event handlers via delegation - no per-tile listeners needed

    fragment.appendChild(g);
  }

  // Batch append all tiles at once
  tilesGroup.appendChild(fragment);

  // Skip roads, buildings, dumps, and overlays in pristine mode (landing page)
  if (!isPristine) {
    // Render roads
    renderRoads();

    // Render dump piles at landfill sites
    renderAllDumpPiles(state, mode);

    // Render detailed buildings
    renderAllIsoBuildings(state, mode);

    // Render hidden ledger overlays (threads, waste, carbon, critiques)
    renderHiddenLedger(state, mode);
  }
}

function renderRoads() {
  const roadsGroup = $('roads');
  if (!roadsGroup) return;
  roadsGroup.innerHTML = '';

  const isPlan = state.viewMode === 'plan' || state.viewMode === 'figureplan';

  for (const roadKey of state.island.roads) {
    const [aKey, bKey] = roadKey.split('|');
    const [ax, ay] = aKey.split(':').map(Number);
    const [bx, by] = bKey.split(':').map(Number);

    const tileA = getTile(state, ax, ay);
    const tileB = getTile(state, bx, by);
    if (!tileA || !tileB) continue;

    const posA = gridToScreen(ax, ay, state.viewMode);
    const posB = gridToScreen(bx, by, state.viewMode);
    const elevA = isPlan ? 0 : tileA.elev * ELEV_UNIT;
    const elevB = isPlan ? 0 : tileB.elev * ELEV_UNIT;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', posA.sx);
    line.setAttribute('y1', posA.sy - elevA);
    line.setAttribute('x2', posB.sx);
    line.setAttribute('y2', posB.sy - elevB);
    line.setAttribute('stroke', 'var(--accent-2)');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '4 2');
    line.setAttribute('opacity', '0.7');
    roadsGroup.appendChild(line);
  }
}

// ════════════════════════════════════════════════════════════════════
// TILE INTERACTIONS
// ════════════════════════════════════════════════════════════════════

function onTileHover(tile) {
  // No tooltip on landing page
  if (state.screen === 'landing') return;

  state.hoveredTile = tile;
  showTileTooltip(tile);
}

function onTileLeave() {
  state.hoveredTile = null;
  hideTileTooltip();
}

function showTileTooltip(tile) {
  const tooltip = $('tile-tooltip');
  if (!tooltip) return;

  // Update content
  const biomeEl = $('tt-biome');
  const resourcesEl = $('tt-resources');

  if (biomeEl) biomeEl.textContent = tile.biome.toUpperCase();

  if (resourcesEl) {
    resourcesEl.innerHTML = '';

    const biomeResources = {
      forest: ['timber'],
      mountain: ['stone'],
      lowlands: ['clay', 'thatch'],
      beach: ['sand'],
      desert: [],
      water: ['water']
    };

    const resources = biomeResources[tile.biome] || [];

    if (tile.built) {
      resourcesEl.innerHTML = '<div class="tile-tooltip-built">◆ Built</div>';
    } else if (resources.length > 0) {
      for (const mat of resources) {
        const remaining = tileRemainingYield(state, tile, mat);
        const spec = ISLAND_MATERIALS[mat];
        const div = document.createElement('div');
        div.className = 'tile-tooltip-resource' + (remaining === 0 ? ' depleted' : '');
        div.textContent = `${spec?.name || mat}: ${Math.round(remaining).toLocaleString()} ${spec?.unit || ''}`;
        resourcesEl.appendChild(div);
      }
    }
  }

  tooltip.classList.add('visible');
}

function hideTileTooltip() {
  const tooltip = $('tile-tooltip');
  tooltip?.classList.remove('visible');
}

// Follow cursor for tooltip
document.addEventListener('mousemove', e => {
  const tooltip = $('tile-tooltip');
  if (tooltip?.classList.contains('visible')) {
    // Position tooltip offset from cursor
    const offsetX = 15;
    const offsetY = 15;
    let x = e.clientX + offsetX;
    let y = e.clientY + offsetY;

    // Keep tooltip on screen
    const rect = tooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 10) {
      x = e.clientX - rect.width - offsetX;
    }
    if (y + rect.height > window.innerHeight - 10) {
      y = e.clientY - rect.height - offsetY;
    }

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }
});

// Track which build is selected in connections view
let selectedConnectionsBuild = null;

function onTileClick(tile) {
  // No interaction on landing page - view only
  if (state.screen === 'landing') return;

  // No interaction during wizard sourcing mode - wizard handles its own clicks
  if (document.body.classList.contains('wizard-sourcing')) return;

  // Check if interactive sourcing mode is active (new system)
  if (isSourcingActive()) {
    const handled = handleSourcingTileClick(tile);
    if (handled) return;
    // If not handled (wrong biome etc), fall through to normal behavior
  }

  // In network/connections view, clicking tiles shows their connections
  if (state.viewAngle === 'network') {
    if (tile.built) {
      // Find build for this tile
      const build = state.island.builds.find(b =>
        b.primaryTile?.gx === tile.gx && b.primaryTile?.gy === tile.gy
      ) || state.island.builds.find(b => b.id === tile.buildId);

      if (build) {
        // Toggle selection: if clicking same build, show all connections
        if (selectedConnectionsBuild?.id === build.id) {
          selectedConnectionsBuild = null;
          showConnectionsOverlay(); // Show all connections
        } else {
          selectedConnectionsBuild = build;
          showSingleBuildConnections(build);
        }
      }
    } else {
      // Clicking empty tile in connections view - show all connections
      selectedConnectionsBuild = null;
      showConnectionsOverlay();
    }
    return;
  }

  // If tile is built, show report card
  if (tile.built) {
    clearTileSelection();
    restoreZoom();
    openReportCard(tile, state);
    return;
  }

  // Can't select water
  if (tile.biome === 'water') {
    return;
  }

  // Toggle tile selection (for multi-tile builds)
  toggleTileSelection(tile);
  state.selectedTile = BUILD.selectedTile;

  // Zoom to selection or restore zoom
  if (BUILD.selectedTiles.length > 0) {
    zoomToSelection(BUILD.selectedTiles);
  } else {
    restoreZoom();
  }
}

/**
 * Show connections for a single build with enhanced styling
 */
function showSingleBuildConnections(build) {
  showSingleBuildConnectionsInSvg(build);
}

// ════════════════════════════════════════════════════════════════════
// LEGEND COUNTS
// ════════════════════════════════════════════════════════════════════

function updateLegendCounts() {
  $('ct-forest').textContent = countTilesByBiome(state, 'forest');
  $('ct-mountain').textContent = countTilesByBiome(state, 'mountain');
  $('ct-lowlands').textContent = countTilesByBiome(state, 'lowlands');
  $('ct-beach').textContent = countTilesByBiome(state, 'beach');
  $('ct-desert').textContent = countTilesByBiome(state, 'desert');
  $('ct-water').textContent = countTilesByBiome(state, 'water');
}

// ════════════════════════════════════════════════════════════════════
// PAN + ZOOM — Optimized for smooth performance
// ════════════════════════════════════════════════════════════════════

let isPanning = false;
let panStart = { x: 0, y: 0 };
let rafPending = false;
let overlapCheckTimeout = null;

const mapWrap = $('map-wrap');

mapWrap?.addEventListener('mousedown', e => {
  // No pan on landing page - static view
  if (state.screen === 'landing') return;
  if (e.target.closest('.tile')) return;
  isPanning = true;
  // Store initial mouse position and pan state
  const svg = document.getElementById('map-svg');
  const rect = svg?.getBoundingClientRect();
  const scaleX = rect ? 3400 / rect.width : 1;
  const scaleY = rect ? 1900 / rect.height : 1;
  panStart = {
    mouseX: e.clientX,
    mouseY: e.clientY,
    panX: state.pan.x,
    panY: state.pan.y,
    scaleX,
    scaleY
  };
  mapWrap.classList.add('panning');
});

document.addEventListener('mousemove', e => {
  if (!isPanning) return;
  // Calculate delta in pixels, convert to SVG units, add to initial pan
  const deltaX = (e.clientX - panStart.mouseX) * panStart.scaleX;
  const deltaY = (e.clientY - panStart.mouseY) * panStart.scaleY;
  state.pan.x = panStart.panX + deltaX;
  state.pan.y = panStart.panY + deltaY;
  scheduleTransformUpdate();
});

document.addEventListener('mouseup', () => {
  isPanning = false;
  mapWrap?.classList.remove('panning');
  // Final overlap check when done panning
  scheduleOverlapCheck();
});

mapWrap?.addEventListener('wheel', e => {
  // No zoom on landing page - static view
  if (state.screen === 'landing') return;

  e.preventDefault();

  // Get cursor position relative to SVG center, converted to SVG units
  const svg = document.getElementById('map-svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();

  // SVG viewBox dimensions
  const viewBoxWidth = 3400;
  const viewBoxHeight = 1900;

  // Scale factors: pixels to SVG units
  const scaleX = viewBoxWidth / rect.width;
  const scaleY = viewBoxHeight / rect.height;

  // Mouse position relative to SVG center, in SVG units
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const mouseX = (e.clientX - centerX) * scaleX;
  const mouseY = (e.clientY - centerY) * scaleY;

  // Calculate zoom - limit max zoom to 4x for readable detail
  const oldZoom = state.zoom;
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoom = Math.max(0.3, Math.min(4, oldZoom * delta));
  const zoomRatio = newZoom / oldZoom;

  // Adjust pan to keep point under cursor fixed
  state.pan.x = mouseX - (mouseX - state.pan.x) * zoomRatio;
  state.pan.y = mouseY - (mouseY - state.pan.y) * zoomRatio;
  state.zoom = newZoom;

  scheduleTransformUpdate();
}, { passive: false });

// Schedule transform update with requestAnimationFrame for smooth animation
function scheduleTransformUpdate() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    updateWorldTransform();
  });
}

// Debounce overlap check — only run after movement stops
function scheduleOverlapCheck() {
  if (overlapCheckTimeout) clearTimeout(overlapCheckTimeout);
  overlapCheckTimeout = setTimeout(() => {
    updateTextOverlapState();
  }, 100);
}

function updateWorldTransform() {
  if (!worldGroup) return;
  // Use SVG transform attribute for more reliable behavior
  worldGroup.setAttribute('transform', `translate(${state.pan.x}, ${state.pan.y}) scale(${state.zoom})`);
  // Don't check overlap on every frame — debounce it
  scheduleOverlapCheck();
  // Note: Connections are now inside worldGroup and transform automatically
}

// Check if UI text elements overlap with rendered tiles
function updateTextOverlapState() {
  if (!tilesGroup || !state.island.tiles.length) return;

  // Get the bounding box of the tiles group in screen coordinates
  const tilesBBox = tilesGroup.getBoundingClientRect();

  // Elements to check for overlap
  const elementsToCheck = [
    { el: document.querySelector('.birdseye-stats-left'), class: 'over-tiles' },
    { el: document.querySelector('.birdseye-header-center'), class: 'over-tiles' }
  ];

  for (const item of elementsToCheck) {
    if (!item.el) continue;

    const elRect = item.el.getBoundingClientRect();

    // Check if element overlaps with tiles bounding box
    const overlaps = !(
      elRect.right < tilesBBox.left ||
      elRect.left > tilesBBox.right ||
      elRect.bottom < tilesBBox.top ||
      elRect.top > tilesBBox.bottom
    );

    // Also check if there's significant overlap (not just edge touching)
    const overlapArea = Math.max(0,
      Math.min(elRect.right, tilesBBox.right) - Math.max(elRect.left, tilesBBox.left)
    ) * Math.max(0,
      Math.min(elRect.bottom, tilesBBox.bottom) - Math.max(elRect.top, tilesBBox.top)
    );
    const elArea = elRect.width * elRect.height;
    const significantOverlap = elArea > 0 && (overlapArea / elArea) > 0.3;

    if (significantOverlap) {
      item.el.classList.add(item.class);
    } else {
      item.el.classList.remove(item.class);
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// CONNECTIONS OVERLAY
// Shows material flow threads between tiles on the island view
// Rendered inside the SVG worldGroup so it transforms with pan/zoom
// ════════════════════════════════════════════════════════════════════

const CONN_COLORS = {
  timber: '#7AA87A',
  stone: '#8B8B8B',
  clay: '#C8A060',
  sand: '#E8D890',
  thatch: '#B8A050',
  brick: '#B8554A',
  concrete: '#A0A0A0',
  glass: '#A8D8E8',
  processing: '#E8B878',
  building: '#5A9AB8'
};

/**
 * Get SVG coordinates for a tile (accounting for elevation)
 */
function getTileSvgCoords(gx, gy) {
  const { sx, sy } = gridToScreen(gx, gy, state.viewMode);
  const tile = state.island.tiles.find(t => t.gx === gx && t.gy === gy);
  const isPlan = state.viewMode === 'plan' || state.viewMode === 'figureplan';
  const elevOffset = (!isPlan && tile) ? tile.elev * ELEV_UNIT : 0;
  return { x: sx, y: sy - elevOffset };
}

/**
 * Create an SVG element with attributes
 */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  return el;
}

/**
 * Show all connections in the worldGroup
 */
function showConnectionsOverlay() {
  // Remove existing connections
  hideConnectionsOverlay();

  if (!worldGroup) return;

  // Create connections group
  const connGroup = svgEl('g', { id: 'connections-group', class: 'connections-layer' });

  // Add defs for markers and effects
  const defs = svgEl('defs');

  // Arrow marker
  const marker = svgEl('marker', {
    id: 'conn-arrow-marker',
    markerWidth: '8',
    markerHeight: '8',
    refX: '6',
    refY: '3',
    orient: 'auto'
  });
  const arrow = svgEl('path', {
    d: 'M0,0 L0,6 L6,3 z',
    fill: 'rgba(90, 154, 184, 0.7)'
  });
  marker.appendChild(arrow);
  defs.appendChild(marker);
  connGroup.appendChild(defs);

  // Draw connections for each build
  const builds = state.island.builds || [];

  for (const build of builds) {
    const draws = build.draws || [];
    if (draws.length === 0 || !build.primaryTile) continue;

    const buildPos = getTileSvgCoords(build.primaryTile.gx, build.primaryTile.gy);

    for (const draw of draws) {
      const src = draw.rawSourceTile || draw.fromTile;
      if (!src) continue;

      const srcPos = getTileSvgCoords(src.gx, src.gy);
      const matColor = CONN_COLORS[draw.rawMaterial || draw.material] || CONN_COLORS.building;

      // If has processing, draw through facility
      if (draw.processingBuilding?.tile) {
        const procPos = getTileSvgCoords(draw.processingBuilding.tile.gx, draw.processingBuilding.tile.gy);

        // Source to processing (dashed)
        const line1 = createConnectionPath(srcPos, procPos, matColor, true);
        connGroup.appendChild(line1);

        // Processing to build (solid)
        const line2 = createConnectionPath(procPos, buildPos, matColor, false);
        connGroup.appendChild(line2);

        // Processing marker
        const procMarker = svgEl('circle', {
          cx: procPos.x,
          cy: procPos.y,
          r: 6,
          fill: CONN_COLORS.processing,
          stroke: 'white',
          'stroke-width': 1.5,
          class: 'conn-processing-marker'
        });
        connGroup.appendChild(procMarker);
      } else {
        // Direct connection
        const line = createConnectionPath(srcPos, buildPos, matColor, false);
        connGroup.appendChild(line);
      }

      // Source marker
      const srcMarker = svgEl('circle', {
        cx: srcPos.x,
        cy: srcPos.y,
        r: 5,
        fill: matColor,
        stroke: 'white',
        'stroke-width': 1,
        class: 'conn-source-marker'
      });
      connGroup.appendChild(srcMarker);
    }

    // Build marker (larger)
    const buildMarker = svgEl('circle', {
      cx: buildPos.x,
      cy: buildPos.y,
      r: 7,
      fill: CONN_COLORS.building,
      stroke: 'white',
      'stroke-width': 2,
      class: 'conn-build-marker'
    });
    connGroup.appendChild(buildMarker);
  }

  // Insert connections group after tiles but before buildings for proper layering
  const buildingsGroup = worldGroup.querySelector('#buildings');
  if (buildingsGroup) {
    worldGroup.insertBefore(connGroup, buildingsGroup);
  } else {
    worldGroup.appendChild(connGroup);
  }
}

/**
 * Show connections for a single build only
 */
function showSingleBuildConnectionsInSvg(build) {
  hideConnectionsOverlay();

  if (!worldGroup || !build) return;

  const connGroup = svgEl('g', { id: 'connections-group', class: 'connections-layer single-build' });

  const draws = build.draws || [];
  if (!build.primaryTile) return;

  const buildPos = getTileSvgCoords(build.primaryTile.gx, build.primaryTile.gy);

  for (const draw of draws) {
    const src = draw.rawSourceTile || draw.fromTile;
    if (!src) continue;

    const srcPos = getTileSvgCoords(src.gx, src.gy);
    const matColor = CONN_COLORS[draw.rawMaterial || draw.material] || CONN_COLORS.building;

    if (draw.processingBuilding?.tile) {
      const procPos = getTileSvgCoords(draw.processingBuilding.tile.gx, draw.processingBuilding.tile.gy);

      // Curved paths with glow effect
      const line1 = createConnectionPath(srcPos, procPos, matColor, true, true);
      connGroup.appendChild(line1);

      const line2 = createConnectionPath(procPos, buildPos, matColor, false, true);
      connGroup.appendChild(line2);

      // Processing marker with pulse
      const procMarker = svgEl('circle', {
        cx: procPos.x,
        cy: procPos.y,
        r: 8,
        fill: CONN_COLORS.processing,
        stroke: 'white',
        'stroke-width': 2,
        class: 'conn-processing-marker pulse'
      });
      connGroup.appendChild(procMarker);
    } else {
      const line = createConnectionPath(srcPos, buildPos, matColor, false, true);
      connGroup.appendChild(line);
    }

    // Source marker with pulse
    const srcMarker = svgEl('circle', {
      cx: srcPos.x,
      cy: srcPos.y,
      r: 7,
      fill: matColor,
      stroke: 'white',
      'stroke-width': 1.5,
      class: 'conn-source-marker pulse'
    });
    connGroup.appendChild(srcMarker);
  }

  // Build marker (largest, pulsing)
  const buildMarker = svgEl('circle', {
    cx: buildPos.x,
    cy: buildPos.y,
    r: 10,
    fill: CONN_COLORS.building,
    stroke: 'white',
    'stroke-width': 2.5,
    class: 'conn-build-marker pulse'
  });
  connGroup.appendChild(buildMarker);

  const buildingsGroup = worldGroup.querySelector('#buildings');
  if (buildingsGroup) {
    worldGroup.insertBefore(connGroup, buildingsGroup);
  } else {
    worldGroup.appendChild(connGroup);
  }
}

/**
 * Create a curved connection path
 */
function createConnectionPath(from, to, color, dashed, glow = false) {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  // Calculate curve offset
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = dist * 0.15;

  // Perpendicular direction for curve
  const nx = -dy / (dist || 1);
  const ny = dx / (dist || 1);

  const ctrlX = midX + nx * offset;
  const ctrlY = midY + ny * offset;

  const path = svgEl('path', {
    d: `M${from.x},${from.y} Q${ctrlX},${ctrlY} ${to.x},${to.y}`,
    stroke: color,
    'stroke-width': glow ? 3 : 2,
    fill: 'none',
    opacity: glow ? 0.8 : 0.6,
    class: `conn-line ${dashed ? 'dashed' : ''} ${glow ? 'glow' : ''}`
  });

  if (dashed) {
    path.setAttribute('stroke-dasharray', '8 5');
  }

  return path;
}

/**
 * Hide the connections overlay
 */
function hideConnectionsOverlay() {
  const existing = document.getElementById('connections-group');
  if (existing) existing.remove();
}

/**
 * Update connections overlay (no longer needed - SVG transforms handle it)
 */
function updateConnectionsOverlay() {
  // No-op: connections now live inside worldGroup and transform automatically
}

// ════════════════════════════════════════════════════════════════════
// ZOOM TO SELECTION
// ════════════════════════════════════════════════════════════════════

function zoomToSelection(tiles) {
  if (!tiles || tiles.length === 0) return;

  // Save current zoom state if not already saved
  if (!savedZoomState) {
    savedZoomState = {
      zoom: state.zoom,
      panX: state.pan.x,
      panY: state.pan.y
    };
  }

  // Calculate bounding box of selected tiles in SVG coordinates
  // Use actual tile dimensions from projection
  const tileW = 38; // TILE_W
  const tileH = 19; // TILE_H

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const tile of tiles) {
    const pos = gridToScreen(tile.gx, tile.gy, state.viewMode);
    // gridToScreen returns { sx, sy }, not { x, y }
    minX = Math.min(minX, pos.sx - tileW);
    maxX = Math.max(maxX, pos.sx + tileW);
    minY = Math.min(minY, pos.sy - tileH);
    maxY = Math.max(maxY, pos.sy + tileH);
  }

  // Calculate center of selection
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Calculate selection dimensions
  const selWidth = maxX - minX;
  const selHeight = maxY - minY;

  // Target: selection takes up 20% of screen height (less aggressive zoom)
  const viewBoxHeight = 1900;
  const targetHeight = viewBoxHeight * 0.2;
  const targetZoom = targetHeight / Math.max(selHeight, 50);

  // Clamp zoom to reasonable range to maintain resolution
  const newZoom = Math.min(Math.max(targetZoom, 1.5), 5);

  // Calculate pan to center the selection
  // ViewBox is centered at (0, 0) with range -1700 to 1700 and -950 to 950
  // After zoom, the center should appear at viewBox center (0, 0)
  // Transform is: translate(pan) then scale(zoom)
  // Final position = point * zoom + pan
  // We want: centerX * zoom + panX = 0
  // So: panX = -centerX * zoom
  const newPanX = -centerX * newZoom;
  const newPanY = -centerY * newZoom;

  // Animate to new zoom/pan
  animateZoom(newZoom, newPanX, newPanY);
}

function restoreZoom() {
  if (!savedZoomState) return;

  animateZoom(savedZoomState.zoom, savedZoomState.panX, savedZoomState.panY, () => {
    savedZoomState = null;
  });
}

function animateZoom(targetZoom, targetPanX, targetPanY, onComplete) {
  // Cancel any existing animation
  if (zoomAnimationFrame) {
    cancelAnimationFrame(zoomAnimationFrame);
  }

  const startZoom = state.zoom;
  const startPanX = state.pan.x;
  const startPanY = state.pan.y;
  const duration = 400; // ms
  const startTime = performance.now();

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);

    state.zoom = startZoom + (targetZoom - startZoom) * eased;
    state.pan.x = startPanX + (targetPanX - startPanX) * eased;
    state.pan.y = startPanY + (targetPanY - startPanY) * eased;

    updateWorldTransform();

    if (progress < 1) {
      zoomAnimationFrame = requestAnimationFrame(animate);
    } else {
      zoomAnimationFrame = null;
      if (onComplete) onComplete();
    }
  }

  zoomAnimationFrame = requestAnimationFrame(animate);
}

// ════════════════════════════════════════════════════════════════════
// LEDGER + BUILD LOG TOGGLES
// ════════════════════════════════════════════════════════════════════

$('resource-strip')?.addEventListener('click', () => {
  const ledger = $('ledger');
  if (ledger) {
    ledger.style.display = ledger.style.display === 'none' ? 'block' : 'none';
  }
});

$('buildlog-head')?.addEventListener('click', () => {
  $('buildlog')?.classList.toggle('collapsed');
});

// ─── RHINO EXPORT ────────────────────────────────────────────────────
$('export-3dm-btn')?.addEventListener('click', async () => {
  try {
    const result = await exportToRhino(state);
    console.log('Export complete:', result);
  } catch (err) {
    alert('Export failed: ' + err.message);
  }
});

// ─── LEDGER UPDATE ─────────────────────────────────────────────────
function updateLedgerUI() {
  const ledger = state.ledger;

  // Resource strip — compact bar display
  const cells = {
    timber: ledger.timber,
    stone: ledger.stone,
    sand: ledger.sand,
    labor: ledger.labor,
    energy: ledger.energy
  };

  for (const [res, val] of Object.entries(cells)) {
    const cell = document.querySelector(`.rs-cell[data-res="${res}"]`);
    if (cell) {
      const valEl = cell.querySelector('.rs-val');
      const fillEl = cell.querySelector('.rs-fill');
      if (valEl) valEl.textContent = val.toLocaleString();
      if (fillEl) {
        const max = res === 'timber' ? 10000 : res === 'stone' ? 12000 : res === 'sand' ? 5000 : 10000;
        fillEl.style.width = Math.max(0, Math.min(100, (val / max) * 100)) + '%';
      }
    }
  }

  // Ledger panel — detailed view
  const panelVals = {
    'r-timber': ledger.timber,
    'r-stone': ledger.stone,
    'r-sand': ledger.sand,
    'r-labor': ledger.labor,
    'r-energy': ledger.energy
  };

  for (const [id, val] of Object.entries(panelVals)) {
    const el = $(id);
    if (el) el.textContent = val.toLocaleString();
  }

  // Update bar fills in the ledger panel
  const barFills = {
    timber: [ledger.timber, 10000],
    stone: [ledger.stone, 12000],
    sand: [ledger.sand, 5000],
    labor: [ledger.labor, 10000],
    energy: [ledger.energy, 10000]
  };

  for (const [res, [val, max]] of Object.entries(barFills)) {
    const row = document.querySelector(`.resource-row[data-res="${res}"]`);
    if (row) {
      const fill = row.querySelector('.bar-fill');
      if (fill) fill.style.width = Math.max(0, Math.min(100, (val / max) * 100)) + '%';
    }
  }

  // Day counter (ledger and birdseye header)
  const day = state.island.gameDay || 1;
  const dayStr = String(day).padStart(4, '0');

  const ledgerDayEl = $('ledger-ts');
  if (ledgerDayEl) ledgerDayEl.textContent = `DAY ${dayStr}`;

  const birdseyeDayEl = $('birdseye-day');
  if (birdseyeDayEl) birdseyeDayEl.textContent = dayStr;
}

// ════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════

console.log('── Generating island ──');
const startTime = performance.now();
generateIsland(state);
const genTime = (performance.now() - startTime).toFixed(1);
console.log(`Island generated in ${genTime}ms`);
console.log(`Total tiles: ${state.island.tiles.length}`);

// Seed starter network
seedStarterNetwork(state);
console.log(`Starter builds: ${state.island.builds.length}`);
console.log(`Road segments: ${state.island.roads.size}`);

// Prepopulate with varied buildings
prepopulateIsland(state);
console.log(`Total builds after prepopulation: ${state.island.builds.length}`);

// Initialize ledger display
updateLedgerUI();

// Update landing and birdseye stats
function updateStats() {
  const builds = state.island.builds.length;
  const uniqueAgents = new Set(state.island.builds.map(b => b.author)).size;
  const totalTiles = state.island.tiles.filter(t => t.biome !== 'water').length;
  const builtTiles = state.island.tiles.filter(t => t.built).length;

  // Calculate actual resource depletion based on material usage
  let totalMaterialCapacity = 0;
  let totalMaterialUsed = 0;

  // Count materials used in builds
  for (const build of state.island.builds) {
    if (build.materialReq) {
      for (const [mat, amount] of Object.entries(build.materialReq)) {
        totalMaterialUsed += amount || 0;
      }
    }
  }

  // Estimate total island capacity (rough approximation)
  const harvestMats = ['timber', 'stone', 'clay', 'sand', 'thatch'];
  for (const mat of harvestMats) {
    const spec = ISLAND_MATERIALS[mat];
    if (spec && spec.yieldPerTile && spec.sourceBiome) {
      const sourceTiles = state.island.tiles.filter(t => t.biome === spec.sourceBiome).length;
      totalMaterialCapacity += sourceTiles * spec.yieldPerTile;
    }
  }

  // Calculate percentage of resources remaining
  const resourcesLeft = totalMaterialCapacity > 0
    ? Math.round((1 - totalMaterialUsed / totalMaterialCapacity) * 100)
    : 100;

  // Calculate total carbon
  let totalCarbon = 0;
  for (const build of state.island.builds) {
    totalCarbon += build.embodiedCarbon || 0;
    totalCarbon += build.transportCarbon || 0;
  }

  // Landing stats
  const lBuilders = $('l-builders');
  const lBuilt = $('l-built');
  const lDepletion = $('l-depletion');
  if (lBuilders) lBuilders.textContent = uniqueAgents;
  if (lBuilt) lBuilt.textContent = builds;
  if (lDepletion) lDepletion.textContent = resourcesLeft;

  // Birdseye stats
  const bAgents = $('l-agents');
  const bBuilds = $('l-builds');
  const bResources = $('l-resources');
  if (bAgents) bAgents.textContent = uniqueAgents;
  if (bBuilds) bBuilds.textContent = builds;
  if (bResources) bResources.textContent = resourcesLeft;

  // Update carbon display if present
  const carbonEl = $('l-carbon');
  if (carbonEl) carbonEl.textContent = totalCarbon.toFixed(1);
}
updateStats();

// Refresh stats periodically (every 5 seconds)
setInterval(updateStats, 5000);

// Render the island tiles (visible on both landing and island screens)
renderIsland();

// Listen for sourcing view mode changes
window.addEventListener('sourcing-view-change', (e) => {
  const mode = e.detail?.mode;
  if (mode === 'plan') {
    state.viewMode = 'plan';
    state.viewAngle = 'plan';
  } else if (mode === 'atlas' || mode === 'iso') {
    state.viewMode = 'atlas';
    state.viewAngle = 'iso';
  }
  renderIsland();
});

// Listen for wizard view mode changes (build wizard step-by-step flow)
window.addEventListener('wizard-view-change', (e) => {
  const mode = e.detail?.mode;
  if (mode === 'plan') {
    state.viewMode = 'plan';
    state.viewAngle = 'plan';
  } else if (mode === 'atlas' || mode === 'iso') {
    state.viewMode = 'atlas';
    state.viewAngle = 'iso';
  }
  renderIsland();
});

// Store render callback on state for build module access
state._renderCallback = renderIsland;

// Listen for island changes (e.g., new builds) to trigger re-render
window.addEventListener('island-changed', () => {
  renderIsland();
  renderAllIsoBuildings(state, state.viewMode);
  updateLegendCounts();
  // Refresh builds panel if it exists
  if (window.refreshBuildsPanel) {
    window.refreshBuildsPanel();
  }
});

// Initialize build handlers with state reference
initBuildHandlers(state);

// Expose global functions for build module to refresh views
window.refreshIsoBuildings = () => {
  renderAllIsoBuildings(state, state.viewMode);
};
window.markWalkBuildingsStale = () => {
  // The walk module will recreate buildings on next activation
  state._walkBuildingsStale = true;
};

// Set up game loop
setGlobalState(state);
setRenderCallback(renderIsland);

// Initialize salvage panel
updateSalvagePanel(state);

// ════════════════════════════════════════════════════════════════════
// ACTIVE AGENTS PANEL — Shows real agent data from prepopulated builds
// ════════════════════════════════════════════════════════════════════

function getAgentStats(agentName) {
  const builds = getBuildsByAgent(state, agentName);
  const info = getAgentInfo(agentName);

  // Calculate totals from builds
  let totalResources = 0;
  let totalLabor = 0;
  let totalWaste = 0;

  for (const build of builds) {
    // Sum material requirements
    if (build.materialReq) {
      totalResources += (build.materialReq.timber || 0);
      totalResources += (build.materialReq.stone || 0);
      totalResources += (build.materialReq.brick || 0);
      totalResources += (build.materialReq.concrete || 0);
    }
    totalLabor += build.laborReq || 0;
    if (build.wasteReq) {
      totalWaste += (build.wasteReq.soil || 0) + (build.wasteReq.debris || 0);
    }
  }

  return {
    name: agentName,
    style: info?.style || '',
    builds: builds.length,
    resources: totalResources > 1000 ? `${(totalResources / 1000).toFixed(1)}k bf` : `${totalResources} bf`,
    laborHours: totalLabor > 1000 ? `${(totalLabor / 1000).toFixed(1)}k hrs` : `${totalLabor} hrs`,
    waste: `${Math.round(totalWaste / 10)} kg`
  };
}

function initActiveAgentsPanel() {
  const panel = $('active-agents-panel');
  const tbody = $('aap-tbody');
  if (!panel || !tbody) return;

  // Get real agent data
  const agentNames = getAgentNames();
  const agentStats = agentNames.map(name => getAgentStats(name));

  // Sort by number of builds (descending)
  agentStats.sort((a, b) => b.builds - a.builds);

  // Populate table with real data
  tbody.innerHTML = '';
  agentStats.forEach((agent, idx) => {
    const row = document.createElement('tr');
    const wasteNum = parseInt(agent.waste);
    const wasteClass = wasteNum > 200 ? 'waste-high' : '';
    row.innerHTML = `
      <td><span class="agent-num">${String(idx + 1).padStart(2, '0')}</span><span class="agent-name">${agent.name}</span></td>
      <td>${agent.builds}</td>
      <td>${agent.resources}</td>
      <td>${agent.laborHours}</td>
      <td class="${wasteClass}">${agent.waste}</td>
    `;
    row.title = agent.style; // Show style on hover
    tbody.appendChild(row);
  });

  // Find Active Agents stat elements (both landing and birdseye)
  const landingAgentsStat = document.querySelector('.landing-stat-left');
  const birdseyeAgentsStat = document.querySelector('.birdseye-stat:first-child');

  // Add has-panel class for cursor styling
  if (landingAgentsStat) landingAgentsStat.classList.add('has-panel');
  if (birdseyeAgentsStat) birdseyeAgentsStat.classList.add('has-panel');

  let hideTimeout = null;

  function showPanel() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    panel.classList.add('visible');
  }

  function hidePanel() {
    hideTimeout = setTimeout(() => {
      panel.classList.remove('visible');
    }, 150); // Small delay for smoother UX when moving to panel
  }

  // Landing page stat hover
  if (landingAgentsStat) {
    landingAgentsStat.addEventListener('mouseenter', showPanel);
    landingAgentsStat.addEventListener('mouseleave', hidePanel);
  }

  // Birdseye stat hover
  if (birdseyeAgentsStat) {
    birdseyeAgentsStat.addEventListener('mouseenter', showPanel);
    birdseyeAgentsStat.addEventListener('mouseleave', hidePanel);
  }

  // Keep panel open when hovering over it
  panel.addEventListener('mouseenter', () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  });
  panel.addEventListener('mouseleave', hidePanel);
}

initActiveAgentsPanel();

// ════════════════════════════════════════════════════════════════════
// BUILDS INVENTORY PANEL — Hover interaction with fake building data
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// BUILD PREVIEW HELPERS
// ════════════════════════════════════════════════════════════════════

/**
 * Get the ISO image for a build (from the tile's populated data)
 */
function getBuildIsoImage(build) {
  const tile = state.island.tiles.find(t =>
    t.gx === build.primaryTile?.gx && t.gy === build.primaryTile?.gy
  );
  return tile?.populated?.isoImage?.dataURL || null;
}

// Fallback SVG icons for when ISO image not available
function getBuildingIcon(type) {
  const icons = {
    tower: `<svg viewBox="0 0 60 60" fill="none" stroke="#9AACBC" stroke-width="1">
      <rect x="20" y="10" width="20" height="45" fill="#E8E8E8"/>
      <rect x="23" y="15" width="5" height="6"/>
      <rect x="32" y="15" width="5" height="6"/>
      <rect x="23" y="25" width="5" height="6"/>
      <rect x="32" y="25" width="5" height="6"/>
      <rect x="23" y="35" width="5" height="6"/>
      <rect x="32" y="35" width="5" height="6"/>
      <rect x="26" y="45" width="8" height="10" fill="#D0D0D0"/>
    </svg>`,
    shed: `<svg viewBox="0 0 60 60" fill="none" stroke="#9AACBC" stroke-width="1">
      <rect x="8" y="35" width="44" height="15" fill="#E8E8E8"/>
      <line x1="15" y1="35" x2="15" y2="50"/>
      <line x1="30" y1="35" x2="30" y2="50"/>
      <line x1="45" y1="35" x2="45" y2="50"/>
      <path d="M5 35 L30 20 L55 35" fill="none" stroke-width="1.5"/>
    </svg>`
  };
  return icons[type] || icons.tower;
}

function getGradeClass(grade) {
  if (grade.startsWith('A')) return 'grade-a';
  if (grade.startsWith('B')) return 'grade-b';
  if (grade.startsWith('C')) return 'grade-c';
  return 'grade-d';
}

function initBuildsPanel() {
  const panel = $('builds-panel');
  const grid = $('bp-grid');
  if (!panel || !grid) return;

  // Populate grid with real builds from state
  refreshBuildsPanel();

  function refreshBuildsPanel() {
    grid.innerHTML = '';

    // Get all built tiles (group by tile, not individual builds)
    const builtTiles = state.island.tiles.filter(t => t.built && t.populated);

    builtTiles.forEach((tile) => {
      const card = document.createElement('div');
      card.className = 'bp-card';
      card.dataset.tileId = tile.id;
      card.dataset.tileGx = tile.gx;
      card.dataset.tileGy = tile.gy;

      const populated = tile.populated;
      const buildCount = populated.buildingCount || 1;

      // Get primary build for this tile
      const primaryBuild = state.island.builds.find(b =>
        b.primaryTile?.gx === tile.gx && b.primaryTile?.gy === tile.gy
      ) || state.island.builds.find(b => b.id === tile.buildId);

      // Get grade from primary build
      const grade = primaryBuild?.grade || { letter: 'C' };
      const gradeLetter = grade.letter || 'C';

      // Get info
      const author = primaryBuild?.author || 'unknown';
      const name = populated.name || primaryBuild?.name || 'Building';
      const floors = populated.floors || primaryBuild?.stats?.floors || 1;
      const typology = primaryBuild?.stats?.typology || '';

      // Get ISO image directly from tile
      const isoImage = populated.isoImage?.dataURL;
      const previewContent = isoImage
        ? `<img src="${isoImage}" alt="${name}" class="bp-iso-img"/>`
        : getBuildingIcon(primaryBuild?.stats?.category || 'tower');

      // Show building count if multiple
      const countBadge = buildCount > 1 ? `<span class="bp-card-count">${buildCount}</span>` : '';

      card.innerHTML = `
        ${countBadge}
        <span class="bp-card-designer">BY: ${author}</span>
        <div class="bp-card-preview">${previewContent}</div>
        <span class="bp-card-name">${name}</span>
        <span class="bp-card-info">${floors}F · ${typology}</span>
        <span class="bp-card-grade ${getGradeClass(gradeLetter)}">GRADE: ${gradeLetter}</span>
        <div class="bp-card-overlay">
          <span class="bp-card-view">VIEW<span class="arrow">→</span></span>
        </div>
      `;

      // Click handler to open build profile - look up build fresh at click time
      card.addEventListener('click', () => {
        const gx = parseInt(card.dataset.tileGx);
        const gy = parseInt(card.dataset.tileGy);

        // Find the tile
        const clickedTile = state.island.tiles.find(t => t.gx === gx && t.gy === gy);

        // Find ALL builds on this tile
        const tileBuilds = state.island.builds.filter(b =>
          b.primaryTile?.gx === gx && b.primaryTile?.gy === gy
        );

        if (tileBuilds.length > 0 || clickedTile?.populated) {
          // Pass tile info along with builds for multi-building support
          // IMPORTANT: Spread tileBuilds[0] FIRST, then override with tile's current populated data
          const buildData = {
            ...tileBuilds[0],  // Base build data
            tile: clickedTile,
            builds: tileBuilds,
            populated: clickedTile?.populated,  // Use tile's populated (has current isoImage)
          };
          openBuildProfile(buildData, state);
        } else {
          console.warn('[BUILD PROFILE] No build found for tile', gx, gy);
        }
        panel.classList.remove('visible');
      });

      grid.appendChild(card);
    });
  }

  // Expose refresh function globally for updates after new builds
  window.refreshBuildsPanel = refreshBuildsPanel;

  // Find Builds stat elements (both landing and birdseye)
  const landingBuildsStat = document.querySelector('.landing-stat-center');
  const birdseyeBuildsStat = document.querySelector('.birdseye-stats-left .birdseye-stat:nth-child(2)');

  console.log('[BUILDS PANEL] Landing stat:', landingBuildsStat);
  console.log('[BUILDS PANEL] Birdseye stat:', birdseyeBuildsStat);

  // Add has-builds-panel class for cursor styling
  if (landingBuildsStat) landingBuildsStat.classList.add('has-builds-panel');
  if (birdseyeBuildsStat) birdseyeBuildsStat.classList.add('has-builds-panel');

  let hideTimeout = null;

  function showPanel() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    panel.classList.add('visible');
  }

  function hidePanel() {
    hideTimeout = setTimeout(() => {
      panel.classList.remove('visible');
    }, 200);
  }

  // Landing page builds stat hover
  if (landingBuildsStat) {
    landingBuildsStat.addEventListener('mouseenter', showPanel);
    landingBuildsStat.addEventListener('mouseleave', hidePanel);
  }

  // Birdseye builds stat hover
  if (birdseyeBuildsStat) {
    birdseyeBuildsStat.addEventListener('mouseenter', showPanel);
    birdseyeBuildsStat.addEventListener('mouseleave', hidePanel);
  }

  // Keep panel open when hovering over it
  panel.addEventListener('mouseenter', () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  });
  panel.addEventListener('mouseleave', hidePanel);

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (panel.classList.contains('visible') && !panel.contains(e.target) &&
        !e.target.closest('.has-builds-panel')) {
      panel.classList.remove('visible');
    }
  });
}

initBuildsPanel();

// ════════════════════════════════════════════════════════════════════
// RESOURCES PANEL
// ════════════════════════════════════════════════════════════════════

function initResourcesPanel() {
  const panel = document.getElementById('resources-panel');
  const list = document.getElementById('rp-list');
  if (!panel || !list) return;

  const landingResourcesStat = document.querySelector('.landing-stat-right');
  const birdseyeResourcesStat = document.querySelector('.birdseye-stat:nth-child(3)');

  // Add has-panel class for cursor styling
  if (landingResourcesStat) landingResourcesStat.classList.add('has-panel');
  if (birdseyeResourcesStat) birdseyeResourcesStat.classList.add('has-panel');

  let hideTimeout = null;

  function calculateResources() {
    const state = window.__OFFCUT_STATE__;
    if (!state || !state.island) return {};

    const resources = {};

    // Harvestable materials (from biomes)
    const harvestable = ['timber', 'stone', 'clay', 'sand', 'thatch', 'water'];

    // Processed materials
    const processed = ['brick', 'glass', 'concrete', 'adobe'];

    // Imported materials
    const imported = ['steel'];

    // Calculate harvestable resources
    for (const mat of harvestable) {
      const spec = ISLAND_MATERIALS[mat];
      if (!spec) continue;

      let unextracted = 0;
      let built = 0;

      // Calculate unextracted (remaining yield across all source tiles)
      for (const tile of state.island.tiles) {
        if (tile.biome === spec.sourceBiome) {
          unextracted += tileRemainingYield(state, tile, mat);
        }
      }

      // Calculate built (materials in ALL builds - standing, constructing, committed)
      for (const build of (state.island.builds || [])) {
        const status = build.status;
        if (status === 'standing' || status === 'committed' || status === 'constructing' || status === 'deteriorating') {
          built += build.materialReq?.[mat] || 0;
        }
      }

      // Get waste (salvage inventory)
      const waste = getSalvageTotal(state, mat);

      resources[mat] = {
        name: spec.name,
        source: spec.sourceBiome.charAt(0).toUpperCase() + spec.sourceBiome.slice(1),
        unit: spec.unit,
        type: 'harvestable',
        unextracted,
        built,
        waste,
        total: unextracted + built + waste
      };
    }

    // Calculate processed resources
    for (const mat of processed) {
      const spec = ISLAND_MATERIALS[mat];
      if (!spec) continue;

      let built = 0;
      for (const build of (state.island.builds || [])) {
        const status = build.status;
        if (status === 'standing' || status === 'committed' || status === 'constructing' || status === 'deteriorating') {
          built += build.materialReq?.[mat] || 0;
        }
      }

      const waste = getSalvageTotal(state, mat);

      // Always have some processed material ready at facilities
      // Base stockpile varies by material type, scales slightly with island activity
      const baseStockpiles = {
        brick: 2500,      // Brick kilns produce steadily
        glass: 800,       // Glass furnace output
        concrete: 1500,   // Concrete plant batches
        adobe: 500        // Sun-dried, slower production
      };
      const baseStock = baseStockpiles[mat] || 500;
      const activityBonus = Math.floor((state.island.builds?.length || 0) * 5);
      const stockpile = (state.island.stockpile?.[mat] || 0) + baseStock + activityBonus;

      // Build recipe string from processedFrom
      let recipe = '';
      if (spec.processedFrom) {
        const ingredients = Object.entries(spec.processedFrom)
          .map(([m, amt]) => ISLAND_MATERIALS[m]?.name || m)
          .join(' + ');
        const facility = spec.requiresLabor
          ? ` + ${spec.requiresLabor.charAt(0).toUpperCase() + spec.requiresLabor.slice(1)}`
          : ' (sun-dried)';
        recipe = ingredients + facility;
      }

      resources[mat] = {
        name: spec.name,
        source: 'Processed',
        unit: spec.unit,
        type: 'processed',
        recipe,
        unextracted: 0,
        stockpile,
        built,
        waste,
        total: stockpile + built + waste
      };
    }

    // Calculate imported resources
    for (const mat of imported) {
      const spec = ISLAND_MATERIALS[mat];
      if (!spec) continue;

      let built = 0;
      for (const build of (state.island.builds || [])) {
        const status = build.status;
        if (status === 'standing' || status === 'committed' || status === 'constructing' || status === 'deteriorating') {
          built += build.materialReq?.[mat] || 0;
        }
      }

      const stockpile = state.island.steelStockpile || 0;

      resources[mat] = {
        name: spec.name,
        source: 'Imported',
        unit: spec.unit,
        type: 'imported',
        unextracted: 0,
        stockpile,
        built,
        waste: 0,
        maxStockpile: spec.maxStockpile,
        total: stockpile + built
      };
    }

    return resources;
  }

  function renderPanel() {
    const resources = calculateResources();
    list.innerHTML = '';

    // Group by type for organized display
    const groups = {
      harvestable: { label: 'FROM ISLAND', items: [] },
      processed: { label: 'PROCESSED', items: [] },
      imported: { label: 'IMPORTED', items: [] }
    };

    for (const [mat, data] of Object.entries(resources)) {
      // Always show imported and processed materials; only hide harvestable if truly empty
      if (data.total === 0 && data.type === 'harvestable') continue;
      groups[data.type]?.items.push({ mat, data });
    }

    for (const [type, group] of Object.entries(groups)) {
      if (group.items.length === 0) continue;

      // Add section header
      const header = document.createElement('div');
      header.className = 'rp-section-header';
      header.textContent = group.label;
      list.appendChild(header);

      for (const { mat, data } of group.items) {
        const row = document.createElement('div');
        row.className = 'rp-row';

        if (type === 'harvestable') {
          const pctUnextracted = data.total > 0 ? (data.unextracted / data.total) * 100 : 0;
          const pctBuilt = data.total > 0 ? (data.built / data.total) * 100 : 0;
          const pctWaste = data.total > 0 ? (data.waste / data.total) * 100 : 0;

          row.innerHTML = `
            <div class="rp-row-header">
              <span class="rp-material">${data.name}</span>
              <span class="rp-source">from ${data.source}</span>
            </div>
            <div class="rp-bar-container">
              <div class="rp-bar-segment rp-bar-unextracted" style="width: ${pctUnextracted}%"></div>
              <div class="rp-bar-segment rp-bar-built" style="width: ${pctBuilt}%"></div>
              <div class="rp-bar-segment rp-bar-waste" style="width: ${pctWaste}%"></div>
            </div>
            <div class="rp-stats">
              <span class="rp-stat"><span class="rp-stat-dot rp-dot-unextracted"></span>${Math.round(data.unextracted).toLocaleString()}</span>
              <span class="rp-stat"><span class="rp-stat-dot rp-dot-built"></span>${Math.round(data.built).toLocaleString()}</span>
              <span class="rp-stat"><span class="rp-stat-dot rp-dot-waste"></span>${Math.round(data.waste).toLocaleString()}</span>
            </div>
          `;
        } else if (type === 'processed') {
          const pctStockpile = data.total > 0 ? (data.stockpile / data.total) * 100 : 0;
          const pctBuilt = data.total > 0 ? (data.built / data.total) * 100 : 0;
          const pctWaste = data.total > 0 ? (data.waste / data.total) * 100 : 0;

          row.innerHTML = `
            <div class="rp-row-header">
              <span class="rp-material">${data.name}</span>
              <span class="rp-recipe">${data.recipe}</span>
            </div>
            <div class="rp-bar-container">
              <div class="rp-bar-segment rp-bar-stockpile" style="width: ${pctStockpile}%"></div>
              <div class="rp-bar-segment rp-bar-built" style="width: ${pctBuilt}%"></div>
              <div class="rp-bar-segment rp-bar-waste" style="width: ${pctWaste}%"></div>
            </div>
            <div class="rp-stats">
              <span class="rp-stat"><span class="rp-stat-dot rp-dot-stockpile"></span>${Math.round(data.stockpile).toLocaleString()} ready</span>
              <span class="rp-stat"><span class="rp-stat-dot rp-dot-built"></span>${Math.round(data.built).toLocaleString()} built</span>
            </div>
          `;
        } else if (type === 'imported') {
          const pctFull = data.maxStockpile > 0 ? (data.stockpile / data.maxStockpile) * 100 : 0;

          row.innerHTML = `
            <div class="rp-row-header">
              <span class="rp-material">${data.name}</span>
              <span class="rp-source">${data.source} weekly</span>
            </div>
            <div class="rp-bar-container">
              <div class="rp-bar-segment rp-bar-imported" style="width: ${pctFull}%"></div>
            </div>
            <div class="rp-stats">
              <span class="rp-stat"><span class="rp-stat-dot rp-dot-imported"></span>${Math.round(data.stockpile).toLocaleString()} / ${data.maxStockpile} stockpile</span>
              <span class="rp-stat"><span class="rp-stat-dot rp-dot-built"></span>${Math.round(data.built).toLocaleString()} built</span>
            </div>
          `;
        }

        list.appendChild(row);
      }
    }

    // If no resources, show message
    if (list.children.length === 0) {
      list.innerHTML = '<div class="rp-empty">No resources tracked yet</div>';
    }
  }

  function showPanel() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    renderPanel();
    panel.classList.add('visible');
  }

  function hidePanel() {
    hideTimeout = setTimeout(() => {
      panel.classList.remove('visible');
    }, 200);
  }

  // Landing page resources stat hover
  if (landingResourcesStat) {
    landingResourcesStat.addEventListener('mouseenter', showPanel);
    landingResourcesStat.addEventListener('mouseleave', hidePanel);
  }

  // Birdseye resources stat hover
  if (birdseyeResourcesStat) {
    birdseyeResourcesStat.addEventListener('mouseenter', showPanel);
    birdseyeResourcesStat.addEventListener('mouseleave', hidePanel);
  }

  // Keep panel open when hovering over it
  panel.addEventListener('mouseenter', () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  });
  panel.addEventListener('mouseleave', hidePanel);

  // Close panel when clicking outside
  document.addEventListener('click', (e) => {
    if (panel.classList.contains('visible') && !panel.contains(e.target) &&
        !e.target.closest('.has-panel')) {
      panel.classList.remove('visible');
    }
  });
}

initResourcesPanel();

// ════════════════════════════════════════════════════════════════════
// TILE SELECTION PANEL
// ════════════════════════════════════════════════════════════════════

function initTileSelectionPanel() {
  // Clear button
  $('tsp-clear')?.addEventListener('click', () => {
    clearTileSelection();
    restoreZoom();
  });

  // Build button - opens wizard with selected tiles
  $('tsp-build-btn')?.addEventListener('click', () => {
    if (BUILD.selectedTiles.length === 0) return;
    openBuildWizard();
  });

  // Design screen back button
  $('ds-back')?.addEventListener('click', () => {
    closeDesignScreen();
    restoreZoom();
  });

  // Design screen hint chips
  document.querySelectorAll('.ds-hint-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const hint = chip.dataset.hint;
      const input = $('ds-prompt-input');
      if (input && hint) {
        input.value = hint.toUpperCase();
        input.focus();
      }
    });
  });

  // Design screen generate button
  $('ds-generate-btn')?.addEventListener('click', () => {
    const prompt = $('ds-prompt-input')?.value?.trim();
    if (!prompt) {
      $('ds-prompt-input')?.focus();
      return;
    }
    // Close design screen and open AI modal with the prompt
    closeDesignScreen();
    BUILD.selectedTile = BUILD.selectedTiles[0];
    openAiModal();
    // Set the prompt in the AI modal
    const aiInput = $('ai-prompt-input');
    if (aiInput) aiInput.value = prompt;
  });

  // ESC key clears selection
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && BUILD.selectedTiles.length > 0) {
      // Only clear if no modal is open
      const modalsOpen = document.querySelector('.modal.active, .ai-modal.open, .design-screen.active');
      if (!modalsOpen) {
        clearTileSelection();
        restoreZoom();
      }
    }
  });
}

initTileSelectionPanel();

// ════════════════════════════════════════════════════════════════════
// ATMOSPHERE + VISUAL DAY CYCLE
// ════════════════════════════════════════════════════════════════════

let lastAtmospherePhase = null;
let lastSteelWeek = 0;

function updateAtmosphere() {
  const visualTime = getVisualTime();

  // Update day counter display if it exists
  const dayEl = $('birdseye-day');
  if (dayEl) {
    // Wrap hour to 0-23 range (late night can exceed 24)
    let h = Math.floor(visualTime.hour) % 24;
    if (h < 0) h += 24;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
    dayEl.textContent = `${visualTime.day} · ${h12}${period}`;
  }

  // Log phase changes (atmosphere colors only apply in walk/streetview)
  if (visualTime.phase !== lastAtmospherePhase) {
    console.log(`☀ Time: ${visualTime.phase} (Day ${visualTime.day}, Week ${visualTime.week})`);
    lastAtmospherePhase = visualTime.phase;
  }

  // Weekly steel import
  if (visualTime.week > lastSteelWeek) {
    const steelToAdd = STEEL_WEEKLY_IMPORT;
    const currentSteel = state.ledger.steel || 0;
    state.ledger.steel = Math.min(currentSteel + steelToAdd, STEEL_MAX_STOCKPILE);
    lastSteelWeek = visualTime.week;
    console.log(`🚢 Steel shipment arrived! +${steelToAdd} units (total: ${state.ledger.steel})`);
  }
}

// Initialize visual cycle and start atmosphere loop
initVisualCycle();
updateAtmosphere(); // Initial update
setInterval(updateAtmosphere, 1000); // Update every second

console.log('── Offcut World ready ──');

// ═══════════════════════════════════════════════════════════════════════
// META BANNER — Track website resource usage (playful meta-commentary)
// ═══════════════════════════════════════════════════════════════════════
const metaBanner = {
  clicks: 0,
  water: 0.001,  // Base water for page load (gallons) - ~4ml
  carbon: 0.0001, // Base carbon for page load (kg CO2)
  tokens: 500000, // Base tokens to build this website

  // Update display - updates ALL instances (for scrolling banner)
  update() {
    document.querySelectorAll('.meta-water').forEach(el => {
      el.textContent = this.water.toFixed(4);
    });
    document.querySelectorAll('.meta-clicks').forEach(el => {
      el.textContent = this.clicks;
    });
    document.querySelectorAll('.meta-carbon').forEach(el => {
      el.textContent = this.carbon.toFixed(5);
    });
    document.querySelectorAll('.meta-tokens').forEach(el => {
      el.textContent = this.tokens.toLocaleString();
    });
  },

  // Add tokens from AI generation (~4ml water per 1000 tokens, ~0.0004 kg CO2)
  addTokens(count) {
    this.tokens += count;
    this.water += count * 0.000004; // ~4ml per 1000 tokens
    this.carbon += count * 0.0000004; // ~0.4g CO2 per 1000 tokens
    this.update();
  },

  // Record an interaction (tiny server ping)
  interact(type = 'click') {
    this.clicks++;
    // Each interaction uses a tiny bit of compute
    this.water += 0.000001 + Math.random() * 0.000002; // ~0.004-0.01ml
    this.carbon += 0.0000001 + Math.random() * 0.0000002;
    this.update();
  },

  // Heavier operations (3D rendering, etc)
  heavyOperation() {
    this.water += 0.00001 + Math.random() * 0.00002;
    this.carbon += 0.000001 + Math.random() * 0.000002;
    this.update();
  }
};

// Track all clicks on the page
document.addEventListener('click', () => metaBanner.interact('click'));
document.addEventListener('keydown', () => metaBanner.interact('key'));

// Track scroll/pan as lighter interactions
let scrollThrottle = 0;
document.addEventListener('wheel', () => {
  if (Date.now() - scrollThrottle > 500) {
    scrollThrottle = Date.now();
    metaBanner.water += 0.00005;
    metaBanner.carbon += 0.000005;
    metaBanner.update();
  }
});

// Initial update
metaBanner.update();

// Make globally accessible for AI generation calls
window.metaBanner = metaBanner;
