// ════════════════════════════════════════════════════════════════════
// BUILD MODULE — AI Design + Import + Sourcing + Commit
// ════════════════════════════════════════════════════════════════════
// Handles the build flow: tile selection → design (AI/import) →
// sourcing → commit → report card generation.

import { ISLAND_MATERIALS, createBuildDraft, recomputeBuildRequirements, commitBuild, getSalvageTotal, consumeSalvage, tileRemainingYield, tileDumpRemaining, getAvailableLabor, getTotalLaborPerDay, allocateLabor, getTileDepletionFraction, canTileAcceptDepletion, applyTileDepletion, tileExtractionFor, tileDistance as stateTileDistance } from '../state/index.js';
import { gridToScreen, TILE_W, TILE_H, ELEV_UNIT } from '../utils/projection.js';
import { startConstruction } from '../game/index.js';
import {
  generateBuildingSpec,
  specToRequirements,
  generateBuildingGeometry,
  renderPreviewSvg,
  renderMetaHtml,
  setApiKey,
  hasApiKey,
  generateArchitecturalGenes,
  genesToSpec,
  generateFromPrompt
} from './ai.js';
import { computeTileUnionPolygon } from './footprint.js';
import { getDefaultGenes } from './interpreter.js';
import { renderEligibilityMarkers, clearEligibilityMarkers, renderLiveSourcingThreads } from '../render/eligibility.js';
import { showSourcingError, showSourcingSuccess, showBuildCommit, showWarning, showSuccess } from '../ui/toast.js';
import * as FormGenerator from './formGenerator.js';
import { openBuildProfile, closeBuildProfile } from '../render/buildProfile.js';
import { startWizard, cancelWizard, isWizardActive } from './wizard.js';

// Re-export for main.js to configure
export { setApiKey, hasApiKey };

// ─── BUILD STATE ────────────────────────────────────────────────────
export const BUILD = {
  selectedTiles: [],        // Array of selected tiles (1-4 adjacent)
  selectedTile: null,       // Legacy: first selected tile (for compatibility)
  currentDraft: null,
  designMode: null, // 'ai' | 'import'
  sourcingTiles: new Map(), // resource → tile
  aiResult: null,
  importedGeometry: null,
  globalState: null // Reference to main state, set by initBuildHandlers
};

// ─── SOURCING STATE ────────────────────────────────────────────────
// Tracks interactive material sourcing from tiles (step-by-step flow)
const SOURCING = {
  active: false,              // Is sourcing mode active?
  currentMaterial: null,      // Which material are we sourcing? (timber, stone, etc.)
  currentRawMaterial: null,   // The raw material type (for processed materials)
  needed: {},                 // How much of each material is needed
  sourced: {},                // How much has been sourced { material: amount }
  draws: [],                  // Array of { tile, material, amount }
  highlightedTiles: [],       // Tiles highlighted for current material
  onTileClick: null,          // Callback for tile clicks during sourcing
  // Step-by-step sourcing
  materialSteps: [],          // Array of { material, rawMaterial, amount, sourceBiome }
  currentStep: 0,             // Current step index
  previousViewMode: 'atlas',  // View mode to restore after sourcing
  // Waste dumping
  selectingWaste: false,      // Is waste dump site selection active?
  wasteDeposited: 0,          // Amount of waste deposited (cu ft)
  wasteDeposits: []           // Array of { tile, amount } for waste dump sites
};

// Check if sourcing mode is active (including waste selection)
export function isSourcingActive() {
  return SOURCING.active || SOURCING.selectingWaste;
}

// Material to biome mapping
const MATERIAL_BIOMES = {
  timber: 'forest',
  stone: 'mountain',
  sand: 'beach',
  clay: 'lowlands',
  thatch: 'lowlands',
  water: 'water',
  adobe: 'dump'  // Adobe comes from dump piles (soil)
};

// Materials that can be sourced from dump piles (soil-based)
const DUMP_SOURCEABLE = ['adobe', 'soil', 'earth'];

// Raw material yields per tile (in respective units)
const TILE_YIELDS = {
  timber: 10000,  // board feet
  stone: 3000,    // cu ft
  sand: 8000,     // cu ft
  clay: 1500,     // cu ft
  thatch: 5000,   // bundles
  water: 50000    // gallons
};

// ─── SIMPLIFIED SOURCING ─────────────────────────────────────────────
// One tile per material, with fractional depletion based on building type

// Required materials for buildings (used for simplified sourcing)
const REQUIRED_MATERIALS = ['timber', 'stone', 'clay', 'sand', 'thatch', 'water'];

// Get depletion fraction based on building stats (tower = 1.0, shed = 0.5)
export function getBuildingDepletionFraction(stats) {
  const floors = stats?.floors || 1;
  return floors >= 6 ? 1.0 : 0.5;
}

// Find the best source tile for a material
function findBestSourceTile(state, material, depletionFraction, buildTile) {
  const biome = MATERIAL_BIOMES[material];
  if (!biome) return null;

  const tiles = state.island.tiles || [];

  // Filter to tiles of the correct biome that can accept the depletion
  const candidates = tiles
    .filter(t => t.biome === biome)
    .filter(t => canTileAcceptDepletion(state, t, material, depletionFraction))
    .map(t => ({
      tile: t,
      depletion: getTileDepletionFraction(state, t, material),
      distance: buildTile ? stateTileDistance(t.gx, t.gy, buildTile.gx, buildTile.gy) : 0
    }));

  if (candidates.length === 0) return null;

  // Sort: prefer already partially depleted (consolidate), then by distance
  candidates.sort((a, b) => {
    // First prefer partially depleted (but not full)
    if (a.depletion !== b.depletion) return b.depletion - a.depletion;
    // Then by distance (closer is better)
    return a.distance - b.distance;
  });

  return candidates[0].tile;
}

// Auto-source all materials with simplified logic (one tile per material)
export function autoSourceAllMaterialsSimplified(state, buildTile, buildingStats) {
  const depletionFraction = getBuildingDepletionFraction(buildingStats);
  const draws = [];

  // Determine which materials this building needs based on its material requirements
  const matReq = FormGenerator.calculateMaterialRequirements();
  const neededMaterials = matReq?.totals
    ? Object.keys(matReq.totals).filter(m => matReq.totals[m] > 0 && MATERIAL_BIOMES[m])
    : REQUIRED_MATERIALS;

  for (const material of neededMaterials) {
    const sourceTile = findBestSourceTile(state, material, depletionFraction, buildTile);
    if (sourceTile) {
      draws.push({
        material,
        tile: { gx: sourceTile.gx, gy: sourceTile.gy, biome: sourceTile.biome },
        depletionFraction
      });
    }
  }

  return draws;
}

// Apply simplified draws to state (update tile depletion)
export function applySimplifiedDraws(state, draws) {
  for (const draw of draws) {
    const tile = state.island.tiles.find(t => t.gx === draw.tile.gx && t.gy === draw.tile.gy);
    if (tile) {
      applyTileDepletion(state, tile, draw.material, draw.depletionFraction);
    }
  }
}

// ─── TILE SELECTION ────────────────────────────────────────────────

// Check if two tiles are adjacent (4-directional)
function tilesAdjacent(t1, t2) {
  const dx = Math.abs(t1.gx - t2.gx);
  const dy = Math.abs(t1.gy - t2.gy);
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

// Check if a tile is adjacent to any tile in the selection
function isAdjacentToSelection(tile, selectedTiles) {
  if (selectedTiles.length === 0) return true; // First tile always allowed
  return selectedTiles.some(t => tilesAdjacent(t, tile));
}

// Check if tile is already selected
function isTileSelected(tile) {
  return BUILD.selectedTiles.some(t => t.gx === tile.gx && t.gy === tile.gy);
}

// Toggle tile selection - SINGLE TILE ONLY
export function toggleTileSelection(tile) {
  // Can't select water tiles
  if (tile.biome === 'water') return false;

  const alreadySelected = isTileSelected(tile);

  if (alreadySelected) {
    // Deselect
    BUILD.selectedTiles = [];
  } else {
    // Select this tile (replacing any previous selection)
    BUILD.selectedTiles = [tile];
  }

  // Update legacy selectedTile for compatibility
  BUILD.selectedTile = BUILD.selectedTiles[0] || null;

  // Update visual feedback
  updateSelectionVisuals();
  updateSelectionPanel();

  return true;
}

// Clear all tile selection
export function clearTileSelection() {
  BUILD.selectedTiles = [];
  BUILD.selectedTile = null;
  updateSelectionVisuals();
  updateSelectionPanel();
}

// Calculate terrain leveling labor (meet in middle)
export function calculateLevelingLabor() {
  if (BUILD.selectedTiles.length <= 1) return 0;

  const avgElev = BUILD.selectedTiles.reduce((sum, t) => sum + t.elev, 0) / BUILD.selectedTiles.length;
  const totalDelta = BUILD.selectedTiles.reduce((sum, t) => sum + Math.abs(t.elev - avgElev), 0);

  // 50 labor hours per elevation unit of change
  return Math.round(totalDelta * 50);
}

// Get the target elevation after leveling
export function getTargetElevation() {
  if (BUILD.selectedTiles.length === 0) return 0;
  if (BUILD.selectedTiles.length === 1) return BUILD.selectedTiles[0].elev;

  // Round to nearest integer for the averaged elevation
  const avgElev = BUILD.selectedTiles.reduce((sum, t) => sum + t.elev, 0) / BUILD.selectedTiles.length;
  return Math.round(avgElev);
}

// Update SVG visuals for selected tiles
function updateSelectionVisuals() {
  const markersGroup = document.getElementById('tile-selection-markers');
  if (!markersGroup) return;

  markersGroup.innerHTML = '';

  // Determine view mode from body class
  const body = document.body;
  const mode = body.classList.contains('view-figure') ? 'figure' :
               body.classList.contains('view-figureplan') ? 'figureplan' :
               body.classList.contains('view-plan') ? 'plan' : 'atlas';
  const isPlan = mode === 'plan' || mode === 'figureplan';

  for (const tile of BUILD.selectedTiles) {
    const { sx, sy } = gridToScreen(tile.gx, tile.gy, mode);
    const elevOffset = isPlan ? 0 : tile.elev * ELEV_UNIT;
    const top = sy - elevOffset;

    // Create selection highlight path
    const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    if (isPlan) {
      // Plan view: square highlight
      const size = 18;
      highlight.setAttribute('d', `M${sx - size},${sy - size} L${sx + size},${sy - size} L${sx + size},${sy + size} L${sx - size},${sy + size} Z`);
    } else {
      // Iso view: diamond highlight
      highlight.setAttribute('d', `M${sx},${top - TILE_H} L${sx + TILE_W},${top} L${sx},${top + TILE_H} L${sx - TILE_W},${top} Z`);
    }

    highlight.setAttribute('fill', 'rgba(90, 154, 184, 0.2)');
    highlight.setAttribute('stroke', 'var(--accent)');
    highlight.setAttribute('stroke-width', '3');
    highlight.setAttribute('class', 'tile-selection-highlight');
    markersGroup.appendChild(highlight);
  }
}

// Update the selection panel UI - SINGLE TILE
function updateSelectionPanel() {
  const panel = document.getElementById('tile-selection-panel');
  if (!panel) return;

  // Hide panel during sourcing mode (material or waste selection)
  if (SOURCING.active || SOURCING.selectingWaste) {
    panel.classList.remove('visible');
    return;
  }

  if (BUILD.selectedTiles.length === 0) {
    panel.classList.remove('visible');
    return;
  }

  panel.classList.add('visible');
  const tile = BUILD.selectedTiles[0];

  // Update title
  const countEl = document.getElementById('tsp-tile-count');
  if (countEl) {
    countEl.textContent = `Tile selected`;
  }

  // Update biome
  const biomesEl = document.getElementById('tsp-biomes');
  if (biomesEl) {
    biomesEl.textContent = tile.biome.charAt(0).toUpperCase() + tile.biome.slice(1);
  }

  // Update elevation
  const elevEl = document.getElementById('tsp-elevation');
  if (elevEl) {
    elevEl.textContent = `Elevation ${tile.elev}`;
  }

  // Hide leveling labor (not needed for single tile)
  const laborEl = document.getElementById('tsp-leveling-labor');
  if (laborEl) {
    laborEl.style.display = 'none';
  }
}

// ─── HELPERS ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── DESIGN STATE ───────────────────────────────────────────────────
const DESIGN = {
  currentStep: 1,
  // Step 1: Site
  padElevation: 'grade', // 'grade' | 'raised' | 'embedded' | 'stilts'
  // Step 2: Structure
  structure: 'mass-timber', // 'mass-timber' | 'load-bearing' | 'concrete-frame' | 'steel-frame'
  // Step 3: Massing
  floors: 2,
  massing: 'bar', // 'bar' | 'tower' | 'courtyard' | 'cluster'
  articulation: 'lightwell', // 'none' | 'lightwell' | 'setback'
  roof: 'flat', // 'flat' | 'pitched' | 'shed'
  // Step 4: Envelope
  cladding: null, // Set based on structure
  fenestration: 'ribbon', // 'punched' | 'ribbon' | 'curtain' | 'minimal'
  windowSize: 3, // 1-5
  // Step 5: Commit
  laborAllocation: 50,
  endOfLife: 'salvage', // 'salvage' | 'ruin' | 'dismantle'
  // Computed
  generatedForm: null
};

let previewInitialized = false;

// ─── BUILD WIZARD ────────────────────────────────────────────────────
export function openBuildWizard() {
  // Get the first selected tile for the wizard
  const tile = BUILD.selectedTiles[0];
  if (!tile) {
    console.error('[BUILD] No tile selected for wizard');
    return;
  }

  // Close build modal
  $('build-modal')?.classList.remove('active');
  document.getElementById('tile-selection-panel')?.classList.remove('visible');

  // Start the wizard
  startWizard(
    BUILD.globalState,
    tile,
    // onComplete callback
    (buildData) => {
      handleWizardComplete(buildData);
    },
    // onCancel callback
    () => {
      // Clear selection and return to map
      clearTileSelection();
    }
  );
}

async function handleWizardComplete(buildData) {
  const state = BUILD.globalState;
  if (!state || !buildData) return;

  try {
    const tile = buildData.tile;

    // Get ALL buildings from the wizard (may be multiple committed buildings)
    const allBuildings = buildData.buildings || [buildData.building];
    console.log('[BUILD] Processing', allBuildings.length, 'buildings from wizard');

    // Use the pre-captured ISO image from the wizard (captured before view was restored)
    const isoImage = buildData.isoImage;
    console.log('[BUILD] Using pre-captured ISO image:', isoImage ? 'success' : 'failed');

    // Process each building
    const committedBuilds = [];
    let totalFloors = 0;
    let totalHeight = 0;
    let totalArea = 0;
    let totalLabor = 0;
    let totalCarbon = 0;

    for (const building of allBuildings) {
      if (!building || !building.stats) continue;

      const floors = building.stats?.floors || 2;
      const height = building.stats?.height || floors * 12;
      const area = building.stats?.grossArea || 2000;

      totalFloors = Math.max(totalFloors, floors);
      totalHeight = Math.max(totalHeight, height);
      totalArea += area;
      totalLabor += building.stats?.laborHours || 500;

      // Create draft for this building
      const draft = createBuildDraft(state, {
        name: building.name || `Building ${committedBuilds.length + 1}`,
        typology: building.stats?.typology || 'residential',
        floors: floors,
        grossArea: area,
        footprint: building.stats?.footprint || building.footprint,
        materials: building.materials || {},
        laborReq: building.stats?.laborHours || (buildData.laborHours / allBuildings.length),
        primaryTile: { gx: tile.gx, gy: tile.gy }
      });

      // Set stats object for build profile display
      draft.stats = {
        floors: floors,
        grossArea: area,
        typology: building.stats?.typology || 'residential',
        height: height,
        footprint: building.stats?.footprint || building.footprint
      };

      // Apply the draws from wizard (split among buildings)
      draft.draws = buildData.draws.map(d => ({
        material: d.material,
        amount: Math.ceil((d.amount || 0) / allBuildings.length),
        tile: d.tile,
        distance: d.distance,
        distanceFt: d.distance,
        rawSourceTile: d.tile,
        rawMaterial: d.rawMaterial
      }));

      // Calculate embodied carbon for this building
      let buildingCarbon = 0;
      for (const draw of draft.draws) {
        const carbonPerUnit = {
          timber: 0.0001, stone: 0.0002, brick: 0.0005,
          concrete: 0.0003, glass: 0.001, clay: 0.0001, sand: 0.00005
        };
        buildingCarbon += (draw.amount || 0) * (carbonPerUnit[draw.material] || 0.0001);
      }
      draft.embodiedCarbon = +buildingCarbon.toFixed(3);
      totalCarbon += buildingCarbon;

      // Set excavation (split among buildings)
      draft.excavationNeeded = Math.ceil((buildData.excavationNeeded || 100) / allBuildings.length);
      draft.wasteReq = { soil: draft.excavationNeeded, debris: 0 };

      if (buildData.dumpSite) {
        draft.wasteDestination = {
          tile: { gx: buildData.dumpSite.gx, gy: buildData.dumpSite.gy },
          amount: draft.excavationNeeded
        };
      }

      draft.transportGrade = calculateTransportGrade(buildData.totalTransportDistance);
      draft.formData = building.formData;
      draft.genes = building.genes;

      // Build sourcing object
      const sourcing = {
        draws: draft.draws.map(d => ({
          fromTile: { gx: d.tile?.gx, gy: d.tile?.gy },
          material: d.material || d.rawMaterial,
          amount: d.amount || 0
        })),
        wasteDestinations: buildData.dumpSite ? [{
          toTile: { gx: buildData.dumpSite.gx, gy: buildData.dumpSite.gy },
          wasteType: 'soil',
          amount: draft.excavationNeeded
        }] : []
      };

      // Commit this building
      const finalBuild = commitBuild(state, draft, sourcing);
      if (finalBuild) {
        finalBuild.status = 'standing';
        finalBuild.progressFraction = 1.0;
        finalBuild.constructionDays = 0;
        finalBuild.stories = floors;
        finalBuild.totalLaborHours = draft.laborReq || 500;
        finalBuild.accumulatedLaborHours = finalBuild.totalLaborHours;
        finalBuild.stats = draft.stats;
        finalBuild.draws = draft.draws;
        finalBuild.wasteDestination = draft.wasteDestination;
        finalBuild.wasteReq = draft.wasteReq;
        finalBuild.embodiedCarbon = draft.embodiedCarbon;
        finalBuild.genes = draft.genes;

        committedBuilds.push({
          id: finalBuild.id,
          name: finalBuild.name,
          category: draft.stats?.typology || 'structure',
          typology: draft.stats?.typology || 'structure',
          floors: floors,
          height: height,
          offset: building.offset || { x: 0, z: 0 },
          rotation: building.rotation || 0,
          width: Math.sqrt(area) || 40,
          depth: Math.sqrt(area) || 40
        });
      }
    }

    // Set tile as built
    tile.built = true;
    tile.buildId = committedBuilds[0]?.id;

    // Collect walkMeshes from building groups for 3D walk view
    const walkMeshes = [];
    for (const building of allBuildings) {
      if (building.group) {
        walkMeshes.push({
          group: building.group,
          offset: building.offset || { x: 0, z: 0 },
          rotation: building.rotation || 0,
          stats: building.stats
        });
      }
    }

    // Create tile.populated with ALL buildings
    const primaryMaterial = buildData.draws?.[0]?.material || 'timber';
    tile.populated = {
      kind: 'wizard',
      name: committedBuilds.length > 1
        ? `${committedBuilds.length} Buildings`
        : committedBuilds[0]?.name || 'New Building',
      floors: totalFloors,
      height: totalHeight,
      condition: 1.0,
      progressFraction: 1.0,
      visibleFloors: totalFloors,
      spec: {
        floors: totalFloors,
        floor_height_ft: 12,
        footprint_w: Math.sqrt(totalArea) / 8,
        footprint_d: Math.sqrt(totalArea) / 8,
        primary_material: primaryMaterial,
        roof_type: 'flat'
      },
      walkMeshes: walkMeshes.length > 0 ? walkMeshes : null,
      isoImage: isoImage,
      buildingCount: committedBuilds.length,
      buildings: committedBuilds
    };

    console.log('[BUILD] Tile populated with', committedBuilds.length, 'buildings');

    showBuildCommit(tile.populated.name);
    window.dispatchEvent(new CustomEvent('island-changed'));

    // Trigger walk mode building refresh
    if (typeof window.markWalkBuildingsStale === 'function') {
      window.markWalkBuildingsStale();
    }
  } catch (err) {
    console.error('[BUILD] Wizard commit failed:', err);
    showWarning('Build failed: ' + err.message);
  }
}

function calculateTransportGrade(totalDistance) {
  // Distance penalty: every 500ft reduces score
  const distancePenalty = Math.min(5, totalDistance / 500);
  const score = Math.max(0, 10 - distancePenalty);

  if (score >= 7.5) return 'A';
  if (score >= 5.5) return 'B';
  if (score >= 3.5) return 'C';
  return 'D';
}

// ─── DESIGN SCREEN (Legacy) ──────────────────────────────────────────
export function openDesignScreen() {
  const screen = $('design-screen');
  if (!screen) return;

  // Close build modal and tile selection panel
  $('build-modal')?.classList.remove('active');
  document.getElementById('tile-selection-panel')?.classList.remove('visible');

  // Reset design state
  DESIGN.currentStep = 1;
  DESIGN.padElevation = 'grade';
  DESIGN.structure = 'mass-timber';
  DESIGN.floors = 2;
  DESIGN.massing = 'bar';
  DESIGN.articulation = 'lightwell';
  DESIGN.roof = 'flat';
  DESIGN.fenestration = 'ribbon';
  DESIGN.windowSize = 3;
  DESIGN.laborAllocation = 50;
  DESIGN.endOfLife = 'salvage';
  DESIGN.generatedForm = null;

  // Show screen first so canvas has dimensions
  screen.classList.add('active');

  // Initialize 3D preview after screen is visible
  setTimeout(() => {
    // Initialize Three.js if needed
    if (!previewInitialized) {
      FormGenerator.initFormPreview('ds-canvas');
      previewInitialized = true;
    }

    // Reset the form generator for new session
    FormGenerator.reset();

    // Set tiles from selection (new API) - this computes polygon and shows ground display
    FormGenerator.setTiles(BUILD.selectedTiles);

    // Add scale figures to show human scale (always visible)
    FormGenerator.addScaleFigures();

    // Initialize step navigation and controls
    initDesignSteps();

    // Update step UI (for legacy step navigation)
    goToStep(1);

    // DON'T generate a building yet - wait for user to click "Generate Design"
    // The ground display (tiles + boundary) is already shown by setTiles()
  }, 50);
}

export function closeDesignScreen() {
  $('design-screen')?.classList.remove('active');
  DESIGN.generatedForm = null;

  // Clear tile selection so user can start fresh
  clearTileSelection();
}

// Initialize step navigation
function initDesignSteps() {
  // Back button
  const backBtn = $('ds-back');
  if (backBtn) {
    backBtn.onclick = closeDesignScreen;
  }

  // Step navigation (legacy - hidden but kept for compatibility)
  document.querySelectorAll('.ds-step').forEach(step => {
    step.onclick = () => {
      const stepNum = parseInt(step.dataset.step);
      if (stepNum <= DESIGN.currentStep + 1) {
        goToStep(stepNum);
      }
    };
  });

  // Preview controls
  const rotateBtn = $('ds-rotate-toggle');
  if (rotateBtn) {
    rotateBtn.onclick = () => {
      const isRotating = FormGenerator.toggleRotation();
      rotateBtn.classList.toggle('active', isRotating);
    };
  }

  const resetBtn = $('ds-view-reset');
  if (resetBtn) {
    resetBtn.onclick = () => FormGenerator.setOrthoView();
  }

  // Initialize prompt-first UI
  initPromptFirstUI();
}

// ─── HINT CHIP POOL ────────────────────────────────────────────────
// Large pool of fun, varied prompts for building generation
const HINT_CHIPS = [
  // Architectural styles
  { label: 'timber tower', prompt: 'organic mass timber tower with irregular floor plates, living walls, and a weathered copper crown' },
  { label: 'glass spiral', prompt: 'a twisted crystalline tower spiraling upward with rotating floor plates and fractured glass skin' },
  { label: 'carved stone', prompt: 'monolithic stone tower carved with deep voids and asymmetric window slots, rough-hewn and ancient' },
  { label: 'steel skeleton', prompt: 'skeletal steel diagrid tower with diamond exoskeleton, minimal glass infill, industrial and raw' },
  { label: 'brick layers', prompt: 'stacked brick volumes with eroded corners, varied setbacks, and hand-laid patterns' },
  { label: 'sculptural', prompt: 'undulating concrete form with board-formed texture, organic curves, no straight edges' },

  // Building types
  { label: 'commune', prompt: 'timber A-frame commune with interconnected pitched roofs and shared outdoor terraces' },
  { label: 'lighthouse', prompt: 'slender cylindrical lighthouse with spiral staircase visible through glass bands, topped with a brass lantern room' },
  { label: 'workshop', prompt: 'industrial workshop with sawtooth roof, large clerestory windows, exposed trusses and roll-up doors' },
  { label: 'treehouse', prompt: 'elevated timber cabin on stilts with rope bridges, wraparound deck, and woven branch railings' },
  { label: 'observatory', prompt: 'domed astronomical observatory with retractable roof panels, stone base, copper dome turning green' },
  { label: 'bathhouse', prompt: 'sunken thermal bathhouse with steaming pools, stone walls, timber lattice roof filtering light' },

  // Moods
  { label: 'fortress', prompt: 'defensive stronghold with thick walls, narrow windows, corner watchtowers and heavy timber gates' },
  { label: 'ruins', prompt: 'partially collapsed ancient temple being reclaimed by nature, missing roof sections, moss-covered stones' },
  { label: 'floating', prompt: 'cantilevered structure dramatically hovering over the landscape, glass floor revealing the void below' },
  { label: 'buried', prompt: 'earth-sheltered dwelling with grass roof, round doors, carved into the hillside like a hobbit hole' },
  { label: 'vertical farm', prompt: 'tiered agricultural tower with planted terraces, irrigation channels, and greenhouse levels' },
  { label: 'wind catcher', prompt: 'tower with dramatic wind scoops and cooling vents, inspired by persian badgirs' },

  // Materials
  { label: 'adobe pueblo', prompt: 'terraced adobe complex with rounded edges, vigas protruding through walls, ladder-accessed rooftops' },
  { label: 'bamboo', prompt: 'woven bamboo pavilion with curved roof, open sides, natural joinery, tropical resort feeling' },
  { label: 'rammed earth', prompt: 'striped rammed earth walls showing geological layers, minimal openings, primitive and permanent' },
  { label: 'salvage', prompt: 'building made from reclaimed ship parts, mismatched windows, patched corrugated metal, nautical details' },
  { label: 'thatch dome', prompt: 'circular building with thick thatched roof sweeping down to the ground, single central oculus' },
  { label: 'glass cube', prompt: 'pure glass box with minimal mullions, completely transparent, contents visible from all angles' },

  // Fantastical
  { label: 'crystal cave', prompt: 'faceted crystalline structure emerging from the ground like a geode, translucent purple-pink stone' },
  { label: 'mushroom', prompt: 'bulbous organic form with spotted cap roof, twisted stem base, fairy tale architecture' },
  { label: 'inverted', prompt: 'building appears upside-down with foundations in the air and roof touching ground' },
  { label: 'impossible', prompt: 'escher-like structure with stairs that loop back on themselves, conflicting perspectives' },
  { label: 'nest', prompt: 'woven branch structure like a giant bird nest, organic rounded form, feathered with straw' },
  { label: 'shell', prompt: 'spiraling nautilus shell translated into architecture, chambered interior, pearlescent surfaces' },

  // Functional
  { label: 'market hall', prompt: 'open-sided market building with dramatic timber roof structure, stalls below, lanterns hanging' },
  { label: 'granary', prompt: 'elevated storage building on stone mushroom pillars, slatted walls for ventilation, peaked roof' },
  { label: 'bell tower', prompt: 'tall narrow campanile with open belfry at top, visible bells, stone construction, clock face' },
  { label: 'kiln', prompt: 'bottle-shaped brick kiln with massive chimney, fire doors, industrial ceramic production' },
  { label: 'windmill', prompt: 'traditional windmill with rotating sails, round stone base, timber cap that turns to face wind' },
  { label: 'amphitheater', prompt: 'outdoor performance venue with curved stone seating tiers, central stage, acoustic shell' }
];

// Pick random chips from the pool
function getRandomHintChips(count = 6) {
  const shuffled = [...HINT_CHIPS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Populate hint chips container
function populateHintChips() {
  const container = $('ds-prompt-hints');
  if (!container) return;

  container.innerHTML = '';
  const chips = getRandomHintChips(6);

  for (const chip of chips) {
    const btn = document.createElement('button');
    btn.className = 'ds-hint-chip';
    btn.dataset.prompt = chip.prompt;
    btn.textContent = chip.label;
    btn.onclick = () => {
      const textarea = $('ds-ai-prompt');
      if (textarea) {
        textarea.value = chip.prompt;
        textarea.focus();
      }
    };
    container.appendChild(btn);
  }

  // Add refresh button
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'ds-hint-refresh';
  refreshBtn.textContent = '↻';
  refreshBtn.title = 'More ideas';
  refreshBtn.onclick = (e) => {
    e.preventDefault();
    populateHintChips();
  };
  container.appendChild(refreshBtn);
}

// Initialize the new prompt-first UI
function initPromptFirstUI() {
  // Update compact site info
  updateSiteInfoCompact();

  // Populate hint chips from pool
  populateHintChips();

  // Wire up generate button
  const generateBtn = $('ds-ai-generate');
  if (generateBtn) {
    generateBtn.onclick = async () => {
      await generateAIDesign();
    };
  }

  // Wire up regenerate button - removes current building and opens prompt
  const regenerateBtn = $('ds-regenerate');
  if (regenerateBtn) {
    regenerateBtn.onclick = () => {
      // Remove the currently selected building
      const selectedIdx = FormGenerator.getSelectedBuildingIndex();
      if (selectedIdx >= 0) {
        FormGenerator.removePreviewBuilding(selectedIdx);
        updateBuildingsList();
      }
      // Show prompt section, hide result section
      const promptSection = $('ds-prompt-section');
      const resultSection = $('ds-result-section');
      if (promptSection) promptSection.style.display = 'block';
      if (resultSection) resultSection.style.display = 'none';
      // Hide position controls if no buildings left
      const posControls = $('ds-preview-position');
      const hasBuildings = FormGenerator.getPreviewBuildings().length > 0;
      if (posControls && !hasBuildings) posControls.style.display = 'none';
    };
  }

  // Wire up commit button
  const commitBtn = $('ds-commit-btn');
  if (commitBtn) {
    commitBtn.onclick = () => {
      commitFromArchetype();
    };
  }

  // Wire up position/rotation controls
  initPositionControls();

  // Reset to prompt view (hide result section)
  const promptSection = $('ds-prompt-section');
  const resultSection = $('ds-result-section');
  const posControls = $('ds-preview-position');
  if (promptSection) promptSection.style.display = 'block';
  if (resultSection) resultSection.style.display = 'none';
  if (posControls) posControls.style.display = 'none';
}

// Initialize building position/rotation controls
function initPositionControls() {
  const MOVE_STEP = 5; // feet per click
  const ROTATE_STEP = Math.PI / 12; // 15 degrees per click

  // Move buttons
  const moveUp = $('ds-move-up');
  const moveDown = $('ds-move-down');
  const moveLeft = $('ds-move-left');
  const moveRight = $('ds-move-right');
  const posReset = $('ds-pos-reset');
  const rotateCcw = $('ds-rotate-ccw');
  const rotateCw = $('ds-rotate-cw');

  const updateAfterMove = () => {
    updateCollisionWarning();
    updateBuildingsList();
    FormGenerator.refreshScaleFigures();
  };

  if (moveUp) {
    moveUp.onclick = () => { FormGenerator.moveBuildingBy(0, -MOVE_STEP); updateAfterMove(); };
  }
  if (moveDown) {
    moveDown.onclick = () => { FormGenerator.moveBuildingBy(0, MOVE_STEP); updateAfterMove(); };
  }
  if (moveLeft) {
    moveLeft.onclick = () => { FormGenerator.moveBuildingBy(-MOVE_STEP, 0); updateAfterMove(); };
  }
  if (moveRight) {
    moveRight.onclick = () => { FormGenerator.moveBuildingBy(MOVE_STEP, 0); updateAfterMove(); };
  }
  if (posReset) {
    posReset.onclick = () => { FormGenerator.resetBuildingTransform(); updateAfterMove(); };
  }
  if (rotateCcw) {
    rotateCcw.onclick = () => { FormGenerator.rotateBuildingBy(ROTATE_STEP); updateAfterMove(); };
  }
  if (rotateCw) {
    rotateCw.onclick = () => { FormGenerator.rotateBuildingBy(-ROTATE_STEP); updateAfterMove(); };
  }

  // Wire up "Add Another" button - saves current building, then opens prompt for new one
  const addBuildingBtn = $('ds-add-building');
  if (addBuildingBtn) {
    addBuildingBtn.onclick = () => {
      // First, save the current building to preview
      const result = FormGenerator.addBuildingToPreview();
      if (!result.success) {
        showWarning(result.reason || 'Could not add building');
        return;
      }

      // Clear current building state (it's now in preview)
      DESIGN.generatedForm = null;
      DESIGN.archetypeResult = null;

      // Update the buildings list to show all preview buildings
      updateBuildingsList();

      // Show prompt section for another building
      const promptSection = $('ds-prompt-section');
      const resultSection = $('ds-result-section');
      if (promptSection) promptSection.style.display = 'block';
      if (resultSection) resultSection.style.display = 'none';

      showSuccess(`Building ${result.count} added! Enter prompt for next building.`);
    };
  }

}

// Update the buildings list UI - shows all preview buildings + current
function updateBuildingsList() {
  const container = $('ds-buildings-items');
  if (!container) return;

  // Get all preview buildings
  const previewBuildings = FormGenerator.getPreviewBuildings();
  // Use DESIGN.generatedForm for current building (set in generateAIDesign)
  const currentStats = DESIGN.generatedForm;
  const archetypeResult = DESIGN.archetypeResult;

  // If no buildings at all, show empty state
  if (previewBuildings.length === 0 && !currentStats) {
    container.innerHTML = '<div class="ds-buildings-empty">Enter a prompt above to generate</div>';
    return;
  }

  let html = '';

  // Show all preview buildings (already saved)
  previewBuildings.forEach((building, index) => {
    const stats = building.stats || {};
    const name = stats.name || `Building ${index + 1}`;
    // Prefer typology (actual tower style) over archetype (AI category)
    const displayType = (stats.typology || stats.archetype || 'Unknown').toUpperCase();
    const floors = stats.floors || 0;
    const height = stats.height || 0;
    const isSelected = building.selected;

    html += `
      <div class="ds-building-item ${isSelected ? 'selected' : ''}" data-building-index="${index}">
        <div class="ds-building-item-info">
          <div class="ds-building-item-name">${name}</div>
          <div class="ds-building-item-meta">${displayType} · ${floors}F · ${height}FT</div>
        </div>
        <button class="ds-building-item-delete" data-delete-index="${index}" title="Remove">×</button>
      </div>
    `;
  });

  // Show current unsaved building (if any)
  // Check if this is the selected one (no preview building selected means current is selected)
  const selectedIdx = FormGenerator.getSelectedBuildingIndex();
  const currentIsSelected = selectedIdx < 0;

  if (currentStats) {
    const name = archetypeResult?.name || currentStats.name || 'New Building';
    // Prefer typology (actual tower style) over archetype (AI category)
    const displayType = (currentStats.typology || currentStats.archetype || 'Unknown').toUpperCase();
    const floors = currentStats.floors || 0;
    const height = currentStats.height || 0;

    html += `
      <div class="ds-building-item current ${currentIsSelected ? 'selected' : ''}" data-building-index="current">
        <div class="ds-building-item-info">
          <div class="ds-building-item-name">${name}</div>
          <div class="ds-building-item-meta">${displayType} · ${floors}F · ${height}FT · <em>unsaved</em></div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Add click handlers for preview buildings selection
  container.querySelectorAll('.ds-building-item[data-building-index]:not([data-building-index="current"])').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('ds-building-item-delete')) return;
      const index = parseInt(item.dataset.buildingIndex);
      FormGenerator.selectPreviewBuilding(index);
      updateBuildingsList();
      // Show position controls when building selected
      const posControls = $('ds-preview-position');
      if (posControls) posControls.style.display = 'flex';
    });
  });

  // Add click handler for current (unsaved) building
  const currentItem = container.querySelector('.ds-building-item[data-building-index="current"]');
  if (currentItem) {
    currentItem.addEventListener('click', () => {
      // Deselect any preview buildings, select the current one
      FormGenerator.selectPreviewBuilding(-1);
      updateBuildingsList();
      const posControls = $('ds-preview-position');
      if (posControls) posControls.style.display = 'flex';
    });
  }

  // Add click handlers for delete buttons
  container.querySelectorAll('.ds-building-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.deleteIndex);
      FormGenerator.removePreviewBuilding(index);
      updateBuildingsList();
      FormGenerator.refreshScaleFigures();
      // Hide position controls if no buildings left
      const posControls = $('ds-preview-position');
      const hasBuildings = FormGenerator.getPreviewBuildings().length > 0 || FormGenerator.hasUncommittedBuilding();
      if (posControls && !hasBuildings) posControls.style.display = 'none';
    });
  });

  // Update position controls visibility based on selection state
  const posControls = $('ds-preview-position');
  const hasAnyBuilding = previewBuildings.length > 0 || currentStats;
  if (posControls) {
    // Show controls if there's any building (preview or current)
    posControls.style.display = hasAnyBuilding ? 'flex' : 'none';
  }

  // Update sourcing display whenever buildings list changes
  updateSourcingDisplay();
}

// Update collision warning
function updateCollisionWarning() {
  const warningEl = $('ds-collision-warning');
  const addBtn = $('ds-add-building');
  if (!warningEl) return;

  const collision = FormGenerator.checkBuildingCollision();
  warningEl.style.display = collision.collides ? 'block' : 'none';

  // Disable add button if collision
  if (addBtn) {
    addBtn.disabled = collision.collides;
  }
}

// Update compact site info display
function updateSiteInfoCompact() {
  const tiles = BUILD.selectedTiles;
  if (tiles.length === 0) return;

  const tilesEl = $('ds-site-tiles');
  const biomeEl = $('ds-site-biome');
  const areaEl = $('ds-site-area');

  if (tilesEl) tilesEl.textContent = `${tiles.length} tile${tiles.length !== 1 ? 's' : ''}`;

  if (biomeEl) {
    const biomes = [...new Set(tiles.map(t => t.biome))];
    biomeEl.textContent = biomes.map(b => b.charAt(0).toUpperCase() + b.slice(1)).join('/');
  }

  // Calculate area from polygon
  const polygon = FormGenerator.getPolygon();
  if (areaEl && polygon) {
    areaEl.textContent = Math.round(polygon.area).toLocaleString();
  }
}

// ─── MATERIAL SOURCING DISPLAY ─────────────────────────────────────
// Calculate and display material requirements from generated buildings
function updateSourcingDisplay() {
  const section = $('ds-sourcing-section');
  const list = $('ds-sourcing-list');
  const statusEl = $('ds-sourcing-status');
  const carbonEl = $('ds-sourcing-carbon');

  if (!section || !list) return;

  // Get material requirements from form generator
  const matReq = FormGenerator.calculateMaterialRequirements();

  if (!matReq || matReq.buildingCount === 0) {
    section.style.display = 'none';
    SOURCING.needed = {};
    return;
  }

  section.style.display = 'block';

  // Store needed amounts for sourcing
  SOURCING.needed = { ...matReq.totals };

  // Get available materials from state
  const state = BUILD.globalState;
  const tiles = state?.island?.tiles || [];

  // Auto-source all materials if not already done
  if (SOURCING.draws.length === 0) {
    autoSourceAllMaterials();
  }

  // Calculate available materials from island
  const available = calculateAvailableMaterials(tiles, state);

  let html = '';
  let totalCarbon = 0;
  let allSatisfied = true;

  // Material display order and units
  const materialConfig = {
    steel: { name: 'STEEL', unit: 'tons', carbonPer: 1.8, rawMat: null },
    glass: { name: 'GLASS', unit: 'sq ft', carbonPer: 0.015, rawMat: 'sand' },
    concrete: { name: 'CONCRETE', unit: 'cu ft', carbonPer: 0.025, rawMat: 'stone' },
    timber: { name: 'TIMBER', unit: 'bf', carbonPer: 0.0008, rawMat: 'timber' },
    stone: { name: 'STONE', unit: 'cu ft', carbonPer: 0.012, rawMat: 'stone' },
    brick: { name: 'BRICK', unit: 'units', carbonPer: 0.0006, rawMat: 'clay' }
  };

  for (const [mat, config] of Object.entries(materialConfig)) {
    const needed = matReq.totals[mat] || 0;
    if (needed <= 0) continue;

    const source = matReq.sources[mat] || { type: mat === 'steel' ? 'imported' : 'extracted' };
    const sourced = SOURCING.sourced[mat] || 0;
    const remaining = needed - sourced;
    const avail = available[mat] || 0;
    // Steel is always satisfied (imported weekly), others need to be sourced
    const isSatisfied = sourced >= needed || source.type === 'imported' || mat === 'steel';
    if (!isSatisfied && remaining > 0) allSatisfied = false;

    // Calculate embodied carbon
    totalCarbon += needed * config.carbonPer;

    // Progress bar width
    const progressPct = Math.min(100, (sourced / needed) * 100);

    // Can we select tiles for this material?
    const canSelect = source.type !== 'imported' && remaining > 0;

    html += `
      <div class="ds-sourcing-item" data-material="${mat}">
        <span class="ds-sourcing-dot ${source.type}"></span>
        <div class="ds-sourcing-info">
          <span class="ds-sourcing-name">${config.name}</span>
          <span class="ds-sourcing-desc">${source.desc}</span>
        </div>
        <div class="ds-sourcing-right">
          <span class="ds-sourcing-amount">${needed.toLocaleString()} ${config.unit}</span>
          <span class="ds-sourcing-avail ${isSatisfied ? 'satisfied' : ''}">
            ${isSatisfied ? '✓' : '!'}
          </span>
        </div>
      </div>
    `;
  }

  // Excavation waste section (if building has foundation/basement)
  const excavationWaste = matReq.excavation || 0;
  if (excavationWaste > 0) {
    const wasteDeposited = SOURCING.wasteDeposited || 0;
    const wasteRemaining = excavationWaste - wasteDeposited;
    const wasteSatisfied = wasteRemaining <= 0;

    html += `
      <div class="ds-sourcing-item" data-material="waste">
        <span class="ds-sourcing-dot waste"></span>
        <div class="ds-sourcing-info">
          <span class="ds-sourcing-name">EXCAVATION</span>
          <span class="ds-sourcing-desc">Soil deposited on island</span>
        </div>
        <div class="ds-sourcing-right">
          <span class="ds-sourcing-amount">${excavationWaste.toLocaleString()} cu ft</span>
          <span class="ds-sourcing-avail satisfied">✓</span>
        </div>
      </div>
    `;
  }

  // Add view map button
  if (SOURCING.draws.length > 0) {
    html += `
      <button class="ds-view-map-btn" id="ds-view-source-map">
        VIEW SOURCE MAP
      </button>
    `;
  }

  list.innerHTML = html || '<div class="ds-sourcing-empty">No materials needed</div>';

  // Add click handler for view map button
  const viewMapBtn = $('ds-view-source-map');
  if (viewMapBtn) {
    viewMapBtn.onclick = () => showSourcingMap();
  }

  // Update summary
  if (carbonEl) carbonEl.textContent = `${totalCarbon.toFixed(2)} T`;
  if (statusEl) {
    statusEl.textContent = allSatisfied ? 'READY TO BUILD' : 'SELECT SOURCES';
    statusEl.className = `ds-sourcing-val ds-sourcing-status ${allSatisfied ? 'available' : 'selecting'}`;
  }

  // Update commit button state - now always enabled since we auto-source
  const commitBtn = $('ds-commit-btn');
  if (commitBtn) {
    commitBtn.disabled = false;
    commitBtn.textContent = 'COMMIT BUILD';
    commitBtn.title = '';
  }
}

// ─── STEP-BY-STEP SOURCING ─────────────────────────────────────────
// Collect all materials that need sourcing and guide user through each

function getMaterialsToSource() {
  const matReq = FormGenerator.calculateMaterialRequirements();
  if (!matReq?.totals) return [];

  const steps = [];
  const materialConfig = {
    timber: { name: 'TIMBER', rawMat: 'timber', sourceBiome: 'forest' },
    stone: { name: 'STONE', rawMat: 'stone', sourceBiome: 'mountain' },
    sand: { name: 'SAND', rawMat: 'sand', sourceBiome: 'beach' },
    clay: { name: 'CLAY', rawMat: 'clay', sourceBiome: 'lowlands' },
    brick: { name: 'BRICK', rawMat: 'clay', sourceBiome: 'lowlands' },
    concrete: { name: 'CONCRETE', rawMat: 'sand', sourceBiome: 'beach' },
    glass: { name: 'GLASS', rawMat: 'sand', sourceBiome: 'beach' },
    thatch: { name: 'THATCH', rawMat: 'thatch', sourceBiome: 'lowlands' },
    adobe: { name: 'ADOBE', rawMat: 'soil', sourceBiome: 'dump' }  // From dump piles
  };

  for (const [mat, config] of Object.entries(materialConfig)) {
    const needed = matReq.totals[mat] || 0;
    if (needed <= 0) continue;

    // Skip imported materials (steel)
    const source = matReq.sources?.[mat];
    if (source?.type === 'imported') continue;

    const sourced = SOURCING.sourced[mat] || 0;
    if (sourced >= needed) continue;

    steps.push({
      material: mat,
      rawMaterial: config.rawMat,
      name: config.name,
      sourceBiome: config.sourceBiome,
      needed,
      sourced
    });
  }

  return steps;
}

// Start the step-by-step sourcing flow
function startSourcingFlow() {
  const state = BUILD.globalState;
  if (!state) return;

  // Get materials to source
  const steps = getMaterialsToSource();
  if (steps.length === 0) {
    // All materials already sourced
    return;
  }

  SOURCING.materialSteps = steps;
  SOURCING.currentStep = 0;
  SOURCING.active = true;

  // Save current view mode and switch to plan view
  SOURCING.previousViewMode = state.viewMode || 'atlas';

  // Add body class
  document.body.classList.add('sourcing-active');

  // Hide design screen
  const designScreen = $('design-screen');
  if (designScreen) {
    designScreen.style.display = 'none';
  }

  // Switch to plan view for clearer tile selection
  if (typeof switchToPlanView === 'function') {
    switchToPlanView();
  } else {
    // Fallback: dispatch event to main.js
    window.dispatchEvent(new CustomEvent('sourcing-view-change', { detail: { mode: 'plan' } }));
  }

  // Show current step
  showCurrentSourcingStep();
}

// Show the current sourcing step
function showCurrentSourcingStep() {
  const state = BUILD.globalState;
  if (!state || SOURCING.currentStep >= SOURCING.materialSteps.length) {
    finishSourcingFlow();
    return;
  }

  const step = SOURCING.materialSteps[SOURCING.currentStep];
  SOURCING.currentMaterial = step.material;
  SOURCING.currentRawMaterial = step.rawMaterial;

  // Find eligible tiles
  const eligibleTiles = [];
  const depletedTiles = [];

  if (step.sourceBiome === 'dump') {
    // For adobe/soil, source from dump sites
    if (state.island.dumpSites) {
      for (const key of state.island.dumpSites) {
        const [gx, gy] = key.split(':').map(Number);
        const tile = state.island.tiles.find(t => t.gx === gx && t.gy === gy);
        if (tile) {
          // Check if dump site has waste (soil) to extract
          const ext = state.island.tileExtraction?.[key];
          const soilAvailable = ext?.soilDumped || 0;
          if (soilAvailable > 0) {
            eligibleTiles.push({ tile, remaining: soilAvailable });
          }
        }
      }
    }
  } else {
    // Regular biome-based sourcing
    const biome = step.sourceBiome;
    for (const tile of state.island.tiles) {
      if (tile.biome !== biome) continue;
      const remaining = tileRemainingYield(state, tile, step.rawMaterial);
      if (remaining > 0) {
        eligibleTiles.push({ tile, remaining });
      } else {
        // Fully depleted - show as unavailable
        depletedTiles.push({ tile, remaining: 0 });
      }
    }
  }

  SOURCING.highlightedTiles = eligibleTiles;

  // Update HUD
  showStepSourcingHUD(step, eligibleTiles.length, depletedTiles.length);

  // Highlight tiles on map
  highlightSourcingTilesWithDepleted(eligibleTiles, depletedTiles, step);
}

// Move to next material step
function nextSourcingStep() {
  SOURCING.currentStep++;
  if (SOURCING.currentStep >= SOURCING.materialSteps.length) {
    finishSourcingFlow();
  } else {
    showCurrentSourcingStep();
  }
}

// Move to previous material step
function prevSourcingStep() {
  if (SOURCING.currentStep > 0) {
    SOURCING.currentStep--;
    showCurrentSourcingStep();
  }
}

// Skip current material (auto-source)
function skipCurrentStep() {
  const step = SOURCING.materialSteps[SOURCING.currentStep];
  if (step) {
    // Auto-source this material
    autoSourceMaterial(step);
  }
  nextSourcingStep();
}

// Finish sourcing flow
function finishSourcingFlow() {
  SOURCING.active = false;
  SOURCING.materialSteps = [];
  SOURCING.currentStep = 0;

  // Remove body class
  document.body.classList.remove('sourcing-active');

  // Hide HUD
  hideSourcingHUD();

  // Clear highlights
  clearSourcingHighlights();

  // Restore view mode
  window.dispatchEvent(new CustomEvent('sourcing-view-change', {
    detail: { mode: SOURCING.previousViewMode }
  }));

  // Show design screen again
  const designScreen = $('design-screen');
  if (designScreen) {
    designScreen.style.display = '';
    setTimeout(() => FormGenerator.refreshPreview(), 50);
  }

  // Update sourcing display
  updateSourcingDisplay();
}

// Show step-based sourcing HUD
function showStepSourcingHUD(step, eligibleCount, depletedCount) {
  const hud = $('sourcing-hud');
  if (!hud) return;

  const totalSteps = SOURCING.materialSteps.length;
  const currentStep = SOURCING.currentStep + 1;
  const needed = step.needed;
  const sourced = SOURCING.sourced[step.material] || 0;
  const remaining = needed - sourced;

  // Update HUD content
  const titleEl = $('sourcing-hud-title');
  if (titleEl) {
    titleEl.textContent = `STEP ${currentStep} OF ${totalSteps}`;
  }

  const matEl = $('sourcing-hud-material');
  if (matEl) {
    matEl.textContent = step.name;
  }

  const amountEl = $('sourcing-hud-amount');
  if (amountEl) {
    amountEl.textContent = `${sourced.toLocaleString()} / ${needed.toLocaleString()}`;
  }

  const hintEl = $('sourcing-hud-hint');
  if (hintEl) {
    if (step.sourceBiome === 'dump') {
      hintEl.textContent = `Select dump piles to extract soil (${eligibleCount} available)`;
    } else {
      const biomeName = step.sourceBiome.charAt(0).toUpperCase() + step.sourceBiome.slice(1);
      if (depletedCount > 0) {
        hintEl.textContent = `Select ${biomeName} tiles (${eligibleCount} available, ${depletedCount} depleted)`;
      } else {
        hintEl.textContent = `Select ${biomeName} tiles to extract ${step.rawMaterial} (${eligibleCount} available)`;
      }
    }
  }

  // Update progress bar
  const fillEl = $('sourcing-hud-fill');
  if (fillEl) {
    const pct = needed > 0 ? Math.min(100, (sourced / needed) * 100) : 0;
    fillEl.style.width = `${pct}%`;
  }

  // Show HUD
  hud.classList.add('visible');

  // Wire up buttons
  const cancelBtn = $('sourcing-hud-cancel');
  if (cancelBtn) {
    cancelBtn.textContent = SOURCING.currentStep > 0 ? '← BACK' : 'CANCEL';
    cancelBtn.onclick = () => {
      if (SOURCING.currentStep > 0) {
        prevSourcingStep();
      } else {
        finishSourcingFlow();
      }
    };
  }

  const doneBtn = $('sourcing-hud-done');
  if (doneBtn) {
    const isLastStep = SOURCING.currentStep >= SOURCING.materialSteps.length - 1;
    const isFullySourced = sourced >= needed;
    doneBtn.textContent = isLastStep ? 'FINISH' : (isFullySourced ? 'NEXT →' : 'SKIP →');
    doneBtn.onclick = () => {
      if (isFullySourced || isLastStep) {
        nextSourcingStep();
      } else {
        skipCurrentStep();
      }
    };
  }
}

// Highlight tiles showing both eligible and depleted
function highlightSourcingTilesWithDepleted(eligibleTiles, depletedTiles, step) {
  const state = BUILD.globalState;
  if (!state) return;

  const markersGroup = document.getElementById('sourcing-threads');
  if (!markersGroup) return;

  markersGroup.innerHTML = '';

  const viewMode = state.viewMode || 'atlas';
  const isPlan = viewMode === 'plan' || viewMode === 'figureplan';

  // Determine colors based on material
  const colors = {
    timber: '#4A8A5A',
    stone: '#6A7A8A',
    sand: '#C8B070',
    clay: '#B8885A',
    thatch: '#8A9A5A',
    soil: '#8B7355'
  };
  const color = colors[step.rawMaterial] || '#5A9AB8';

  // Draw depleted tiles first (grayed out)
  for (const { tile } of depletedTiles) {
    const pos = gridToScreen(tile.gx, tile.gy, viewMode);

    if (isPlan) {
      // Plan view: square
      const size = 16;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', pos.sx - size);
      rect.setAttribute('y', pos.sy - size);
      rect.setAttribute('width', size * 2);
      rect.setAttribute('height', size * 2);
      rect.setAttribute('fill', 'rgba(100, 100, 100, 0.3)');
      rect.setAttribute('stroke', '#666');
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('stroke-dasharray', '3 3');
      rect.style.pointerEvents = 'none';
      rect.classList.add('sourcing-tile-depleted');
      markersGroup.appendChild(rect);
    } else {
      // ISO view: diamond
      const size = 20;
      const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = `M ${pos.sx} ${pos.sy - size}
                 L ${pos.sx + size * 1.5} ${pos.sy}
                 L ${pos.sx} ${pos.sy + size}
                 L ${pos.sx - size * 1.5} ${pos.sy} Z`;
      diamond.setAttribute('d', d);
      diamond.setAttribute('fill', 'rgba(100, 100, 100, 0.3)');
      diamond.setAttribute('stroke', '#666');
      diamond.setAttribute('stroke-width', '1');
      diamond.setAttribute('stroke-dasharray', '3 3');
      diamond.style.pointerEvents = 'none';
      diamond.classList.add('sourcing-tile-depleted');
      markersGroup.appendChild(diamond);
    }
  }

  // Draw eligible tiles (selectable)
  for (const { tile, remaining } of eligibleTiles) {
    const pos = gridToScreen(tile.gx, tile.gy, viewMode);

    if (isPlan) {
      // Plan view: square
      const size = 16;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', pos.sx - size);
      rect.setAttribute('y', pos.sy - size);
      rect.setAttribute('width', size * 2);
      rect.setAttribute('height', size * 2);
      rect.setAttribute('fill', `${color}33`);
      rect.setAttribute('stroke', color);
      rect.setAttribute('stroke-width', '2');
      rect.style.cursor = 'pointer';
      rect.classList.add('sourcing-tile-highlight');
      rect.dataset.gx = tile.gx;
      rect.dataset.gy = tile.gy;
      rect.dataset.remaining = remaining;
      markersGroup.appendChild(rect);
    } else {
      // ISO view: diamond
      const size = 24;
      const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = `M ${pos.sx} ${pos.sy - size}
                 L ${pos.sx + size * 1.5} ${pos.sy}
                 L ${pos.sx} ${pos.sy + size}
                 L ${pos.sx - size * 1.5} ${pos.sy} Z`;
      diamond.setAttribute('d', d);
      diamond.setAttribute('fill', `${color}33`);
      diamond.setAttribute('stroke', color);
      diamond.setAttribute('stroke-width', '2');
      diamond.style.cursor = 'pointer';
      diamond.classList.add('sourcing-tile-highlight');
      diamond.dataset.gx = tile.gx;
      diamond.dataset.gy = tile.gy;
      diamond.dataset.remaining = remaining;
      markersGroup.appendChild(diamond);
    }
  }
}

// Auto-source a material from available tiles
function autoSourceMaterial(step) {
  const state = BUILD.globalState;
  if (!state) return;

  const needed = step.needed - (SOURCING.sourced[step.material] || 0);
  if (needed <= 0) return;

  let remaining = needed;

  if (step.sourceBiome === 'dump') {
    // Source from dump sites
    if (state.island.dumpSites) {
      for (const key of state.island.dumpSites) {
        if (remaining <= 0) break;
        const [gx, gy] = key.split(':').map(Number);
        const tile = state.island.tiles.find(t => t.gx === gx && t.gy === gy);
        if (!tile) continue;

        const ext = state.island.tileExtraction?.[key];
        const soilAvailable = ext?.soilDumped || 0;
        if (soilAvailable > 0) {
          const amount = Math.min(remaining, soilAvailable);
          SOURCING.sourced[step.material] = (SOURCING.sourced[step.material] || 0) + amount;
          SOURCING.draws.push({
            tile: { gx: tile.gx, gy: tile.gy, biome: tile.biome },
            material: step.material,
            rawMaterial: step.rawMaterial,
            amount,
            fromDump: true
          });
          remaining -= amount;
        }
      }
    }
  } else {
    // Source from biome tiles
    const biome = step.sourceBiome;
    const eligibleTiles = state.island.tiles
      .filter(t => t.biome === biome)
      .map(t => ({ tile: t, remaining: tileRemainingYield(state, t, step.rawMaterial) }))
      .filter(e => e.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining);  // Most yield first

    for (const { tile, remaining: tileYield } of eligibleTiles) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, tileYield);
      SOURCING.sourced[step.material] = (SOURCING.sourced[step.material] || 0) + amount;
      SOURCING.draws.push({
        tile: { gx: tile.gx, gy: tile.gy, biome: tile.biome },
        material: step.material,
        rawMaterial: step.rawMaterial,
        amount
      });
      remaining -= amount;
    }
  }
}

// Handle tile click during step-by-step sourcing
function handleStepSourcingTileClick(tile) {
  if (!tile) return false;

  const step = SOURCING.materialSteps[SOURCING.currentStep];
  if (!step) return false;

  // Check if this tile is eligible
  const isEligible = SOURCING.highlightedTiles.some(
    e => e.tile.gx === tile.gx && e.tile.gy === tile.gy
  );

  if (!isEligible) {
    // Tile not eligible - maybe show feedback
    return false;
  }

  // Find remaining for this tile
  const tileData = SOURCING.highlightedTiles.find(
    e => e.tile.gx === tile.gx && e.tile.gy === tile.gy
  );

  if (!tileData || tileData.remaining <= 0) return false;

  // Calculate how much to draw
  const needed = step.needed - (SOURCING.sourced[step.material] || 0);
  const amount = Math.min(needed, tileData.remaining);

  if (amount <= 0) return false;

  // Record the draw
  SOURCING.sourced[step.material] = (SOURCING.sourced[step.material] || 0) + amount;
  SOURCING.draws.push({
    tile: { gx: tile.gx, gy: tile.gy, biome: tile.biome },
    material: step.material,
    rawMaterial: step.rawMaterial,
    amount,
    fromDump: step.sourceBiome === 'dump'
  });

  // Update tile data
  tileData.remaining -= amount;

  // Update HUD
  showStepSourcingHUD(step, SOURCING.highlightedTiles.filter(e => e.remaining > 0).length, 0);

  // Check if this material is fully sourced
  if (SOURCING.sourced[step.material] >= step.needed) {
    // Auto-advance to next step after brief delay
    setTimeout(() => nextSourcingStep(), 300);
  }

  return true;
}

// Legacy function for backwards compatibility
function enterSourcingMode(material, rawMaterial) {
  // Start the step-by-step flow instead
  startSourcingFlow();
}

// Exit tile selection mode
function exitSourcingMode() {
  SOURCING.active = false;
  SOURCING.currentMaterial = null;
  SOURCING.currentRawMaterial = null;
  SOURCING.highlightedTiles = [];

  // Remove body class
  document.body.classList.remove('sourcing-active');

  // Hide the floating HUD
  hideSourcingHUD();

  // Show design screen again
  const designScreen = $('design-screen');
  if (designScreen) {
    designScreen.style.display = '';
    // Refresh the 3D preview after a brief delay for DOM to update
    setTimeout(() => {
      FormGenerator.refreshPreview();
    }, 50);
  }

  // Clear tile highlights
  clearSourcingHighlights();

  // Update display
  updateSourcingDisplay();
}

// ─── WASTE DUMPING MODE ────────────────────────────────────────────
// Enter waste dump site selection mode
function enterWasteSourcingMode() {
  const state = BUILD.globalState;
  if (!state) return;

  // If already in material sourcing mode, exit first
  if (SOURCING.active) {
    exitSourcingMode();
  }

  SOURCING.selectingWaste = true;

  // Add body class
  document.body.classList.add('sourcing-active');

  // Hide tile selection panel
  document.getElementById('tile-selection-panel')?.classList.remove('visible');

  // Hide design screen, show map
  const designScreen = $('design-screen');
  if (designScreen) {
    designScreen.style.display = 'none';
  }

  // Show waste selection HUD
  showWasteHUD();

  // Highlight all tiles that can accept waste (any non-water tile)
  highlightWasteDumpTiles();

  // Set up tile click handler
  SOURCING.onTileClick = (tile) => {
    if (!tile || tile.biome === 'ocean') return;
    depositWasteOnTile(tile);
  };
}

// Exit waste dump site selection mode
function exitWasteSourcingMode() {
  SOURCING.selectingWaste = false;

  // Remove body class
  document.body.classList.remove('sourcing-active');

  // Hide the floating HUD
  hideSourcingHUD();

  // Show design screen again
  const designScreen = $('design-screen');
  if (designScreen) {
    designScreen.style.display = '';
    setTimeout(() => {
      FormGenerator.refreshPreview();
    }, 50);
  }

  // Clear tile highlights
  clearSourcingHighlights();

  // Update display
  updateSourcingDisplay();
}

// Deposit waste on a tile
function depositWasteOnTile(tile) {
  const matReq = FormGenerator.calculateMaterialRequirements();
  const totalWaste = matReq.excavation || 0;
  const remaining = totalWaste - SOURCING.wasteDeposited;

  if (remaining <= 0) return;

  // Each tile can accept up to 50000 cu ft of waste (fills in lowlands, creates mounds)
  const WASTE_CAPACITY = 50000;
  const amount = Math.min(remaining, WASTE_CAPACITY);

  SOURCING.wasteDeposited += amount;
  SOURCING.wasteDeposits.push({
    tile: { gx: tile.gx, gy: tile.gy, biome: tile.biome },
    amount
  });

  // Update HUD
  updateWasteHUDProgress();

  // If all waste deposited, exit mode
  if (SOURCING.wasteDeposited >= totalWaste) {
    setTimeout(() => {
      exitWasteSourcingMode();
    }, 300);
  }
}

// Highlight tiles for waste dumping
function highlightWasteDumpTiles() {
  const state = BUILD.globalState;
  if (!state) return;

  const markersGroup = document.getElementById('sourcing-threads');
  if (!markersGroup) return;

  markersGroup.innerHTML = '';

  // Get all land tiles (not ocean)
  const tiles = state.island.tiles.filter(t => t.biome !== 'ocean');

  for (const tile of tiles) {
    const pos = gridToScreen(tile.gx, tile.gy, state.viewMode || 'iso');

    // Create a subtle diamond outline
    const size = 24;
    const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = `M ${pos.sx} ${pos.sy - size}
               L ${pos.sx + size * 1.5} ${pos.sy}
               L ${pos.sx} ${pos.sy + size}
               L ${pos.sx - size * 1.5} ${pos.sy} Z`;
    diamond.setAttribute('d', d);
    diamond.setAttribute('fill', 'rgba(139, 115, 85, 0.1)');
    diamond.setAttribute('stroke', '#8B7355');
    diamond.setAttribute('stroke-width', '1.5');
    diamond.style.pointerEvents = 'none';
    diamond.classList.add('sourcing-tile-highlight');
    markersGroup.appendChild(diamond);
  }
}

// Show waste selection HUD
function showWasteHUD() {
  const hud = $('sourcing-hud');
  if (!hud) return;

  const matReq = FormGenerator.calculateMaterialRequirements();
  const needed = matReq.excavation || 0;
  const deposited = SOURCING.wasteDeposited || 0;

  // Update HUD content
  $('sourcing-hud-material').textContent = 'EXCAVATION WASTE';
  updateWasteHUDProgress();

  // Show HUD
  hud.classList.add('visible');

  // Wire up buttons
  $('sourcing-hud-cancel').onclick = () => {
    exitWasteSourcingMode();
  };

  $('sourcing-hud-done').onclick = () => {
    exitWasteSourcingMode();
  };
}

// Update waste HUD progress
function updateWasteHUDProgress() {
  const fill = $('sourcing-hud-fill');
  const amount = $('sourcing-hud-amount');
  const hint = $('sourcing-hud-hint');
  const doneBtn = $('sourcing-hud-done');

  if (!fill || !amount) return;

  const matReq = FormGenerator.calculateMaterialRequirements();
  const needed = matReq.excavation || 0;
  const deposited = SOURCING.wasteDeposited || 0;

  const pct = needed > 0 ? Math.min(100, (deposited / needed) * 100) : 0;
  fill.style.width = `${pct}%`;
  fill.style.background = '#8B7355'; // Earthy brown for waste
  amount.textContent = `${deposited.toLocaleString()} / ${needed.toLocaleString()} cu ft`;

  const satisfied = deposited >= needed;
  if (hint) {
    hint.textContent = satisfied ? 'All waste deposited' : 'Click tiles to deposit excavated soil';
  }
  if (doneBtn) {
    doneBtn.disabled = !satisfied;
    doneBtn.textContent = satisfied ? 'DONE' : 'SELECT MORE';
  }
}

// Show the floating sourcing HUD
function showSourcingHUD(material, rawMaterial) {
  const hud = $('sourcing-hud');
  if (!hud) return;

  // Get material config for display
  const materialConfig = {
    timber: { label: 'TIMBER', unit: 'bd ft' },
    stone: { label: 'STONE', unit: 'cu ft' },
    sand: { label: 'SAND', unit: 'cu ft' },
    clay: { label: 'CLAY', unit: 'cu ft' },
    glass: { label: 'GLASS', unit: 'cu ft' },
    concrete: { label: 'CONCRETE', unit: 'cu ft' },
    brick: { label: 'BRICK', unit: 'cu ft' }
  };

  const config = materialConfig[material] || { label: material.toUpperCase(), unit: 'units' };
  const needed = SOURCING.needed[material] || 0;
  const sourced = SOURCING.sourced[material] || 0;

  // Update HUD content
  $('sourcing-hud-material').textContent = config.label;
  updateSourcingHUDProgress(sourced, needed, config.unit);

  // Show HUD
  hud.classList.add('visible');

  // Wire up buttons
  $('sourcing-hud-cancel').onclick = () => {
    exitSourcingMode();
  };

  $('sourcing-hud-done').onclick = () => {
    exitSourcingMode();
  };
}

// Update the HUD progress bar and amount
function updateSourcingHUDProgress(sourced, needed, unit) {
  const fill = $('sourcing-hud-fill');
  const amount = $('sourcing-hud-amount');
  const hint = $('sourcing-hud-hint');
  const doneBtn = $('sourcing-hud-done');

  if (!fill || !amount) return;

  const pct = needed > 0 ? Math.min(100, (sourced / needed) * 100) : 0;
  fill.style.width = `${pct}%`;

  // Format numbers
  const formatNum = n => n >= 1000 ? `${(n/1000).toFixed(1)}k` : n.toLocaleString();
  amount.textContent = `${formatNum(sourced)} / ${formatNum(needed)} ${unit}`;

  // Update fill color and hint based on completion
  if (pct >= 100) {
    fill.classList.add('complete');
    if (hint) hint.textContent = 'Material fully sourced! Click DONE to continue.';
    if (doneBtn) doneBtn.disabled = false;
  } else {
    fill.classList.remove('complete');
    if (hint) hint.textContent = 'Click highlighted tiles to draw materials';
    if (doneBtn) doneBtn.disabled = false; // Allow partial sourcing
  }
}

// Hide the floating sourcing HUD
function hideSourcingHUD() {
  const hud = $('sourcing-hud');
  if (hud) {
    hud.classList.remove('visible');
  }
}

// Handle tile click during sourcing mode
export function handleSourcingTileClick(tile) {
  // Handle waste dumping mode
  if (SOURCING.selectingWaste) {
    if (SOURCING.onTileClick) {
      SOURCING.onTileClick(tile);
      return true;
    }
    return false;
  }

  // Handle step-by-step sourcing mode
  if (SOURCING.materialSteps && SOURCING.materialSteps.length > 0) {
    return handleStepSourcingTileClick(tile);
  }

  if (!SOURCING.active || !SOURCING.currentMaterial) return false;

  const rawMaterial = getRawMaterialFor(SOURCING.currentMaterial);
  const biome = MATERIAL_BIOMES[rawMaterial];

  // Check if this tile is eligible
  if (tile.biome !== biome) {
    return false; // Wrong biome
  }

  const state = BUILD.globalState;
  const remaining = tileRemainingYield(state, tile, rawMaterial);
  if (remaining <= 0) {
    return false; // Depleted
  }

  // Calculate how much we still need
  const needed = SOURCING.needed[SOURCING.currentMaterial] || 0;
  const sourced = SOURCING.sourced[SOURCING.currentMaterial] || 0;
  const stillNeeded = needed - sourced;

  if (stillNeeded <= 0) {
    exitSourcingMode();
    return true;
  }

  // Take as much as we need (or as much as tile has)
  const takeAmount = Math.min(stillNeeded, remaining);

  // Add draw
  SOURCING.draws.push({
    tile: { gx: tile.gx, gy: tile.gy, biome: tile.biome },
    material: SOURCING.currentMaterial,
    rawMaterial: rawMaterial,
    amount: takeAmount
  });

  // Update sourced total
  SOURCING.sourced[SOURCING.currentMaterial] = (SOURCING.sourced[SOURCING.currentMaterial] || 0) + takeAmount;

  // Update HUD progress
  const materialConfig = {
    timber: { unit: 'bd ft' },
    stone: { unit: 'cu ft' },
    sand: { unit: 'cu ft' },
    clay: { unit: 'cu ft' },
    glass: { unit: 'cu ft' },
    concrete: { unit: 'cu ft' },
    brick: { unit: 'cu ft' }
  };
  const config = materialConfig[SOURCING.currentMaterial] || { unit: 'units' };
  updateSourcingHUDProgress(SOURCING.sourced[SOURCING.currentMaterial], needed, config.unit);

  // Check if we're done with this material - auto-exit if fully sourced
  if (SOURCING.sourced[SOURCING.currentMaterial] >= needed) {
    // Material fully sourced - exit after a brief delay to show completion
    setTimeout(() => {
      exitSourcingMode();
    }, 500);
  } else {
    // Update highlights (tile may now be depleted)
    highlightSourcingTiles(SOURCING.highlightedTiles.map(h => {
      // Recalculate remaining for each tile
      const t = state.island.tiles.find(t => t.gx === h.tile.gx && t.gy === h.tile.gy);
      return { tile: h.tile, remaining: t ? tileRemainingYield(state, t, rawMaterial) : 0 };
    }).filter(h => h.remaining > 0), rawMaterial);
  }

  // Update display (for when we return to panel)
  updateSourcingDisplay();

  return true;
}

// Remove a source draw
function removeSourceDraw(index) {
  if (index < 0 || index >= SOURCING.draws.length) return;

  const draw = SOURCING.draws[index];
  SOURCING.sourced[draw.material] = (SOURCING.sourced[draw.material] || 0) - draw.amount;
  if (SOURCING.sourced[draw.material] < 0) SOURCING.sourced[draw.material] = 0;

  SOURCING.draws.splice(index, 1);

  updateSourcingDisplay();
  clearSourcingHighlights();
}

// Get raw material name for a processed material
function getRawMaterialFor(material) {
  const map = {
    timber: 'timber',
    stone: 'stone',
    glass: 'sand',
    concrete: 'stone',
    brick: 'clay'
  };
  return map[material] || material;
}

// Highlight eligible tiles on the map
function highlightSourcingTiles(eligibleTiles, rawMaterial) {
  const markersGroup = document.getElementById('sourcing-threads');
  if (!markersGroup) return;

  markersGroup.innerHTML = '';

  // Calculate how much has been drawn from each tile in this session
  const drawnFromTile = {};
  for (const draw of SOURCING.draws) {
    const key = `${draw.tile.gx},${draw.tile.gy}`;
    drawnFromTile[key] = (drawnFromTile[key] || 0) + draw.amount;
  }

  for (const { tile, remaining } of eligibleTiles) {
    const pos = gridToScreen(tile.gx, tile.gy, BUILD.globalState?.viewMode || 'iso');
    const key = `${tile.gx},${tile.gy}`;
    const drawnAmount = drawnFromTile[key] || 0;
    const effectiveRemaining = remaining - drawnAmount;
    const maxYield = TILE_YIELDS[rawMaterial] || 10000;
    const depletionPct = 1 - (effectiveRemaining / maxYield);

    // Determine visual state - clean, minimal design
    let strokeColor, fillOpacity, isDepleted = false;
    if (effectiveRemaining <= 0) {
      strokeColor = '#888';
      fillOpacity = 0.3;
      isDepleted = true;
    } else if (depletionPct > 0.7) {
      strokeColor = '#C4836A'; // Warm warning
      fillOpacity = 0.15;
    } else if (drawnAmount > 0) {
      strokeColor = '#B89A5A'; // Gold - already used
      fillOpacity = 0.12;
    } else {
      strokeColor = '#E8E4DE'; // Light - available
      fillOpacity = 0.08;
    }

    // Create a subtle diamond outline (matches isometric tile shape)
    const size = 24;
    const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = `M ${pos.sx} ${pos.sy - size}
               L ${pos.sx + size * 1.5} ${pos.sy}
               L ${pos.sx} ${pos.sy + size}
               L ${pos.sx - size * 1.5} ${pos.sy} Z`;
    diamond.setAttribute('d', d);
    diamond.setAttribute('fill', isDepleted ? 'rgba(100,100,100,0.2)' : `rgba(255,255,255,${fillOpacity})`);
    diamond.setAttribute('stroke', strokeColor);
    diamond.setAttribute('stroke-width', isDepleted ? '1' : '1.5');
    diamond.style.pointerEvents = 'none';
    if (!isDepleted) {
      diamond.classList.add('sourcing-tile-highlight');
    }
    markersGroup.appendChild(diamond);

    // Small label showing remaining - clean typography
    if (!isDepleted) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', pos.sx);
      text.setAttribute('y', pos.sy + 3);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '9');
      text.setAttribute('font-weight', '500');
      text.setAttribute('fill', strokeColor);
      text.setAttribute('font-family', 'Spline Sans Mono, monospace');
      text.setAttribute('letter-spacing', '0.5');
      text.style.pointerEvents = 'none';

      if (effectiveRemaining >= 1000) {
        text.textContent = `${Math.round(effectiveRemaining/1000)}k`;
      } else {
        text.textContent = Math.round(effectiveRemaining);
      }
      markersGroup.appendChild(text);
    }
  }

  showTileDepletionOverlays();
}

// Clear sourcing highlights
function clearSourcingHighlights() {
  const markersGroup = document.getElementById('sourcing-threads');
  if (markersGroup) {
    markersGroup.innerHTML = '';
  }
  // Also clear tile depletion overlays
  clearTileDepletionOverlays();
}

// Show depletion overlays on tiles that have been drawn from
function showTileDepletionOverlays() {
  const state = BUILD.globalState;
  if (!state) return;

  // Clear existing overlays first
  clearTileDepletionOverlays();

  // Group draws by tile
  const drawsByTile = {};
  for (const draw of SOURCING.draws) {
    const key = `${draw.tile.gx},${draw.tile.gy}`;
    if (!drawsByTile[key]) {
      drawsByTile[key] = { tile: draw.tile, total: 0, material: draw.rawMaterial || draw.material };
    }
    drawsByTile[key].total += draw.amount;
  }

  // Check if any tile is now depleted and apply visual feedback
  for (const [key, data] of Object.entries(drawsByTile)) {
    const tile = state.island.tiles.find(t => t.gx === data.tile.gx && t.gy === data.tile.gy);
    if (!tile) continue;

    const maxYield = TILE_YIELDS[data.material] || 10000;
    const originalRemaining = tileRemainingYield(state, tile, data.material);
    const effectiveRemaining = originalRemaining - data.total;
    const depletionPct = 1 - (effectiveRemaining / maxYield);

    // Find the tile element and add depletion class/style
    const tileEl = document.querySelector(`g.tile[data-gx="${tile.gx}"][data-gy="${tile.gy}"]`);
    if (tileEl) {
      if (effectiveRemaining <= 0) {
        tileEl.classList.add('tile-depleted');
      } else if (depletionPct > 0.5) {
        tileEl.classList.add('tile-low-resources');
      }
    }
  }
}

// Clear tile depletion overlays
function clearTileDepletionOverlays() {
  document.querySelectorAll('.tile-depleted, .tile-low-resources').forEach(el => {
    el.classList.remove('tile-depleted', 'tile-low-resources');
  });
}

// Reset sourcing state (called when closing design screen or committing)
function resetSourcingState() {
  SOURCING.active = false;
  SOURCING.currentMaterial = null;
  SOURCING.currentRawMaterial = null;
  SOURCING.needed = {};
  SOURCING.sourced = {};
  SOURCING.draws = [];
  SOURCING.highlightedTiles = [];
  SOURCING.selectingWaste = false;
  SOURCING.wasteDeposited = 0;
  SOURCING.wasteDeposits = [];
  SOURCING.onTileClick = null;
  clearSourcingHighlights();
  hideSourcingHUD();
}

// Calculate available materials from island tiles
function calculateAvailableMaterials(tiles, state) {
  const available = {
    timber: 0,
    stone: 0,
    sand: 0,
    clay: 0,
    thatch: 0,
    water: 0,
    // Processed materials calculated from raw
    glass: 0,
    concrete: 0,
    brick: 0,
    // Imported
    steel: 500 // Weekly shipment cap
  };

  if (!tiles || !state) return available;

  // Sum up raw materials from tiles by biome
  for (const tile of tiles) {
    if (!tile.biome) continue;

    // Get remaining yield after extractions
    const remaining = (mat) => tileRemainingYield(state, tile, mat);

    if (tile.biome === 'forest') {
      available.timber += remaining('timber');
    } else if (tile.biome === 'mountain') {
      available.stone += remaining('stone');
    } else if (tile.biome === 'beach') {
      available.sand += remaining('sand');
    } else if (tile.biome === 'lowlands') {
      available.clay += remaining('clay');
      available.thatch += remaining('thatch');
    } else if (tile.biome === 'water') {
      available.water += remaining('water');
    }
  }

  // Calculate processed materials from raw
  // Glass: 0.5 cu ft sand per sq ft glass
  available.glass = Math.floor(available.sand / 0.5);
  // Concrete: 0.4 sand + 0.3 stone + 2 water per cu ft
  const concreteBySand = Math.floor(available.sand / 0.4);
  const concreteByStone = Math.floor(available.stone / 0.3);
  const concreteByWater = Math.floor(available.water / 2);
  available.concrete = Math.min(concreteBySand, concreteByStone, concreteByWater);
  // Brick: 0.05 cu ft clay per brick
  available.brick = Math.floor(available.clay / 0.05);

  return available;
}

// Auto-source all materials at once
function autoSourceAllMaterials() {
  const state = BUILD.globalState;
  if (!state) return false;

  const matReq = FormGenerator.calculateMaterialRequirements();
  if (!matReq) return false;

  const tiles = state.island.tiles;

  // Material to biome and raw material mapping
  const materialInfo = {
    timber: { biome: 'forest', rawMat: 'timber' },
    stone: { biome: 'mountain', rawMat: 'stone' },
    glass: { biome: 'beach', rawMat: 'sand' },
    concrete: { biome: 'mountain', rawMat: 'stone' },
    brick: { biome: 'lowlands', rawMat: 'clay' }
  };

  // Clear existing draws
  SOURCING.draws = [];
  SOURCING.sourced = {};

  // For each material needed, find tiles to source from
  for (const [mat, needed] of Object.entries(matReq.totals)) {
    if (needed <= 0) continue;
    if (mat === 'steel') continue; // Steel is imported

    const info = materialInfo[mat];
    if (!info) continue;

    let remaining = needed;
    const eligibleTiles = tiles
      .filter(t => t.biome === info.biome)
      .map(t => ({
        tile: t,
        available: tileRemainingYield(state, t, info.rawMat)
      }))
      .filter(t => t.available > 0)
      .sort((a, b) => b.available - a.available); // Most available first

    for (const { tile, available } of eligibleTiles) {
      if (remaining <= 0) break;

      // Check how much we've already drawn from this tile in this session
      const key = `${tile.gx},${tile.gy}`;
      const alreadyDrawn = SOURCING.draws
        .filter(d => d.tile.gx === tile.gx && d.tile.gy === tile.gy)
        .reduce((sum, d) => sum + d.amount, 0);

      const canTake = Math.max(0, available - alreadyDrawn);
      const takeAmount = Math.min(remaining, canTake);

      if (takeAmount > 0) {
        SOURCING.draws.push({
          tile: { gx: tile.gx, gy: tile.gy, biome: tile.biome },
          material: mat,
          rawMaterial: info.rawMat,
          amount: takeAmount
        });
        SOURCING.sourced[mat] = (SOURCING.sourced[mat] || 0) + takeAmount;
        remaining -= takeAmount;
      }
    }
  }

  // Auto-assign waste deposit (pick first suitable land tile)
  const excavation = matReq.excavation || 0;
  if (excavation > 0) {
    const wasteTile = tiles.find(t => t.biome !== 'ocean' && t.biome !== 'water');
    if (wasteTile) {
      SOURCING.wasteDeposited = excavation;
      SOURCING.wasteDeposits = [{
        tile: { gx: wasteTile.gx, gy: wasteTile.gy, biome: wasteTile.biome },
        amount: excavation
      }];
    }
  }

  updateSourcingDisplay();
  return true;
}

// Show sourcing map with all auto-assigned sources
function showSourcingMap() {
  const state = BUILD.globalState;
  if (!state) return;

  // Hide design screen
  const designScreen = $('design-screen');
  if (designScreen) {
    designScreen.style.display = 'none';
  }

  // Add body class
  document.body.classList.add('sourcing-active');

  // Hide tile selection panel
  document.getElementById('tile-selection-panel')?.classList.remove('visible');

  // Show the sourcing map HUD
  showSourcingMapHUD();

  // Highlight all source tiles
  highlightAllSourceTiles();
}

// Show unified sourcing map HUD
function showSourcingMapHUD() {
  const hud = $('sourcing-hud');
  if (!hud) return;

  const matReq = FormGenerator.calculateMaterialRequirements();

  // Build summary of what's sourced
  let summaryHtml = '';
  const materialLabels = {
    timber: 'Timber', stone: 'Stone', glass: 'Glass',
    concrete: 'Concrete', brick: 'Brick', steel: 'Steel'
  };

  for (const [mat, needed] of Object.entries(matReq.totals)) {
    if (needed <= 0) continue;
    const sourced = SOURCING.sourced[mat] || 0;
    const isSatisfied = mat === 'steel' || sourced >= needed;
    summaryHtml += `<span class="${isSatisfied ? 'satisfied' : ''}">${materialLabels[mat] || mat}</span> `;
  }

  // Update HUD content for map view
  $('sourcing-hud-material').textContent = 'MATERIAL SOURCES';
  $('sourcing-hud-amount').innerHTML = summaryHtml || 'All materials assigned';
  $('sourcing-hud-hint').textContent = 'Review source locations';

  const fill = $('sourcing-hud-fill');
  if (fill) fill.style.width = '100%';

  const doneBtn = $('sourcing-hud-done');
  if (doneBtn) {
    doneBtn.disabled = false;
    doneBtn.textContent = 'DONE';
  }

  // Show HUD
  hud.classList.add('visible');

  // Wire up buttons
  $('sourcing-hud-cancel').onclick = () => exitSourcingMapView();
  $('sourcing-hud-done').onclick = () => exitSourcingMapView();
}

// Highlight all source tiles on the map
function highlightAllSourceTiles() {
  const markersGroup = document.getElementById('sourcing-threads');
  if (!markersGroup) return;

  markersGroup.innerHTML = '';
  const state = BUILD.globalState;
  if (!state) return;

  // Color by material type
  const matColors = {
    timber: '#4A7C59',
    stone: '#8B8B8B',
    glass: '#87CEEB',
    concrete: '#A9A9A9',
    brick: '#CD5C5C',
    waste: '#8B7355'
  };

  // Group draws by tile
  const tileDraws = {};
  for (const draw of SOURCING.draws) {
    const key = `${draw.tile.gx},${draw.tile.gy}`;
    if (!tileDraws[key]) tileDraws[key] = { tile: draw.tile, materials: [] };
    tileDraws[key].materials.push({ mat: draw.material, amount: draw.amount });
  }

  // Add waste deposits
  for (const deposit of (SOURCING.wasteDeposits || [])) {
    const key = `${deposit.tile.gx},${deposit.tile.gy}`;
    if (!tileDraws[key]) tileDraws[key] = { tile: deposit.tile, materials: [] };
    tileDraws[key].materials.push({ mat: 'waste', amount: deposit.amount });
  }

  // Draw highlights for each source tile
  for (const { tile, materials } of Object.values(tileDraws)) {
    const pos = gridToScreen(tile.gx, tile.gy, state.viewMode || 'iso');
    const primaryMat = materials[0].mat;
    const color = matColors[primaryMat] || '#E8E4DE';

    // Diamond highlight
    const size = 24;
    const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = `M ${pos.sx} ${pos.sy - size}
               L ${pos.sx + size * 1.5} ${pos.sy}
               L ${pos.sx} ${pos.sy + size}
               L ${pos.sx - size * 1.5} ${pos.sy} Z`;
    diamond.setAttribute('d', d);
    diamond.setAttribute('fill', `${color}33`);
    diamond.setAttribute('stroke', color);
    diamond.setAttribute('stroke-width', '2');
    diamond.style.pointerEvents = 'none';
    markersGroup.appendChild(diamond);

    // Label
    const label = materials.map(m => m.mat.charAt(0).toUpperCase()).join('');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', pos.sx);
    text.setAttribute('y', pos.sy + 3);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '9');
    text.setAttribute('font-weight', '600');
    text.setAttribute('fill', color);
    text.setAttribute('font-family', 'Spline Sans Mono, monospace');
    text.textContent = label;
    text.style.pointerEvents = 'none';
    markersGroup.appendChild(text);
  }
}

// Exit sourcing map view
function exitSourcingMapView() {
  document.body.classList.remove('sourcing-active');
  hideSourcingHUD();
  clearSourcingHighlights();

  // Show design screen again
  const designScreen = $('design-screen');
  if (designScreen) {
    designScreen.style.display = '';
    setTimeout(() => {
      FormGenerator.refreshPreview();
    }, 50);
  }

  updateSourcingDisplay();
}

// Commit build from archetype result - direct commit with inline sourcing
async function commitFromArchetype() {
  const state = BUILD.globalState;
  if (!state) {
    showWarning('No state available');
    return;
  }

  // Check if there's an uncommitted building - add it to preview first
  if (FormGenerator.hasUncommittedBuilding()) {
    const result = FormGenerator.addBuildingToPreview();
    if (!result.success) {
      showWarning(result.reason);
      return;
    }
  }

  // Get all preview buildings
  const previewBuildings = FormGenerator.getPreviewBuildingsForCommit();
  if (previewBuildings.length === 0 && !DESIGN.generatedForm) {
    showWarning('No buildings to commit');
    return;
  }

  // Get material requirements and check availability
  const matReq = FormGenerator.calculateMaterialRequirements();
  const tiles = state.island?.tiles || [];
  const available = calculateAvailableMaterials(tiles, state);

  // Check if materials are sufficient
  let allSatisfied = true;
  for (const [mat, needed] of Object.entries(matReq.totals)) {
    if (needed > 0 && mat !== 'steel') { // Steel is imported, always available
      if ((available[mat] || 0) < needed) {
        allSatisfied = false;
        break;
      }
    }
  }

  if (!allSatisfied) {
    showWarning('Not enough materials available');
    return;
  }

  // Get the selected tile
  const buildTile = BUILD.selectedTiles[0];
  if (!buildTile) {
    showWarning('No tile selected');
    return;
  }

  const polygon = FormGenerator.getPolygon();

  // Combine all building stats
  const allBuildings = previewBuildings.length > 0
    ? previewBuildings
    : [{ stats: DESIGN.generatedForm, offset: { x: 0, z: 0 }, rotation: 0 }];

  const totalArea = allBuildings.reduce((sum, b) => sum + (b.stats?.grossArea || 0), 0);
  const maxFloors = Math.max(...allBuildings.map(b => b.stats?.floors || 1));
  const maxHeight = Math.max(...allBuildings.map(b => b.stats?.height || 20));

  // Create build draft
  const draft = createBuildDraft(state, {
    name: previewBuildings.length > 1
      ? `${previewBuildings.length} Buildings`
      : (DESIGN.archetypeResult?.name || 'Building'),
    tiles: BUILD.selectedTiles.map(t => ({ gx: t.gx, gy: t.gy })),
    primaryTile: { gx: buildTile.gx, gy: buildTile.gy },
    polygon: polygon,
    totalArea: totalArea,
    deathPlan: 'demolish-salvage'
  });

  // Calculate simplified sourcing - one tile per material with fractional depletion
  const depletionFraction = getBuildingDepletionFraction(DESIGN.generatedForm);
  const simplifiedDraws = autoSourceAllMaterialsSimplified(state, buildTile, DESIGN.generatedForm);

  // Store simplified draws on draft for build profile visualization
  draft.simplifiedDraws = simplifiedDraws;
  draft.depletionFraction = depletionFraction;

  // Apply depletion to source tiles
  applySimplifiedDraws(state, simplifiedDraws);

  // Create material draws for legacy system (convert simplified to detailed draws)
  let draws = [];

  if (SOURCING.draws.length > 0) {
    // User manually selected source tiles - use their selections
    draws = SOURCING.draws.map(d => {
      const sourceTile = tiles.find(t => t.gx === d.tile.gx && t.gy === d.tile.gy);
      return {
        fromTile: { gx: d.tile.gx, gy: d.tile.gy },
        material: d.material,
        rawMaterial: d.rawMaterial,
        amount: d.amount,
        distanceFt: sourceTile
          ? Math.sqrt(Math.pow((sourceTile.gx - buildTile.gx) * 130, 2) + Math.pow((sourceTile.gy - buildTile.gy) * 130, 2))
          : 0,
        fromSalvage: false
      };
    });
  } else {
    // Convert simplified draws to detailed draws (for legacy compatibility)
    for (const sd of simplifiedDraws) {
      const sourceTile = tiles.find(t => t.gx === sd.tile.gx && t.gy === sd.tile.gy);
      const needed = matReq.totals[sd.material] || 0;
      if (needed > 0) {
        draws.push({
          fromTile: { gx: sd.tile.gx, gy: sd.tile.gy },
          material: sd.material,
          amount: needed,
          distanceFt: sourceTile
            ? Math.sqrt(Math.pow((sourceTile.gx - buildTile.gx) * 130, 2) + Math.pow((sourceTile.gy - buildTile.gy) * 130, 2))
            : 0,
          fromSalvage: false,
          depletionFraction: sd.depletionFraction
        });
      }
    }
  }

  // Build sourcing object
  const sourcing = {
    draws: draws,
    wasteDestinations: [],
    deathPlan: 'demolish-salvage'
  };

  // Commit the build
  const build = commitBuild(state, draft, sourcing);

  // GET THE ACTUAL 3D MESHES AND ISO IMAGE BEFORE CLEARING
  // This is the key - we clone the detailed THREE.js geometry from the preview
  const meshesForWalk = FormGenerator.getPreviewMeshesForWalk();

  // Get the user-chosen building position offset (in feet)
  const userOffset = FormGenerator.getBuildingOffset();

  // Render an isometric image of the building for the ISO (birdseye) view
  const isoImageData = FormGenerator.renderPreviewToIsoImage(200, 300);

  // Mark tile as built with proper geometry for ISO and walk views
  buildTile.built = true;
  buildTile.buildId = build.id;

  buildTile.populated = {
    kind: 'ai',
    name: build.name,
    floors: maxFloors,
    height: maxHeight,
    condition: 1.0,
    progressFraction: 1.0, // Start at full for now
    visibleFloors: maxFloors,
    polygon: polygon,
    genes: DESIGN.archetypeResult?.genes || null,
    spec: {
      floors: maxFloors,
      floor_height_ft: maxHeight / maxFloors,
      primary_material: DESIGN.archetypeResult?.archetypeDefinition?.materials?.primary || 'concrete'
    },
    // Store the actual THREE.js mesh groups for walk mode
    // These are cloned from the preview so they have all the detail
    walkMeshes: meshesForWalk,
    // Store the isometric image for ISO (birdseye) view
    // This is a rendered image of the 3D building from an isometric angle
    isoImage: isoImageData,
    // Store position offset (in feet) for ISO view positioning - use user's chosen position
    offset: { x: userOffset.x, z: userOffset.z },
    // Store archetype for reference
    archetypeResult: DESIGN.archetypeResult,
    // Simplified sourcing draws for build profile visualization
    simplifiedDraws: simplifiedDraws,
    depletionFraction: depletionFraction
  };

  // Trigger ISO view refresh
  if (typeof window.refreshIsoBuildings === 'function') {
    window.refreshIsoBuildings();
  }

  // Trigger walk mode building creation (will be picked up on next walk view)
  if (typeof window.markWalkBuildingsStale === 'function') {
    window.markWalkBuildingsStale();
  }

  // Close design screen
  closeDesignScreen();

  // Clear build state
  BUILD.selectedTiles = [];
  BUILD.selectedTile = null;
  BUILD.currentDraft = null;
  BUILD.aiResult = null;
  DESIGN.generatedForm = null;
  DESIGN.archetypeResult = null;

  // Reset sourcing state
  resetSourcingState();

  // Clear FormGenerator preview
  FormGenerator.clearPreview();

  // Clear tile selection visuals
  clearTileSelection();

  // Show success
  showBuildCommit(build.name);

  console.log('Build committed:', build.name, 'on tile', buildTile.gx, buildTile.gy);

  return build;
}

// Go to a specific step
function goToStep(stepNum) {
  // Update step navigation
  document.querySelectorAll('.ds-step').forEach(s => {
    const num = parseInt(s.dataset.step);
    s.classList.remove('active', 'completed');
    if (num === stepNum) s.classList.add('active');
    else if (num < stepNum) s.classList.add('completed');
  });

  // Update content
  document.querySelectorAll('.ds-step-content').forEach(c => {
    c.classList.remove('active');
  });
  $(`ds-step-${stepNum}`)?.classList.add('active');

  DESIGN.currentStep = Math.max(DESIGN.currentStep, stepNum);
  updateStepUI(stepNum);
}

// Update UI for current step
function updateStepUI(stepNum) {
  switch (stepNum) {
    case 1: initSiteStep(); break;
    case 2: initStructureStep(); break;
    case 3: initMassingStep(); break;
    case 4: initEnvelopeStep(); break;
    case 5: initCommitStep(); break;
  }
}

// Update 3D preview with current design state
function updateFormPreview() {
  // Map structure to material (default)
  const structureMaterials = {
    'mass-timber': 'timber',
    'load-bearing': 'brick',
    'concrete-frame': 'concrete',
    'steel-frame': 'steel'
  };

  // Map cladding to material (overrides structure default)
  const claddingToMaterial = {
    'timber-panel': 'timber', 'cedar-shingle': 'wood', 'charred-wood': 'wood',
    'exposed-brick': 'brick', 'stone-face': 'stone', 'stucco': 'concrete',
    'board-formed': 'concrete', 'smooth-concrete': 'concrete', 'precast-panel': 'concrete',
    'metal-panel': 'steel', 'glass-curtain': 'glass', 'zinc-clad': 'steel'
  };

  // Use cladding-based material if cladding is set, otherwise use structure default
  const material = DESIGN.cladding
    ? (claddingToMaterial[DESIGN.cladding] || structureMaterials[DESIGN.structure] || 'timber')
    : (structureMaterials[DESIGN.structure] || 'timber');

  // Map massing types to generator types
  const massingMap = {
    'bar': 'bar',
    'tower': 'stepped',
    'courtyard': 'courtyard'
  };

  // Determine if building is raised (on pilotis)
  const isRaised = DESIGN.padElevation === 'stilts' || DESIGN.padElevation === 'raised';

  // Update params
  FormGenerator.updateParams({
    floors: DESIGN.floors,
    material: material,
    massing: massingMap[DESIGN.massing] || 'bar',
    roof: DESIGN.roof,
    raised: isRaised,
    voidPercent: DESIGN.articulation === 'none' ? 0 :
                 DESIGN.articulation === 'lightwell' ? 15 : 25
  });

  // Generate form
  const stats = FormGenerator.generateForm();

  if (stats) {
    DESIGN.generatedForm = stats;

    // Update stats display
    const areaEl = $('ds-stat-area');
    const floorsEl = $('ds-stat-floors');
    const heightEl = $('ds-stat-height');

    if (areaEl) areaEl.textContent = stats.grossArea?.toLocaleString() || '—';
    if (floorsEl) floorsEl.textContent = stats.floors || '—';
    if (heightEl) heightEl.textContent = stats.height || '—';
  }
}

// ─── STEP 1: SITE ───────────────────────────────────────────────────
function initSiteStep() {
  const tiles = BUILD.selectedTiles;
  if (tiles.length === 0) return;

  // Update site info
  const tile = tiles[0];
  $('ds-site-tiles')&&($('ds-site-tiles').textContent = `${tiles.length} TILE${tiles.length > 1 ? 'S' : ''}`);
  $('ds-site-biome')&&($('ds-site-biome').textContent = tile.biome?.toUpperCase() || '—');
  $('ds-site-elev')&&($('ds-site-elev').textContent = `LEVEL ${tile.elev || 0}`);
  $('ds-site-area')&&($('ds-site-area').textContent = `${(tiles.length * 1600).toLocaleString()} SQ FT`);

  // Populate program grid based on tile count
  initProgramGrid();

  // Pad elevation options
  document.querySelectorAll('[data-pad]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.pad === DESIGN.padElevation);
    btn.onclick = () => {
      DESIGN.padElevation = btn.dataset.pad;
      document.querySelectorAll('[data-pad]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      FormGenerator.updateParams({ raised: btn.dataset.pad === 'stilts' });
      updateFormPreview();
    };
  });

  // Compute polygon from tiles (new system - replaces custom footprint editing)
  const polygon = FormGenerator.computePolygonFromTiles();
  if (polygon) {
    // Display polygon info instead of footprint editor
    displayPolygonInfo(polygon);
  }

  // Initialize AI design generation button
  initAIDesignButton();

  // Next button
  const nextBtn = $('ds-next-1');
  if (nextBtn) {
    nextBtn.onclick = () => goToStep(2);
  }
}

// ─── PROGRAM GRID ───────────────────────────────────────────────────
function initProgramGrid() {
  const gridContainer = $('ds-program-grid');
  if (!gridContainer) return;

  // Get available programs for current tile count
  const programs = FormGenerator.getAvailablePrograms();

  // Clear existing
  gridContainer.innerHTML = '';

  // Create program buttons
  programs.forEach((program, idx) => {
    const btn = document.createElement('button');
    btn.className = 'ds-program-btn';
    btn.dataset.program = program.id;

    // Select first program by default
    if (idx === 0) {
      btn.classList.add('selected');
      FormGenerator.setProgram(program.id);
      updateFloorsSliderForProgram(program);
    }

    btn.innerHTML = `
      <span class="ds-program-icon">${program.icon}</span>
      <span class="ds-program-name">${program.name}</span>
      <span class="ds-program-desc">${program.desc}</span>
    `;

    btn.onclick = () => {
      // Update selection
      document.querySelectorAll('.ds-program-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');

      // Set program in FormGenerator
      FormGenerator.setProgram(program.id);

      // Update floors slider range
      updateFloorsSliderForProgram(program);

      // Update preview
      updateFormPreview();
    };

    gridContainer.appendChild(btn);
  });
}

function updateFloorsSliderForProgram(program) {
  const floorsSlider = $('ds-floors');
  const floorsVal = $('ds-floors-val');

  if (!floorsSlider || !program.floors) return;

  const [minFloors, maxFloors] = program.floors;
  floorsSlider.min = minFloors;
  floorsSlider.max = maxFloors;

  // Clamp current value to new range
  let currentFloors = parseInt(floorsSlider.value) || minFloors;
  currentFloors = Math.max(minFloors, Math.min(maxFloors, currentFloors));

  floorsSlider.value = currentFloors;
  if (floorsVal) floorsVal.textContent = currentFloors;

  DESIGN.floors = currentFloors;
  FormGenerator.updateParams({ floors: currentFloors });
}

// ─── POLYGON DISPLAY (replaces footprint editor) ──────────────────
function displayPolygonInfo(polygon) {
  const gridContainer = $('ds-footprint-grid');
  if (!gridContainer) return;

  // Clear existing content
  gridContainer.innerHTML = '';

  // Create SVG visualization of polygon shape
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-100 -100 200 200');
  svg.style.width = '100%';
  svg.style.height = '100%';

  if (polygon && polygon.vertices.length > 0) {
    // Normalize vertices to fit in viewBox
    const scale = 150 / Math.max(polygon.bounds.width, polygon.bounds.height);
    const pathData = polygon.vertices.map((v, i) => {
      const x = v.x * scale;
      const y = v.y * scale;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ') + ' Z';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', 'rgba(90, 154, 184, 0.3)');
    path.setAttribute('stroke', 'var(--accent)');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);

    // Add shape type label
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', '0');
    label.setAttribute('y', '85');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', '#666');
    label.setAttribute('font-size', '12');
    label.textContent = polygon.shapeType.toUpperCase();
    svg.appendChild(label);
  }

  gridContainer.appendChild(svg);

  // Update stats display
  const cellsEl = $('ds-fp-cells');
  const sqftEl = $('ds-fp-sqft');

  if (cellsEl) cellsEl.textContent = polygon?.tileCount || 0;
  if (sqftEl) sqftEl.textContent = Math.round(polygon?.area || 0).toLocaleString();
}

// ─── AI DESIGN GENERATION ──────────────────────────────────────────
function initAIDesignButton() {
  // Look for existing AI generate button or create one
  const generateBtn = $('ds-ai-generate') || $('ds-generate-design');
  if (generateBtn) {
    generateBtn.onclick = async () => {
      await generateAIDesign();
    };
  }
}

async function generateAIDesign() {
  const promptInput = $('ds-ai-prompt') || $('ds-design-prompt');
  const prompt = promptInput?.value?.trim() || 'A building appropriate for this site';

  const polygon = FormGenerator.getPolygon();
  const tiles = BUILD.selectedTiles;

  if (!polygon || tiles.length === 0) {
    showWarning('No tiles selected');
    return;
  }

  // Show loading state
  const generateBtn = $('ds-ai-generate') || $('ds-generate-design');
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.textContent = 'GENERATING...';
  }

  try {
    // NEW: Use archetype-based generation
    const archetypeResult = await generateFromPrompt(prompt, polygon, tiles);

    // Store archetype result
    FormGenerator.setArchetypeResult(archetypeResult);
    DESIGN.archetypeResult = archetypeResult;

    // Generate building from archetype
    const stats = FormGenerator.generateFromArchetype(archetypeResult, polygon);

    if (stats) {
      DESIGN.generatedForm = stats;

      // Update stats display
      const areaEl = $('ds-stat-area');
      const floorsEl = $('ds-stat-floors');
      const heightEl = $('ds-stat-height');

      if (areaEl) areaEl.textContent = stats.grossArea?.toLocaleString() || '—';
      if (floorsEl) floorsEl.textContent = stats.floors || '—';
      if (heightEl) heightEl.textContent = stats.height || '—';

      // Display archetype info
      displayArchetypeInfo(archetypeResult);

      // Update archetype badge to show actual typology (for towers)
      if (stats.typology) {
        const archetypeEl = $('ds-archetype');
        if (archetypeEl) archetypeEl.textContent = stats.typology.toUpperCase();
      }

      // Update the buildings list to show the generated building
      updateBuildingsList();

      // Refresh scale figures to avoid the new building
      FormGenerator.refreshScaleFigures();
    }

    showSuccess(`Generated: ${archetypeResult.name}`);

    // Track AI token usage in meta banner (~2-5k tokens per generation)
    if (window.metaBanner) {
      const estimatedTokens = 2000 + Math.floor(Math.random() * 3000);
      window.metaBanner.addTokens(estimatedTokens);
    }
  } catch (err) {
    console.error('AI generation error:', err);
    showWarning('Generation failed: ' + err.message);
  } finally {
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = 'GENERATE DESIGN';
    }
  }
}

function displayGeneInfo(genes) {
  // Update any UI elements showing gene information
  const nameEl = $('ds-design-name');
  const descEl = $('ds-design-desc');
  const intentEl = $('ds-designer-intent');
  const critiqueEl = $('ds-value-critique');

  if (nameEl) nameEl.textContent = genes.name || '';
  if (descEl) descEl.textContent = genes.description || '';
  if (intentEl) intentEl.textContent = genes.designer_intent || '';
  if (critiqueEl) critiqueEl.textContent = genes.value_system_critique || '';
}

function displayArchetypeInfo(result) {
  // Update UI elements with archetype result
  const nameEl = $('ds-design-name');
  const descEl = $('ds-design-desc');
  const intentEl = $('ds-designer-intent');
  const critiqueEl = $('ds-value-critique');
  const archetypeEl = $('ds-archetype');

  if (nameEl) nameEl.textContent = result.name || '';
  if (descEl) descEl.textContent = result.description || '';
  if (intentEl) intentEl.textContent = `"${result.designer_intent || ''}"`;
  if (critiqueEl) critiqueEl.textContent = `"${result.value_system_critique || ''}"`;
  if (archetypeEl) archetypeEl.textContent = (result.archetypeDefinition?.name || result.archetype || '').toUpperCase();

  // Show result section, hide prompt section
  const promptSection = $('ds-prompt-section');
  const resultSection = $('ds-result-section');
  if (promptSection) promptSection.style.display = 'none';
  if (resultSection) resultSection.style.display = 'block';

  // Show position controls overlay
  const posControls = $('ds-preview-position');
  if (posControls) posControls.style.display = 'flex';

  // Update collision warning
  updateCollisionWarning();

  // Update material sourcing display
  updateSourcingDisplay();
}

// Legacy functions kept for backwards compatibility
function refreshFootprintGrid() {
  const polygon = FormGenerator.getPolygon();
  if (polygon) {
    displayPolygonInfo(polygon);
  }
}

function updateFootprintStats() {
  const polygon = FormGenerator.getPolygon();
  if (polygon) {
    const cellsEl = $('ds-fp-cells');
    const sqftEl = $('ds-fp-sqft');
    if (cellsEl) cellsEl.textContent = polygon.tileCount || 0;
    if (sqftEl) sqftEl.textContent = Math.round(polygon.area || 0).toLocaleString();
  }
}

// ─── STEP 2: STRUCTURE ──────────────────────────────────────────────
function initStructureStep() {
  document.querySelectorAll('.ds-structure-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.structure === DESIGN.structure);
    btn.onclick = () => {
      DESIGN.structure = btn.dataset.structure;
      document.querySelectorAll('.ds-structure-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updateFormPreview();
    };
  });

  const nextBtn = $('ds-next-2');
  if (nextBtn) {
    nextBtn.onclick = () => goToStep(3);
  }
}

// ─── STEP 3: MASSING ────────────────────────────────────────────────
function initMassingStep() {
  // Floors slider
  const floorsSlider = $('ds-floors');
  const floorsVal = $('ds-floors-val');
  if (floorsSlider) {
    floorsSlider.value = DESIGN.floors;
    if (floorsVal) floorsVal.textContent = DESIGN.floors;
    floorsSlider.oninput = () => {
      DESIGN.floors = parseInt(floorsSlider.value);
      if (floorsVal) floorsVal.textContent = DESIGN.floors;
      FormGenerator.updateParams({ floors: DESIGN.floors });
      updateFormPreview();
    };
  }

  // Massing options
  document.querySelectorAll('[data-massing]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.massing === DESIGN.massing);
    btn.onclick = () => {
      DESIGN.massing = btn.dataset.massing;
      document.querySelectorAll('[data-massing]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updateFormPreview();
    };
  });

  // Articulation options
  document.querySelectorAll('[data-void]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.void === DESIGN.articulation);
    btn.onclick = () => {
      DESIGN.articulation = btn.dataset.void;
      document.querySelectorAll('[data-void]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updateFormPreview();
    };
  });

  // Roof options
  document.querySelectorAll('[data-roof]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.roof === DESIGN.roof);
    btn.onclick = () => {
      DESIGN.roof = btn.dataset.roof;
      document.querySelectorAll('[data-roof]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updateFormPreview();
    };
  });

  const nextBtn = $('ds-next-3');
  if (nextBtn) {
    nextBtn.onclick = () => goToStep(4);
  }
}

// ─── STEP 4: ENVELOPE ───────────────────────────────────────────────
function initEnvelopeStep() {
  // Populate cladding options based on structure
  const claddingContainer = $('ds-cladding-options');
  const claddingHint = $('ds-cladding-hint');

  const claddingByStructure = {
    'mass-timber': [
      { id: 'timber-panel', name: 'TIMBER PANEL', color: '#A89078' },
      { id: 'cedar-shingle', name: 'CEDAR SHINGLE', color: '#8B7355' },
      { id: 'charred-wood', name: 'CHARRED WOOD', color: '#3A3A3A' }
    ],
    'load-bearing': [
      { id: 'exposed-brick', name: 'EXPOSED BRICK', color: '#B87D6D' },
      { id: 'stone-face', name: 'STONE FACE', color: '#9AAAB8' },
      { id: 'stucco', name: 'STUCCO', color: '#E8E0D8' }
    ],
    'concrete-frame': [
      { id: 'board-formed', name: 'BOARD-FORMED', color: '#B0B0B0' },
      { id: 'smooth-concrete', name: 'SMOOTH', color: '#C8C8C8' },
      { id: 'precast-panel', name: 'PRECAST PANEL', color: '#D0D0D0' }
    ],
    'steel-frame': [
      { id: 'metal-panel', name: 'METAL PANEL', color: '#707080' },
      { id: 'glass-curtain', name: 'GLASS CURTAIN', color: '#A8C8D8' },
      { id: 'zinc-clad', name: 'ZINC CLAD', color: '#808890' }
    ]
  };

  const options = claddingByStructure[DESIGN.structure] || claddingByStructure['concrete-frame'];

  if (claddingHint) {
    const structureNames = {
      'mass-timber': 'MASS TIMBER',
      'load-bearing': 'LOAD-BEARING WALL',
      'concrete-frame': 'CONCRETE FRAME',
      'steel-frame': 'STEEL FRAME'
    };
    claddingHint.textContent = `OPTIONS FOR ${structureNames[DESIGN.structure] || 'YOUR STRUCTURE'}`;
  }

  if (claddingContainer) {
    claddingContainer.innerHTML = options.map((opt, i) => `
      <button class="ds-cladding-btn ${i === 0 ? 'selected' : ''}" data-cladding="${opt.id}">
        <span class="ds-cladding-swatch" style="background: ${opt.color}"></span>
        <span class="ds-cladding-name">${opt.name}</span>
      </button>
    `).join('');

    if (!DESIGN.cladding) DESIGN.cladding = options[0].id;

    // Map cladding IDs to FormGenerator material names
    const claddingToMaterial = {
      'timber-panel': 'timber', 'cedar-shingle': 'wood', 'charred-wood': 'wood',
      'exposed-brick': 'brick', 'stone-face': 'stone', 'stucco': 'concrete',
      'board-formed': 'concrete', 'smooth-concrete': 'concrete', 'precast-panel': 'concrete',
      'metal-panel': 'steel', 'glass-curtain': 'glass', 'zinc-clad': 'steel'
    };

    claddingContainer.querySelectorAll('.ds-cladding-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.cladding === DESIGN.cladding);
      btn.onclick = () => {
        DESIGN.cladding = btn.dataset.cladding;
        claddingContainer.querySelectorAll('.ds-cladding-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        // Update FormGenerator material
        const material = claddingToMaterial[DESIGN.cladding] || 'timber';
        FormGenerator.updateParams({ material });
        updateFormPreview();
      };
    });
  }

  // Fenestration options
  document.querySelectorAll('[data-fenestration]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.fenestration === DESIGN.fenestration);
    btn.onclick = () => {
      DESIGN.fenestration = btn.dataset.fenestration;
      document.querySelectorAll('[data-fenestration]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      updateFormPreview();
    };
  });

  // Window size slider
  const windowSlider = $('ds-window-size');
  if (windowSlider) {
    windowSlider.value = DESIGN.windowSize;
    windowSlider.oninput = () => {
      DESIGN.windowSize = parseInt(windowSlider.value);
      updateFormPreview();
    };
  }

  const nextBtn = $('ds-next-4');
  if (nextBtn) {
    nextBtn.onclick = () => goToStep(5);
  }
}

// ─── STEP 5: COMMIT ─────────────────────────────────────────────────
function initCommitStep() {
  const form = DESIGN.generatedForm;

  // Material requirements
  const reqContainer = $('ds-requirements');
  if (reqContainer && form) {
    const structureMaterials = {
      'mass-timber': { name: 'TIMBER', color: '#A8C8A8' },
      'load-bearing': { name: 'BRICK/STONE', color: '#B87D6D' },
      'concrete-frame': { name: 'CONCRETE', color: '#B0B0B0' },
      'steel-frame': { name: 'STEEL', color: '#707080' }
    };
    const mat = structureMaterials[DESIGN.structure];
    const volume = form.grossArea ? form.grossArea * 12 : 50000;

    reqContainer.innerHTML = `
      <div class="ds-req-item">
        <span class="ds-req-swatch" style="background: ${mat.color}"></span>
        <div class="ds-req-info">
          <span class="ds-req-name">${mat.name}</span>
        </div>
        <span class="ds-req-amount">${Math.round(volume / 50).toLocaleString()} UNITS</span>
      </div>
      <div class="ds-req-item">
        <span class="ds-req-swatch" style="background: #A8C8D8"></span>
        <div class="ds-req-info">
          <span class="ds-req-name">GLASS</span>
        </div>
        <span class="ds-req-amount">${Math.round(volume / 200).toLocaleString()} UNITS</span>
      </div>
    `;
  }

  // Carbon
  const carbonFactor = { 'mass-timber': 0.5, 'load-bearing': 1.5, 'concrete-frame': 3.0, 'steel-frame': 2.5 };
  const grossArea = form?.grossArea || 5000;
  const embodied = (grossArea / 1000 * (carbonFactor[DESIGN.structure] || 2)).toFixed(1);

  $('ds-carbon-embodied')&&($('ds-carbon-embodied').textContent = `${embodied} T`);
  $('ds-carbon-transport')&&($('ds-carbon-transport').textContent = '0.5 T');
  $('ds-carbon-total')&&($('ds-carbon-total').textContent = `${(parseFloat(embodied) + 0.5).toFixed(1)} T`);

  // Labor
  const laborHours = Math.round(grossArea * 0.5);
  const siteHours = Math.round(grossArea * 0.1);

  $('ds-labor-hours')&&($('ds-labor-hours').textContent = `${laborHours.toLocaleString()} HRS`);
  $('ds-labor-site')&&($('ds-labor-site').textContent = `${siteHours.toLocaleString()} HRS`);

  // Labor allocation slider
  const laborSlider = $('ds-labor-alloc');
  const laborVal = $('ds-labor-alloc-val');
  const laborEstimate = $('ds-labor-estimate');

  if (laborSlider) {
    laborSlider.value = DESIGN.laborAllocation;
    if (laborVal) laborVal.textContent = `${DESIGN.laborAllocation} HRS/DAY`;

    const totalLabor = laborHours + siteHours;
    const days = Math.ceil(totalLabor / DESIGN.laborAllocation);
    if (laborEstimate) laborEstimate.textContent = `~${days} DAYS TO COMPLETE`;

    laborSlider.oninput = () => {
      DESIGN.laborAllocation = parseInt(laborSlider.value);
      if (laborVal) laborVal.textContent = `${DESIGN.laborAllocation} HRS/DAY`;
      const newDays = Math.ceil(totalLabor / DESIGN.laborAllocation);
      if (laborEstimate) laborEstimate.textContent = `~${newDays} DAYS TO COMPLETE`;
    };
  }

  // End of life options
  document.querySelectorAll('[data-endlife]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.endlife === DESIGN.endOfLife);
    btn.onclick = () => {
      DESIGN.endOfLife = btn.dataset.endlife;
      document.querySelectorAll('[data-endlife]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    };
  });

  // Commit button
  const commitBtn = $('ds-commit-btn');
  if (commitBtn) {
    commitBtn.onclick = () => commitDesignNew();
  }
}

// ─── COMMIT DESIGN ──────────────────────────────────────────────────
function commitDesignNew() {
  const form = DESIGN.generatedForm;
  if (!form) return;

  const tile = BUILD.selectedTiles[0];
  if (!tile) return;

  // Create spec for the build system
  const structureNames = {
    'mass-timber': 'Timber Structure',
    'load-bearing': 'Masonry Structure',
    'concrete-frame': 'Concrete Structure',
    'steel-frame': 'Steel Structure'
  };

  const spec = {
    name: `${structureNames[DESIGN.structure]} ${DESIGN.floors}F`,
    floors: DESIGN.floors,
    user_prompt: `${DESIGN.massing} massing with ${DESIGN.roof} roof`,
    designer_intent: `A ${DESIGN.floors}-story ${DESIGN.structure.replace('-', ' ')} building`
  };

  const reqs = {
    wFt: Math.sqrt(form.footprintArea || 2000),
    dFt: Math.sqrt(form.footprintArea || 2000),
    hFt: form.height || DESIGN.floors * 12,
    laborReq: Math.round((form.grossArea || 5000) * 0.5),
    materialReq: {},
    embodiedCarbon: (form.grossArea || 5000) / 1000 * 2
  };

  // Store result
  BUILD.aiResult = { spec, reqs };

  // Close design screen and open sourcing
  closeDesignScreen();

  // Show success
  showBuildCommit(spec.name);
}

// ─── OLD STEP FUNCTIONS (kept for compatibility) ────────────────────
function renderSubdividedGrid() {
  // No longer used - kept for compatibility
  const tileW = 100; // Full tile width
  const tileH = 50;  // Full tile height
  const subW = tileW / 2; // Sub-tile width
  const subH = tileH / 2; // Sub-tile height

  // Center the grid
  const centerGx = (minGx + maxGx) / 2;
  const centerGy = (minGy + maxGy) / 2;
  const offsetX = 300;
  const offsetY = 200;

  // Helper to convert grid to screen for tile center
  const toScreen = (gx, gy) => {
    const relGx = gx - centerGx;
    const relGy = gy - centerGy;
    return {
      x: offsetX + (relGx - relGy) * (tileW / 2),
      y: offsetY + (relGx + relGy) * (tileH / 2)
    };
  };

  // Draw each tile with 4 sub-tiles
  // Sub-tile quadrants: 0=top, 1=right, 2=bottom, 3=left
  for (const tile of tiles) {
    const center = toScreen(tile.gx, tile.gy);

    // Draw 4 sub-diamonds within the tile
    const subTiles = [
      { quadrant: 0, cx: center.x, cy: center.y - subH / 2 },             // Top
      { quadrant: 1, cx: center.x + subW / 2, cy: center.y },             // Right
      { quadrant: 2, cx: center.x, cy: center.y + subH / 2 },             // Bottom
      { quadrant: 3, cx: center.x - subW / 2, cy: center.y }              // Left
    ];

    for (const sub of subTiles) {
      const key = `${tile.gx},${tile.gy},${sub.quadrant}`;
      const isSelected = DESIGN.selectedSubTiles.has(key);

      // Create sub-diamond path
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const hw = subW / 2;
      const hh = subH / 2;
      path.setAttribute('d', `
        M${sub.cx},${sub.cy - hh}
        L${sub.cx + hw},${sub.cy}
        L${sub.cx},${sub.cy + hh}
        L${sub.cx - hw},${sub.cy}
        Z
      `);
      path.setAttribute('fill', isSelected ? 'rgba(90, 154, 184, 0.3)' : 'white');
      path.setAttribute('stroke', isSelected ? 'var(--accent)' : '#CCCCCC');
      path.setAttribute('stroke-width', isSelected ? '2' : '1');
      path.setAttribute('class', 'ds-subtile');
      path.setAttribute('data-key', key);
      path.style.cursor = 'pointer';

      // Click handler
      path.addEventListener('click', () => {
        if (DESIGN.selectedSubTiles.has(key)) {
          DESIGN.selectedSubTiles.delete(key);
        } else {
          DESIGN.selectedSubTiles.add(key);
        }
        renderSubdividedGrid();
        updateFootprintUI();
      });

      // Hover effect
      path.addEventListener('mouseenter', () => {
        if (!DESIGN.selectedSubTiles.has(key)) {
          path.setAttribute('fill', 'rgba(90, 154, 184, 0.1)');
        }
      });
      path.addEventListener('mouseleave', () => {
        if (!DESIGN.selectedSubTiles.has(key)) {
          path.setAttribute('fill', 'white');
        }
      });

      svg.appendChild(path);
    }

    // Draw tile outline
    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    outline.setAttribute('d', `
      M${center.x},${center.y - tileH / 2}
      L${center.x + tileW / 2},${center.y}
      L${center.x},${center.y + tileH / 2}
      L${center.x - tileW / 2},${center.y}
      Z
    `);
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke', '#888888');
    outline.setAttribute('stroke-width', '1');
    outline.style.pointerEvents = 'none';
    svg.appendChild(outline);
  }
}

function updateFootprintUI() {
  const count = DESIGN.selectedSubTiles.size;
  const countEl = $('ds-subtile-count');
  const areaEl = $('ds-footprint-area');
  const nextBtn = $('ds-next-1');

  if (countEl) countEl.textContent = count;

  // Each sub-tile is roughly 4,250 sq ft (17,000 / 4)
  const area = count * 4250;
  if (areaEl) areaEl.textContent = `${area.toLocaleString()} SQ FT`;

  // Enable next button if at least one sub-tile selected
  if (nextBtn) {
    nextBtn.disabled = count === 0;
    nextBtn.onclick = () => goToStep(2);
  }
}

// ─── STEP 2: FORM GENERATION (THREE.JS) ─────────────────────────────
let formPreviewInitialized = false;

function initFormStep() {
  // Initialize Three.js preview if not already done
  if (!formPreviewInitialized) {
    FormGenerator.initFormPreview('ds-form-canvas');
    formPreviewInitialized = true;
  }

  // Pass footprint data to generator
  const footprintCells = Array.from(DESIGN.selectedSubTiles);
  FormGenerator.setFootprint(footprintCells);

  // Set initial params
  const params = {
    floors: parseInt($('ds-param-floors')?.value) || 2,
    massing: document.querySelector('.ds-massing-btn.selected')?.dataset?.massing || 'extrude',
    roof: document.querySelector('.ds-roof-btn.selected')?.dataset?.roof || 'flat',
    voidPercent: parseInt($('ds-param-void')?.value) || 10
  };
  FormGenerator.updateParams(params);

  // Generate initial form and update stats
  updateFormAndStats();

  // Setup parameter controls
  setupFormControls();
}

function setupFormControls() {
  // Floors slider
  const floorsSlider = $('ds-param-floors');
  const floorsVal = $('ds-param-floors-val');
  if (floorsSlider) {
    floorsSlider.oninput = () => {
      if (floorsVal) floorsVal.textContent = floorsSlider.value;
      FormGenerator.updateParams({ floors: parseInt(floorsSlider.value) });
      updateFormAndStats();
    };
  }

  // Void slider
  const voidSlider = $('ds-param-void');
  const voidVal = $('ds-param-void-val');
  if (voidSlider) {
    voidSlider.oninput = () => {
      if (voidVal) voidVal.textContent = voidSlider.value + '%';
      FormGenerator.updateParams({ voidPercent: parseInt(voidSlider.value) });
      updateFormAndStats();
    };
  }

  // Massing buttons
  document.querySelectorAll('.ds-massing-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.ds-massing-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      FormGenerator.updateParams({ massing: btn.dataset.massing });
      updateFormAndStats();
    };
  });

  // Roof buttons
  document.querySelectorAll('.ds-roof-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.ds-roof-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      FormGenerator.updateParams({ roof: btn.dataset.roof });
      updateFormAndStats();
    };
  });

  // Regenerate button
  const regenBtn = $('ds-regenerate-btn');
  if (regenBtn) {
    regenBtn.onclick = () => {
      // Slightly randomize void to get variation
      const currentVoid = parseInt($('ds-param-void')?.value) || 10;
      const newVoid = Math.max(0, Math.min(40, currentVoid + (Math.random() - 0.5) * 10));
      if ($('ds-param-void')) $('ds-param-void').value = Math.round(newVoid);
      if ($('ds-param-void-val')) $('ds-param-void-val').textContent = Math.round(newVoid) + '%';
      FormGenerator.updateParams({ voidPercent: Math.round(newVoid) });
      updateFormAndStats();
    };
  }

  // Rotation toggle
  const rotateBtn = $('ds-rotate-toggle');
  if (rotateBtn) {
    rotateBtn.onclick = () => {
      const isRotating = FormGenerator.toggleRotation();
      rotateBtn.classList.toggle('active', isRotating);
    };
    rotateBtn.classList.add('active'); // Start rotating
  }

  // Ortho view
  const orthoBtn = $('ds-view-ortho');
  if (orthoBtn) {
    orthoBtn.onclick = () => {
      FormGenerator.setOrthoView();
    };
  }

  // Next button
  const nextBtn = $('ds-next-2');
  if (nextBtn) {
    nextBtn.onclick = () => goToStep(3);
  }
}

function updateFormAndStats() {
  const stats = FormGenerator.generateForm(DESIGN.primaryMaterial || 'concrete');

  if (stats) {
    // Update stats display
    $('ds-form-footprint').textContent = `${stats.footprintArea.toLocaleString()} SQ FT`;
    $('ds-form-floors').textContent = stats.floors;
    $('ds-form-height').textContent = `${stats.height} FT`;
    $('ds-form-area').textContent = `${stats.grossArea.toLocaleString()} SQ FT`;

    // Store in DESIGN state for later steps
    DESIGN.generatedForm = {
      footprintArea: stats.footprintArea,
      floors: stats.floors,
      height: stats.height,
      grossArea: stats.grossArea,
      volume: stats.grossArea * 12, // Rough volume estimate
      reqs: {
        laborReq: Math.round(stats.grossArea * 0.5), // 0.5 labor hours per sq ft
        embodiedCarbon: stats.grossArea * 0.003 // Rough carbon estimate
      }
    };
  }
}

// ─── BEAUTIFUL BUILDING RENDERER ────────────────────────────────────
// Saul Kim-inspired architectural forms with sophisticated rendering

// Color palette - soft gray concrete aesthetic
const COLORS = {
  leftFace: '#B8B8B8',      // Darker left face (shadow)
  rightFace: '#D8D8D8',     // Lighter right face
  topFace: '#E8E8E8',       // Lightest top face
  darkAccent: '#A0A0A0',    // For depth/shadows
  window: '#4A5A6A',        // Dark windows
  stroke: '#909090',        // Subtle outlines
  piloti: '#C0C0C0',        // Column color
  human: '#707070'          // Human figures
};

// Building archetypes based on the reference images
const ARCHETYPES = [
  'parallel-walls',      // Leaning parallel wall structure
  'stepped-mass',        // Stepped/terraced building with external stairs
  'cylindrical-tower',   // Round tower with spiral stair
  'suspended-platform',  // Platform on pilotis/columns
  'courtyard',           // Building with internal void/courtyard
  'a-frame',             // Triangular A-frame structure
  'interlocking-l',      // Interlocking L-shaped masses
  'canopy'               // Cable-stayed canopy structure
];

function selectArchetype(prompt, floors) {
  const p = prompt.toLowerCase();
  if (p.includes('wall') || p.includes('fin') || p.includes('parallel') || p.includes('blade')) return 'parallel-walls';
  if (p.includes('step') || p.includes('terrace') || p.includes('stair')) return 'stepped-mass';
  if (p.includes('tower') || p.includes('cylinder') || p.includes('round') || p.includes('circular')) return 'cylindrical-tower';
  if (p.includes('suspend') || p.includes('piloti') || p.includes('column') || p.includes('platform') || p.includes('elevat')) return 'suspended-platform';
  if (p.includes('courtyard') || p.includes('void') || p.includes('atrium')) return 'courtyard';
  if (p.includes('a-frame') || p.includes('triangle') || p.includes('pyramid')) return 'a-frame';
  if (p.includes('canopy') || p.includes('cable') || p.includes('tent')) return 'canopy';
  if (p.includes('interlock') || p.includes('l-shape')) return 'interlocking-l';

  // Random selection based on floors for variety
  const idx = (floors + Date.now()) % ARCHETYPES.length;
  return ARCHETYPES[idx];
}

function renderGeneratedBuilding(svg, form) {
  const tiles = BUILD.selectedTiles;
  if (tiles.length === 0) return;

  // Calculate position
  let minGx = Infinity, maxGx = -Infinity;
  let minGy = Infinity, maxGy = -Infinity;
  for (const t of tiles) {
    minGx = Math.min(minGx, t.gx);
    maxGx = Math.max(maxGx, t.gx);
    minGy = Math.min(minGy, t.gy);
    maxGy = Math.max(maxGy, t.gy);
  }

  const offsetX = 400;
  const offsetY = 300;

  // Select archetype based on prompt
  const prompt = form.spec?.user_prompt || form.name || '';
  const archetype = selectArchetype(prompt, form.floors || 2);

  // Store for potential use
  form.archetype = archetype;

  // Create building group
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'ds-building');

  // Render based on archetype
  switch (archetype) {
    case 'parallel-walls':
      renderParallelWalls(g, offsetX, offsetY, form);
      break;
    case 'stepped-mass':
      renderSteppedMass(g, offsetX, offsetY, form);
      break;
    case 'cylindrical-tower':
      renderCylindricalTower(g, offsetX, offsetY, form);
      break;
    case 'suspended-platform':
      renderSuspendedPlatform(g, offsetX, offsetY, form);
      break;
    case 'courtyard':
      renderCourtyardBuilding(g, offsetX, offsetY, form);
      break;
    case 'a-frame':
      renderAFrame(g, offsetX, offsetY, form);
      break;
    case 'interlocking-l':
      renderInterlockingL(g, offsetX, offsetY, form);
      break;
    case 'canopy':
      renderCanopy(g, offsetX, offsetY, form);
      break;
    default:
      renderSteppedMass(g, offsetX, offsetY, form);
  }

  // Add human figure for scale
  addHumanFigure(g, offsetX + 60, offsetY + 80);

  svg.appendChild(g);
}

// Helper: Create an isometric box
function isoBox(g, cx, cy, w, d, h, colors = COLORS) {
  // Left face (shadow side)
  const left = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  left.setAttribute('d', `M${cx},${cy} L${cx - w/2},${cy - d/4} L${cx - w/2},${cy - d/4 - h} L${cx},${cy - h} Z`);
  left.setAttribute('fill', colors.leftFace);
  left.setAttribute('stroke', colors.stroke);
  left.setAttribute('stroke-width', '0.5');
  g.appendChild(left);

  // Right face (lit side)
  const right = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  right.setAttribute('d', `M${cx},${cy} L${cx + w/2},${cy - d/4} L${cx + w/2},${cy - d/4 - h} L${cx},${cy - h} Z`);
  right.setAttribute('fill', colors.rightFace);
  right.setAttribute('stroke', colors.stroke);
  right.setAttribute('stroke-width', '0.5');
  g.appendChild(right);

  // Top face
  const top = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  top.setAttribute('d', `M${cx},${cy - h} L${cx - w/2},${cy - d/4 - h} L${cx},${cy - d/2 - h} L${cx + w/2},${cy - d/4 - h} Z`);
  top.setAttribute('fill', colors.topFace);
  top.setAttribute('stroke', colors.stroke);
  top.setAttribute('stroke-width', '0.5');
  g.appendChild(top);
}

// Helper: Add windows to a face
function addWindows(g, x, y, w, h, rows, cols, isLeft = true) {
  const winW = 6;
  const winH = 10;
  const spacingX = w / (cols + 1);
  const spacingY = h / (rows + 1);

  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const wx = x + c * spacingX - winW/2;
      const wy = y + r * spacingY - winH/2;
      const win = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      win.setAttribute('x', wx);
      win.setAttribute('y', wy);
      win.setAttribute('width', winW);
      win.setAttribute('height', winH);
      win.setAttribute('fill', COLORS.window);
      g.appendChild(win);
    }
  }
}

// Helper: Add human figure for scale
function addHumanFigure(g, x, y) {
  // Simple stylized human ~6ft tall at scale
  const human = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  // Head
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  head.setAttribute('cx', x);
  head.setAttribute('cy', y - 14);
  head.setAttribute('r', 2);
  head.setAttribute('fill', COLORS.human);
  human.appendChild(head);

  // Body
  const body = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  body.setAttribute('x1', x);
  body.setAttribute('y1', y - 12);
  body.setAttribute('x2', x);
  body.setAttribute('y2', y - 4);
  body.setAttribute('stroke', COLORS.human);
  body.setAttribute('stroke-width', '1.5');
  human.appendChild(body);

  // Legs
  const leg1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  leg1.setAttribute('x1', x);
  leg1.setAttribute('y1', y - 4);
  leg1.setAttribute('x2', x - 2);
  leg1.setAttribute('y2', y);
  leg1.setAttribute('stroke', COLORS.human);
  leg1.setAttribute('stroke-width', '1.5');
  human.appendChild(leg1);

  const leg2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  leg2.setAttribute('x1', x);
  leg2.setAttribute('y1', y - 4);
  leg2.setAttribute('x2', x + 2);
  leg2.setAttribute('y2', y);
  leg2.setAttribute('stroke', COLORS.human);
  leg2.setAttribute('stroke-width', '1.5');
  human.appendChild(leg2);

  g.appendChild(human);
}

// ─── ARCHETYPE: PARALLEL WALLS ──────────────────────────────────────
function renderParallelWalls(g, cx, cy, form) {
  const wallCount = 3 + Math.floor(form.floors / 2);
  const wallSpacing = 20;
  const wallW = 8;
  const wallD = 60;
  const wallH = 80 + form.floors * 15;

  // Render walls back to front
  for (let i = wallCount - 1; i >= 0; i--) {
    const wx = cx - wallCount * wallSpacing / 2 + i * wallSpacing;
    const wy = cy - i * 8; // Slight stagger for depth

    // Slight lean
    const lean = 3;

    // Left face
    const left = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    left.setAttribute('d', `
      M${wx},${wy}
      L${wx - wallW/2},${wy - wallD/6}
      L${wx - wallW/2 + lean},${wy - wallD/6 - wallH}
      L${wx + lean},${wy - wallH}
      Z
    `);
    left.setAttribute('fill', COLORS.leftFace);
    left.setAttribute('stroke', COLORS.stroke);
    left.setAttribute('stroke-width', '0.5');
    g.appendChild(left);

    // Front face
    const front = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    front.setAttribute('d', `
      M${wx},${wy}
      L${wx + wallW/2},${wy - wallD/6}
      L${wx + wallW/2 + lean},${wy - wallD/6 - wallH}
      L${wx + lean},${wy - wallH}
      Z
    `);
    front.setAttribute('fill', COLORS.rightFace);
    front.setAttribute('stroke', COLORS.stroke);
    front.setAttribute('stroke-width', '0.5');
    g.appendChild(front);

    // Top face
    const top = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    top.setAttribute('d', `
      M${wx + lean},${wy - wallH}
      L${wx - wallW/2 + lean},${wy - wallD/6 - wallH}
      L${wx + lean},${wy - wallD/3 - wallH}
      L${wx + wallW/2 + lean},${wy - wallD/6 - wallH}
      Z
    `);
    top.setAttribute('fill', COLORS.topFace);
    top.setAttribute('stroke', COLORS.stroke);
    top.setAttribute('stroke-width', '0.5');
    g.appendChild(top);

    // Windows on some walls
    if (i % 2 === 0) {
      for (let w = 0; w < 3; w++) {
        const win = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        win.setAttribute('x', wx + 1);
        win.setAttribute('y', wy - wallH + 20 + w * 25);
        win.setAttribute('width', 5);
        win.setAttribute('height', 12);
        win.setAttribute('fill', COLORS.window);
        g.appendChild(win);
      }
    }
  }

  // Add thin pilotis/columns at base
  for (let i = 0; i < 2; i++) {
    const px = cx - 30 + i * 60;
    const py = cy + 20;
    const piloti = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    piloti.setAttribute('x1', px);
    piloti.setAttribute('y1', py);
    piloti.setAttribute('x2', px);
    piloti.setAttribute('y2', py + 25);
    piloti.setAttribute('stroke', COLORS.piloti);
    piloti.setAttribute('stroke-width', '3');
    g.appendChild(piloti);
  }
}

// ─── ARCHETYPE: STEPPED MASS ────────────────────────────────────────
function renderSteppedMass(g, cx, cy, form) {
  const floors = Math.max(2, form.floors);
  const stepW = 50;
  const stepD = 35;
  const floorH = 25;

  // Draw from back to front, bottom to top
  for (let f = 0; f < floors; f++) {
    const stepCx = cx + f * 12;
    const stepCy = cy - f * (floorH - 5);
    const w = stepW - f * 8;
    const d = stepD - f * 5;

    isoBox(g, stepCx, stepCy, w, d, floorH);

    // Windows
    const winCount = Math.max(1, 3 - f);
    for (let wi = 0; wi < winCount; wi++) {
      const winX = stepCx + 3 + wi * 10;
      const winY = stepCy - floorH + 8;
      const win = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      win.setAttribute('x', winX);
      win.setAttribute('y', winY);
      win.setAttribute('width', 6);
      win.setAttribute('height', 10);
      win.setAttribute('fill', COLORS.window);
      g.appendChild(win);
    }
  }

  // External staircase
  const stairX = cx - 35;
  const stairY = cy + 10;
  for (let s = 0; s < 6; s++) {
    const stair = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const sx = stairX + s * 4;
    const sy = stairY - s * 8;
    stair.setAttribute('d', `M${sx},${sy} L${sx + 8},${sy - 4} L${sx + 8},${sy - 2} L${sx},${sy + 2} Z`);
    stair.setAttribute('fill', COLORS.rightFace);
    stair.setAttribute('stroke', COLORS.stroke);
    stair.setAttribute('stroke-width', '0.5');
    g.appendChild(stair);
  }
}

// ─── ARCHETYPE: CYLINDRICAL TOWER ───────────────────────────────────
function renderCylindricalTower(g, cx, cy, form) {
  const radius = 30;
  const height = 80 + form.floors * 20;

  // Cylinder body - approximated with ellipse and gradient
  const body = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  body.setAttribute('cx', cx);
  body.setAttribute('cy', cy - height/2);
  body.setAttribute('rx', radius);
  body.setAttribute('ry', height/2);
  body.setAttribute('fill', 'url(#cylinderGrad)');
  body.setAttribute('stroke', COLORS.stroke);
  body.setAttribute('stroke-width', '0.5');

  // Create gradient for cylinder
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  grad.setAttribute('id', 'cylinderGrad');
  grad.setAttribute('x1', '0%');
  grad.setAttribute('y1', '0%');
  grad.setAttribute('x2', '100%');
  grad.setAttribute('y2', '0%');

  const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', COLORS.leftFace);
  grad.appendChild(stop1);

  const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop2.setAttribute('offset', '50%');
  stop2.setAttribute('stop-color', COLORS.rightFace);
  grad.appendChild(stop2);

  const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop3.setAttribute('offset', '100%');
  stop3.setAttribute('stop-color', COLORS.leftFace);
  grad.appendChild(stop3);

  defs.appendChild(grad);
  g.appendChild(defs);

  // Simpler cylinder rendering
  // Left half (darker)
  const leftHalf = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  leftHalf.setAttribute('d', `
    M${cx},${cy}
    Q${cx - radius},${cy} ${cx - radius},${cy - height/2}
    Q${cx - radius},${cy - height} ${cx},${cy - height}
    L${cx},${cy}
    Z
  `);
  leftHalf.setAttribute('fill', COLORS.leftFace);
  leftHalf.setAttribute('stroke', 'none');
  g.appendChild(leftHalf);

  // Right half (lighter)
  const rightHalf = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  rightHalf.setAttribute('d', `
    M${cx},${cy}
    Q${cx + radius},${cy} ${cx + radius},${cy - height/2}
    Q${cx + radius},${cy - height} ${cx},${cy - height}
    L${cx},${cy}
    Z
  `);
  rightHalf.setAttribute('fill', COLORS.rightFace);
  rightHalf.setAttribute('stroke', 'none');
  g.appendChild(rightHalf);

  // Outline
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  outline.setAttribute('cx', cx);
  outline.setAttribute('cy', cy - height/2);
  outline.setAttribute('rx', radius);
  outline.setAttribute('ry', height/2);
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', COLORS.stroke);
  outline.setAttribute('stroke-width', '0.5');
  g.appendChild(outline);

  // Top ellipse
  const topEllipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  topEllipse.setAttribute('cx', cx);
  topEllipse.setAttribute('cy', cy - height);
  topEllipse.setAttribute('rx', radius);
  topEllipse.setAttribute('ry', radius * 0.4);
  topEllipse.setAttribute('fill', COLORS.topFace);
  topEllipse.setAttribute('stroke', COLORS.stroke);
  topEllipse.setAttribute('stroke-width', '0.5');
  g.appendChild(topEllipse);

  // Spiral staircase indication
  for (let s = 0; s < 8; s++) {
    const angle = s * Math.PI / 4;
    const sx = cx + Math.cos(angle) * (radius - 5);
    const sy = cy - height + 10 + s * (height - 20) / 8;
    const stair = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    stair.setAttribute('x', sx - 3);
    stair.setAttribute('y', sy - 1);
    stair.setAttribute('width', 6);
    stair.setAttribute('height', 2);
    stair.setAttribute('fill', COLORS.darkAccent);
    g.appendChild(stair);
  }

  // Windows around cylinder
  for (let w = 0; w < 4; w++) {
    const wy = cy - height + 30 + w * 30;
    const win = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    win.setAttribute('x', cx + radius - 8);
    win.setAttribute('y', wy);
    win.setAttribute('width', 5);
    win.setAttribute('height', 12);
    win.setAttribute('fill', COLORS.window);
    g.appendChild(win);
  }
}

// ─── ARCHETYPE: SUSPENDED PLATFORM ──────────────────────────────────
function renderSuspendedPlatform(g, cx, cy, form) {
  const platformW = 80;
  const platformD = 50;
  const platformH = 15;
  const pilotiH = 50;
  const pilotiCount = 4;

  // Pilotis (columns)
  const pilotiPositions = [
    { x: cx - 25, y: cy + 20 },
    { x: cx + 25, y: cy + 20 },
    { x: cx - 25, y: cy - 10 },
    { x: cx + 25, y: cy - 10 }
  ];

  for (const pos of pilotiPositions) {
    // Column
    const col = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    col.setAttribute('x', pos.x - 3);
    col.setAttribute('y', pos.y - pilotiH);
    col.setAttribute('width', 6);
    col.setAttribute('height', pilotiH + 20);
    col.setAttribute('fill', COLORS.piloti);
    col.setAttribute('stroke', COLORS.stroke);
    col.setAttribute('stroke-width', '0.5');
    g.appendChild(col);
  }

  // Platform
  isoBox(g, cx, cy - pilotiH + 10, platformW, platformD, platformH);

  // Add structure on top
  const structW = 40;
  const structD = 25;
  const structH = 35;
  isoBox(g, cx + 10, cy - pilotiH - 5, structW, structD, structH);

  // Windows on structure
  for (let w = 0; w < 2; w++) {
    const win = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    win.setAttribute('x', cx + 15 + w * 15);
    win.setAttribute('y', cy - pilotiH - structH + 10);
    win.setAttribute('width', 8);
    win.setAttribute('height', 14);
    win.setAttribute('fill', COLORS.window);
    g.appendChild(win);
  }
}

// ─── ARCHETYPE: COURTYARD BUILDING ──────────────────────────────────
function renderCourtyardBuilding(g, cx, cy, form) {
  const outerW = 70;
  const outerD = 50;
  const buildingH = 50 + form.floors * 15;
  const wallThickness = 18;

  // Outer mass
  isoBox(g, cx, cy, outerW, outerD, buildingH);

  // Carve out courtyard (draw void as white)
  const voidW = outerW - wallThickness * 2;
  const voidD = outerD - wallThickness;
  const voidH = buildingH - 10;

  // Inner void - back wall visible
  const innerBack = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  innerBack.setAttribute('d', `
    M${cx},${cy - 10}
    L${cx - voidW/2},${cy - 10 - voidD/4}
    L${cx - voidW/2},${cy - 10 - voidD/4 - voidH}
    L${cx},${cy - 10 - voidH}
    Z
  `);
  innerBack.setAttribute('fill', COLORS.darkAccent);
  innerBack.setAttribute('stroke', COLORS.stroke);
  innerBack.setAttribute('stroke-width', '0.5');
  g.appendChild(innerBack);

  // Inner void floor
  const innerFloor = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  innerFloor.setAttribute('d', `
    M${cx},${cy - 5}
    L${cx - voidW/2},${cy - 5 - voidD/4}
    L${cx},${cy - 5 - voidD/2}
    L${cx + voidW/2},${cy - 5 - voidD/4}
    Z
  `);
  innerFloor.setAttribute('fill', '#F5F5F5');
  innerFloor.setAttribute('stroke', COLORS.stroke);
  innerFloor.setAttribute('stroke-width', '0.5');
  g.appendChild(innerFloor);

  // Tree in courtyard
  const treeX = cx;
  const treeY = cy - 25;
  const trunk = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  trunk.setAttribute('x1', treeX);
  trunk.setAttribute('y1', treeY);
  trunk.setAttribute('x2', treeX);
  trunk.setAttribute('y2', treeY - 15);
  trunk.setAttribute('stroke', '#8B7355');
  trunk.setAttribute('stroke-width', '2');
  g.appendChild(trunk);

  const foliage = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  foliage.setAttribute('cx', treeX);
  foliage.setAttribute('cy', treeY - 22);
  foliage.setAttribute('rx', 10);
  foliage.setAttribute('ry', 8);
  foliage.setAttribute('fill', '#7A9A7A');
  g.appendChild(foliage);

  // Windows on outer walls
  for (let w = 0; w < 3; w++) {
    // Left side windows
    const winL = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    winL.setAttribute('x', cx - outerW/2 + 5);
    winL.setAttribute('y', cy - buildingH + 15 + w * 20);
    winL.setAttribute('width', 6);
    winL.setAttribute('height', 10);
    winL.setAttribute('fill', COLORS.window);
    g.appendChild(winL);

    // Right side windows
    const winR = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    winR.setAttribute('x', cx + outerW/2 - 12);
    winR.setAttribute('y', cy - buildingH + 15 + w * 20);
    winR.setAttribute('width', 6);
    winR.setAttribute('height', 10);
    winR.setAttribute('fill', COLORS.window);
    g.appendChild(winR);
  }
}

// ─── ARCHETYPE: A-FRAME ─────────────────────────────────────────────
function renderAFrame(g, cx, cy, form) {
  const baseW = 60;
  const height = 90 + form.floors * 15;
  const depth = 40;

  // Left slope face
  const leftSlope = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  leftSlope.setAttribute('d', `
    M${cx - baseW/2},${cy}
    L${cx},${cy - height}
    L${cx - depth/4},${cy - height - depth/8}
    L${cx - baseW/2 - depth/4},${cy - depth/8}
    Z
  `);
  leftSlope.setAttribute('fill', COLORS.leftFace);
  leftSlope.setAttribute('stroke', COLORS.stroke);
  leftSlope.setAttribute('stroke-width', '0.5');
  g.appendChild(leftSlope);

  // Right slope face
  const rightSlope = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  rightSlope.setAttribute('d', `
    M${cx + baseW/2},${cy}
    L${cx},${cy - height}
    L${cx + depth/4},${cy - height - depth/8}
    L${cx + baseW/2 + depth/4},${cy - depth/8}
    Z
  `);
  rightSlope.setAttribute('fill', COLORS.rightFace);
  rightSlope.setAttribute('stroke', COLORS.stroke);
  rightSlope.setAttribute('stroke-width', '0.5');
  g.appendChild(rightSlope);

  // Front triangle face
  const frontFace = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  frontFace.setAttribute('d', `
    M${cx - baseW/2},${cy}
    L${cx + baseW/2},${cy}
    L${cx},${cy - height}
    Z
  `);
  frontFace.setAttribute('fill', COLORS.topFace);
  frontFace.setAttribute('stroke', COLORS.stroke);
  frontFace.setAttribute('stroke-width', '0.5');
  g.appendChild(frontFace);

  // Windows in front face
  for (let w = 0; w < 3; w++) {
    const wy = cy - 25 - w * 25;
    const wScale = 1 - w * 0.25;
    const win = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    win.setAttribute('x', cx - 5 * wScale);
    win.setAttribute('y', wy);
    win.setAttribute('width', 10 * wScale);
    win.setAttribute('height', 15 * wScale);
    win.setAttribute('fill', COLORS.window);
    g.appendChild(win);
  }

  // Door at base
  const door = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  door.setAttribute('x', cx - 6);
  door.setAttribute('y', cy - 18);
  door.setAttribute('width', 12);
  door.setAttribute('height', 18);
  door.setAttribute('fill', COLORS.window);
  g.appendChild(door);
}

// ─── ARCHETYPE: INTERLOCKING L ──────────────────────────────────────
function renderInterlockingL(g, cx, cy, form) {
  const blockW = 40;
  const blockD = 30;
  const blockH = 35 + form.floors * 10;

  // First L block
  isoBox(g, cx - 20, cy + 10, blockW, blockD, blockH);
  isoBox(g, cx - 35, cy - 5, blockW * 0.6, blockD, blockH * 0.7);

  // Second L block (interlocking)
  isoBox(g, cx + 15, cy - 15, blockW, blockD, blockH * 1.2);
  isoBox(g, cx + 30, cy + 5, blockW * 0.6, blockD, blockH * 0.8);

  // Windows
  for (let w = 0; w < 2; w++) {
    const win1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    win1.setAttribute('x', cx - 15 + w * 12);
    win1.setAttribute('y', cy - blockH + 25 + w * 15);
    win1.setAttribute('width', 6);
    win1.setAttribute('height', 10);
    win1.setAttribute('fill', COLORS.window);
    g.appendChild(win1);

    const win2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    win2.setAttribute('x', cx + 20 + w * 12);
    win2.setAttribute('y', cy - blockH * 1.2 + 25 + w * 15);
    win2.setAttribute('width', 6);
    win2.setAttribute('height', 10);
    win2.setAttribute('fill', COLORS.window);
    g.appendChild(win2);
  }
}

// ─── ARCHETYPE: CANOPY ──────────────────────────────────────────────
function renderCanopy(g, cx, cy, form) {
  const canopyW = 80;
  const canopyD = 50;
  const canopyH = 8;
  const poleH = 60;

  // Support poles
  const poles = [
    { x: cx - 30, y: cy + 15 },
    { x: cx + 30, y: cy + 15 },
    { x: cx, y: cy - 20 }
  ];

  for (const p of poles) {
    const pole = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    pole.setAttribute('x1', p.x);
    pole.setAttribute('y1', p.y);
    pole.setAttribute('x2', p.x);
    pole.setAttribute('y2', p.y - poleH);
    pole.setAttribute('stroke', COLORS.piloti);
    pole.setAttribute('stroke-width', '4');
    g.appendChild(pole);
  }

  // Cables
  const cableStart = { x: cx, y: cy - poleH - 30 };
  for (const p of poles) {
    const cable = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    cable.setAttribute('x1', cableStart.x);
    cable.setAttribute('y1', cableStart.y);
    cable.setAttribute('x2', p.x);
    cable.setAttribute('y2', p.y - poleH);
    cable.setAttribute('stroke', COLORS.stroke);
    cable.setAttribute('stroke-width', '1');
    g.appendChild(cable);
  }

  // Canopy surface
  isoBox(g, cx, cy - poleH + 10, canopyW, canopyD, canopyH);

  // Small structure underneath
  isoBox(g, cx + 10, cy, 30, 20, 25);

  // Windows
  const win = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  win.setAttribute('x', cx + 15);
  win.setAttribute('y', cy - 18);
  win.setAttribute('width', 10);
  win.setAttribute('height', 12);
  win.setAttribute('fill', COLORS.window);
  g.appendChild(win);
}

function showFormInfo(form) {
  const infoEl = $('ds-form-info');
  if (!infoEl) return;

  infoEl.style.display = 'block';

  $('ds-form-name').textContent = form.name?.toUpperCase() || '—';
  $('ds-form-floors').textContent = form.floors || '—';
  $('ds-form-height').textContent = form.height ? `${form.height} FT` : '—';
  $('ds-form-volume').textContent = form.volume ? `${form.volume.toLocaleString()} CU FT` : '—';

  const quoteEl = $('ds-form-quote');
  if (quoteEl && form.designerIntent) {
    quoteEl.textContent = `"${form.designerIntent}"`;
  }
}

// ─── STEP 3: MATERIALS ──────────────────────────────────────────────
function updateMaterialsUI() {
  // Copy preview from step 2
  const previewSvg = $('ds-materials-preview');
  const formSvg = $('ds-form-preview');
  if (previewSvg && formSvg) {
    previewSvg.innerHTML = formSvg.innerHTML;
  }

  // Setup material buttons
  document.querySelectorAll('#ds-primary-materials .ds-material-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.material === DESIGN.primaryMaterial);
    btn.onclick = () => {
      DESIGN.primaryMaterial = btn.dataset.material;
      updateMaterialsUI();
    };
  });

  document.querySelectorAll('#ds-secondary-materials .ds-material-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.material === DESIGN.secondaryMaterial);
    btn.onclick = () => {
      DESIGN.secondaryMaterial = btn.dataset.material;
      const splitEl = $('ds-material-split');
      if (splitEl) {
        splitEl.style.display = DESIGN.secondaryMaterial !== 'none' ? 'block' : 'none';
      }
      updateMaterialsUI();
    };
  });

  // Setup split slider
  const splitSlider = $('ds-split-slider');
  if (splitSlider) {
    splitSlider.value = DESIGN.materialSplit;
    splitSlider.oninput = () => {
      DESIGN.materialSplit = parseInt(splitSlider.value);
      $('ds-split-pct').textContent = `${DESIGN.materialSplit}%`;
      $('ds-split-secondary').textContent = `${100 - DESIGN.materialSplit}%`;
    };
  }

  // Next button
  const nextBtn = $('ds-next-3');
  if (nextBtn) {
    nextBtn.disabled = !DESIGN.primaryMaterial;
    nextBtn.onclick = () => goToStep(4);
  }
}

// ─── STEP 4: SOURCING ───────────────────────────────────────────────
function updateSourcingUI() {
  const listEl = $('ds-sourcing-list');
  if (listEl) {
    const form = DESIGN.generatedForm;
    const reqs = form?.reqs;
    let html = '';

    // Material requirements from selected materials
    const primaryMat = DESIGN.primaryMaterial;
    const secondaryMat = DESIGN.secondaryMaterial;
    const split = DESIGN.materialSplit / 100;

    // Calculate material needs based on building volume
    const volume = form?.volume || 50000;
    const totalMaterialUnits = Math.round(volume / 100); // Rough conversion

    if (primaryMat && primaryMat !== 'none') {
      const primaryAmount = secondaryMat !== 'none'
        ? Math.round(totalMaterialUnits * split)
        : totalMaterialUnits;
      html += `
        <div class="ds-sourcing-item">
          <div class="ds-sourcing-mat">
            <span class="ds-mat-swatch ${primaryMat}"></span>
            <span class="ds-mat-name">${primaryMat.toUpperCase()}</span>
          </div>
          <div class="ds-sourcing-amount">${primaryAmount.toLocaleString()} UNITS</div>
          <button class="ds-sourcing-btn">SELECT SOURCE</button>
        </div>
      `;
    }

    if (secondaryMat && secondaryMat !== 'none') {
      const secondaryAmount = Math.round(totalMaterialUnits * (1 - split));
      html += `
        <div class="ds-sourcing-item">
          <div class="ds-sourcing-mat">
            <span class="ds-mat-swatch ${secondaryMat}"></span>
            <span class="ds-mat-name">${secondaryMat.toUpperCase()}</span>
          </div>
          <div class="ds-sourcing-amount">${secondaryAmount.toLocaleString()} UNITS</div>
          <button class="ds-sourcing-btn">SELECT SOURCE</button>
        </div>
      `;
    }

    // Waste soil from grading (if any)
    const gradingLabor = calculateLevelingLabor();
    if (gradingLabor > 0) {
      const wasteSoil = Math.round(gradingLabor * 10); // Rough: 10 cu ft per labor hour
      html += `
        <div class="ds-sourcing-item ds-sourcing-waste">
          <div class="ds-sourcing-mat">
            <span class="ds-mat-swatch soil"></span>
            <span class="ds-mat-name">WASTE SOIL</span>
          </div>
          <div class="ds-sourcing-amount">${wasteSoil.toLocaleString()} CU FT</div>
          <button class="ds-sourcing-btn ds-dump-btn">SELECT DUMP SITE</button>
        </div>
      `;
    }

    listEl.innerHTML = html || '<div class="ds-sidebar-hint">NO MATERIALS REQUIRED</div>';
  }

  // Carbon summary
  const form = DESIGN.generatedForm;
  const primaryCarbon = getCarbonFactor(DESIGN.primaryMaterial);
  const totalCarbon = (form?.volume || 50000) / 1000 * primaryCarbon;
  $('ds-carbon-embodied').textContent = `${totalCarbon.toFixed(2)} T`;
  $('ds-carbon-transport').textContent = `0.00 T`;
  $('ds-carbon-total').textContent = `${totalCarbon.toFixed(2)} T`;

  // Next button
  const nextBtn = $('ds-next-4');
  if (nextBtn) {
    nextBtn.disabled = false; // Enable for now - would check sourcing completion
    nextBtn.onclick = () => goToStep(5);
  }
}

// Carbon factors by material (tons CO2 per 1000 cu ft)
function getCarbonFactor(material) {
  const factors = {
    timber: 0.5,
    stone: 1.2,
    brick: 2.0,
    concrete: 3.5,
    steel: 4.0
  };
  return factors[material] || 1.0;
}

// ─── STEP 5: LABOR ──────────────────────────────────────────────────
function updateLaborStepUI() {
  // Copy preview
  const previewSvg = $('ds-labor-preview');
  const formSvg = $('ds-form-preview');
  if (previewSvg && formSvg) {
    previewSvg.innerHTML = formSvg.innerHTML;
  }

  const form = DESIGN.generatedForm;
  const laborReq = form?.reqs?.laborReq || 500;
  const gradingLabor = calculateLevelingLabor();
  const totalLabor = laborReq + gradingLabor;

  $('ds-labor-construction').textContent = `${laborReq.toLocaleString()} HRS`;
  $('ds-labor-grading').textContent = `${gradingLabor.toLocaleString()} HRS`;
  $('ds-labor-total').textContent = `${totalLabor.toLocaleString()} HRS`;

  const gradingRow = $('ds-labor-grading-row');
  if (gradingRow) {
    gradingRow.style.display = gradingLabor > 0 ? 'flex' : 'none';
  }

  // Labor allocation slider
  const slider = $('ds-labor-slider');
  if (slider) {
    slider.value = DESIGN.laborAllocation;
    slider.oninput = () => {
      DESIGN.laborAllocation = parseInt(slider.value);
      $('ds-labor-slider-val').textContent = DESIGN.laborAllocation;
      const days = DESIGN.laborAllocation > 0 ? Math.ceil(totalLabor / DESIGN.laborAllocation) : 0;
      $('ds-labor-estimate').textContent = days > 0 ? `~${days} DAYS TO COMPLETE` : 'NO LABOR ALLOCATED';
    };
    // Trigger initial update
    slider.oninput();
  }

  // Death plan
  const deathPlanEl = $('ds-death-plan');
  if (deathPlanEl) {
    deathPlanEl.value = DESIGN.deathPlan;
    deathPlanEl.onchange = () => {
      DESIGN.deathPlan = deathPlanEl.value;
    };
  }

  // Commit button
  const commitBtn = $('ds-commit-btn');
  if (commitBtn) {
    commitBtn.disabled = DESIGN.laborAllocation <= 0;
    commitBtn.onclick = () => commitDesign();
  }
}

// ─── COMMIT DESIGN ──────────────────────────────────────────────────
function commitDesign() {
  const form = DESIGN.generatedForm;
  if (!form) return;

  const state = BUILD.globalState;
  if (!state) return;

  // Create build from design
  const tile = BUILD.selectedTiles[0];
  if (!tile) return;

  // Store the design result for the existing commit flow
  BUILD.aiResult = {
    spec: form.spec,
    reqs: form.reqs,
    name: form.name,
    kind: 'ai',
    stories: form.floors,
    designerIntent: form.designerIntent
  };

  BUILD.selectedTile = tile;

  // Close design screen
  closeDesignScreen();

  // Clear tile selection visuals
  clearTileSelection();

  // Open sourcing panel with the design
  // For now, show a success message
  console.log('Design committed:', form.name);

  // Show toast
  showBuildCommit(form.name || 'NEW BUILDING');
}

// ─── BUILD MODAL ────────────────────────────────────────────────────
export function openBuildModal(tile) {
  BUILD.selectedTile = tile;
  const modal = $('build-modal');
  if (!modal) return;

  $('bm-title').textContent = `${tile.biome.toUpperCase()} · ELEV ${tile.elev}`;
  $('bm-sub').textContent = `empty · ${tile.id} · ready to build`;

  modal.classList.add('active');
}

export function closeBuildModal() {
  $('build-modal')?.classList.remove('active');
  BUILD.selectedTile = null;
}

// ─── AI MODAL ───────────────────────────────────────────────────────
export function openAiModal() {
  // Save tile reference before closing build modal (which clears it)
  const tile = BUILD.selectedTile;

  // Just hide the build modal, don't clear tile
  $('build-modal')?.classList.remove('active');

  BUILD.designMode = 'ai';

  const modal = $('ai-modal');
  if (!modal) return;

  // Restore tile reference
  BUILD.selectedTile = tile;

  if (tile) {
    $('ai-title').textContent = `${tile.biome.toUpperCase()} · ELEV ${tile.elev}`;
  }

  // Reset to prompt stage
  showAiStage('prompt');
  $('ai-prompt-input').value = '';

  modal.classList.add('open');
}

export function closeAiModal() {
  $('ai-modal')?.classList.remove('open');
  BUILD.aiResult = null;
}

export function showAiStage(stage) {
  const stages = ['prompt', 'loading', 'result', 'apikey'];
  stages.forEach(s => {
    const el = $(`ai-stage-${s}`);
    if (el) el.style.display = (s === stage) ? 'block' : 'none';
  });
}

export function setAiPrompt(text) {
  const input = $('ai-prompt-input');
  if (input) input.value = text;
}

// AI generation - calls Claude API
export async function runAiGenerate() {
  const userPrompt = $('ai-prompt-input')?.value?.trim();
  if (!userPrompt) {
    $('ai-prompt-input')?.focus();
    return;
  }

  const tile = BUILD.selectedTile;
  if (!tile) return;

  showAiStage('loading');

  // Rotating loading messages
  const messages = [
    'consulting the architect…',
    'reading material weights…',
    'sketching the form…',
    'planning structural commitments…',
    'auditing the value system…'
  ];
  let msgIdx = 0;
  const detailEl = $('ai-loading-detail');
  if (detailEl) detailEl.textContent = messages[0];
  const msgTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % messages.length;
    if (detailEl) detailEl.textContent = messages[msgIdx];
  }, 1400);

  try {
    // Check if API key is configured
    if (!hasApiKey()) {
      // Try to get from localStorage
      const storedKey = localStorage.getItem('anthropic_api_key');
      if (storedKey) {
        setApiKey(storedKey);
      } else {
        // Show API key input stage
        clearInterval(msgTimer);
        showAiStage('apikey');
        return;
      }
    }

    // Call Claude API
    const spec = await generateBuildingSpec(userPrompt, tile);
    const reqs = specToRequirements(spec);

    clearInterval(msgTimer);

    // Store full result
    BUILD.aiResult = {
      spec,
      reqs,
      name: spec.name,
      kind: 'ai',
      stories: spec.floors,
      footprint: { w: reqs.wFt, d: reqs.dFt },
      materials: {
        primary: spec.primary_material,
        secondary: spec.secondary_material,
        split: spec.material_pct_primary
      },
      designerIntent: spec.designer_intent,
      valueSystemCritique: spec.value_system_critique,
      deathPlan: spec.death_plan_recommendation
    };

    renderAiResult();
    showAiStage('result');

  } catch (err) {
    clearInterval(msgTimer);
    console.error('AI generation failed:', err.message);
    if (detailEl) detailEl.textContent = 'generation failed — ' + (err.message || 'please try again');
    setTimeout(() => showAiStage('prompt'), 2500);
  }
}

function renderAiResult() {
  const result = BUILD.aiResult;
  if (!result || !result.spec || !result.reqs) return;

  // Render preview SVG
  const preview = $('ai-result-preview');
  if (preview) {
    preview.innerHTML = renderPreviewSvg(result.spec, result.reqs);
  }

  // Render meta table
  const meta = $('ai-result-meta');
  if (meta) {
    meta.innerHTML = renderMetaHtml(result.spec, result.reqs);
  }

  // Designer intent quote
  const quote = $('ai-result-quote');
  if (quote && result.designerIntent) {
    quote.innerHTML = `<span class="quote-intent">"${result.designerIntent}"</span>`;
  }

  // Value system critique (the hidden truth)
  const critique = $('ai-result-critique');
  if (critique && result.valueSystemCritique) {
    critique.innerHTML = `<span class="quote-critique">${result.valueSystemCritique}</span>`;
  } else if (critique) {
    // Create critique element if it exists but no content yet
    critique.innerHTML = '';
  }
}

export function aiBackToPrompt() {
  showAiStage('prompt');
  BUILD.aiResult = null;
}

export function aiAcceptDesign() {
  if (!BUILD.aiResult) return;
  // Don't use closeAiModal here - it clears aiResult which we still need
  $('ai-modal')?.classList.remove('open');
  openSourcingPanel();
}

// ─── IMPORT MODAL ───────────────────────────────────────────────────
export function openImportModal() {
  // Save tile reference before closing build modal
  const tile = BUILD.selectedTile;

  // Just hide the build modal, don't clear tile
  $('build-modal')?.classList.remove('active');

  BUILD.designMode = 'import';

  const modal = $('import-modal');
  if (!modal) return;

  // Restore tile reference
  BUILD.selectedTile = tile;
  if (tile) {
    $('import-title').textContent = `IMPORT TO ${tile.biome.toUpperCase()} · ELEV ${tile.elev}`;
  }

  // Reset to pick stage
  showImportStage('pick');

  modal.classList.add('open');
}

export function closeImportModal() {
  $('import-modal')?.classList.remove('open');
  BUILD.importedGeometry = null;
}

export function showImportStage(stage) {
  const stages = ['pick', 'loading', 'declare'];
  stages.forEach(s => {
    const el = $(`import-stage-${s}`);
    if (el) el.style.display = (s === stage) ? 'block' : 'none';
  });
}

export function handleImportFile(file) {
  if (!file || !file.name.endsWith('.obj')) {
    alert('Please upload a .obj file');
    return;
  }

  showImportStage('loading');
  $('import-loading-detail').textContent = 'reading vertices…';

  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    await parseObjFile(text);
  };
  reader.readAsText(file);
}

async function parseObjFile(text) {
  // Simple OBJ parser
  const lines = text.split('\n');
  let vertexCount = 0;
  let faceCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('v ')) vertexCount++;
    if (trimmed.startsWith('f ')) faceCount++;
  }

  $('import-loading-detail').textContent = 'building geometry…';
  await new Promise(r => setTimeout(r, 500));

  BUILD.importedGeometry = {
    vertices: vertexCount,
    faces: faceCount,
    raw: text
  };

  renderImportPreview();
  showImportStage('declare');
}

function renderImportPreview() {
  const geo = BUILD.importedGeometry;
  if (!geo) return;

  const preview = $('import-preview');
  if (preview) {
    preview.innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--ink-3);">
        <svg width="60" height="60" viewBox="0 0 60 60" fill="none" stroke="var(--ink-2)" stroke-width="1">
          <polygon points="30,5 55,20 55,45 30,55 5,45 5,20"/>
          <line x1="30" y1="5" x2="30" y2="55"/>
          <line x1="5" y1="20" x2="55" y2="20"/>
        </svg>
        <div style="margin-top:12px;font-size:11px;">IMPORTED MESH</div>
      </div>
    `;
  }

  const meta = $('import-meta');
  if (meta) {
    meta.innerHTML = `
      <div class="ai-meta-row"><span>VERTICES</span><span>${geo.vertices.toLocaleString()}</span></div>
      <div class="ai-meta-row"><span>FACES</span><span>${geo.faces.toLocaleString()}</span></div>
    `;
  }
}

export function importAcceptDesign() {
  if (!BUILD.importedGeometry) return;

  const primary = $('im-primary')?.value || 'timber';
  const secondary = $('im-secondary')?.value || 'none';
  const split = parseInt($('im-split')?.value || '80') / 100;

  BUILD.importedGeometry.materials = {
    primary,
    secondary: secondary !== 'none' ? secondary : null,
    split
  };

  closeImportModal();
  openSourcingPanel();
}

// ─── SOURCING PANEL ─────────────────────────────────────────────────
export function openSourcingPanel() {
  const panel = $('sourcing-panel');
  if (!panel) return;

  const design = BUILD.aiResult || BUILD.importedGeometry;
  if (!design) return;

  const state = BUILD.globalState;
  if (!state) return;

  // Create build draft
  BUILD.currentDraft = createBuildDraft(state, {
    primaryTile: BUILD.selectedTile,
    name: design.name || 'Untitled build',
    method: BUILD.designMode === 'ai' ? 'ai' : 'import',
    author: state.user?.name || 'anonymous'
  });

  // Use AI requirements if available, otherwise estimate
  if (design.reqs && design.reqs.materialReq) {
    BUILD.currentDraft.materialReq = { ...design.reqs.materialReq };
    BUILD.currentDraft.wasteSoil = design.reqs.wasteSoil || 0;
    BUILD.currentDraft.laborReq = design.reqs.laborReq || 0;
    BUILD.currentDraft.constructionDays = design.reqs.constructionDays || 1;
    BUILD.currentDraft.embodiedCarbon = design.reqs.embodiedCarbon || 0;

    // Store spec for death plan
    if (design.spec) {
      BUILD.currentDraft.aiSpec = design.spec;
      BUILD.currentDraft.deathPlan = design.spec.death_plan_recommendation;
      BUILD.currentDraft.dimensions = {
        w: design.reqs.wFt,
        d: design.reqs.dFt,
        h: design.reqs.hFt
      };
    }
  } else if (design.materials) {
    // Fallback: estimate from materials
    const footprint = design.footprint || { w: 10, d: 10 };
    const stories = design.stories || 1;
    const volume = footprint.w * footprint.d * stories * 10;
    const split = design.materials.split || 0.8;

    const matToCount = (mass, mat) => {
      if (mat === 'timber') return Math.round(mass * 2.5);
      if (mat === 'stone') return Math.round(mass * 0.85);
      if (mat === 'brick') return Math.round(mass * 15);
      return 0;
    };

    const solidMass = volume * 0.12;
    BUILD.currentDraft.materialReq[design.materials.primary] =
      matToCount(solidMass * split, design.materials.primary);

    if (design.materials.secondary && design.materials.secondary !== 'none') {
      BUILD.currentDraft.materialReq[design.materials.secondary] =
        matToCount(solidMass * (1 - split), design.materials.secondary);
    }

    BUILD.currentDraft.wasteSoil = Math.round(volume * 0.015);
    BUILD.currentDraft.dimensions = { w: footprint.w, d: footprint.d, h: stories * 10 };
  }

  // Build requirements list for UI
  BUILD.currentDraft.requirements = {
    materials: []
  };
  for (const mat of ['timber', 'stone', 'brick']) {
    if (BUILD.currentDraft.materialReq[mat] > 0) {
      BUILD.currentDraft.requirements.materials.push({
        type: mat,
        amount: BUILD.currentDraft.materialReq[mat],
        sourceBiome: ISLAND_MATERIALS[mat].sourceBiome,
        unit: ISLAND_MATERIALS[mat].unit
      });
    }
  }

  // Initialize sourcing state
  BUILD.sourcingTiles.clear();
  BUILD.sourcingDraws = []; // Track all sourcing draws
  BUILD.wasteDestinations = []; // Track waste dump locations

  // Enter sourcing mode
  document.body.classList.add('sourcing-active');

  // Update panel header
  const tile = BUILD.selectedTile;
  const dims = BUILD.currentDraft.dimensions;
  $('sp-title').textContent = (design.name || 'UNTITLED BUILD').toUpperCase();
  $('sp-sub').textContent = dims
    ? `${dims.w}′ × ${dims.d}′ × ${dims.h}′ tall`
    : `${tile?.biome} · elev ${tile?.elev}`;

  // Set default death plan
  const deathSelect = $('sp-death');
  if (deathSelect && BUILD.currentDraft.deathPlan) {
    deathSelect.value = BUILD.currentDraft.deathPlan;
  }

  // Show design preview if we have designer intent
  const designPreview = $('sp-design-preview');
  const designQuote = $('sp-design-quote');
  if (designPreview && designQuote && BUILD.aiResult?.designerIntent) {
    designQuote.textContent = BUILD.aiResult.designerIntent;
    designPreview.style.display = 'block';
  } else if (designPreview) {
    designPreview.style.display = 'none';
  }

  renderSourcingOptions();
  panel.classList.add('active');

  // Initialize labor UI
  BUILD.laborSliderInitialized = false;
  updateLaborUI();

  // Initial display update (show build target marker)
  updateEligibilityDisplay();
}

export function closeSourcingPanel() {
  $('sourcing-panel')?.classList.remove('active');
  document.body.classList.remove('sourcing-active');
  BUILD.currentDraft = null;
  BUILD.sourcingTiles.clear();
  BUILD.sourcingDraws = [];
  BUILD.wasteDestinations = [];
  BUILD.activeMaterial = null;
  clearEligibilityMarkers();
}

function renderSourcingOptions() {
  const draft = BUILD.currentDraft;
  if (!draft) return;

  const container = $('sp-materials');
  if (!container) return;

  const materials = draft.requirements?.materials || [];
  const draws = BUILD.sourcingDraws || [];
  const buildTile = BUILD.selectedTile;

  let html = '';

  const state = BUILD.globalState;

  for (const m of materials) {
    const matDraws = draws.filter(d => d.material === m.type);
    const sourcedAmount = matDraws.reduce((sum, d) => sum + d.amount, 0);
    const remaining = m.amount - sourcedAmount;
    const satisfied = remaining <= 0;
    const isActive = BUILD.activeMaterial === m.type;

    // Check salvage availability
    const salvageAvail = state ? getSalvageTotal(state, m.type) : 0;
    const canUseSalvage = salvageAvail > 0 && remaining > 0;

    html += `<div class="sp-mat ${satisfied ? 'satisfied' : ''}" data-material="${m.type}">
      <div class="sp-mat-head">
        <span class="sp-mat-name">${ISLAND_MATERIALS[m.type]?.name || m.type}</span>
        <span class="sp-mat-counts">
          <span class="${satisfied ? 'done' : 'pending'}">${sourcedAmount.toLocaleString()}</span>
          / ${m.amount.toLocaleString()} ${m.unit}
        </span>
      </div>
      <div class="sp-mat-actions">
        <button class="sp-mat-cta ${satisfied ? 'satisfied' : ''} ${isActive ? 'active' : ''}"
                data-material="${m.type}" data-action="pick">
          ${satisfied ? '✓ FULLY SOURCED'
            : isActive ? `CLICK A ${m.sourceBiome.toUpperCase()} TILE`
            : `SOURCE FROM ${m.sourceBiome.toUpperCase()}`}
        </button>
        ${canUseSalvage ? `
        <button class="sp-salvage-btn" data-material="${m.type}" data-action="salvage">
          USE SALVAGE (${Math.min(salvageAvail, remaining).toLocaleString()} avail)
        </button>` : ''}
      </div>`;

    // Show each draw
    for (let i = 0; i < matDraws.length; i++) {
      const d = matDraws[i];
      const isSalvage = d.fromSalvage;
      const tileLabel = isSalvage ? 'SALVAGE' : `${d.tile.gx >= 0 ? '+' : ''}${d.tile.gx}·${d.tile.gy >= 0 ? '+' : ''}${d.tile.gy}`;
      const embodied = isSalvage ? '0.00' : (d.amount * (ISLAND_MATERIALS[m.type]?.embodiedCarbonPer || 0)).toFixed(2);
      const transport = (d.amount * 0.0000005 * d.distanceFt).toFixed(3);

      html += `<div class="sp-draw ${isSalvage ? 'salvage' : ''}">
        <div class="sp-draw-info">
          <span class="sp-draw-tile ${isSalvage ? 'salvage-tag' : ''}">${tileLabel}</span>
          <span class="sp-draw-detail">${d.amount.toLocaleString()} ${m.unit}${isSalvage ? '' : ` · ${Math.round(d.distanceFt)} ft`}</span>
          <span class="sp-draw-carbon">${isSalvage ? '0t carbon (recycled)' : `${embodied}t embodied · ${transport}t transport`}</span>
        </div>
        <button class="sp-draw-remove" data-material="${m.type}" data-idx="${i}">×</button>
      </div>`;
    }

    html += `</div>`;
  }

  // Waste section
  const wasteSoil = draft.wasteSoil || 0;
  if (wasteSoil > 0) {
    const wasteDeposits = BUILD.wasteDestinations || [];
    const depositedAmount = wasteDeposits.reduce((sum, w) => sum + w.amount, 0);
    const wasteRemaining = wasteSoil - depositedAmount;
    const wasteSatisfied = wasteRemaining <= 0;
    const isWasteActive = BUILD.activeMaterial === 'waste';

    html += `<div class="sp-mat sp-waste ${wasteSatisfied ? 'satisfied' : ''}" data-material="waste">
      <div class="sp-mat-head">
        <span class="sp-mat-name">EXCAVATION SOIL</span>
        <span class="sp-mat-counts">
          <span class="${wasteSatisfied ? 'done' : 'pending'}">${depositedAmount.toLocaleString()}</span>
          / ${wasteSoil.toLocaleString()} cu ft
        </span>
      </div>
      <button class="sp-mat-cta ${wasteSatisfied ? 'satisfied' : ''} ${isWasteActive ? 'active' : ''}"
              data-material="waste" data-action="pick">
        ${wasteSatisfied ? '✓ DESTINATION SET'
          : isWasteActive ? 'CLICK ANY TILE TO DUMP'
          : `SELECT DUMP DESTINATION (${wasteRemaining.toLocaleString()} cu ft)`}
      </button>
    </div>`;
  }

  // Carbon summary
  const totalEmbodied = draft.embodiedCarbon || 0;
  const totalTransport = draws.reduce((sum, d) =>
    sum + d.amount * 0.0000005 * d.distanceFt, 0);

  html += `<div class="sp-carbon-summary">
    <div class="sp-carbon-row">
      <span>Embodied CO₂</span><span>${totalEmbodied.toFixed(2)} t</span>
    </div>
    <div class="sp-carbon-row">
      <span>Transport CO₂</span><span>${totalTransport.toFixed(3)} t</span>
    </div>
    <div class="sp-carbon-row total">
      <span>Total CO₂</span><span>${(totalEmbodied + totalTransport).toFixed(2)} t</span>
    </div>
  </div>`;

  container.innerHTML = html;

  // Bind click handlers
  container.querySelectorAll('.sp-mat-cta').forEach(btn => {
    btn.onclick = () => {
      const mat = btn.dataset.material;
      BUILD.activeMaterial = (BUILD.activeMaterial === mat) ? null : mat;
      renderSourcingOptions();
      updateEligibilityDisplay();
    };
  });

  container.querySelectorAll('.sp-draw-remove').forEach(btn => {
    btn.onclick = () => {
      const mat = btn.dataset.material;
      const idx = parseInt(btn.dataset.idx);
      BUILD.sourcingDraws = BUILD.sourcingDraws.filter((d, i) =>
        !(d.material === mat && BUILD.sourcingDraws.filter(x => x.material === mat).indexOf(d) === idx)
      );
      // Simpler: find draws of this material and remove by index
      const matDraws = BUILD.sourcingDraws.filter(d => d.material === mat);
      if (matDraws[idx]) {
        BUILD.sourcingDraws = BUILD.sourcingDraws.filter(d => d !== matDraws[idx]);
      }
      renderSourcingOptions();
      checkCommitReady();
    };
  });

  // Salvage button handlers
  container.querySelectorAll('.sp-salvage-btn').forEach(btn => {
    btn.onclick = () => {
      const mat = btn.dataset.material;
      useSalvageForMaterial(mat);
    };
  });

  checkCommitReady();
}

// Use salvage inventory for a material
function useSalvageForMaterial(material) {
  const draft = BUILD.currentDraft;
  const state = BUILD.globalState;
  if (!draft || !state) return;

  const matReq = draft.requirements?.materials?.find(m => m.type === material);
  if (!matReq) return;

  // Calculate how much we still need
  const currentDraws = (BUILD.sourcingDraws || []).filter(d => d.material === material);
  const sourced = currentDraws.reduce((sum, d) => sum + d.amount, 0);
  const remaining = matReq.amount - sourced;

  if (remaining <= 0) return;

  // Check salvage availability
  const salvageAvail = getSalvageTotal(state, material);
  if (salvageAvail <= 0) return;

  // Take what we can from salvage
  const amount = Math.min(salvageAvail, remaining);

  // Add as a salvage draw (zero distance, flagged as salvage)
  BUILD.sourcingDraws = BUILD.sourcingDraws || [];
  BUILD.sourcingDraws.push({
    material,
    tile: { gx: 0, gy: 0 }, // placeholder
    amount,
    distanceFt: 0, // zero transport for salvage
    fromSalvage: true
  });

  // Re-render
  renderSourcingOptions();
}

// Check if all materials are sourced and enable/disable commit button
function checkCommitReady() {
  const draft = BUILD.currentDraft;
  if (!draft) return;

  const materials = draft.requirements?.materials || [];
  const draws = BUILD.sourcingDraws || [];

  const allSourced = materials.every(m => {
    const sourced = draws.filter(d => d.material === m.type)
                         .reduce((sum, d) => sum + d.amount, 0);
    return sourced >= m.amount;
  });

  // Also check labor allocation
  const laborSlider = $('sp-labor-slider');
  const laborAllocation = laborSlider ? parseInt(laborSlider.value) : 0;
  const hasLabor = laborAllocation > 0;

  const commitBtn = $('sp-commit-btn');
  if (commitBtn) {
    const ready = allSourced && hasLabor;
    commitBtn.disabled = !ready;
    if (!allSourced) {
      commitBtn.textContent = 'SOURCE ALL MATERIALS FIRST';
    } else if (!hasLabor) {
      commitBtn.textContent = 'ALLOCATE LABOR FIRST';
    } else {
      commitBtn.textContent = 'COMMIT BUILD';
    }
  }
}

// Update labor allocation UI
function updateLaborUI() {
  const draft = BUILD.currentDraft;
  const state = BUILD.globalState;
  if (!draft || !state) return;

  // Get construction labor from draft (set by AI/import)
  const constructionLabor = draft.laborReq || 500; // Default 500 hrs if not set

  // Get grading labor from selected tiles
  const gradingLabor = calculateLevelingLabor();

  const totalLabor = constructionLabor + gradingLabor;

  // Update summary
  const constructionEl = $('sp-labor-construction');
  const gradingEl = $('sp-labor-grading');
  const gradingRow = $('sp-labor-grading-row');
  const totalEl = $('sp-labor-total');

  if (constructionEl) constructionEl.textContent = `${constructionLabor.toLocaleString()} hrs`;
  if (gradingEl) gradingEl.textContent = `${gradingLabor.toLocaleString()} hrs`;
  if (gradingRow) gradingRow.style.display = gradingLabor > 0 ? 'flex' : 'none';
  if (totalEl) totalEl.textContent = `${totalLabor.toLocaleString()} hrs`;

  // Store total on draft
  draft.totalLaborHours = totalLabor;

  // Update available labor
  const available = getAvailableLabor(state);
  const total = getTotalLaborPerDay(state);
  const availableEl = $('sp-labor-available');
  if (availableEl) availableEl.textContent = `${available} of ${total} available`;

  // Update slider max
  const slider = $('sp-labor-slider');
  if (slider) {
    slider.max = available;
    // Cap current value if needed
    if (parseInt(slider.value) > available) {
      slider.value = available;
    }
    // Default to reasonable allocation (50% of available, or enough to finish in ~7 days)
    if (!BUILD.laborSliderInitialized) {
      const suggestedAllocation = Math.min(available, Math.ceil(totalLabor / 7));
      slider.value = Math.max(10, suggestedAllocation);
      BUILD.laborSliderInitialized = true;
    }
  }

  updateLaborEstimate();
}

// Update labor estimate based on slider value
function updateLaborEstimate() {
  const draft = BUILD.currentDraft;
  if (!draft) return;

  const slider = $('sp-labor-slider');
  const sliderVal = $('sp-labor-slider-val');
  const estimateEl = $('sp-labor-estimate');

  if (!slider) return;

  const allocation = parseInt(slider.value);
  if (sliderVal) sliderVal.textContent = allocation;

  const totalLabor = draft.totalLaborHours || 0;

  if (estimateEl) {
    if (allocation <= 0) {
      estimateEl.textContent = 'No labor allocated';
    } else {
      const days = Math.ceil(totalLabor / allocation);
      estimateEl.textContent = `~${days} day${days !== 1 ? 's' : ''} to complete`;
    }
  }

  // Store allocation on draft
  draft.laborAllocation = allocation;

  // Recheck commit ready
  checkCommitReady();
}

// Initialize labor slider event handler
function initLaborSlider() {
  const slider = $('sp-labor-slider');
  if (slider) {
    slider.addEventListener('input', updateLaborEstimate);
  }
}

// Call init on module load
initLaborSlider();

// Calculate distance between two tiles (in feet)
function tileDistance(t1, t2) {
  const TILE_SIZE = 130; // feet per tile
  const dx = (t1.gx - t2.gx) * TILE_SIZE;
  const dy = (t1.gy - t2.gy) * TILE_SIZE;
  return Math.sqrt(dx * dx + dy * dy);
}

// Update eligibility markers on the map
function updateEligibilityDisplay() {
  const state = BUILD.globalState;
  if (!state) return;

  const mode = state.viewMode || 'atlas';

  // Always render live sourcing threads during sourcing mode
  if (BUILD.currentDraft) {
    renderLiveSourcingThreads(
      state,
      mode,
      BUILD.selectedTile,
      BUILD.sourcingDraws,
      BUILD.wasteDestinations
    );
  }

  if (!BUILD.activeMaterial) {
    // Still show threads but clear eligibility markers
    const markersGroup = document.getElementById('eligibility-markers');
    if (markersGroup) markersGroup.innerHTML = '';
    return;
  }

  renderEligibilityMarkers(
    state,
    mode,
    BUILD.activeMaterial,
    BUILD.selectedTile,
    BUILD.sourcingDraws,
    BUILD.wasteDestinations
  );
}

export function selectSourceTile(material, tile) {
  if (!BUILD.currentDraft) {
    showSourcingError('no-active-material');
    return false;
  }

  if (!BUILD.activeMaterial) {
    showSourcingError('no-active-material');
    return false;
  }

  const draft = BUILD.currentDraft;
  const state = BUILD.globalState;
  const buildTile = BUILD.selectedTile;

  // Check water tile
  if (tile.biome === 'water') {
    showSourcingError('water-tile');
    return false;
  }

  // Check if tile is already built
  if (tile.built) {
    showSourcingError('tile-built');
    return false;
  }

  if (BUILD.activeMaterial === 'waste') {
    // Dumping waste
    const wasteSoil = draft.wasteSoil || 0;
    const deposited = (BUILD.wasteDestinations || []).reduce((s, w) => s + w.amount, 0);
    const remaining = wasteSoil - deposited;
    if (remaining <= 0) return false;

    // Check dump capacity
    const dumpCapacity = tileDumpRemaining(state, tile);
    if (dumpCapacity <= 0) {
      showSourcingError('tile-full');
      return false;
    }

    const dumpAmount = Math.min(dumpCapacity, remaining);

    BUILD.wasteDestinations = BUILD.wasteDestinations || [];
    BUILD.wasteDestinations.push({
      tile: { gx: tile.gx, gy: tile.gy },
      amount: dumpAmount,
      distanceFt: tileDistance(tile, buildTile)
    });

    showSourcingSuccess('soil', dumpAmount, 'cu ft');

    // Auto-deactivate if fully placed
    if (deposited + dumpAmount >= wasteSoil) {
      BUILD.activeMaterial = null;
    }

    renderSourcingOptions();
    updateEligibilityDisplay();
    return true;
  }

  // Sourcing material
  const matReq = draft.requirements?.materials?.find(m => m.type === material);
  if (!matReq) return false;

  // Check biome match
  if (tile.biome !== matReq.sourceBiome) {
    showSourcingError('wrong-biome');
    return false;
  }

  // Check tile yield
  const tileYield = tileRemainingYield(state, tile, material);
  if (tileYield <= 0) {
    showSourcingError('tile-depleted');
    return false;
  }

  // Calculate how much we still need
  const currentDraws = (BUILD.sourcingDraws || []).filter(d => d.material === material);
  const sourced = currentDraws.reduce((sum, d) => sum + d.amount, 0);
  const remaining = matReq.amount - sourced;

  if (remaining <= 0) return false;

  // Take what we can from this tile (up to what we need)
  const amount = Math.min(tileYield, remaining);
  const distanceFt = tileDistance(tile, buildTile);

  BUILD.sourcingDraws = BUILD.sourcingDraws || [];
  BUILD.sourcingDraws.push({
    material,
    tile: { gx: tile.gx, gy: tile.gy },
    amount,
    distanceFt,
    fromSalvage: false
  });

  BUILD.sourcingTiles.set(material, tile);

  // Show success toast
  const unit = ISLAND_MATERIALS[material]?.unit || 'units';
  showSourcingSuccess(material, amount, unit);

  // Auto-deactivate if fully sourced
  if (sourced + amount >= matReq.amount) {
    BUILD.activeMaterial = null;
  }

  // Re-render and check commit ready
  renderSourcingOptions();
  updateEligibilityDisplay();
  return true;
}

// ─── COMMIT ─────────────────────────────────────────────────────────
export function commitSourcing(state) {
  const draft = BUILD.currentDraft;
  if (!draft) return;

  const tile = BUILD.selectedTile;
  if (!tile) return;

  // Use the detailed draws from sourcing panel
  const draws = (BUILD.sourcingDraws || []).map(d => ({
    fromTile: d.tile,
    material: d.material,
    amount: d.amount,
    distanceFt: d.distanceFt,
    fromSalvage: d.fromSalvage || false
  }));

  // Get waste destinations
  const wasteDestinations = (BUILD.wasteDestinations || []).map(w => ({
    toTile: w.tile,
    wasteType: 'soil',
    amount: w.amount,
    distanceFt: w.distanceFt
  }));

  // Get selected death plan
  const deathPlanSelect = $('sp-death');
  const deathPlan = deathPlanSelect?.value || draft.deathPlan || 'demolish-salvage';

  // Copy AI spec and generate geometry if available
  if (BUILD.aiResult?.spec && BUILD.aiResult?.reqs) {
    draft.aiSpec = BUILD.aiResult.spec;
    draft.designerIntent = BUILD.aiResult.designerIntent;
    draft.valueSystemCritique = BUILD.aiResult.valueSystemCritique;
    // Generate 3D geometry for rendering
    draft.geometry = generateBuildingGeometry(BUILD.aiResult.spec, BUILD.aiResult.reqs);
  }

  // Build the sourcing object expected by commitBuild
  const sourcing = {
    draws,
    wasteDestinations,
    deathPlan
  };

  // Commit the build using schema's commitBuild
  const build = commitBuild(state, draft, sourcing);

  // Mark tile as built with building info
  tile.built = true;
  tile.buildId = build.id;
  tile.populated = {
    kind: BUILD.aiResult ? 'ai' : 'structure',
    name: build.name,
    floors: BUILD.aiResult?.spec?.floors || 1,
    condition: 1.0,
    progressFraction: 0,
    visibleFloors: 0,
    geo: draft.geometry || null,
    spec: BUILD.aiResult?.spec || null
  };

  // Update ledger
  if (state.ledger) {
    for (const draw of draws) {
      if (state.ledger[draw.material] !== undefined) {
        state.ledger[draw.material] = Math.max(0, state.ledger[draw.material] - draw.amount);
      }
    }
  }

  // Copy construction days and stories to build
  build.constructionDays = draft.constructionDays || 30;
  build.stories = BUILD.aiResult?.spec?.floors || 1;

  // Set up labor hours for new build system
  build.totalLaborHours = draft.totalLaborHours || 500;
  build.accumulatedLaborHours = 0;
  build.laborAllocation = draft.laborAllocation || 0;

  // Allocate labor from the pool
  if (state.island.laborPool) {
    allocateLabor(state, build.id, build.laborAllocation);
  }

  // Start construction animation
  startConstruction(build);

  // Clean up
  closeSourcingPanel();
  BUILD.selectedTile = null;
  BUILD.currentDraft = null;
  BUILD.aiResult = null;
  BUILD.importedGeometry = null;
  BUILD.sourcingDraws = [];
  BUILD.wasteDestinations = [];

  // Show success toast
  showBuildCommit(build.name);

  console.log('Build committed:', build.name, 'on tile', tile.id);

  return build;
}

// ─── REPORT CARD ────────────────────────────────────────────────────
export function openReportCard(tile, state) {
  const build = state.island.builds.find(b =>
    b.primaryTile?.gx === tile.gx && b.primaryTile?.gy === tile.gy
  );
  if (!build) return;

  // Open the new build profile visualization
  openBuildProfile(build, state);

  const card = $('report-card');
  if (!card) return;

  $('rc-title').textContent = build.name || 'UNTITLED BUILD';
  $('rc-sub').textContent = `${build.author} · ${tile.biome} · elev ${tile.elev}`;

  // Calculate age and condition
  const gameDay = state.island.gameDay || 1;
  const builtDay = build.builtOnDay || 1;
  const age = gameDay - builtDay;
  const condition = tile.populated?.condition ?? 1.0;
  const conditionPct = Math.round(condition * 100);

  // Calculate total materials used
  const materials = build.draws || [];
  const matTotals = { timber: 0, stone: 0, brick: 0 };
  let longestDraw = 0;
  for (const d of materials) {
    if (matTotals[d.material] !== undefined) {
      matTotals[d.material] += d.amount;
    }
    if (d.distanceFt > longestDraw) longestDraw = d.distanceFt;
  }

  const totalMat = matTotals.timber + matTotals.stone + matTotals.brick;
  const timberPct = totalMat > 0 ? Math.round((matTotals.timber / totalMat) * 100) : 0;
  const stonePct = totalMat > 0 ? Math.round((matTotals.stone / totalMat) * 100) : 0;
  const brickPct = totalMat > 0 ? Math.round((matTotals.brick / totalMat) * 100) : 0;

  // Carbon totals
  const embodiedCarbon = build.embodiedCarbon || 0;
  const transportCarbon = build.transportCarbon || 0;
  const totalCarbon = embodiedCarbon + transportCarbon;

  // Death plan info
  const deathPlanLabels = {
    'demolish-salvage': 'DEMOLISH + SALVAGE (~80% recovery)',
    'abandon': 'ABANDON (decay to ruin)',
    'dismantle-return': 'DISMANTLE + RETURN (~95% recovery)'
  };
  const deathPlanLabel = deathPlanLabels[build.deathPlan] || build.deathPlan || 'not set';

  // Render build details
  const body = $('rc-body');
  if (body) {
    let html = `
      <div class="rc-section">
        <div class="rc-sec-title">STATUS</div>
        <div class="rc-row"><span>AGE</span><span>${age} days</span></div>
        <div class="rc-row"><span>CONDITION</span><span class="${conditionPct < 50 ? 'warn' : ''}">${conditionPct}%</span></div>
        <div class="rc-row"><span>STATUS</span><span>${build.status || 'standing'}</span></div>
      </div>

      <div class="rc-section">
        <div class="rc-sec-title">MATERIALS</div>
        <div class="rc-chart">
          <div class="rc-bar">
            ${timberPct > 0 ? `<div class="rc-bar-seg timber" style="width:${timberPct}%" title="Timber ${timberPct}%"></div>` : ''}
            ${stonePct > 0 ? `<div class="rc-bar-seg stone" style="width:${stonePct}%" title="Stone ${stonePct}%"></div>` : ''}
            ${brickPct > 0 ? `<div class="rc-bar-seg brick" style="width:${brickPct}%" title="Brick ${brickPct}%"></div>` : ''}
          </div>
          <div class="rc-bar-legend">
            ${timberPct > 0 ? `<span class="rc-leg timber">TIMBER ${matTotals.timber.toLocaleString()}</span>` : ''}
            ${stonePct > 0 ? `<span class="rc-leg stone">STONE ${matTotals.stone.toLocaleString()}</span>` : ''}
            ${brickPct > 0 ? `<span class="rc-leg brick">BRICK ${matTotals.brick.toLocaleString()}</span>` : ''}
          </div>
        </div>
        <div class="rc-row"><span>LONGEST DRAW</span><span>${Math.round(longestDraw).toLocaleString()} ft</span></div>
      </div>

      <div class="rc-section">
        <div class="rc-sec-title">CARBON FOOTPRINT</div>
        <div class="rc-row"><span>EMBODIED</span><span>${embodiedCarbon.toFixed(2)} t CO₂</span></div>
        <div class="rc-row"><span>TRANSPORT</span><span>${transportCarbon.toFixed(3)} t CO₂</span></div>
        <div class="rc-row total"><span>TOTAL</span><span>${totalCarbon.toFixed(2)} t CO₂</span></div>
      </div>

      <div class="rc-section">
        <div class="rc-sec-title">DEATH PLAN</div>
        <div class="rc-death-plan">${deathPlanLabel}</div>
      </div>`;

    // Designer intent
    if (build.designerIntent) {
      html += `
      <div class="rc-section rc-intent">
        <div class="rc-sec-title">DESIGNER INTENT</div>
        <div class="rc-quote">"${build.designerIntent}"</div>
      </div>`;
    }

    // Hidden ledger critique
    if (build.valueSystemCritique) {
      html += `
      <div class="rc-section rc-critique">
        <div class="rc-sec-title">HIDDEN LEDGER</div>
        <div class="rc-critique-text">${build.valueSystemCritique}</div>
      </div>`;
    }

    // Sourcing map - show where materials came from
    if (materials.length > 0) {
      html += `
      <div class="rc-section">
        <div class="rc-sec-title">SOURCING</div>
        <div class="rc-sourcing-list">
          ${materials.map(d => {
            const tileLabel = d.fromTile
              ? `${d.fromTile.gx >= 0 ? '+' : ''}${d.fromTile.gx}·${d.fromTile.gy >= 0 ? '+' : ''}${d.fromTile.gy}`
              : 'local';
            return `<div class="rc-source-item">
              <span class="rc-source-mat ${d.material}">${d.material}</span>
              <span class="rc-source-tile">${tileLabel}</span>
              <span class="rc-source-dist">${Math.round(d.distanceFt || 0)} ft</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }

    body.innerHTML = html;
  }

  card.classList.add('active');
}

export function closeReportCard() {
  $('report-card')?.classList.remove('active');
}

// ─── EVENT BINDINGS ─────────────────────────────────────────────────
export function initBuildHandlers(state) {
  // Store global state reference for commit
  BUILD.globalState = state;

  // Build modal buttons
  $('bm-cancel')?.addEventListener('click', closeBuildModal);
  $('bm-ai')?.addEventListener('click', openBuildWizard);  // Use new wizard flow
  $('bm-import')?.addEventListener('click', openImportModal);

  // AI modal buttons
  $('ai-cancel')?.addEventListener('click', closeAiModal);
  $('ai-cancel-result')?.addEventListener('click', closeAiModal);
  $('ai-accept-btn')?.addEventListener('click', aiAcceptDesign);
  $('ai-regenerate')?.addEventListener('click', runAiGenerate);

  // API key input handlers
  $('ai-apikey-cancel')?.addEventListener('click', () => {
    showAiStage('prompt');
  });
  $('ai-apikey-submit')?.addEventListener('click', () => {
    const keyInput = $('ai-apikey-input');
    const key = keyInput?.value?.trim();
    if (!key) {
      keyInput?.focus();
      return;
    }
    setApiKey(key);
    localStorage.setItem('anthropic_api_key', key);
    // Continue with generation
    runAiGenerate();
  });

  // Import modal buttons
  $('import-cancel')?.addEventListener('click', closeImportModal);
  $('import-cancel-declare')?.addEventListener('click', closeImportModal);
  $('import-back')?.addEventListener('click', () => showImportStage('pick'));
  $('import-accept-btn')?.addEventListener('click', importAcceptDesign);

  // Report card close
  $('rc-close')?.addEventListener('click', closeReportCard);

  // Build profile close
  $('bpp-close')?.addEventListener('click', closeBuildProfile);

  // Sourcing panel
  $('sp-cancel')?.addEventListener('click', closeSourcingPanel);
  $('sp-commit-btn')?.addEventListener('click', () => {
    const build = commitSourcing(BUILD.globalState);
    if (build) {
      // Trigger re-render of the island
      if (typeof BUILD.globalState._renderCallback === 'function') {
        BUILD.globalState._renderCallback();
      }
    }
  });

  // AI preset chips - populate and bind
  const presetChips = [
    { label: 'timber cabin', prompt: 'A small one-story timber cabin with stone foundation and a pitched cedar roof. Modest, lived-in.' },
    { label: 'brick warehouse', prompt: 'A four-story brick warehouse with wide arched windows and a flat roof. Industrial, civic.' },
    { label: 'stone tower', prompt: 'A massive stone tower, cyclopean masonry, narrow slit windows, conical capstone. Defensive, ancient.' },
    { label: 'barn', prompt: 'A timber-framed barn with sloped roof, large hay doors, and a stone footing course. Agricultural, generous.' }
  ];

  const chipsContainer = $('ai-preset-chips');
  if (chipsContainer) {
    chipsContainer.innerHTML = presetChips.map(c =>
      `<button class="ai-chip" type="button">${c.label}</button>`
    ).join('');

    chipsContainer.querySelectorAll('.ai-chip').forEach((chip, i) => {
      chip.addEventListener('click', () => {
        setAiPrompt(presetChips[i].prompt);
      });
    });
  }

  // AI generate button
  $('ai-generate-btn')?.addEventListener('click', runAiGenerate);

  // Import file handling
  const filePicker = $('im-file');
  const dropZone = $('im-drop');

  if (filePicker) {
    filePicker.addEventListener('change', (e) => {
      if (e.target.files[0]) handleImportFile(e.target.files[0]);
    });
  }

  if (dropZone) {
    dropZone.addEventListener('click', () => filePicker?.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer?.files[0];
      if (file) handleImportFile(file);
    });
  }

  // Secondary material toggle
  $('im-secondary')?.addEventListener('change', (e) => {
    const splitRow = $('im-split-row');
    if (splitRow) {
      splitRow.style.display = e.target.value !== 'none' ? 'block' : 'none';
    }
  });

  // Split slider display
  $('im-split')?.addEventListener('input', (e) => {
    const pct = e.target.value;
    $('im-split-pct').textContent = `${pct}% / ${100 - pct}%`;
  });

}
