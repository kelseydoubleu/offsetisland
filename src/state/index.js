// ════════════════════════════════════════════════════════════════════
// STATE MODULE — RE-EXPORTS
// Clean entry point for importing thesis state machinery.
// ════════════════════════════════════════════════════════════════════

// Materials & constants
export {
  ISLAND_MATERIALS,
  COMPONENT_BLOCKS,
  DEATH_PLANS,
  DETERIORATION_PER_DAY,
  TILE_SIZE_FT,
  TILE_DUMP_MAX,
  BUILDING_CATALOG
} from './materials.js';

// Species
export { SPECIES } from './species.js';

// Extraction & tile helpers
export {
  tileKey,
  tileExtractionFor,
  tileRemainingYield,
  tileDepletion,
  tileDumpAmount,
  tileDumpFraction,
  tileDumpRemaining,
  tileDistance,
  // Simplified depletion tracking
  getTileDepletionFraction,
  canTileAcceptDepletion,
  applyTileDepletion
} from './extraction.js';

// Salvage inventory
export {
  ensureSalvageInventory,
  addSalvage,
  getSalvageTotal,
  consumeSalvage
} from './salvage.js';

// Schema & build logic
export {
  currentGameDay,
  createBuildDraft,
  recomputeBuildRequirements,
  commitBuild,
  generateReportCard,
  initializeThesisState
} from './schema.js';

// Labor pool
export {
  getTotalLaborPerDay,
  getAllocatedLabor,
  getAvailableLabor,
  getIdleLaborPercent,
  allocateLabor,
  deallocateLabor,
  getBuildLaborAllocation,
  getBuildProgress,
  advanceBuildByDay
} from './labor.js';
