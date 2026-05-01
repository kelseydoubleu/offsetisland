// ════════════════════════════════════════════════════════════════════
// ISLAND MODULE — RE-EXPORTS
// ════════════════════════════════════════════════════════════════════

export {
  isLand,
  coastDistance,
  elevationRaw,
  elevationAt,
  biomeFor,
  generateIsland,
  getTile,
  countTilesByBiome
} from './generation.js';

export {
  roadKey,
  edgeCost,
  roadResourceCost,
  findPath,
  networkKeys,
  pathToSegments,
  seedStarterNetwork
} from './roads.js';
