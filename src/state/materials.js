// ════════════════════════════════════════════════════════════════════
// ISLAND MATERIALS + COMPONENT BLOCKS + DEATH PLANS
// The material vocabulary of Offcut World. Each encodes thesis principles
// about where things come from, what they cost, and how they end.
// ════════════════════════════════════════════════════════════════════

// ── ISLAND MATERIALS ────────────────────────────────────────────────
// Materials sourced from biomes, processed, or imported.
export const ISLAND_MATERIALS = {
  // ─── RAW MATERIALS (harvestable from biomes) ─────────────────────────
  timber: {
    name: 'Timber',
    unit: 'bf',                    // board-feet
    sourceBiome: 'forest',
    yieldPerTile: 10000,           // bf
    embodiedCarbonPer: 0.0008,     // tons CO₂ per bf (low — wood is carbon-storing)
    color: 0xB89060,
    componentBlocks: ['stud', 'beam', 'joist', 'sheathing']
  },
  stone: {
    name: 'Stone',
    unit: 'cu ft',
    sourceBiome: 'mountain',
    yieldPerTile: 3000,
    embodiedCarbonPer: 0.012,      // tons CO₂ per cu ft (medium — quarry energy)
    color: 0x8E8C84,
    componentBlocks: ['stone-block']
  },
  sand: {
    name: 'Sand',
    unit: 'cu ft',
    sourceBiome: 'beach',
    yieldPerTile: 8000,
    embodiedCarbonPer: 0.002,      // low — just extraction
    color: 0xE8D8A0,
    componentBlocks: []
  },
  clay: {
    name: 'Clay',
    unit: 'cu ft',
    sourceBiome: 'lowlands',       // dug from lowland soil
    yieldPerTile: 1500,            // cu ft of clay per tile
    embodiedCarbonPer: 0.003,      // low — just digging
    color: 0xC49070,
    componentBlocks: []
  },
  thatch: {
    name: 'Thatch',
    unit: 'bundles',
    sourceBiome: 'lowlands',       // reeds/grasses from lowlands
    yieldPerTile: 5000,
    embodiedCarbonPer: 0.0002,     // very low — natural material
    color: 0xC8A858,
    componentBlocks: ['thatch-panel']
  },
  water: {
    name: 'Water',
    unit: 'gal',
    sourceBiome: 'water',          // from lakes, rivers, ocean (desalinated)
    yieldPerTile: 50000,           // gallons per water tile
    embodiedCarbonPer: 0.00001,    // very low — just pumping
    color: 0x7BC4D8,
    componentBlocks: []
  },

  // ─── PROCESSED MATERIALS (require raw materials + facilities) ────────
  brick: {
    name: 'Brick',
    unit: 'units',
    sourceBiome: null,             // processed, not harvested
    processedFrom: { clay: 0.05 }, // 0.05 cu ft clay per brick
    yieldPerTile: 0,
    embodiedCarbonPer: 0.0006,     // tons CO₂ per brick (kiln energy)
    requiresLabor: 'kiln',
    color: 0xB8554A,
    componentBlocks: ['brick']
  },
  glass: {
    name: 'Glass',
    unit: 'sq ft',
    sourceBiome: null,             // processed, not harvested
    processedFrom: { sand: 0.5 },  // 0.5 cu ft sand per sq ft glass
    yieldPerTile: 0,
    embodiedCarbonPer: 0.015,      // high — furnace energy
    requiresLabor: 'furnace',
    color: 0xA8D8E8,
    componentBlocks: ['glass-pane']
  },
  concrete: {
    name: 'Concrete',
    unit: 'cu ft',
    sourceBiome: null,             // processed, not harvested
    processedFrom: { sand: 0.4, stone: 0.3, water: 2 },  // sand + aggregate + water
    yieldPerTile: 0,
    embodiedCarbonPer: 0.025,      // high — cement production
    requiresLabor: 'mixer',
    color: 0xA0A0A0,
    componentBlocks: ['concrete-block', 'concrete-slab']
  },
  adobe: {
    name: 'Adobe',
    unit: 'blocks',
    sourceBiome: null,             // made from clay + thatch, sun-dried
    processedFrom: { clay: 0.8, thatch: 0.2 },  // no facility needed
    yieldPerTile: 0,
    embodiedCarbonPer: 0.001,      // very low — sun-dried
    color: 0xC4A882,
    componentBlocks: ['adobe-block']
  },

  // ─── IMPORTED MATERIALS (can't make locally) ─────────────────────────
  steel: {
    name: 'Steel',
    unit: 'tons',
    sourceBiome: null,             // imported, not local
    imported: true,
    weeklyImport: 200,             // units per visual week
    maxStockpile: 500,             // storage cap
    embodiedCarbonPer: 1.8,        // very high — industrial production
    color: 0x607080,
    componentBlocks: ['i-beam', 'column', 'deck']
  }
};

// ── COMPONENT BLOCKS ────────────────────────────────────────────────
// Real-geometry placeable units. Dimensions in feet. Each consumes a
// specific amount of its parent material when placed.
export const COMPONENT_BLOCKS = {
  // Timber components
  'stud':       { material: 'timber', dims: [0.33, 8, 0.16],  cost: 6,  role: 'wall-frame'  },
  'beam':       { material: 'timber', dims: [0.66, 8, 0.33],  cost: 24, role: 'structure'   },
  'joist':      { material: 'timber', dims: [0.16, 8, 0.66],  cost: 12, role: 'floor-frame' },
  'sheathing':  { material: 'timber', dims: [4,    8, 0.04],  cost: 14, role: 'wall-skin'   },
  // Stone components
  'stone-block': { material: 'stone', dims: [1.33, 0.66, 0.66], cost: 0.6, role: 'masonry' },
  // Brick components
  'brick':       { material: 'brick', dims: [0.66, 0.21, 0.33], cost: 1,   role: 'masonry' },
  // Thatch components
  'thatch-panel': { material: 'thatch', dims: [4, 4, 0.25], cost: 20, role: 'roofing' },
  // Glass components
  'glass-pane':  { material: 'glass', dims: [4, 6, 0.02], cost: 24, role: 'glazing' },
  // Concrete components
  'concrete-block': { material: 'concrete', dims: [1.33, 0.66, 0.66], cost: 0.6, role: 'masonry' },
  'concrete-slab':  { material: 'concrete', dims: [10, 0.5, 10], cost: 50, role: 'floor' },
  // Adobe components
  'adobe-block': { material: 'adobe', dims: [1, 0.5, 0.5], cost: 1, role: 'masonry' },
  // Steel components
  'i-beam':  { material: 'steel', dims: [0.5, 20, 0.3], cost: 0.5, role: 'structure' },
  'column':  { material: 'steel', dims: [0.5, 12, 0.5], cost: 0.3, role: 'structure' },
  'deck':    { material: 'steel', dims: [10, 0.15, 10], cost: 0.8, role: 'floor' }
  // dims = [width, height, depth] in feet
};

// ── DEATH PLAN OPTIONS ──────────────────────────────────────────────
// Every build must declare how it will end. This is the thesis principle:
// "Technology does not know how to plan its own death."
export const DEATH_PLANS = {
  'demolish-salvage': {
    label: 'Demolish + salvage',
    desc: 'Recoverable materials returned to inventory; ~20% loss as debris.',
    salvageRate: 0.80,
    debrisRate:  0.20
  },
  'abandon': {
    label: 'Abandon',
    desc: 'Decay into ruin over decades. No salvage. Becomes part of landscape.',
    salvageRate: 0.00,
    debrisRate:  0.00,
    decayMultiplier: 0.5    // decays slower if officially abandoned (no demolition)
  },
  'dismantle-return': {
    label: 'Dismantle + return to source',
    desc: 'Materials returned to their original source tiles. High labor cost.',
    salvageRate: 0.95,
    debrisRate:  0.05,
    laborMultiplier: 2.0    // costs more labor than demolish
  }
};

// ── DETERIORATION RATES ─────────────────────────────────────────────
// Material-driven decay per in-game-day. Tuned for visceral gameplay
// (1 real second = 1 game day). With these rates, buildings show
// visible decay within minutes of completion, requiring active
// maintenance choices.
export const DETERIORATION_PER_DAY = {
  timber:   0.010,    // ~100 days (~1.5 min real time) to full decay
  stone:    0.0033,   // ~300 days (~5 min) — stone the most durable
  brick:    0.0067,   // ~150 days (~2.5 min) — fired clay, durable
  thatch:   0.015,    // ~67 days (~1 min) — organic, needs frequent replacement
  glass:    0.002,    // ~500 days (~8 min) — very durable but brittle
  concrete: 0.002,    // ~500 days (~8 min) — very durable
  adobe:    0.008,    // ~125 days (~2 min) — sun-dried, moderate durability
  steel:    0.001     // ~1000 days (~16 min) — most durable, but rusts
};

// ── PROCESSING FACILITIES ──────────────────────────────────────────
// Industrial buildings that transform raw materials into processed materials.
// Each facility consumes raw materials and produces processed materials.
export const PROCESSING_FACILITIES = {
  sawmill: {
    name: 'Sawmill',
    processes: 'timber',         // Output material (milled lumber)
    consumes: { timber: 1.2 },   // 1.2 raw timber → 1 processed
    laborPerUnit: 0.2,           // person-hours per unit
    sourceBiome: 'forest'
  },
  brickKiln: {
    name: 'Brick Kiln',
    processes: 'brick',
    consumes: { clay: 0.05 },    // 0.05 cu ft clay per brick
    laborPerUnit: 0.3,
    sourceBiome: 'lowlands'
  },
  concretePlant: {
    name: 'Concrete Plant',
    processes: 'concrete',
    consumes: { sand: 0.4, stone: 0.3 },
    laborPerUnit: 0.15,
    sourceBiome: 'mountain'      // Primary source (stone)
  },
  glassFurnace: {
    name: 'Glass Furnace',
    processes: 'glass',
    consumes: { sand: 0.5 },
    laborPerUnit: 0.5,
    sourceBiome: 'beach'
  }
};

// Mapping from processed materials to their processing facility type
export const MATERIAL_TO_FACILITY = {
  brick: 'brickKiln',
  glass: 'glassFurnace',
  concrete: 'concretePlant'
  // Note: timber doesn't need processing for basic use, but sawmill improves quality
};

// ── TILE CONSTANTS ──────────────────────────────────────────────────
export const TILE_SIZE_FT = 130;         // each tile is 130 ft across
export const TILE_DUMP_MAX = 1500;       // cu ft of waste a regular tile can absorb (legacy)

// ── DUMP SITE CONSTANTS ─────────────────────────────────────────────
// Dedicated landfill tiles that can absorb waste from many builds.
// Each dump site can hold waste equivalent to ~50 buildings.
export const DUMP_SITE_CAPACITY = 25000;  // cu ft per dump site (~50 builds worth)
export const DUMP_SITES_COUNT = 3;        // number of dump sites on the island
export const WASTE_PER_BUILD_AVG = 500;   // average cu ft waste per building

// ── BUILDING CATALOG ────────────────────────────────────────────────
// Preset building types with material/labor costs and biome requirements.
export const BUILDING_CATALOG = [
  { id: 'house', name: 'House', hint: 'Small dwelling',
    cost: { timber: 40, stone: 20, labor: 30, sand: 0, energy: 0 },
    requires: { biome: ['lowlands', 'forest', 'desert'] } },
  { id: 'tower', name: 'Housing tower', hint: '6-8 stories · dense',
    cost: { timber: 80, stone: 120, labor: 90, sand: 40, energy: 0 },
    requires: { biome: ['lowlands', 'forest'] } },
  { id: 'repair', name: 'Repair shop', hint: 'Wasp-nest logic',
    cost: { timber: 30, stone: 20, labor: 25, sand: 0, energy: 0 },
    requires: { biome: ['lowlands', 'forest', 'desert'] }, waspy: true },
  { id: 'courtyard', name: 'Courtyard', hint: 'Open · trees',
    cost: { timber: 20, stone: 30, labor: 25, sand: 0, energy: 0 },
    requires: { biome: ['lowlands', 'forest'] } },
  { id: 'farm', name: 'Farm plot', hint: 'Needs lowlands/forest',
    cost: { timber: 15, stone: 5, labor: 40, sand: 0, energy: 0 },
    requires: { biome: ['lowlands', 'forest'] } },
  { id: 'school', name: 'School', hint: 'Civic · stone pediment',
    cost: { timber: 50, stone: 80, labor: 60, sand: 10, energy: 0 },
    requires: { biome: ['lowlands', 'forest'] } },
  { id: 'solar', name: 'Solar array', hint: 'Needs desert/lowlands',
    cost: { timber: 10, stone: 25, labor: 30, sand: 10, energy: -80 },
    requires: { biome: ['desert', 'lowlands'] } },
  { id: 'library', name: 'Library', hint: 'Civic · stone',
    cost: { timber: 40, stone: 180, labor: 100, sand: 20, energy: 0 },
    requires: { biome: ['lowlands', 'forest'] } },
  { id: 'datacenter', name: 'Data center', hint: 'Unlocks AI · costly',
    cost: { timber: 30, stone: 120, labor: 140, sand: 340, energy: 200 },
    requires: { biome: ['lowlands', 'desert'] }, unlocks: 'ai' },
  { id: 'quarry', name: 'Quarry', hint: 'Mountain · extracts stone',
    cost: { timber: 50, stone: 0, labor: 200, sand: 0, energy: 80 },
    requires: { biome: ['mountain'] } },
  { id: 'pier', name: 'Pier', hint: 'Beach only',
    cost: { timber: 60, stone: 30, labor: 80, sand: 0, energy: 0 },
    requires: { biome: ['beach'] } }
];
