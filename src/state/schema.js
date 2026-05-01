// ════════════════════════════════════════════════════════════════════
// THESIS SCHEMA — BUILD RECORDS + COMMIT LOGIC
//
// This is the data model that enacts the thesis. Every shape here encodes
// a thesis principle — together they make the value-system grading legible
// and the hidden ledger queryable.
//
// Core record types:
//   Build         — a committed structure on one or more tiles
//   MaterialDraw  — a sourcing decision (this build, this tile, this material, this amount)
//   WasteDeposit  — a waste destination decision (this build dumps X on this tile)
//   LaborLink     — labor sourced from a manufacturing facility (sawmill, kiln, quarry)
//   SalvageItem   — recovered material from a demolished build, available for reuse
//   ReportCard    — the retroactive constitution computed from the above
//
// Three thesis-critical principles encoded:
//   1. Every consequence has a tile address. No "fades into the world" — material
//      comes from somewhere specific, waste goes somewhere specific.
//   2. The ledger is hidden by default and revealed via toggle. The data exists
//      always; the UI chooses when to show it.
//   3. Builds plan their endings at birth. deathPlan is required at commit time.
// ════════════════════════════════════════════════════════════════════

import { ISLAND_MATERIALS, COMPONENT_BLOCKS } from './materials.js';
import { tileExtractionFor, tileDistance } from './extraction.js';

// ── TIME HELPERS ────────────────────────────────────────────────────

// Compute the in-game day from wall-clock. 1 real second = 1 game day.
export function currentGameDay(state) {
  const elapsedMs = Date.now() - (state.island.gameHourStart || Date.now());
  const elapsedSeconds = elapsedMs / 1000;
  return Math.floor(state.island.gameDay + elapsedSeconds);
}

// ── BUILD RECORD CONSTRUCTOR ────────────────────────────────────────
//
// Build record shape:
//   {
//     id:           number,         // unique across session
//     author:       string,         // architect username
//     authorSpecies:'human',
//     name:         string,         // architect-provided or auto
//     method:       'voxel'|'import'|'ai'|'genes',
//     tiles:        [{gx,gy}, ...], // claimed tiles (can be multi-tile)
//     primaryTile:  {gx,gy},        // the "address" tile (for hover etc.)
//     voxels:       [Voxel, ...],   // for method='voxel'
//     dimensions:   {w, h, d},      // bounding box in feet
//     committedDay: number,         // game-day of commit
//     constructionDays: number,     // days to complete
//     condition:    1.0,            // 0..1, drops as it deteriorates
//     lastMaintained: number,       // game-day
//     deathPlan:    string,         // key into DEATH_PLANS
//     materialReq:  { timber, stone, brick }, // commitments from voxels
//     laborReq:     number,         // person-days
//     wasteReq:     { soil, debris }, // bundle of waste byproducts
//     waterReq:     number,         // gal
//     embodiedCarbon: number,       // tons CO₂
//     status:       'designing'|'sourcing'|'constructing'|'standing'|'deteriorating'|'demolished'|'ruin',
//     // NEW: Polygon-based building fields
//     polygon:      FootprintPolygon, // footprint polygon from tile union (optional)
//     genes:        ArchitecturalGenes, // AI-generated architectural genes (optional)
//   }
//
// FootprintPolygon shape (from tile selection):
//   {
//     vertices:     [{x, y}, ...],  // polygon vertices in feet, counter-clockwise
//     bounds:       {minX, maxX, minY, maxY, width, height},
//     centroid:     {x, y},
//     area:         number,         // sq ft
//     shapeType:    'rect'|'L'|'linear'|'square'|'irregular',
//     tileCount:    number,
//     tiles:        [{gx, gy}, ...]
//   }
//
// ArchitecturalGenes shape (AI-generated):
//   {
//     name:         string,
//     description:  string,
//     massStrategy: 'extrude'|'stack'|'carve'|'additive'|'courtyard',
//     verticalProfile: 'uniform'|'stepped'|'tapered'|'cantilevered',
//     roofForm:     'flat'|'pitched'|'shed'|'sawtooth'|'green',
//     character:    'domestic'|'civic'|'industrial'|'vernacular'|'experimental',
//     materialPalette: { primary, secondary, accent, primaryRatio },
//     features:     [{ type, location, intensity }, ...],
//     mutations:    { asymmetry, irregularity, articulation, fenestrationDensity },
//     floors:       { min, max, preferred },
//     floorHeight:  number,
//     baseCondition: 'at-grade'|'raised'|'pilotis',
//     designer_intent: string,
//     value_system_critique: string
//   }
//
// Voxel record shape:
//   { x, y, z,                      // grid position (in feet) on tile
//     component: 'stud'|'brick'|...,
//     rotation: 0|90|180|270        // y-axis rotation
//   }
//
// MaterialDraw shape (extended with supply chain):
//   {
//     buildId,
//     material,                              // Output material (e.g., 'brick', 'concrete')
//     amount,                                // Amount of material
//     // Source chain
//     rawSourceTile: { gx, gy, biome },     // Where raw material originates
//     rawMaterial,                           // Type of raw material (e.g., 'clay', 'sand')
//     rawAmount,                             // Amount of raw material consumed
//     // Processing
//     processingBuilding: {                  // Processing facility (null if raw material)
//       id,
//       name,
//       tile: { gx, gy },
//       subtype                              // 'sawmill', 'brickKiln', 'concretePlant', 'glassFurnace'
//     },
//     processingLabor,                       // Person-hours for processing
//     // Delivery
//     toTile: { gx, gy },                   // Build site
//     distanceFt,                            // Transport distance
//     fromSalvage,                           // Whether sourced from salvage
//     depletionFraction                      // How much tile is depleted
//   }
//
// LaborBreakdown shape:
//   {
//     extraction,                            // Hours at source tiles
//     processing,                            // Hours at facilities
//     transport,                             // Hours hauling
//     construction,                          // Hours on site
//     total                                  // Sum of all labor
//   }
//
// WasteDeposit shape:
//   { buildId, toTile:{gx,gy}, wasteType:'soil'|'debris'|'carbon', amount, distanceFt }
//
// LaborLink shape:
//   { buildId, fromBuildId:?number, type:'unspecialized'|'sawmill'|'kiln'|'quarry', personDays }

export function createBuildDraft(state, opts) {
  return {
    id: state.island.nextBuildId++,
    author: opts.author || state.user?.name || 'anon',
    authorSpecies: 'human',
    name: opts.name || 'Untitled build',
    method: opts.method || 'voxel',
    tiles: opts.tiles || [opts.primaryTile],
    primaryTile: opts.primaryTile,
    voxels: [],
    dimensions: { w: 0, h: 0, d: 0 },
    committedDay: null,
    constructionDays: null,
    condition: 1.0,
    lastMaintained: null,
    deathPlan: null,
    materialReq: { timber: 0, stone: 0, brick: 0 },
    laborReq: 0,
    wasteReq: { soil: 0, debris: 0 },
    waterReq: 0,
    embodiedCarbon: 0,
    status: 'designing',
    // NEW: Polygon-based building fields
    polygon: opts.polygon || null,
    genes: opts.genes || null
  };
}

// ── REQUIREMENT COMPUTATION ─────────────────────────────────────────

// Recompute material/labor/waste/carbon requirements from the voxel list.
// Called every time the player edits the design.
export function recomputeBuildRequirements(build) {
  const req = { timber: 0, stone: 0, brick: 0 };
  let totalVolume = 0;

  for (const v of build.voxels) {
    const comp = COMPONENT_BLOCKS[v.component];
    if (!comp) continue;
    req[comp.material] += comp.cost;
    totalVolume += comp.dims[0] * comp.dims[1] * comp.dims[2];
  }

  build.materialReq = req;

  // Simple rule: foundation soil excavation = 10% of total volume in cu ft
  build.wasteReq.soil = Math.round(totalVolume * 0.10);

  // Water: 0.05 gal per cu ft of total build volume (mortar mixing etc.)
  build.waterReq = Math.round(totalVolume * 0.05);

  // Embodied carbon
  let carbon = 0;
  for (const mat of ['timber', 'stone', 'brick']) {
    carbon += req[mat] * (ISLAND_MATERIALS[mat].embodiedCarbonPer || 0);
  }
  build.embodiedCarbon = +carbon.toFixed(2);

  // Labor: 1 person-day per 100 cu ft of volume, min 2
  build.laborReq = Math.max(2, Math.round(totalVolume / 100));

  // Construction takes laborReq / 4 days assuming 4 people work at once
  build.constructionDays = Math.max(1, Math.ceil(build.laborReq / 4));

  return build;
}

// ── COMMIT BUILD ────────────────────────────────────────────────────

// Commit a build draft + its sourcing decisions to the island state.
// sourcing = {
//   draws: [{ fromTile:{gx,gy}, material, amount, fromSalvage? }, ...],
//   wasteDestinations: [{ toTile:{gx,gy}, wasteType, amount }, ...],
//   waterFromTile: {gx,gy},
//   deathPlan: 'demolish-salvage' | ...
// }
export function commitBuild(state, build, sourcing) {
  // Apply tile extractions
  for (const draw of sourcing.draws) {
    // Skip salvage draws — they don't extract from tiles
    if (draw.fromSalvage) continue;

    const ext = tileExtractionFor(state, draw.fromTile.gx, draw.fromTile.gy);
    if (draw.material === 'brick') {
      ext.brick_clay += draw.amount * ISLAND_MATERIALS.brick.soilCostPerBrick;
    } else {
      ext[draw.material] = (ext[draw.material] || 0) + draw.amount;
    }

    state.island.materialDraws.push({
      buildId: build.id,
      fromTile: draw.fromTile,
      material: draw.material,
      amount: draw.amount,
      fromSalvage: false,
      distanceFt: tileDistance(
        draw.fromTile.gx, draw.fromTile.gy,
        build.primaryTile.gx, build.primaryTile.gy
      )
    });
  }

  // Record salvage draws separately (zero transport carbon)
  for (const draw of sourcing.draws) {
    if (!draw.fromSalvage) continue;

    state.island.materialDraws.push({
      buildId: build.id,
      fromTile: null,
      material: draw.material,
      amount: draw.amount,
      fromSalvage: true,
      distanceFt: 0
    });
  }

  // Apply waste deposits
  for (const wd of sourcing.wasteDestinations) {
    if (wd.wasteType === 'soil') {
      const ext = tileExtractionFor(state, wd.toTile.gx, wd.toTile.gy);
      ext.soilDumped += wd.amount;
    }

    state.island.wasteDeposits.push({
      buildId: build.id,
      toTile: wd.toTile,
      wasteType: wd.wasteType,
      amount: wd.amount,
      distanceFt: tileDistance(
        wd.toTile.gx, wd.toTile.gy,
        build.primaryTile.gx, build.primaryTile.gy
      )
    });
  }

  // Embodied carbon goes to the atmosphere ledger
  state.island.atmosphereCarbon += build.embodiedCarbon;
  state.island.wasteDeposits.push({
    buildId: build.id,
    toTile: null,                  // atmosphere has no tile
    wasteType: 'carbon',
    amount: build.embodiedCarbon,
    distanceFt: 0
  });

  // Labor: for now, all unspecialized
  state.island.laborLinks.push({
    buildId: build.id,
    fromBuildId: null,
    type: 'unspecialized',
    personDays: build.laborReq
  });

  // Mark build as committed + constructing
  build.committedDay = currentGameDay(state);
  build.deathPlan = sourcing.deathPlan;
  build.status = 'constructing';
  build.lastMaintained = build.committedDay;

  state.island.builds.push(build);

  return build;
}

// ── REPORT CARD ─────────────────────────────────────────────────────

// Generate a report card for any build by aggregating its records.
export function generateReportCard(state, build) {
  const draws = state.island.materialDraws.filter(d => d.buildId === build.id);
  const wastes = state.island.wasteDeposits.filter(w => w.buildId === build.id);
  const labor = state.island.laborLinks.filter(l => l.buildId === build.id);

  // Hidden-ledger metrics
  let transportCarbon = 0;
  for (const draw of draws) {
    if (draw.fromSalvage) continue;  // salvage has zero transport carbon
    // Rough: 0.0000005 tons CO₂ per unit per ft transported
    transportCarbon += draw.amount * 0.0000005 * draw.distanceFt;
  }

  const landDraws = draws.filter(d => !d.fromSalvage);
  const longestDraw = landDraws.length ? Math.max(...landDraws.map(d => d.distanceFt)) : 0;

  // Count tiles used from salvage vs fresh extraction
  const salvageDraws = draws.filter(d => d.fromSalvage);

  return {
    build,
    draws,
    wastes,
    labor,
    hiddenLedger: {
      transportCarbon: +transportCarbon.toFixed(4),
      longestDrawFt: longestDraw,
      atmosphereTotal: state.island.atmosphereCarbon,
      salvageUsed: salvageDraws.reduce((sum, d) => sum + d.amount, 0),
      freshExtraction: landDraws.reduce((sum, d) => sum + d.amount, 0)
    }
  };
}

// ── STATE INITIALIZATION ────────────────────────────────────────────

// Initialize the thesis-specific parts of state.island
export function initializeThesisState(state) {
  state.island = state.island || {};
  state.island.builds = state.island.builds || [];
  state.island.materialDraws = state.island.materialDraws || [];
  state.island.wasteDeposits = state.island.wasteDeposits || [];
  state.island.laborLinks = state.island.laborLinks || [];
  state.island.salvageInventory = state.island.salvageInventory || {};
  state.island.tileExtraction = state.island.tileExtraction || {};
  state.island.atmosphereCarbon = state.island.atmosphereCarbon || 0;
  state.island.gameDay = state.island.gameDay || 1;
  state.island.gameHourStart = state.island.gameHourStart || Date.now();
  state.island.nextBuildId = state.island.nextBuildId || 1;

  return state;
}
