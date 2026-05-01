// ════════════════════════════════════════════════════════════════════
// EXTRACTION — TILE RESOURCE TRACKING
// Functions for tracking what's been extracted from and dumped on tiles.
// Thesis principle: "Every consequence has a tile address."
// ════════════════════════════════════════════════════════════════════

import { ISLAND_MATERIALS, TILE_SIZE_FT, TILE_DUMP_MAX, DUMP_SITE_CAPACITY } from './materials.js';

// ── TILE KEY HELPERS ────────────────────────────────────────────────

export function tileKey(gx, gy) {
  return gx + ':' + gy;
}

// Get or create extraction record for a tile
export function tileExtractionFor(state, gx, gy) {
  const k = tileKey(gx, gy);
  if (!state.island.tileExtraction[k]) {
    state.island.tileExtraction[k] = {
      timber: 0,
      stone: 0,
      clay: 0,
      sand: 0,
      thatch: 0,
      water: 0,
      soilDumped: 0,
      // Simplified depletion tracking (0-1 per material)
      depletionFraction: {
        timber: 0,
        stone: 0,
        clay: 0,
        sand: 0,
        thatch: 0,
        water: 0
      }
    };
  }
  // Ensure depletionFraction exists for older records
  if (!state.island.tileExtraction[k].depletionFraction) {
    state.island.tileExtraction[k].depletionFraction = {
      timber: 0,
      stone: 0,
      clay: 0,
      sand: 0,
      thatch: 0,
      water: 0
    };
  }
  return state.island.tileExtraction[k];
}

// ── REMAINING YIELD ─────────────────────────────────────────────────

// Remaining yield of a material on a tile (after past extractions)
export function tileRemainingYield(state, tile, material) {
  if (!tile) return 0;
  const ext = tileExtractionFor(state, tile.gx, tile.gy);
  const matSpec = ISLAND_MATERIALS[material];
  if (!matSpec) return 0;
  if (tile.biome !== matSpec.sourceBiome) return 0;

  const extracted = ext[material] || 0;
  const max = matSpec.yieldPerTile;
  return Math.max(0, max - extracted);
}

// ── DEPLETION ───────────────────────────────────────────────────────

// Returns fraction (0..1) of this tile's primary resource that's been extracted.
// A forest tile shows 0 if untouched, 1 if fully logged. Used by renderers to
// thin trees, add quarry scars, etc.
export function tileDepletion(state, tile) {
  if (!tile) return 0;
  const ext = state.island.tileExtraction[tileKey(tile.gx, tile.gy)];
  if (!ext) return 0;

  if (tile.biome === 'forest') {
    return Math.min(1, (ext.timber || 0) / ISLAND_MATERIALS.timber.yieldPerTile);
  }
  if (tile.biome === 'mountain') {
    return Math.min(1, (ext.stone || 0) / ISLAND_MATERIALS.stone.yieldPerTile);
  }
  if (tile.biome === 'lowlands') {
    // Lowlands has both clay and thatch - use max depletion
    const clayDepletion = (ext.clay || 0) / ISLAND_MATERIALS.clay.yieldPerTile;
    const thatchDepletion = (ext.thatch || 0) / ISLAND_MATERIALS.thatch.yieldPerTile;
    return Math.min(1, Math.max(clayDepletion, thatchDepletion));
  }
  if (tile.biome === 'beach') {
    return Math.min(1, (ext.sand || 0) / ISLAND_MATERIALS.sand.yieldPerTile);
  }
  if (tile.biome === 'water') {
    return Math.min(1, (ext.water || 0) / ISLAND_MATERIALS.water.yieldPerTile);
  }
  return 0;
}

// ── WASTE DUMPING ───────────────────────────────────────────────────

// Returns cu ft of soil/debris dumped on this tile.
export function tileDumpAmount(state, tile) {
  if (!tile) return 0;
  const ext = state.island.tileExtraction[tileKey(tile.gx, tile.gy)];
  if (!ext) return 0;
  return ext.soilDumped || 0;
}

// Returns fraction (0..1) of "fullness" for waste dumping.
// Dump sites use their larger capacity, regular tiles use TILE_DUMP_MAX.
export function tileDumpFraction(state, tile) {
  if (!tile) return 0;
  const amount = tileDumpAmount(state, tile);
  // Check if this is a dump site
  const isDump = state.island.dumpSites?.includes(tileKey(tile.gx, tile.gy));
  const capacity = isDump ? DUMP_SITE_CAPACITY : TILE_DUMP_MAX;
  return Math.min(1, amount / capacity);
}

// How much more soil this tile can accept before reaching its dump cap.
export function tileDumpRemaining(state, tile) {
  return Math.max(0, TILE_DUMP_MAX - tileDumpAmount(state, tile));
}

// ── DISTANCE ────────────────────────────────────────────────────────

// Distance between two tiles in feet
export function tileDistance(gx1, gy1, gx2, gy2) {
  const dx = (gx2 - gx1) * TILE_SIZE_FT;
  const dy = (gy2 - gy1) * TILE_SIZE_FT;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── SIMPLIFIED DEPLETION (for build profile visualization) ──────────

// Get simplified depletion fraction (0-1) for a material on a tile
export function getTileDepletionFraction(state, tile, material) {
  if (!tile) return 0;
  const ext = tileExtractionFor(state, tile.gx, tile.gy);
  return ext.depletionFraction?.[material] || 0;
}

// Check if tile can accept additional depletion for a material
export function canTileAcceptDepletion(state, tile, material, depletionFraction) {
  const current = getTileDepletionFraction(state, tile, material);
  return (current + depletionFraction) <= 1.0;
}

// Apply simplified depletion to a tile
export function applyTileDepletion(state, tile, material, depletionFraction) {
  const ext = tileExtractionFor(state, tile.gx, tile.gy);
  if (!ext.depletionFraction) {
    ext.depletionFraction = { timber: 0, stone: 0, clay: 0, sand: 0, thatch: 0, water: 0 };
  }
  ext.depletionFraction[material] = Math.min(1, (ext.depletionFraction[material] || 0) + depletionFraction);
  return ext.depletionFraction[material];
}

// ── DUMP SITES ──────────────────────────────────────────────────────
// Dedicated landfill tiles that accumulate waste from construction.

// Check if a tile is a designated dump site
export function isDumpSite(state, tile) {
  if (!tile) return false;
  return state.island.dumpSites?.includes(tileKey(tile.gx, tile.gy)) || false;
}

// Get dump site fill fraction (0 = empty, 1 = full)
export function getDumpSiteFillFraction(state, tile) {
  if (!isDumpSite(state, tile)) return 0;
  const ext = state.island.tileExtraction[tileKey(tile.gx, tile.gy)];
  if (!ext) return 0;
  return Math.min(1, (ext.soilDumped || 0) / DUMP_SITE_CAPACITY);
}

// Get total waste dumped at a dump site
export function getDumpSiteWaste(state, tile) {
  if (!isDumpSite(state, tile)) return 0;
  const ext = state.island.tileExtraction[tileKey(tile.gx, tile.gy)];
  return ext?.soilDumped || 0;
}

// Get remaining capacity at a dump site
export function getDumpSiteRemaining(state, tile) {
  if (!isDumpSite(state, tile)) return 0;
  const ext = state.island.tileExtraction[tileKey(tile.gx, tile.gy)];
  const current = ext?.soilDumped || 0;
  return Math.max(0, DUMP_SITE_CAPACITY - current);
}

// Add waste to a dump site
export function addWasteToDumpSite(state, tile, amount) {
  if (!isDumpSite(state, tile)) return false;
  const ext = tileExtractionFor(state, tile.gx, tile.gy);
  const remaining = DUMP_SITE_CAPACITY - (ext.soilDumped || 0);
  const toAdd = Math.min(amount, remaining);
  ext.soilDumped = (ext.soilDumped || 0) + toAdd;
  return toAdd;
}

// Find the best dump site to use (least full, with capacity)
export function findBestDumpSite(state, amount) {
  if (!state.island.dumpSites || state.island.dumpSites.length === 0) return null;

  let bestTile = null;
  let bestFill = 1;

  for (const key of state.island.dumpSites) {
    const [gx, gy] = key.split(':').map(Number);
    const tile = state.island.tiles.find(t => t.gx === gx && t.gy === gy);
    if (!tile) continue;

    const fill = getDumpSiteFillFraction(state, tile);
    const remaining = getDumpSiteRemaining(state, tile);

    if (remaining >= amount && fill < bestFill) {
      bestFill = fill;
      bestTile = tile;
    }
  }

  return bestTile;
}

// Get all dump sites with their fill levels
export function getAllDumpSites(state) {
  if (!state.island.dumpSites) return [];

  return state.island.dumpSites.map(key => {
    const [gx, gy] = key.split(':').map(Number);
    const tile = state.island.tiles.find(t => t.gx === gx && t.gy === gy);
    if (!tile) return null;

    return {
      tile,
      key,
      fillFraction: getDumpSiteFillFraction(state, tile),
      waste: getDumpSiteWaste(state, tile),
      remaining: getDumpSiteRemaining(state, tile)
    };
  }).filter(Boolean);
}
