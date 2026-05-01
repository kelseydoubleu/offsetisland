// ════════════════════════════════════════════════════════════════════
// BUILD WIZARD — Clean Step-by-Step Build Flow
// ════════════════════════════════════════════════════════════════════
// 1. DESIGN - AI generate building
// 2. MATERIALS - Source each material from PLAN view
// 3. EXCAVATION - Select dump site for soil
// 4. LABOR - Set construction hours
// 5. CONFIRM - Review and submit
// ════════════════════════════════════════════════════════════════════

import { gridToScreen, TILE_W, TILE_H, PLAN_TILE } from '../utils/projection.js';
import { tileRemainingYield, tileDistance } from '../state/index.js';
import { getDumpSiteRemaining, getAllDumpSites } from '../state/extraction.js';
import * as FormGenerator from './formGenerator.js';
import { generateFromPrompt as aiGenerateFromPrompt, hasApiKey } from './ai.js';

// ─── WIZARD STATE ──────────────────────────────────────────────────
const WIZARD = {
  active: false,
  step: 1,  // 1=design, 2=materials, 3=excavation, 4=labor, 5=confirm

  // Design
  generatedBuilding: null,
  buildingTile: null,

  // Materials to source
  materials: [],       // Array of { material, rawMaterial, needed, sourced, sourceBiome }
  currentMaterialIndex: 0,
  draws: [],           // Array of { tile, material, amount, distance }

  // Excavation
  excavationNeeded: 0,
  excavationDumped: 0,
  dumpSite: null,
  dumpDistance: 0,

  // Labor
  laborHours: 0,
  laborMin: 0,
  laborMax: 0,

  // State reference
  globalState: null,

  // Callbacks
  onComplete: null,
  onCancel: null
};

// Material config
const MATERIAL_CONFIG = {
  timber: { name: 'TIMBER', rawMat: 'timber', biome: 'forest', unit: 'bd ft', color: '#4A8A5A' },
  stone: { name: 'STONE', rawMat: 'stone', biome: 'mountain', unit: 'cu ft', color: '#6A7A8A' },
  brick: { name: 'BRICK', rawMat: 'clay', biome: 'lowlands', unit: 'units', color: '#B8685A' },
  concrete: { name: 'CONCRETE', rawMat: 'sand', biome: 'beach', unit: 'cu ft', color: '#9AAAB8' },
  glass: { name: 'GLASS', rawMat: 'sand', biome: 'beach', unit: 'sq ft', color: '#88C8E0' },
  clay: { name: 'CLAY', rawMat: 'clay', biome: 'lowlands', unit: 'cu ft', color: '#C8A060' },
  sand: { name: 'SAND', rawMat: 'sand', biome: 'beach', unit: 'cu ft', color: '#D0C490' },
  thatch: { name: 'THATCH', rawMat: 'thatch', biome: 'lowlands', unit: 'bundles', color: '#8A9A5A' },
  adobe: { name: 'ADOBE', rawMat: 'soil', biome: 'dump', unit: 'cu ft', color: '#8B7355' }
};

// ─── HELPERS ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function formatDistance(feet) {
  if (feet < 100) return `${Math.round(feet)} ft`;
  return `${(feet / 5280).toFixed(2)} mi`;
}

// ─── WIZARD LIFECYCLE ──────────────────────────────────────────────

export function startWizard(state, tile, onComplete, onCancel) {
  WIZARD.active = true;
  WIZARD.step = 1;
  WIZARD.globalState = state;
  WIZARD.buildingTile = tile;
  WIZARD.onComplete = onComplete;
  WIZARD.onCancel = onCancel;

  // Reset state
  WIZARD.generatedBuilding = null;
  WIZARD.materials = [];
  WIZARD.currentMaterialIndex = 0;
  WIZARD.draws = [];
  WIZARD.excavationNeeded = 0;
  WIZARD.excavationDumped = 0;
  WIZARD.dumpSite = null;
  WIZARD.dumpDistance = 0;
  WIZARD.laborHours = 0;

  // Reset preview state for new wizard session
  previewInitialized = false;

  showWizard();
  renderStep();
}

export function cancelWizard() {
  WIZARD.active = false;
  hideWizard();
  clearMapHighlights();
  restoreMapView();
  if (WIZARD.onCancel) WIZARD.onCancel();
}

function completeWizard() {
  WIZARD.active = false;

  // IMPORTANT: Capture ISO image BEFORE hiding wizard or restoring map view
  // This ensures the 3D preview is still available for rendering
  const buildingsWithGroups = FormGenerator.getPreviewBuildingsWithGroups();
  console.log('[WIZARD] Capturing ISO from', buildingsWithGroups.length, 'buildings with groups');

  let isoImage = FormGenerator.renderMultipleBuildingsToIsoImage(buildingsWithGroups, 300, 400);
  if (!isoImage) {
    console.log('[WIZARD] renderMultipleBuildingsToIsoImage failed, trying fallback');
    isoImage = FormGenerator.renderPreviewToIsoImage(300, 400);
  }
  console.log('[WIZARD] ISO capture result:', isoImage ? 'success' : 'failed');

  // Now safe to hide wizard and restore view
  hideWizard();
  clearMapHighlights();
  restoreMapView();

  // Get ALL committed buildings from FormGenerator
  const committedBuildings = FormGenerator.getCommittedBuildings();
  const previewBuildings = FormGenerator.getPreviewBuildingsForCommit();

  // Use buildingsWithGroups to include THREE.js groups for walk view
  // This was captured BEFORE view was restored, so groups are valid
  let allBuildings = buildingsWithGroups.map((bwg, i) => ({
    group: bwg.group,
    offset: bwg.offset,
    rotation: bwg.rotation,
    stats: committedBuildings[i]?.stats || WIZARD.generatedBuilding?.stats,
    name: committedBuildings[i]?.name || WIZARD.generatedBuilding?.name || `Building ${i + 1}`,
    genes: committedBuildings[i]?.genes || WIZARD.generatedBuilding?.genes,
    formData: committedBuildings[i]?.formData || WIZARD.generatedBuilding?.formData
  }));

  // If no buildings with groups but we have a generated building, use that
  if (allBuildings.length === 0 && WIZARD.generatedBuilding) {
    allBuildings.push({
      stats: WIZARD.generatedBuilding.stats,
      name: WIZARD.generatedBuilding.name,
      genes: WIZARD.generatedBuilding.genes,
      formData: WIZARD.generatedBuilding.formData
    });
  }

  // Compile final build data with ALL buildings
  const buildData = {
    building: WIZARD.generatedBuilding,  // Keep for backwards compat
    buildings: allBuildings,              // ALL buildings on this tile (with groups)
    tile: WIZARD.buildingTile,
    draws: WIZARD.draws,
    dumpSite: WIZARD.dumpSite,
    dumpDistance: WIZARD.dumpDistance,
    excavationNeeded: WIZARD.excavationNeeded,
    laborHours: WIZARD.laborHours,
    totalTransportDistance: calculateTotalTransportDistance(),
    isoImage: isoImage  // Pass the pre-captured ISO image
  };

  console.log('[WIZARD] Complete with', allBuildings.length, 'buildings');

  if (WIZARD.onComplete) WIZARD.onComplete(buildData);
}

// ─── WIZARD UI ─────────────────────────────────────────────────────

function showWizard() {
  const wizard = $('build-wizard');
  if (wizard) {
    wizard.style.display = 'flex';
    wizard.classList.add('visible');
  }
  document.body.classList.add('wizard-active');
}

function hideWizard() {
  const wizard = $('build-wizard');
  if (wizard) {
    wizard.classList.remove('visible');
    setTimeout(() => {
      wizard.style.display = 'none';
    }, 300);
  }
  document.body.classList.remove('wizard-active');
}

function renderStep() {
  const content = $('wizard-content');
  if (!content) return;

  // Update step indicators
  updateStepIndicators();

  // Manage sourcing mode (compact panel for map interaction)
  const wizardEl = $('build-wizard');
  if (wizardEl) {
    // Steps 2 and 3 need map interaction, so use compact mode
    if (WIZARD.step === 2 || WIZARD.step === 3) {
      wizardEl.classList.add('sourcing-mode');
    } else {
      wizardEl.classList.remove('sourcing-mode');
    }
  }

  switch (WIZARD.step) {
    case 1: renderDesignStep(content); break;
    case 2: renderMaterialsStep(content); break;
    case 3: renderExcavationStep(content); break;
    case 4: renderLaborStep(content); break;
    case 5: renderConfirmStep(content); break;
  }
}

function updateStepIndicators() {
  const indicators = document.querySelectorAll('.wizard-step-indicator');
  indicators.forEach((ind, i) => {
    const stepNum = i + 1;
    ind.classList.remove('active', 'completed');
    if (stepNum < WIZARD.step) ind.classList.add('completed');
    else if (stepNum === WIZARD.step) ind.classList.add('active');
  });
}

// ─── STEP 1: DESIGN ────────────────────────────────────────────────

let previewInitialized = false;

function renderDesignStep(container) {
  const buildingCount = FormGenerator.getPreviewBuildingCount();

  container.innerHTML = `
    <div class="wizard-design-layout">
      <!-- 3D Preview Panel -->
      <div class="wizard-preview-panel">
        <canvas id="wizard-canvas"></canvas>
        <div class="wizard-preview-controls">
          <button class="wizard-preview-btn active" id="wizard-rotate-toggle" title="Auto-rotate">⟳</button>
          <button class="wizard-preview-btn" id="wizard-view-reset" title="Reset view">⌂</button>
        </div>
        <div class="wizard-preview-stats">
          <div class="wizard-stat"><span class="wizard-stat-val" id="wizard-stat-area">—</span><span class="wizard-stat-label">SQ FT</span></div>
          <div class="wizard-stat"><span class="wizard-stat-val" id="wizard-stat-floors">—</span><span class="wizard-stat-label">FLOORS</span></div>
          <div class="wizard-stat"><span class="wizard-stat-val" id="wizard-stat-buildings">${buildingCount}</span><span class="wizard-stat-label">BUILDINGS</span></div>
        </div>
        <!-- Position/Rotation Controls -->
        <div class="wizard-position-controls" id="wizard-position-controls" style="display: ${WIZARD.generatedBuilding ? 'block' : 'none'};">
          <div class="wizard-pos-grid">
            <div></div>
            <button class="wizard-pos-btn" id="wizard-move-up" title="Move forward">↑</button>
            <div></div>
            <button class="wizard-pos-btn" id="wizard-move-left" title="Move left">←</button>
            <button class="wizard-pos-btn wizard-pos-center" id="wizard-pos-reset" title="Reset">⊙</button>
            <button class="wizard-pos-btn" id="wizard-move-right" title="Move right">→</button>
            <div></div>
            <button class="wizard-pos-btn" id="wizard-move-down" title="Move backward">↓</button>
            <div></div>
          </div>
          <div class="wizard-rot-row">
            <button class="wizard-rot-btn" id="wizard-rotate-ccw" title="Rotate left">↺</button>
            <button class="wizard-rot-btn" id="wizard-rotate-cw" title="Rotate right">↻</button>
          </div>
        </div>
      </div>

      <!-- Controls Panel -->
      <div class="wizard-controls-panel">
        <!-- Prompt Section -->
        <div class="wizard-prompt-section">
          <label class="wizard-label">DESCRIBE YOUR BUILDING</label>
          <textarea
            id="wizard-prompt"
            class="wizard-textarea"
            placeholder="A timber cabin with large windows overlooking the forest..."
            rows="3"
          >${WIZARD.generatedBuilding?.prompt || ''}</textarea>
          <div class="wizard-hints" id="wizard-hints"></div>
          <button class="wizard-btn primary full-width" id="wizard-generate">
            ${WIZARD.generatedBuilding ? 'REGENERATE' : 'GENERATE DESIGN'}
          </button>
        </div>

        <!-- Result Section (after generation) -->
        <div class="wizard-result-section" id="wizard-result-section" style="display: ${WIZARD.generatedBuilding ? 'block' : 'none'};">
          <div class="wizard-result-header">
            <span class="wizard-result-badge" id="wizard-result-badge">${WIZARD.generatedBuilding?.archetype?.toUpperCase() || 'GENERATED'}</span>
            <h3 class="wizard-result-name" id="wizard-result-name">${WIZARD.generatedBuilding?.name || ''}</h3>
          </div>
          <p class="wizard-result-desc" id="wizard-result-desc">${WIZARD.generatedBuilding?.description || ''}</p>

          <!-- Simple action: add more buildings to this tile -->
          <button class="wizard-btn secondary full-width" id="wizard-add-building">+ ADD ANOTHER BUILDING TO TILE</button>
        </div>

        <!-- Buildings List - only show when there ARE committed buildings -->
        <div class="wizard-buildings-list" id="wizard-buildings-list" style="display: ${buildingCount > 0 ? 'block' : 'none'};">
          <label class="wizard-label">BUILDINGS ON THIS TILE (${buildingCount + (WIZARD.generatedBuilding ? 1 : 0)})</label>
          <div class="wizard-buildings-items" id="wizard-buildings-items">
            ${renderBuildingsList()}
            ${WIZARD.generatedBuilding ? `
              <div class="wizard-building-item current">
                <span class="wizard-building-name">${WIZARD.generatedBuilding.name} <span class="wizard-current-tag">current</span></span>
                <span class="wizard-building-stats">${WIZARD.generatedBuilding.stats?.floors || '?'}F · ${(WIZARD.generatedBuilding.stats?.grossArea || 0).toLocaleString()} sf</span>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    </div>

    <div class="wizard-actions">
      <button class="wizard-btn secondary" id="wizard-cancel">CANCEL</button>
      <button class="wizard-btn primary" id="wizard-next" ${buildingCount > 0 || WIZARD.generatedBuilding ? '' : 'disabled'}>
        ${WIZARD.generatedBuilding ? 'BUILD THIS →' : 'NEXT →'}
      </button>
    </div>
  `;

  // Initialize 3D preview
  initDesignPreview();

  // Wire up events
  wireDesignEvents();

  // Populate hint chips
  populateHintChips();
}

function initDesignPreview() {
  const canvas = $('wizard-canvas');
  if (!canvas) return;

  // Initialize FormGenerator with canvas
  if (!previewInitialized) {
    FormGenerator.initFormPreview('wizard-canvas');
    previewInitialized = true;
  }

  // Reset and set tiles
  FormGenerator.reset();
  FormGenerator.setTiles([WIZARD.buildingTile]);
  FormGenerator.addScaleFigures();

  // If we already have a generated building, regenerate it
  if (WIZARD.generatedBuilding?.genes) {
    FormGenerator.setArchetypeResult(WIZARD.generatedBuilding.genes);
    FormGenerator.generateFromArchetype(WIZARD.generatedBuilding.genes, FormGenerator.getPolygon());
    updatePreviewStats();
  }
}

function wireDesignEvents() {
  // Generate button
  $('wizard-generate')?.addEventListener('click', generateDesign);

  // Cancel button
  $('wizard-cancel')?.addEventListener('click', cancelWizard);

  // Next button
  $('wizard-next')?.addEventListener('click', () => {
    // Commit current building if not already committed
    if (WIZARD.generatedBuilding && !WIZARD.generatedBuilding.committed) {
      commitCurrentBuilding();
    }
    prepareMaterialsStep();
    WIZARD.step = 2;
    renderStep();
  });

  // Preview controls
  $('wizard-rotate-toggle')?.addEventListener('click', () => {
    const isRotating = FormGenerator.toggleRotation();
    $('wizard-rotate-toggle')?.classList.toggle('active', isRotating);
  });

  $('wizard-view-reset')?.addEventListener('click', () => {
    FormGenerator.setOrthoView();
  });

  // Position controls
  const moveStep = 5;
  $('wizard-move-up')?.addEventListener('click', () => FormGenerator.moveBuildingBy(0, -moveStep));
  $('wizard-move-down')?.addEventListener('click', () => FormGenerator.moveBuildingBy(0, moveStep));
  $('wizard-move-left')?.addEventListener('click', () => FormGenerator.moveBuildingBy(-moveStep, 0));
  $('wizard-move-right')?.addEventListener('click', () => FormGenerator.moveBuildingBy(moveStep, 0));
  $('wizard-pos-reset')?.addEventListener('click', () => FormGenerator.resetBuildingTransform());

  // Rotation controls
  const rotStep = Math.PI / 12;
  $('wizard-rotate-ccw')?.addEventListener('click', () => FormGenerator.rotateBuildingBy(-rotStep));
  $('wizard-rotate-cw')?.addEventListener('click', () => FormGenerator.rotateBuildingBy(rotStep));

  // Building actions
  $('wizard-add-building')?.addEventListener('click', addAnotherBuilding);
}

function updatePreviewStats() {
  const stats = FormGenerator.getCurrentBuildingStats();
  if (stats) {
    const areaEl = $('wizard-stat-area');
    const floorsEl = $('wizard-stat-floors');
    if (areaEl) areaEl.textContent = stats.grossArea?.toLocaleString() || '—';
    if (floorsEl) floorsEl.textContent = stats.floors || '—';
  }

  const buildingCount = FormGenerator.getPreviewBuildingCount();
  const buildingsEl = $('wizard-stat-buildings');
  if (buildingsEl) buildingsEl.textContent = buildingCount;

  // Show position controls if we have a building
  const posControls = $('wizard-position-controls');
  if (posControls) posControls.style.display = WIZARD.generatedBuilding ? 'block' : 'none';
}

function renderBuildingsList() {
  const buildings = FormGenerator.getCommittedBuildings();
  if (buildings.length === 0) return '';

  return buildings.map((b, i) => `
    <div class="wizard-building-item">
      <span class="wizard-building-name">${b.stats?.name || `Building ${i + 1}`}</span>
      <span class="wizard-building-stats">${b.stats?.floors || '?'}F · ${(b.stats?.grossArea || 0).toLocaleString()} sf</span>
    </div>
  `).join('');
}

function updateBuildingsList() {
  const buildingCount = FormGenerator.getPreviewBuildingCount();
  const listEl = $('wizard-buildings-list');
  const itemsEl = $('wizard-buildings-items');
  const countLabel = listEl?.querySelector('.wizard-label');

  // Always show when there's at least one building (committed or current)
  const hasBuildings = buildingCount > 0 || WIZARD.generatedBuilding;
  if (listEl) listEl.style.display = hasBuildings ? 'block' : 'none';

  // Update count label
  const totalCount = buildingCount + (WIZARD.generatedBuilding && !WIZARD.generatedBuilding.committed ? 1 : 0);
  if (countLabel) countLabel.textContent = `BUILDINGS ON THIS TILE (${totalCount})`;

  // Update items - committed + current
  if (itemsEl) {
    let html = renderBuildingsList();
    if (WIZARD.generatedBuilding && !WIZARD.generatedBuilding.committed) {
      html += `
        <div class="wizard-building-item current">
          <span class="wizard-building-name">${WIZARD.generatedBuilding.name} <span class="wizard-current-tag">current</span></span>
          <span class="wizard-building-stats">${WIZARD.generatedBuilding.stats?.floors || '?'}F · ${(WIZARD.generatedBuilding.stats?.grossArea || 0).toLocaleString()} sf</span>
        </div>
      `;
    }
    itemsEl.innerHTML = html || '<p class="wizard-no-buildings">No buildings yet</p>';
  }
}

function commitCurrentBuilding() {
  if (!WIZARD.generatedBuilding) return;

  FormGenerator.commitCurrentBuilding();
  WIZARD.generatedBuilding.committed = true;

  // Update UI
  updateBuildingsList();
  updatePreviewStats();

  // Enable next button
  const nextBtn = $('wizard-next');
  if (nextBtn) nextBtn.disabled = false;
}

function addAnotherBuilding() {
  // Commit current building first
  if (WIZARD.generatedBuilding && !WIZARD.generatedBuilding.committed) {
    commitCurrentBuilding();
  }

  // Reset for new building
  WIZARD.generatedBuilding = null;

  // Clear result section
  const resultSection = $('wizard-result-section');
  if (resultSection) resultSection.style.display = 'none';

  // Clear prompt
  const promptEl = $('wizard-prompt');
  if (promptEl) promptEl.value = '';

  // Update generate button
  const genBtn = $('wizard-generate');
  if (genBtn) genBtn.textContent = 'GENERATE DESIGN';

  // Update next button back to default
  const nextBtn = $('wizard-next');
  if (nextBtn) nextBtn.textContent = 'NEXT →';

  // Hide position controls
  const posControls = $('wizard-position-controls');
  if (posControls) posControls.style.display = 'none';

  // Refresh scale figures
  FormGenerator.refreshScaleFigures();
}

async function generateDesign() {
  const prompt = $('wizard-prompt')?.value?.trim();
  if (!prompt) return;

  const btn = $('wizard-generate');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'GENERATING...';
  }

  try {
    // Check if API key is set
    if (!hasApiKey()) {
      throw new Error('Please set your Anthropic API key first');
    }

    // Set up tiles and polygon for FormGenerator
    FormGenerator.setTiles([WIZARD.buildingTile]);
    const polygon = FormGenerator.getPolygon();

    // Generate archetype from prompt via AI
    const archetypeResult = await aiGenerateFromPrompt(prompt, polygon, [WIZARD.buildingTile]);

    // Store archetype result and generate building
    FormGenerator.setArchetypeResult(archetypeResult);
    const stats = FormGenerator.generateFromArchetype(archetypeResult, polygon);

    if (stats) {
      WIZARD.generatedBuilding = {
        name: archetypeResult.name || 'Generated Building',
        description: archetypeResult.description || '',
        prompt,
        archetype: archetypeResult.archetype,
        stats: {
          floors: stats.floors,
          grossArea: stats.grossArea,
          height: stats.height,
          typology: stats.typology,
          footprint: stats.footprint
        },
        materials: stats.materials || {},
        formData: stats,
        genes: archetypeResult
      };

      // Show result section
      const resultSection = $('wizard-result-section');
      if (resultSection) resultSection.style.display = 'block';

      // Update result content
      const badgeEl = $('wizard-result-badge');
      const nameEl = $('wizard-result-name');
      const descEl = $('wizard-result-desc');

      if (badgeEl) badgeEl.textContent = archetypeResult.archetype?.toUpperCase() || 'GENERATED';
      if (nameEl) nameEl.textContent = archetypeResult.name || 'Generated Building';
      if (descEl) descEl.textContent = archetypeResult.description || '';

      // Show position controls
      const posControls = $('wizard-position-controls');
      if (posControls) posControls.style.display = 'block';

      // Update buildings list to show current building
      updateBuildingsList();

      // Update preview stats
      updatePreviewStats();

      // Enable next button and update label
      const nextBtn = $('wizard-next');
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.textContent = 'BUILD THIS →';
      }
    }
  } catch (err) {
    console.error('Generation failed:', err);
    // Show error to user
    const resultSection = $('wizard-result-section');
    if (resultSection) {
      resultSection.style.display = 'block';
      resultSection.innerHTML = `<p class="wizard-error" style="color: #C87A5A;">Error: ${err.message}</p>`;
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = WIZARD.generatedBuilding ? 'REGENERATE' : 'GENERATE DESIGN';
  }
}

function populateHintChips() {
  const container = $('wizard-hints');
  if (!container) return;

  const hints = [
    { label: 'timber cabin', prompt: 'cozy timber cabin with steep pitched roof and wraparound porch' },
    { label: 'glass pavilion', prompt: 'minimal glass pavilion floating above the landscape' },
    { label: 'stone tower', prompt: 'medieval stone watchtower with thick walls and narrow windows' },
    { label: 'brick warehouse', prompt: 'industrial brick warehouse with sawtooth roof and large doors' },
    { label: 'adobe home', prompt: 'organic adobe dwelling with rounded walls and earth tones' },
    { label: 'concrete bunker', prompt: 'brutalist concrete bunker half-buried in the earth' }
  ].sort(() => Math.random() - 0.5).slice(0, 4);

  container.innerHTML = hints.map(h =>
    `<button class="wizard-hint-chip" data-prompt="${h.prompt}">${h.label}</button>`
  ).join('');

  container.querySelectorAll('.wizard-hint-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const textarea = $('wizard-prompt');
      if (textarea) {
        textarea.value = chip.dataset.prompt;
        textarea.focus();
      }
    });
  });
}

// ─── STEP 2: MATERIALS ─────────────────────────────────────────────

function prepareMaterialsStep() {
  // Debug: check FormGenerator state
  console.log('[WIZARD] prepareMaterialsStep: checking FormGenerator...');
  console.log('[WIZARD] - previewBuildings count:', FormGenerator.getPreviewBuildingCount());
  console.log('[WIZARD] - committedBuildings:', FormGenerator.getCommittedBuildings());
  console.log('[WIZARD] - currentBuildingStats:', FormGenerator.getCurrentBuildingStats());

  // Get material requirements from generated building
  const matReq = FormGenerator.calculateMaterialRequirements();
  console.log('[WIZARD] prepareMaterialsStep: matReq =', matReq);

  if (!matReq?.totals) {
    console.warn('[WIZARD] No material requirements found');
    return;
  }

  WIZARD.materials = [];

  for (const [mat, amount] of Object.entries(matReq.totals)) {
    if (amount <= 0) continue;
    if (mat === 'steel') continue; // Imported, skip

    const config = MATERIAL_CONFIG[mat];
    if (!config) {
      console.log('[WIZARD] No config for material:', mat);
      continue;
    }

    WIZARD.materials.push({
      material: mat,
      rawMaterial: config.rawMat,
      name: config.name,
      biome: config.biome,
      unit: config.unit,
      color: config.color,
      needed: amount,
      sourced: 0
    });
  }

  console.log('[WIZARD] Materials to source:', WIZARD.materials.length, WIZARD.materials.map(m => m.name));
  WIZARD.currentMaterialIndex = 0;
  WIZARD.excavationNeeded = matReq.excavation || Math.round(matReq.totals.concrete * 0.1) || 100;
}

function renderMaterialsStep(container) {
  console.log('[WIZARD] renderMaterialsStep: materials count =', WIZARD.materials.length, 'currentIndex =', WIZARD.currentMaterialIndex);

  const mat = WIZARD.materials[WIZARD.currentMaterialIndex];
  if (!mat) {
    // No more materials, move to excavation
    console.log('[WIZARD] No materials to source, skipping to excavation');
    WIZARD.step = 3;
    renderStep();
    return;
  }

  console.log('[WIZARD] Sourcing material:', mat.name, 'from', mat.biome);

  const progress = WIZARD.currentMaterialIndex + 1;
  const total = WIZARD.materials.length;

  // Make wizard a compact floating panel during sourcing
  const wizardEl = $('build-wizard');
  if (wizardEl) wizardEl.classList.add('sourcing-mode');

  container.innerHTML = `
    <div class="wizard-sourcing-panel">
      <h2 class="wizard-step-title">SOURCE ${mat.name}</h2>
      <p class="wizard-step-desc">
        Material ${progress}/${total}. Click <strong>${mat.biome}</strong> tiles on map.
      </p>

      <div class="wizard-material-progress">
        <div class="wizard-progress-bar">
          <div class="wizard-progress-fill" style="width: ${(mat.sourced / mat.needed) * 100}%; background: ${mat.color}"></div>
        </div>
        <span class="wizard-progress-text">${mat.sourced.toLocaleString()} / ${mat.needed.toLocaleString()} ${mat.unit}</span>
      </div>

      <div class="wizard-draws-compact" id="wizard-draws">
        ${renderDrawsList(mat.material)}
      </div>

      <div class="wizard-actions-compact">
        <button class="wizard-btn secondary small" id="wizard-back">← BACK</button>
        <button class="wizard-btn secondary small" id="wizard-skip">AUTO</button>
        <button class="wizard-btn primary small" id="wizard-next" ${mat.sourced >= mat.needed ? '' : 'disabled'}>
          ${WIZARD.currentMaterialIndex < WIZARD.materials.length - 1 ? 'NEXT →' : 'DONE →'}
        </button>
      </div>
    </div>
  `;

  // Switch to plan view
  switchToPlanView();

  // Small delay to ensure view has switched before highlighting
  setTimeout(() => {
    highlightMaterialTiles(mat);
  }, 100);

  // Wire events
  $('wizard-back')?.addEventListener('click', () => {
    if (WIZARD.currentMaterialIndex > 0) {
      WIZARD.currentMaterialIndex--;
      renderStep();
    } else {
      WIZARD.step = 1;
      clearMapHighlights();
      restoreMapView();
      renderStep();
    }
  });

  $('wizard-skip')?.addEventListener('click', () => {
    autoSourceMaterial(mat);
    nextMaterial();
  });

  $('wizard-next')?.addEventListener('click', nextMaterial);
}

function renderDrawsList(material) {
  const draws = WIZARD.draws.filter(d => d.material === material);
  if (draws.length === 0) return '<p class="wizard-no-draws">No tiles selected yet</p>';

  return draws.map(d => `
    <div class="wizard-draw-item">
      <span class="wizard-draw-tile">(${d.tile.gx}, ${d.tile.gy})</span>
      <span class="wizard-draw-amount">${d.amount.toLocaleString()}</span>
      <span class="wizard-draw-distance">${formatDistance(d.distance)}</span>
    </div>
  `).join('');
}

function nextMaterial() {
  WIZARD.currentMaterialIndex++;
  if (WIZARD.currentMaterialIndex >= WIZARD.materials.length) {
    WIZARD.step = 3;
  }
  clearMapHighlights();
  renderStep();
}

function autoSourceMaterial(mat) {
  const state = WIZARD.globalState;
  if (!state) return;

  let remaining = mat.needed - mat.sourced;

  if (mat.biome === 'dump') {
    // Source from dump sites
    const dumpSites = getAllDumpSites(state);
    for (const site of dumpSites) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, site.waste);
      if (amount > 0) {
        const distance = tileDistance(
          WIZARD.buildingTile.gx, WIZARD.buildingTile.gy,
          site.tile.gx, site.tile.gy
        );
        WIZARD.draws.push({
          tile: site.tile,
          material: mat.material,
          rawMaterial: mat.rawMaterial,
          amount,
          distance
        });
        mat.sourced += amount;
        remaining -= amount;
      }
    }
  } else {
    // Source from biome tiles
    const tiles = state.island.tiles
      .filter(t => t.biome === mat.biome)
      .map(t => ({
        tile: t,
        remaining: tileRemainingYield(state, t, mat.rawMaterial),
        distance: tileDistance(WIZARD.buildingTile.gx, WIZARD.buildingTile.gy, t.gx, t.gy)
      }))
      .filter(t => t.remaining > 0)
      .sort((a, b) => a.distance - b.distance); // Closest first

    for (const t of tiles) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, t.remaining);
      WIZARD.draws.push({
        tile: t.tile,
        material: mat.material,
        rawMaterial: mat.rawMaterial,
        amount,
        distance: t.distance
      });
      mat.sourced += amount;
      remaining -= amount;
    }
  }
}

function highlightMaterialTiles(mat) {
  const state = WIZARD.globalState;
  if (!state) {
    console.warn('[WIZARD] highlightMaterialTiles: no state');
    return;
  }

  // Get or create highlight group - must be on top for clicks to work
  let markersGroup = document.getElementById('wizard-highlights');
  const worldGroup = document.getElementById('world');

  if (!worldGroup) {
    console.warn('[WIZARD] highlightMaterialTiles: no worldGroup found');
    return;
  }

  // Always recreate the group to ensure it's at the end (on top)
  if (markersGroup) {
    markersGroup.remove();
  }

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = 'wizard-highlights';
  g.setAttribute('pointer-events', 'all');
  g.style.pointerEvents = 'all';
  worldGroup.appendChild(g);
  markersGroup = g;
  console.log('[WIZARD] Created wizard-highlights group at end of worldGroup');
  let tileCount = 0;

  if (mat.biome === 'dump') {
    // Highlight dump sites - find tiles with soil dumped on them
    const dumpSites = getAllDumpSites(state);
    console.log('[WIZARD] highlightMaterialTiles: dump biome,', dumpSites.length, 'dump sites');
    for (const site of dumpSites) {
      const hasBuilding = tileHasBuilding(state, site.tile);
      if (hasBuilding) {
        addTileHighlight(markersGroup, site.tile, '#666', false, 'occupied');
      } else if (site.waste > 0) {
        addTileHighlight(markersGroup, site.tile, mat.color, true, 'available');
      }
      tileCount++;
    }
  } else {
    // Highlight biome tiles - show ALL tiles of this biome
    const tiles = state.island?.tiles || [];
    console.log('[WIZARD] highlightMaterialTiles:', mat.biome, 'biome, checking', tiles.length, 'tiles');
    for (const tile of tiles) {
      if (tile.biome !== mat.biome) continue;

      const hasBuilding = tileHasBuilding(state, tile);
      const remaining = tileRemainingYield(state, tile, mat.rawMaterial);

      if (hasBuilding) {
        // Tile has building - not available
        addTileHighlight(markersGroup, tile, '#666', false, 'occupied');
      } else if (remaining > 0) {
        // Available for sourcing
        addTileHighlight(markersGroup, tile, mat.color, true, 'available');
      } else {
        // Depleted
        addTileHighlight(markersGroup, tile, '#888', false, 'depleted');
      }
      tileCount++;
    }
  }

  console.log('[WIZARD] highlightMaterialTiles: added', tileCount, 'highlights');
}

function addTileHighlight(group, tile, color, clickable, status = 'available') {
  const pos = gridToScreen(tile.gx, tile.gy, 'plan');

  // Use PLAN_TILE size to match tile grid exactly
  const size = PLAN_TILE;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', pos.sx - size);
  rect.setAttribute('y', pos.sy - size);
  rect.setAttribute('width', size * 2);
  rect.setAttribute('height', size * 2);
  rect.setAttribute('class', `wizard-tile-highlight ${status}`);

  if (clickable) {
    // Available tiles - colored, interactive with visible overlay
    // Parse color and create rgba with proper opacity
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const baseFill = `rgba(${r}, ${g}, ${b}, 0.35)`;
    const hoverFill = `rgba(${r}, ${g}, ${b}, 0.55)`;

    rect.setAttribute('fill', baseFill);
    rect.setAttribute('stroke', color);
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('pointer-events', 'all');
    rect.style.cursor = 'pointer';
    rect.style.pointerEvents = 'all';
    rect.dataset.gx = tile.gx;
    rect.dataset.gy = tile.gy;
    rect.dataset.color = color;

    // Hover effects
    rect.addEventListener('mouseenter', () => {
      rect.setAttribute('fill', hoverFill);
      rect.setAttribute('stroke-width', '3');
    });
    rect.addEventListener('mouseleave', () => {
      rect.setAttribute('fill', baseFill);
      rect.setAttribute('stroke-width', '2');
    });
    rect.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      console.log('[WIZARD] Tile clicked:', tile.gx, tile.gy);
      handleTileClick(tile);
    });
  } else {
    // Unavailable tiles - grayed out with dark overlay
    rect.setAttribute('fill', 'rgba(60, 60, 60, 0.6)');
    rect.setAttribute('stroke', '#444');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('stroke-dasharray', '4 2');
    rect.style.cursor = 'not-allowed';
    rect.style.pointerEvents = 'none';
  }

  group.appendChild(rect);
}

function handleTileClick(tile) {
  const mat = WIZARD.materials[WIZARD.currentMaterialIndex];
  if (!mat) return;

  const state = WIZARD.globalState;
  let available = 0;

  if (mat.biome === 'dump') {
    const ext = state.island.tileExtraction?.[`${tile.gx}:${tile.gy}`];
    available = ext?.soilDumped || 0;
  } else {
    available = tileRemainingYield(state, tile, mat.rawMaterial);
  }

  if (available <= 0) return;

  const remaining = mat.needed - mat.sourced;
  const amount = Math.min(remaining, available);
  const distance = tileDistance(WIZARD.buildingTile.gx, WIZARD.buildingTile.gy, tile.gx, tile.gy);

  WIZARD.draws.push({
    tile: { gx: tile.gx, gy: tile.gy, biome: tile.biome },
    material: mat.material,
    rawMaterial: mat.rawMaterial,
    amount,
    distance
  });

  mat.sourced += amount;

  // Re-render
  renderStep();
}

// ─── STEP 3: EXCAVATION ────────────────────────────────────────────

function renderExcavationStep(container) {
  const needed = WIZARD.excavationNeeded;

  // Keep in sourcing mode (compact panel)
  const wizardEl = $('build-wizard');
  if (wizardEl) wizardEl.classList.add('sourcing-mode');

  container.innerHTML = `
    <div class="wizard-sourcing-panel">
      <h2 class="wizard-step-title">EXCAVATION DISPOSAL</h2>
      <p class="wizard-step-desc">
        ${needed.toLocaleString()} cu ft of soil. Click dump site.
      </p>

      ${WIZARD.dumpSite ? `
        <div class="wizard-dump-selected">
          <span class="wizard-dump-coords">(${WIZARD.dumpSite.gx}, ${WIZARD.dumpSite.gy})</span>
          <span class="wizard-dump-distance">${formatDistance(WIZARD.dumpDistance)}</span>
        </div>
      ` : ''}

      <div class="wizard-actions-compact">
        <button class="wizard-btn secondary small" id="wizard-back">← BACK</button>
        <button class="wizard-btn secondary small" id="wizard-skip">AUTO</button>
        <button class="wizard-btn primary small" id="wizard-next" ${WIZARD.dumpSite ? '' : 'disabled'}>
          NEXT →
        </button>
      </div>
    </div>
  `;

  // Switch to plan view and highlight dump sites
  switchToPlanView();
  setTimeout(() => {
    highlightDumpSites();
  }, 100);

  // Wire events
  $('wizard-back')?.addEventListener('click', () => {
    WIZARD.currentMaterialIndex = WIZARD.materials.length - 1;
    WIZARD.step = 2;
    renderStep();
  });

  $('wizard-skip')?.addEventListener('click', () => {
    autoSelectDumpSite();
    WIZARD.step = 4;
    clearMapHighlights();
    restoreMapView();
    renderStep();
  });

  $('wizard-next')?.addEventListener('click', () => {
    WIZARD.step = 4;
    clearMapHighlights();
    restoreMapView();
    renderStep();
  });
}

function highlightDumpSites() {
  const state = WIZARD.globalState;
  if (!state) {
    console.warn('[WIZARD] highlightDumpSites: no state');
    return;
  }

  // Get or create highlight group - must be on top for clicks to work
  let markersGroup = document.getElementById('wizard-highlights');
  const worldGroup = document.getElementById('world');

  if (!worldGroup) {
    console.warn('[WIZARD] highlightDumpSites: no worldGroup found');
    return;
  }

  // Always recreate the group to ensure it's at the end (on top)
  if (markersGroup) {
    markersGroup.remove();
  }

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = 'wizard-highlights';
  g.setAttribute('pointer-events', 'all');
  g.style.pointerEvents = 'all';
  worldGroup.appendChild(g);
  markersGroup = g;
  console.log('[WIZARD] Created wizard-highlights group for dump sites');

  const dumpColor = '#8B7355';
  let tileCount = 0;

  // Show ALL tiles - highlight valid dump sites, gray out occupied tiles
  const tiles = state.island?.tiles || [];
  console.log('[WIZARD] highlightDumpSites: processing', tiles.length, 'tiles');


  for (const tile of tiles) {
    // Skip water tiles
    if (tile.biome === 'water' || tile.biome === 'ocean') continue;

    const hasBuilding = tileHasBuilding(state, tile);
    const pos = gridToScreen(tile.gx, tile.gy, 'plan');
    const size = PLAN_TILE;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', pos.sx - size);
    rect.setAttribute('y', pos.sy - size);
    rect.setAttribute('width', size * 2);
    rect.setAttribute('height', size * 2);
    rect.setAttribute('class', 'wizard-dump-highlight');

    if (hasBuilding) {
      // Occupied - not available for dumping (gray overlay, dashed border)
      rect.setAttribute('fill', 'rgba(60, 60, 60, 0.6)');
      rect.setAttribute('stroke', '#444');
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('stroke-dasharray', '4 2');
      rect.style.cursor = 'not-allowed';
      rect.style.pointerEvents = 'none';
    } else {
      // Available for dumping - use visible semi-transparent overlay
      const baseFill = 'rgba(139, 115, 85, 0.35)';  // dumpColor with 35% opacity
      const hoverFill = 'rgba(139, 115, 85, 0.55)'; // dumpColor with 55% opacity

      // Check if this is already a dump site with waste
      const ext = state.island.tileExtraction?.[`${tile.gx}:${tile.gy}`];
      const existingWaste = ext?.soilDumped || 0;

      rect.setAttribute('fill', existingWaste > 0 ? 'rgba(139, 115, 85, 0.5)' : baseFill);
      rect.setAttribute('stroke', dumpColor);
      rect.setAttribute('stroke-width', '2');
      rect.setAttribute('pointer-events', 'all');
      rect.style.cursor = 'pointer';
      rect.style.pointerEvents = 'all';

      // Hover effects
      rect.addEventListener('mouseenter', () => {
        rect.setAttribute('fill', hoverFill);
        rect.setAttribute('stroke-width', '3');
      });
      rect.addEventListener('mouseleave', () => {
        rect.setAttribute('fill', existingWaste > 0 ? 'rgba(139, 115, 85, 0.5)' : baseFill);
        rect.setAttribute('stroke-width', '2');
      });

      rect.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        console.log('[WIZARD] Dump site clicked:', tile.gx, tile.gy);
        WIZARD.dumpSite = tile;
        WIZARD.dumpDistance = tileDistance(
          WIZARD.buildingTile.gx, WIZARD.buildingTile.gy,
          tile.gx, tile.gy
        );
        renderStep();
      });
    }

    markersGroup.appendChild(rect);
    tileCount++;
  }

  console.log('[WIZARD] highlightDumpSites: added', tileCount, 'highlight rects');
}

function autoSelectDumpSite() {
  const state = WIZARD.globalState;
  if (!state) return;

  const dumpSites = getAllDumpSites(state)
    .filter(s => s.remaining >= WIZARD.excavationNeeded)
    .map(s => ({
      ...s,
      distance: tileDistance(WIZARD.buildingTile.gx, WIZARD.buildingTile.gy, s.tile.gx, s.tile.gy)
    }))
    .sort((a, b) => a.distance - b.distance);

  if (dumpSites.length > 0) {
    WIZARD.dumpSite = dumpSites[0].tile;
    WIZARD.dumpDistance = dumpSites[0].distance;
  }
}

// ─── STEP 4: LABOR ─────────────────────────────────────────────────

function renderLaborStep(container) {
  // Calculate labor range based on building size
  const stats = WIZARD.generatedBuilding?.stats || {};
  const area = stats.grossArea || 1000;
  const floors = stats.floors || 1;

  // Base: 0.5-2 hours per sq ft depending on complexity
  WIZARD.laborMin = Math.round(area * 0.3);
  WIZARD.laborMax = Math.round(area * 1.5);

  if (!WIZARD.laborHours) {
    WIZARD.laborHours = Math.round((WIZARD.laborMin + WIZARD.laborMax) / 2);
  }

  container.innerHTML = `
    <div class="wizard-step-content">
      <h2 class="wizard-step-title">CONSTRUCTION LABOR</h2>
      <p class="wizard-step-desc">
        Set the labor hours for construction. More hours = faster build, but higher cost.
      </p>

      <div class="wizard-labor-control">
        <input
          type="range"
          id="wizard-labor-slider"
          min="${WIZARD.laborMin}"
          max="${WIZARD.laborMax}"
          value="${WIZARD.laborHours}"
          class="wizard-slider"
        >
        <div class="wizard-labor-display">
          <span class="wizard-labor-value" id="wizard-labor-value">${WIZARD.laborHours.toLocaleString()}</span>
          <span class="wizard-labor-unit">person-hours</span>
        </div>
        <div class="wizard-labor-info">
          <span>≈ ${Math.ceil(WIZARD.laborHours / 8)} work days</span>
          <span>≈ ${Math.ceil(WIZARD.laborHours / 160)} person-months</span>
        </div>
      </div>
    </div>

    <div class="wizard-actions">
      <button class="wizard-btn secondary" id="wizard-back">← BACK</button>
      <button class="wizard-btn primary" id="wizard-next">NEXT: REVIEW →</button>
    </div>
  `;

  // Wire events
  const slider = $('wizard-labor-slider');
  slider?.addEventListener('input', (e) => {
    WIZARD.laborHours = parseInt(e.target.value);
    $('wizard-labor-value').textContent = WIZARD.laborHours.toLocaleString();
  });

  $('wizard-back')?.addEventListener('click', () => {
    WIZARD.step = 3;
    switchToPlanView();
    renderStep();
  });

  $('wizard-next')?.addEventListener('click', () => {
    WIZARD.step = 5;
    renderStep();
  });
}

// ─── STEP 5: CONFIRM ───────────────────────────────────────────────

function renderConfirmStep(container) {
  const totalDistance = calculateTotalTransportDistance();
  const grade = calculateGrade();

  container.innerHTML = `
    <div class="wizard-step-content">
      <h2 class="wizard-step-title">REVIEW & SUBMIT</h2>

      <div class="wizard-summary">
        <div class="wizard-summary-section">
          <h3>BUILDING</h3>
          <p><strong>${WIZARD.generatedBuilding?.name || 'Building'}</strong></p>
          <p>${WIZARD.generatedBuilding?.stats?.floors || 1} floors · ${(WIZARD.generatedBuilding?.stats?.grossArea || 0).toLocaleString()} sq ft</p>
        </div>

        <div class="wizard-summary-section">
          <h3>MATERIALS</h3>
          ${WIZARD.materials.map(m => `
            <p>${m.name}: ${m.sourced.toLocaleString()} ${m.unit}</p>
          `).join('')}
        </div>

        <div class="wizard-summary-section">
          <h3>TRANSPORT</h3>
          <p>Total distance: <strong>${formatDistance(totalDistance)}</strong></p>
          <p>Dump site: (${WIZARD.dumpSite?.gx || '?'}, ${WIZARD.dumpSite?.gy || '?'})</p>
        </div>

        <div class="wizard-summary-section">
          <h3>LABOR</h3>
          <p><strong>${WIZARD.laborHours.toLocaleString()}</strong> person-hours</p>
        </div>

        <div class="wizard-grade">
          <span class="wizard-grade-letter grade-${grade.letter.toLowerCase()}">${grade.letter}</span>
          <span class="wizard-grade-label">PROJECTED GRADE</span>
        </div>
      </div>
    </div>

    <div class="wizard-actions">
      <button class="wizard-btn secondary" id="wizard-back">← BACK</button>
      <button class="wizard-btn primary submit" id="wizard-submit">COMMIT BUILD</button>
    </div>
  `;

  $('wizard-back')?.addEventListener('click', () => {
    WIZARD.step = 4;
    renderStep();
  });

  $('wizard-submit')?.addEventListener('click', completeWizard);
}

// ─── CALCULATIONS ──────────────────────────────────────────────────

function calculateTotalTransportDistance() {
  let total = 0;
  for (const draw of WIZARD.draws) {
    total += draw.distance || 0;
  }
  total += WIZARD.dumpDistance || 0;
  return total;
}

function calculateGrade() {
  const totalDistance = calculateTotalTransportDistance();

  // Distance penalty: every 500ft reduces score by 1 point
  const distancePenalty = Math.min(5, totalDistance / 500);

  // Material sustainability (placeholder)
  const materialScore = 5;

  // Final score out of 10
  const score = Math.max(0, 10 - distancePenalty);

  let letter = 'D';
  if (score >= 7.5) letter = 'A';
  else if (score >= 5.5) letter = 'B';
  else if (score >= 3.5) letter = 'C';

  return { letter, score };
}

// ─── MAP HELPERS ───────────────────────────────────────────────────

function switchToPlanView() {
  // Switch to plan view
  window.dispatchEvent(new CustomEvent('wizard-view-change', { detail: { mode: 'plan' } }));

  // Add sourcing class to body to hide UI elements
  document.body.classList.add('wizard-sourcing');

  // Hide buildings layer (the main building renders)
  const buildingsLayer = document.getElementById('buildings-layer');
  if (buildingsLayer) buildingsLayer.style.display = 'none';

  // Hide tile scatter elements (trees, etc)
  document.querySelectorAll('.tile-scatter').forEach(el => {
    el.style.display = 'none';
  });

  // Hide any building class elements
  document.querySelectorAll('.building').forEach(el => {
    el.style.display = 'none';
  });

  // Clear the tile selection markers (the blue iso tile selection)
  const tileSelectionMarkers = document.getElementById('tile-selection-markers');
  if (tileSelectionMarkers) tileSelectionMarkers.innerHTML = '';

  // Hide the tile selection panel
  const tileSelectionPanel = document.getElementById('tile-selection-panel');
  if (tileSelectionPanel) tileSelectionPanel.classList.remove('visible');

  // Reset zoom/pan to show full island
  const worldGroup = document.getElementById('world');
  if (worldGroup) {
    // Store original transform
    if (!worldGroup.dataset.originalTransform) {
      worldGroup.dataset.originalTransform = worldGroup.getAttribute('transform') || '';
    }
    // Reset to no transform (zoom 1, pan 0,0)
    worldGroup.setAttribute('transform', 'translate(0, 0) scale(1)');
  }
}

function restoreMapView() {
  // Switch back to atlas view
  window.dispatchEvent(new CustomEvent('wizard-view-change', { detail: { mode: 'atlas' } }));

  // Remove sourcing class
  document.body.classList.remove('wizard-sourcing');

  // Show buildings layer
  const buildingsLayer = document.getElementById('buildings-layer');
  if (buildingsLayer) buildingsLayer.style.display = '';

  // Show tile scatter elements
  document.querySelectorAll('.tile-scatter').forEach(el => {
    el.style.display = '';
  });

  // Show building elements
  document.querySelectorAll('.building').forEach(el => {
    el.style.display = '';
  });

  // Restore original worldGroup transform (zoom/pan state)
  const worldGroup = document.getElementById('world');
  if (worldGroup && worldGroup.dataset.originalTransform) {
    worldGroup.setAttribute('transform', worldGroup.dataset.originalTransform);
  }

  // Restore original viewBox
  const svg = document.getElementById('map-svg');
  if (svg && svg.dataset.originalViewBox) {
    svg.setAttribute('viewBox', svg.dataset.originalViewBox);
  }
}

function clearMapHighlights() {
  const group = document.getElementById('wizard-highlights');
  if (group) group.innerHTML = '';
}

// Check if a tile has buildings on it
function tileHasBuilding(state, tile) {
  if (!state?.island?.builds) return false;
  return state.island.builds.some(b =>
    b.primaryTile?.gx === tile.gx && b.primaryTile?.gy === tile.gy
  );
}

// ─── EXPORTS ───────────────────────────────────────────────────────

export function isWizardActive() {
  return WIZARD.active;
}

export function getWizardStep() {
  return WIZARD.step;
}
