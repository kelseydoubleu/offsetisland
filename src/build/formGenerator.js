// ════════════════════════════════════════════════════════════════════
// SHAPE GRAMMAR FORM GENERATOR
// Program-based architectural forms with detailed structural expression
// Scale: 1 tile = 130ft × 130ft (updated), 1 unit = 1 foot
//
// NEW: Supports polygon-aware generation from tile footprints
// and hybrid AI + shape grammar via architectural genes
// ════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeTileUnionPolygon, centerPolygon, getPolygonEdges } from './footprint.js';
import { interpretGenes, getDefaultGenes } from './interpreter.js';

// ── CONSTANTS ──────────────────────────────────────────────────────
const FLOOR_HEIGHT = 6; // feet (visual floor-to-floor for denser appearance)
const TILE_SIZE = 130; // feet per tile (corrected from 40)
const PERIMETER_INSET = 4; // feet inset from outer perimeter only
const CELL_SIZE = 5; // feet per grid cell

// ── GEOMETRY CONSTANTS (for clean, physically plausible geometry) ──
const GEOM = {
  // Offsets to prevent z-fighting (surfaces at same plane)
  Z_OFFSET: 0.02,         // Tiny offset to separate coplanar faces
  INSET: 0.15,            // Standard inset for windows/doors into walls
  REVEAL_DEPTH: 0.4,      // Depth of window/door reveals

  // Element dimensions
  MULLION_WIDTH: 0.15,    // Width of window mullions (actual geometry)
  MULLION_DEPTH: 0.08,    // Depth of mullions
  SILL_PROJECTION: 0.25,  // How far sills project from wall
  SILL_HEIGHT: 0.12,      // Height of window sills
  LINTEL_HEIGHT: 0.2,     // Height of lintels above windows

  // Facade layers (from wall plane outward)
  LAYER_1: 0.0,           // Primary wall plane
  LAYER_2: 0.08,          // Secondary (frames, spandrels)
  LAYER_3: 0.15,          // Tertiary (mullions, reveals)

  // Masonry
  COURSE_HEIGHT: 0.25,    // Height of one brick course (3" = 0.25ft)
  COURSE_DEPTH_VAR: 0.02, // Variation in course depth
  MORTAR_RECESS: 0.03,    // How deep mortar joints are recessed

  // Curve segments
  CURVE_SEGMENTS_SMALL: 16,
  CURVE_SEGMENTS_MED: 24,
  CURVE_SEGMENTS_LARGE: 32,
};

// ── POLYGON STATE ─────────────────────────────────────────────────
let currentPolygon = null;
let currentGenes = null;

// ── RNG ────────────────────────────────────────────────────────────
let _seed = 12345;
function seed(s) { _seed = s; }
function rng() { _seed = (_seed * 1664525 + 1013904223) & 0xFFFFFFFF; return (_seed >>> 0) / 0xFFFFFFFF; }
const rnd = rng; // Alias for compatibility
function rr(a, b) { return a + rng() * (b - a); }
function ri(a, b) { return Math.floor(rr(a, b + 1)); }
function pick(arr) { return arr[ri(0, arr.length - 1)]; }

// ── COLOR VARIATION ────────────────────────────────────────────────
// Slightly vary a color so no two buildings look exactly the same
function varyColor(hex, variation = 0.08) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  // Apply slight random variation to each channel
  const vr = Math.max(0, Math.min(1, r + rr(-variation, variation)));
  const vg = Math.max(0, Math.min(1, g + rr(-variation, variation)));
  const vb = Math.max(0, Math.min(1, b + rr(-variation, variation)));
  return (Math.round(vr * 255) << 16) | (Math.round(vg * 255) << 8) | Math.round(vb * 255);
}

// Get material with slight color variation
function getVariedMaterial(matFn, variation = 0.06) {
  const mat = matFn();
  if (mat.color) {
    mat.color.setHex(varyColor(mat.color.getHex(), variation));
  }
  return mat;
}

// ── PROGRAM DEFINITIONS ────────────────────────────────────────────
export const PROGRAMS = {
  1: [
    { id: 'cottage', name: 'COTTAGE', desc: 'Small residential home', floors: [1, 2], icon: '⌂' },
    { id: 'townhouse', name: 'TOWNHOUSE', desc: 'Narrow urban dwelling', floors: [3, 4], icon: '▯' },
    { id: 'shop', name: 'SHOP', desc: 'Small retail storefront', floors: [1, 2], icon: '◫' },
    { id: 'pavilion', name: 'PAVILION', desc: 'Experimental structure', floors: [1], icon: '◇' },
    { id: 'chapel', name: 'CHAPEL', desc: 'Contemplative space', floors: [1, 2], icon: '△' },
  ],
  2: [
    { id: 'rowhouse', name: 'ROWHOUSE', desc: 'Connected urban homes', floors: [3, 4], icon: '▯▯' },
    { id: 'brownstone', name: 'BROWNSTONE', desc: 'Classic urban residential', floors: [4, 5], icon: '▣▣' },
    { id: 'restaurant', name: 'RESTAURANT', desc: 'Dining establishment', floors: [1, 2], icon: '◨◨' },
    { id: 'gallery', name: 'GALLERY', desc: 'Art exhibition space', floors: [1, 2], icon: '□□' },
    { id: 'clinic', name: 'CLINIC', desc: 'Healthcare facility', floors: [2, 3], icon: '▢▢' },
  ],
  3: [
    { id: 'apartment', name: 'APARTMENT BLOCK', desc: 'Multi-unit housing', floors: [4, 6], icon: '▦▦▦' },
    { id: 'library', name: 'LIBRARY', desc: 'Public reading space', floors: [2, 3], icon: '▤▤▤' },
    { id: 'hotel', name: 'HOTEL', desc: 'Lodging with rooms', floors: [4, 8], icon: '▥▥▥' },
    { id: 'market', name: 'MARKET HALL', desc: 'Indoor marketplace', floors: [1, 2], icon: '◫◫◫' },
    { id: 'workshop', name: 'WORKSHOP', desc: 'Making & craft space', floors: [1, 2], icon: '▨▨▨' },
  ],
  4: [
    { id: 'museum', name: 'MUSEUM', desc: 'Exhibition galleries', floors: [2, 4], icon: '▣▣▣▣' },
    { id: 'stadium', name: 'STADIUM', desc: 'Sports & events venue', floors: [1, 3], icon: '○○○○' },
    { id: 'school', name: 'SCHOOL', desc: 'Educational campus', floors: [2, 3], icon: '▤▤▤▤' },
    { id: 'tower', name: 'TOWER', desc: 'High-rise building', floors: [8, 20], icon: '▮▮▮▮' },
    { id: 'park', name: 'PARK', desc: 'Public green space', floors: [0, 1], icon: '◊◊◊◊' },
  ]
};

// ══════════════════════════════════════════════════════════════════
// MATERIALS LIBRARY — Rich architectural materials
// ══════════════════════════════════════════════════════════════════
const MATS = {
  // Glass variants - soft, illustrative blues and teals
  glass_dark: () => new THREE.MeshPhysicalMaterial({
    color: 0x7ca8c8, metalness: 0.08, roughness: 0.04,
    transparent: true, opacity: 0.45, side: THREE.DoubleSide
  }),
  glass_clear: () => new THREE.MeshPhysicalMaterial({
    color: 0xa8d0e8, metalness: 0.05, roughness: 0.02,
    transparent: true, opacity: 0.3, side: THREE.DoubleSide
  }),
  glass_tinted: () => new THREE.MeshPhysicalMaterial({
    color: 0x88b8d0, metalness: 0.06, roughness: 0.03,
    transparent: true, opacity: 0.38, side: THREE.DoubleSide
  }),

  // Masonry - warm, earthy, inviting
  brick_red: () => new THREE.MeshStandardMaterial({ color: 0xB5503C, metalness: 0.0, roughness: 0.85 }), // Classic red brick
  brick_brown: () => new THREE.MeshStandardMaterial({ color: 0x8B5A3C, metalness: 0.0, roughness: 0.88 }), // Brown/auburn brick
  brick_cream: () => new THREE.MeshStandardMaterial({ color: 0xE8DCC8, metalness: 0.0, roughness: 0.82 }), // Cream/blonde brick
  stone_gray: () => new THREE.MeshStandardMaterial({ color: 0xC8C8C0, metalness: 0.02, roughness: 0.75 }),
  stone_warm: () => new THREE.MeshStandardMaterial({ color: 0xE0D4C8, metalness: 0.02, roughness: 0.78 }),
  stone_light: () => new THREE.MeshStandardMaterial({ color: 0xF0EDE8, metalness: 0.02, roughness: 0.72 }),
  brownstone: () => new THREE.MeshStandardMaterial({ color: 0xC0A090, metalness: 0.0, roughness: 0.85 }),
  limestone: () => new THREE.MeshStandardMaterial({ color: 0xF8F0E8, metalness: 0.02, roughness: 0.7 }),

  // Concrete - soft warm grays (architectural render style)
  concrete: () => new THREE.MeshStandardMaterial({ color: 0xE8E8E4, metalness: 0.0, roughness: 0.88 }),
  concrete_light: () => new THREE.MeshStandardMaterial({ color: 0xF4F4F0, metalness: 0.0, roughness: 0.85 }),
  concrete_board: () => new THREE.MeshStandardMaterial({ color: 0xECECE8, metalness: 0.0, roughness: 0.9 }),
  precast: () => new THREE.MeshStandardMaterial({ color: 0xF8F8F4, metalness: 0.02, roughness: 0.8 }),

  // Wood - rich warm tones
  timber_light: () => new THREE.MeshStandardMaterial({ color: 0xF0DCC0, metalness: 0.0, roughness: 0.75 }),
  timber_dark: () => new THREE.MeshStandardMaterial({ color: 0xC8A888, metalness: 0.0, roughness: 0.8 }),
  timber_weathered: () => new THREE.MeshStandardMaterial({ color: 0xD0C0B0, metalness: 0.0, roughness: 0.88 }),
  cedar: () => new THREE.MeshStandardMaterial({ color: 0xE8C098, metalness: 0.0, roughness: 0.82 }),
  oak: () => new THREE.MeshStandardMaterial({ color: 0xD0B090, metalness: 0.0, roughness: 0.78 }),
  // Wood aliases for tower typologies
  wood_light: () => new THREE.MeshStandardMaterial({ color: 0xF5E8D0, metalness: 0.0, roughness: 0.72 }),
  wood_medium: () => new THREE.MeshStandardMaterial({ color: 0xD4B896, metalness: 0.0, roughness: 0.76 }),
  wood_dark: () => new THREE.MeshStandardMaterial({ color: 0xA08060, metalness: 0.0, roughness: 0.82 }),

  // Metal - elegant and refined
  steel: () => new THREE.MeshStandardMaterial({ color: 0xA8A8A8, metalness: 0.75, roughness: 0.3 }),
  steel_dark: () => new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.35 }),
  steel_weathered: () => new THREE.MeshStandardMaterial({ color: 0xA09890, metalness: 0.55, roughness: 0.55 }),
  bronze: () => new THREE.MeshStandardMaterial({ color: 0xC8A070, metalness: 0.88, roughness: 0.22 }),
  copper: () => new THREE.MeshStandardMaterial({ color: 0xE0A068, metalness: 0.85, roughness: 0.25 }),
  copper_patina: () => new THREE.MeshStandardMaterial({ color: 0x88C8A8, metalness: 0.35, roughness: 0.65 }),
  zinc: () => new THREE.MeshStandardMaterial({ color: 0xB8B8B0, metalness: 0.65, roughness: 0.4 }),
  corten: () => new THREE.MeshStandardMaterial({ color: 0xC88868, metalness: 0.45, roughness: 0.7 }),

  // Roofing - subtle and architectural
  slate: () => new THREE.MeshStandardMaterial({ color: 0x889098, metalness: 0.1, roughness: 0.7 }),
  terracotta: () => new THREE.MeshStandardMaterial({ color: 0xE8A888, metalness: 0.0, roughness: 0.8 }),
  shingle_dark: () => new THREE.MeshStandardMaterial({ color: 0x787878, metalness: 0.0, roughness: 0.9 }),
  shingle_gray: () => new THREE.MeshStandardMaterial({ color: 0x989890, metalness: 0.0, roughness: 0.88 }),
  metal_roof: () => new THREE.MeshStandardMaterial({ color: 0x989898, metalness: 0.75, roughness: 0.35 }),
  green_roof: () => new THREE.MeshStandardMaterial({ color: 0x98B888, metalness: 0.0, roughness: 0.95 }),

  // Accents - clean and crisp
  white_trim: () => new THREE.MeshStandardMaterial({ color: 0xFCFCF8, metalness: 0.0, roughness: 0.55 }),
  dark_trim: () => new THREE.MeshStandardMaterial({ color: 0x606060, metalness: 0.1, roughness: 0.5 }),
  cream_trim: () => new THREE.MeshStandardMaterial({ color: 0xF8F0E0, metalness: 0.0, roughness: 0.6 }),

  // Tower glass variants - beautiful soft blues (illustrative style)
  glass_tower_dark: () => new THREE.MeshPhysicalMaterial({ color: 0x78a8c8, metalness: 0.12, roughness: 0.05, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
  glass_tower_blue: () => new THREE.MeshPhysicalMaterial({ color: 0x88b8d8, metalness: 0.15, roughness: 0.04, transparent: true, opacity: 0.38, side: THREE.DoubleSide }),
  glass_tower_light: () => new THREE.MeshPhysicalMaterial({ color: 0xa8d0e8, metalness: 0.08, roughness: 0.03, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),

  // Tower metals - sophisticated and light
  titanium: () => new THREE.MeshStandardMaterial({ color: 0xe8e0d8, metalness: 0.9, roughness: 0.15 }),
  white_metal: () => new THREE.MeshStandardMaterial({ color: 0xf0f0ec, metalness: 0.65, roughness: 0.25 }),
  dark_panel: () => new THREE.MeshStandardMaterial({ color: 0x686868, metalness: 0.35, roughness: 0.65 }),
};

// ══════════════════════════════════════════════════════════════════
// TOWER CATEGORIES WITH HEIGHT RANGES
// ══════════════════════════════════════════════════════════════════
const TOWER_HEIGHT_RANGES = {
  masonry:    { min: 3, max: 12 },   // Brick buildings - structural limits
  commercial: { min: 20, max: 50 },  // Steel/glass megatowers
  sculptural: { min: 4, max: 12 },   // Organic/irregular forms
  timber:     { min: 3, max: 30 },   // Mass timber - modern CLT can go tall
  brutalist:  { min: 4, max: 18 },   // Concrete - austere and massive
};

// Commercial sub-types (randomly selected)
const COMMERCIAL_SUBTYPES = ['straight', 'setback', 'twisted', 'diagrid', 'spire'];

// Legacy compatibility
const TYPOLOGY_MAX_FLOORS = {
  masonry: 12, commercial: 50, sculptural: 12, timber: 30, brutalist: 18, industrial: 3,
  // Legacy keys
  curtainwall: 50, diagrid: 50, twisted: 50, spire: 50, skeletal: 35, organic: 12, stone: 8, modular: 14,
};

// ══════════════════════════════════════════════════════════════════
// TOWER TYPOLOGIES (Skyscraper Engine Style)
// ══════════════════════════════════════════════════════════════════
// 5 MAIN TOWER CATEGORIES
// ══════════════════════════════════════════════════════════════════
const TOWER_TYPOLOGIES = {
  // ─────────────────────────────────────────────────────────────────
  // MASONRY: 3-12 floors, brick, setbacks optional, arch or rect windows
  // ─────────────────────────────────────────────────────────────────
  masonry: {
    name: 'Brick Masonry',
    description: 'Traditional brick with visible courses and punched windows',
    category: 'masonry',
    facadeMats: ['brick_red', 'brick_red', 'brick_brown', 'brick_cream'], // weighted toward red
    structMats: ['steel_dark', 'brick_red'],
    mullionDensity: [0.2, 0.4],
    taperRange: [0.0, 0.08],
    setbackChance: 0.4,
    crownChance: 0.4,
    windowTypes: ['rect', 'rect', 'arch'], // can be arch or rectangle
    brickCourses: true,
    entryTypes: ['portico', 'arcade', 'recessed', 'portal'],
  },

  // ─────────────────────────────────────────────────────────────────
  // COMMERCIAL: 20-50 floors, steel/glass megatowers
  // Sub-types: straight, setback, twisted, diagrid, spire (randomly selected)
  // ─────────────────────────────────────────────────────────────────
  commercial: {
    name: 'Commercial Office Tower',
    description: 'Steel and glass megatower with expressed structure',
    category: 'commercial',
    facadeMats: ['glass_tower_dark', 'glass_tower_blue', 'glass_tower_light', 'glass_clear'],
    structMats: ['steel', 'steel_dark', 'bronze', 'titanium', 'white_metal'],
    mullionDensity: [0.5, 1.0],
    taperRange: [0.0, 0.3],
    twistRange: [0.0, 0.8], // 0 for straight, >0 for twisted
    setbackChance: 0.5,
    crownChance: 0.7,
    subtypes: ['straight', 'setback', 'twisted', 'diagrid', 'spire'],
    entryTypes: ['canopy', 'glass_box', 'portal', 'recessed'],
  },

  // ─────────────────────────────────────────────────────────────────
  // SCULPTURAL: 4-12 floors, organic irregular forms
  // Can be curtainwall or punched windows, arch or rect
  // ─────────────────────────────────────────────────────────────────
  sculptural: {
    name: 'Sculptural Tower',
    description: 'Organic irregular floor plates, flowing curves',
    category: 'sculptural',
    facadeMats: ['glass_tower_light', 'concrete_light', 'precast', 'white_metal'],
    structMats: ['white_metal', 'titanium', 'steel'],
    mullionDensity: [0.4, 0.8],
    taperRange: [0.05, 0.2],
    twistRange: [0.1, 0.4],
    crownChance: 0.5,
    windowTypes: ['rect', 'arch'], // can be arch or rectangle
    facadeTypes: ['curtainwall', 'punched'], // randomly selected
    curvedFloors: true,
    entryTypes: ['sculptural', 'void', 'canopy', 'glass_box'],
  },

  // ─────────────────────────────────────────────────────────────────
  // TIMBER: 3-30 floors, exposed wood column/beam structure
  // ─────────────────────────────────────────────────────────────────
  timber: {
    name: 'Mass Timber',
    description: 'CLT tower with exposed wood columns and beams',
    category: 'timber',
    facadeMats: ['wood_light', 'wood_medium', 'wood_dark'],
    structMats: ['wood_light', 'wood_medium', 'wood_dark'],
    mullionDensity: [0.3, 0.6],
    taperRange: [0.0, 0.1],
    crownChance: 0.3,
    exposedStructure: true, // clear column/beam expression
    entryTypes: ['timber_frame', 'porch', 'canopy', 'portico'],
  },

  // ─────────────────────────────────────────────────────────────────
  // BRUTALIST: 4-18 floors, concrete, small windows, austere
  // ─────────────────────────────────────────────────────────────────
  brutalist: {
    name: 'Brutalist',
    description: 'Massive concrete with small punched windows, austere',
    category: 'brutalist',
    facadeMats: ['concrete', 'concrete_light', 'precast'],
    structMats: ['steel_dark', 'concrete'],
    mullionDensity: [0.15, 0.35],
    taperRange: [0.0, 0.05],
    crownChance: 0.15,
    smallWindows: true, // flag for austere small openings
    entryTypes: ['recessed', 'void', 'monumental', 'portal'],
  },

  // ─────────────────────────────────────────────────────────────────
  // LEGACY COMPATIBILITY (map old names to new categories)
  // ─────────────────────────────────────────────────────────────────
  curtainwall: { name: 'Curtain Wall', category: 'commercial', facadeMats: ['glass_tower_dark', 'glass_tower_blue'], structMats: ['steel', 'bronze'], mullionDensity: [0.5, 0.9], taperRange: [0.0, 0.15], crownChance: 0.6 },
  diagrid: { name: 'Diagrid', category: 'commercial', facadeMats: ['glass_tower_dark', 'glass_tower_blue'], structMats: ['steel', 'bronze', 'titanium'], mullionDensity: [0.7, 1.0], taperRange: [0.05, 0.25], crownChance: 0.7 },
  twisted: { name: 'Twisted', category: 'commercial', facadeMats: ['glass_tower_light', 'glass_tower_blue'], structMats: ['steel', 'white_metal', 'titanium'], mullionDensity: [0.6, 0.9], taperRange: [0.05, 0.2], twistRange: [0.3, 0.8], crownChance: 0.8 },
  spire: { name: 'Spire', category: 'commercial', facadeMats: ['glass_tower_dark', 'glass_tower_light'], structMats: ['steel', 'bronze'], mullionDensity: [0.5, 0.8], taperRange: [0.2, 0.4], crownChance: 0.95 },
  skeletal: { name: 'Skeletal', category: 'commercial', facadeMats: ['glass_clear', 'glass_tower_light'], structMats: ['steel', 'steel_dark'], mullionDensity: [0.8, 1.0], taperRange: [0.05, 0.2], crownChance: 0.5 },
  organic: { name: 'Organic', category: 'sculptural', facadeMats: ['glass_tower_light', 'concrete_light'], structMats: ['white_metal', 'titanium'], mullionDensity: [0.4, 0.7], taperRange: [0.1, 0.25], twistRange: [0.2, 0.5], crownChance: 0.6, curvedFloors: true },
  stone: { name: 'Stone', category: 'brutalist', facadeMats: ['stone_light', 'concrete', 'precast'], structMats: ['steel_dark', 'concrete'], mullionDensity: [0.15, 0.35], taperRange: [0.0, 0.08], crownChance: 0.25 },
  modular: { name: 'Modular', category: 'brutalist', facadeMats: ['precast', 'concrete_light', 'dark_panel'], structMats: ['steel_dark'], mullionDensity: [0.4, 0.7], taperRange: [0.0, 0.05], crownChance: 0.1 },
};

// ══════════════════════════════════════════════════════════════════
// SHED TYPOLOGIES - Same 5 categories as towers, but horizontal
// Footprint: 2-5x larger than tower, Max 6 floors
// Always ornament, varied entries, detailed facades
// ══════════════════════════════════════════════════════════════════
const SHED_TYPOLOGIES = {
  // ─────────────────────────────────────────────────────────────────
  // MASONRY SHED: Brick civic buildings (libraries, schools, museums)
  // ─────────────────────────────────────────────────────────────────
  masonry: {
    name: 'Masonry Civic',
    description: 'Brick building with arched windows and ornamental details',
    category: 'masonry',
    facadeMats: ['brick_red', 'brick_red', 'brick_brown', 'brick_cream'],
    structMats: ['steel_dark', 'brick_red'],
    roofMats: ['slate', 'terracotta', 'shingle_dark'],
    roofTypes: ['flat', 'pitched', 'hip'],
    maxFloors: 6,
    footprintMultiplier: [2, 4], // 2-4x tower footprint
    windowTypes: ['rect', 'arch', 'arch'], // weighted toward arch
    ornamentChance: 1.0, // always ornament
    entryTypes: ['portico', 'arcade', 'recessed', 'canopy'],
    corniceChance: 0.9,
    quoinChance: 0.7,
  },

  // ─────────────────────────────────────────────────────────────────
  // COMMERCIAL SHED: Glass/steel halls (convention centers, terminals)
  // ─────────────────────────────────────────────────────────────────
  commercial: {
    name: 'Commercial Hall',
    description: 'Steel and glass horizontal building with dramatic spans',
    category: 'commercial',
    facadeMats: ['glass_tower_dark', 'glass_tower_light', 'glass_clear'],
    structMats: ['steel', 'steel_dark', 'white_metal'],
    roofMats: ['metal_roof', 'steel', 'steel_dark'],
    roofTypes: ['flat', 'curved', 'folded', 'sawtooth'],
    maxFloors: 6,
    footprintMultiplier: [3, 5], // 3-5x tower footprint
    ornamentChance: 0.8,
    entryTypes: ['canopy', 'glass_box', 'portal'],
    skylightChance: 0.7,
    trussChance: 0.6,
  },

  // ─────────────────────────────────────────────────────────────────
  // SCULPTURAL SHED: Museums, galleries with dramatic forms
  // ─────────────────────────────────────────────────────────────────
  sculptural: {
    name: 'Sculptural Pavilion',
    description: 'Organic forms with cantilevers, voids, and dramatic gestures',
    category: 'sculptural',
    facadeMats: ['concrete_light', 'white_metal', 'precast', 'titanium'],
    structMats: ['steel', 'white_metal', 'concrete'],
    roofMats: ['metal_roof', 'concrete_light', 'white_metal'],
    roofTypes: ['curved', 'folded', 'butterfly', 'shell'],
    maxFloors: 4,
    footprintMultiplier: [2, 4],
    windowTypes: ['rect', 'arch', 'irregular'],
    ornamentChance: 1.0,
    entryTypes: ['sculptural', 'void', 'canopy', 'ramp'],
    voidChance: 0.8,
    cantileverChance: 0.7,
  },

  // ─────────────────────────────────────────────────────────────────
  // TIMBER SHED: Wood structures (community centers, markets)
  // ─────────────────────────────────────────────────────────────────
  timber: {
    name: 'Timber Hall',
    description: 'Exposed wood structure with warm character',
    category: 'timber',
    facadeMats: ['wood_light', 'wood_medium', 'wood_dark'],
    structMats: ['wood_light', 'wood_medium', 'wood_dark'],
    roofMats: ['shingle_gray', 'slate', 'wood_medium'],
    roofTypes: ['pitched', 'butterfly', 'shed', 'monitor'],
    maxFloors: 4,
    footprintMultiplier: [2, 4],
    ornamentChance: 1.0,
    entryTypes: ['porch', 'canopy', 'timber_frame'],
    exposedStructure: true,
    clerestoryChance: 0.6,
  },

  // ─────────────────────────────────────────────────────────────────
  // BRUTALIST SHED: Concrete cultural buildings
  // ─────────────────────────────────────────────────────────────────
  brutalist: {
    name: 'Brutalist Civic',
    description: 'Massive concrete forms with deep reveals and bold geometry',
    category: 'brutalist',
    facadeMats: ['concrete', 'concrete_light', 'precast'],
    structMats: ['concrete', 'steel_dark'],
    roofMats: ['concrete', 'concrete_light', 'metal_roof'],
    roofTypes: ['flat', 'folded', 'coffered'],
    maxFloors: 5,
    footprintMultiplier: [2, 5],
    ornamentChance: 0.6, // brutalist has less ornament but bold form
    entryTypes: ['monumental', 'recessed', 'ramp'],
    smallWindows: true,
    deepReveals: true,
  },

  // Legacy compatibility
  museum: { name: 'Museum', category: 'sculptural', facadeMats: ['concrete_light', 'white_metal'], structMats: ['steel'], roofTypes: ['curved', 'folded'], maxFloors: 4, footprintMultiplier: [2, 4], ornamentChance: 1.0, entryTypes: ['sculptural', 'canopy'] },
  library: { name: 'Library', category: 'masonry', facadeMats: ['brick_red', 'brick_cream'], structMats: ['steel_dark'], roofTypes: ['flat', 'pitched'], maxFloors: 5, footprintMultiplier: [2, 3], ornamentChance: 1.0, entryTypes: ['portico', 'arcade'] },
  school: { name: 'School', category: 'masonry', facadeMats: ['brick_cream', 'brick_red'], structMats: ['steel'], roofTypes: ['flat', 'pitched'], maxFloors: 4, footprintMultiplier: [3, 5], ornamentChance: 0.9, entryTypes: ['canopy', 'arcade'] },
  gallery: { name: 'Gallery', category: 'sculptural', facadeMats: ['concrete_light', 'white_metal'], structMats: ['steel'], roofTypes: ['flat', 'skylight'], maxFloors: 3, footprintMultiplier: [2, 3], ornamentChance: 1.0, entryTypes: ['glass_box', 'void'] },
  community: { name: 'Community', category: 'timber', facadeMats: ['wood_light', 'brick_red'], structMats: ['wood_medium', 'steel'], roofTypes: ['pitched', 'butterfly'], maxFloors: 3, footprintMultiplier: [2, 3], ornamentChance: 1.0, entryTypes: ['porch', 'canopy'] },
  warehouse: { name: 'Warehouse', category: 'commercial', facadeMats: ['dark_panel', 'corten'], structMats: ['steel'], roofTypes: ['shed', 'monitor'], maxFloors: 2, footprintMultiplier: [3, 5], ornamentChance: 0.3, entryTypes: ['dock', 'roller'] },
};

// Programs that map to shed category (flatter, object-like buildings)
const SHED_PROGRAMS = [
  'museum', 'gallery', 'library', 'school', 'community_center', 'community',
  'theater', 'auditorium', 'arena', 'gym', 'gymnasium', 'recreation',
  'warehouse', 'factory', 'workshop', 'studio', 'market', 'pavilion',
  'visitor_center', 'cultural_center', 'arts_center', 'concert_hall',
];

// Crown types for towers
const CROWN_TYPES = ['spire', 'lantern', 'stepped', 'antenna', 'shards', 'mechanical', 'parapet'];

/**
 * Determine building category: 'tower' vs 'shed'
 * Towers are vertical (offices, residential, hotels)
 * Sheds are horizontal/object-like (museums, libraries, schools, etc.)
 */
function selectBuildingCategory(archetype, buildingName = '') {
  const archetypeId = archetype?.id?.toLowerCase() || '';
  const archetypeName = archetype?.name?.toLowerCase() || '';
  const description = archetype?.description?.toLowerCase() || '';
  const name = buildingName?.toLowerCase() || '';
  const allText = `${archetypeId} ${archetypeName} ${description} ${name}`;

  // Explicit tower keywords → tower
  if (allText.includes('tower') || allText.includes('skyscraper') || allText.includes('high-rise') ||
      allText.includes('highrise') || allText.includes('high rise')) {
    return 'tower';
  }

  // Check for shed programs
  for (const program of SHED_PROGRAMS) {
    if (allText.includes(program.replace('_', ' ')) || allText.includes(program)) {
      return 'shed';
    }
  }

  // Residential types that are towers
  if (allText.includes('apartment') || allText.includes('condo') || allText.includes('residential tower')) {
    return 'tower';
  }

  // Office usually towers
  if (allText.includes('office') || allText.includes('corporate') || allText.includes('headquarters')) {
    return 'tower';
  }

  // Default to tower for now (existing behavior)
  return 'tower';
}

/**
 * Select shed typology based on archetype
 */
function selectShedTypology(archetype, buildingName = '') {
  const archetypeId = archetype?.id?.toLowerCase() || '';
  const archetypeName = archetype?.name?.toLowerCase() || '';
  const description = archetype?.description?.toLowerCase() || '';
  const name = buildingName?.toLowerCase() || '';
  const allText = `${archetypeId} ${archetypeName} ${description} ${name}`;

  // Match to specific shed types
  if (allText.includes('museum') || allText.includes('exhibit')) return 'museum';
  if (allText.includes('gallery') || allText.includes('art space')) return 'gallery';
  if (allText.includes('library') || allText.includes('reading')) return 'library';
  if (allText.includes('school') || allText.includes('education') || allText.includes('classroom')) return 'school';
  if (allText.includes('community') || allText.includes('civic') || allText.includes('recreation')) return 'community';
  if (allText.includes('warehouse') || allText.includes('factory') || allText.includes('industrial') ||
      allText.includes('workshop') || allText.includes('maker')) return 'warehouse';
  if (allText.includes('theater') || allText.includes('auditorium') || allText.includes('concert') ||
      allText.includes('performance')) return 'community'; // performance spaces are community-like

  // Default shed type
  return 'museum'; // Most versatile
}

/**
 * Get max floors for a given typology (material-based height limits)
 */
function getTypologyMaxFloors(typology) {
  return TYPOLOGY_MAX_FLOORS[typology] || 20; // Default to 20 if not specified
}

/**
 * Select tower typology based on archetype.
 */
function selectTowerTypology(archetype, floors, buildingName = '') {
  const archetypeId = archetype?.id?.toLowerCase() || '';
  const archetypeName = archetype?.name?.toLowerCase() || '';
  const strategy = archetype?.massing?.strategy || '';
  const description = archetype?.description?.toLowerCase() || '';
  const name = buildingName?.toLowerCase() || '';

  // Check all text for typology keywords (including building name)
  const allText = `${archetypeId} ${archetypeName} ${description} ${name}`;

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM-BASED TYPOLOGIES (check first - these define the building's shape)
  // ═══════════════════════════════════════════════════════════════════════════

  // Twisted/spiral forms - very distinctive, check early
  if (allText.includes('twisted') || allText.includes('twist') || allText.includes('spiral') || allText.includes('torso') || allText.includes('calatrava')) {
    return 'twisted';
  }
  // Organic/curved forms
  if (allText.includes('organic') || allText.includes('undulat') || allText.includes('flowing') || allText.includes('sculptural') || allText.includes('blob')) {
    return 'organic';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MATERIAL-BASED TYPOLOGIES (check after form)
  // ═══════════════════════════════════════════════════════════════════════════

  // BRICK/MASONRY - explicit material request
  if (allText.includes('brick') || allText.includes('masonry') || allText.includes('red brick')) {
    console.log(`[TYPOLOGY] Detected masonry/brick in: "${allText.substring(0, 100)}..."`);
    return 'masonry';
  }
  // Timber/wood
  if (allText.includes('timber') || allText.includes('wood') || allText.includes('clt') || allText.includes('mass timber')) {
    return 'timber';
  }
  // Stone - but not if also mentions glass (e.g., "glass unlike stone")
  if ((allText.includes('stone') || allText.includes('hewn')) && !allText.includes('glass') && !allText.includes('brick')) {
    return 'stone';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STRUCTURAL TYPOLOGIES
  // ═══════════════════════════════════════════════════════════════════════════

  if (allText.includes('skeletal') || allText.includes('exposed frame') || allText.includes('exposed structure')) {
    return 'skeletal';
  }
  if (allText.includes('diagrid') || allText.includes('diamond') || allText.includes('exoskeleton') || allText.includes('gherkin') || allText.includes('30 st mary')) {
    return 'diagrid';
  }
  if (allText.includes('spire') || allText.includes('taper') || allText.includes('shard') || allText.includes('pointed') || allText.includes('needle')) {
    return 'spire';
  }
  if (allText.includes('brutalist') || allText.includes('brutalism') || allText.includes('raw concrete') || strategy === 'carved_monolith') {
    return 'brutalist';
  }
  if (allText.includes('curtainwall') || allText.includes('curtain wall') || allText.includes('seagram') || allText.includes('mies') || allText.includes('minimal glass')) {
    return 'curtainwall';
  }
  if (allText.includes('modular') || allText.includes('prefab') || allText.includes('stacked unit')) {
    return 'modular';
  }

  // Archetype-based fallbacks
  if (archetypeId.includes('parametric') || archetypeName.includes('parametric') || strategy === 'stack_and_shift') {
    return rng() > 0.5 ? 'diagrid' : 'twisted';
  }
  if (archetypeId.includes('organic') || archetypeName.includes('organic')) {
    return 'organic';
  }
  if (archetypeId.includes('minimal') || archetypeName.includes('minimal')) {
    return 'curtainwall';
  }
  if (archetypeId.includes('industrial') || archetypeName.includes('industrial')) {
    return 'skeletal';
  }

  // For tall towers, use more dramatic typologies (twisted more common)
  if (floors >= 8) {
    return pick(['diagrid', 'spire', 'twisted', 'twisted', 'curtainwall']);
  }
  if (floors >= 6) {
    return pick(['curtainwall', 'diagrid', 'twisted', 'spire']);
  }

  // Default for 4-5 floor towers - include twisted
  return pick(['curtainwall', 'twisted', 'diagrid', 'brutalist']);
}

/**
 * Generate a tower with skyscraper-engine quality structural expression.
 */
function generateSkyscraperTower(group, width, depth, floors, floorH, typology, options = {}) {
  console.log(`[TOWER] Input typology: "${typology}", exists in TOWER_TYPOLOGIES: ${!!TOWER_TYPOLOGIES[typology]}`);
  const typ = TOWER_TYPOLOGIES[typology] || TOWER_TYPOLOGIES.curtainwall;
  const totalHeight = floors * floorH;

  // Pick materials with slight color variation so no two buildings look the same
  const facadeMatName = pick(typ.facadeMats);
  const structMatName = pick(typ.structMats);
  console.log(`[TOWER] Using typology: ${typ.name}, facade: ${facadeMatName}, struct: ${structMatName}`);
  if (!MATS[facadeMatName]) {
    console.error(`[TOWER] Missing facade material: ${facadeMatName}`);
  }
  if (!MATS[structMatName]) {
    console.error(`[TOWER] Missing struct material: ${structMatName}`);
  }
  // Apply color variation (6% for facade, 4% for structure)
  const facadeMat = MATS[facadeMatName] ? getVariedMaterial(MATS[facadeMatName], 0.06) : MATS.concrete();
  const structMat = MATS[structMatName] ? getVariedMaterial(MATS[structMatName], 0.04) : MATS.steel();

  // Parameters
  const taper = rr(typ.taperRange[0], typ.taperRange[1]);
  const twist = typ.twistRange ? rr(typ.twistRange[0], typ.twistRange[1]) : 0;
  const mullionDensity = rr(typ.mullionDensity[0], typ.mullionDensity[1]);
  const mullionRadius = rr(0.2, 0.5);

  const hw = width / 2;
  const hd = depth / 2;

  // Generate sections (for setbacks)
  const numSections = typology === 'brutalist' ? ri(1, 2) : ri(2, 4);
  const sections = [];
  let currentY = 0;

  for (let i = 0; i < numSections; i++) {
    const t = i / numSections;
    const sectionFloors = Math.ceil(floors / numSections);
    const sectionH = sectionFloors * floorH;
    const taperFactor = 1.0 - taper * t;
    const w = width * taperFactor * (i === 0 ? rr(1.0, 1.15) : rr(0.85, 1.0));
    const d = depth * taperFactor * (i === 0 ? rr(1.0, 1.1) : rr(0.85, 1.0));

    sections.push({
      y: currentY,
      height: sectionH,
      width: w,
      depth: d,
      floors: sectionFloors,
    });
    currentY += sectionH;
  }

  // Build each section
  sections.forEach((sec, si) => {
    const shw = sec.width / 2;
    const shd = sec.depth / 2;
    const y0 = sec.y;

    // ── FACADE VOLUME ──
    // Masonry, brutalist, organic have their own solid volumes; modular builds its own
    // Organic creates its own curved shell, so skip rectangular box
    if (typology !== 'brutalist' && typology !== 'modular' && typology !== 'masonry' && typology !== 'organic') {
      const glassGeo = new THREE.BoxGeometry(sec.width - 0.3, sec.height, sec.depth - 0.3);
      const glassMesh = new THREE.Mesh(glassGeo, facadeMat);
      glassMesh.position.y = y0 + sec.height / 2;
      glassMesh.castShadow = true;
      glassMesh.receiveShadow = true;

      // Apply twist
      if (twist > 0) {
        const t = (y0 + sec.height / 2) / totalHeight;
        glassMesh.rotation.y = t * twist;
      }

      group.add(glassMesh);
    }

    // Masonry gets a solid brick volume
    if (typology === 'masonry') {
      const brickGeo = new THREE.BoxGeometry(sec.width, sec.height, sec.depth);
      const brickMesh = new THREE.Mesh(brickGeo, facadeMat);
      brickMesh.position.y = y0 + sec.height / 2;
      brickMesh.castShadow = true;
      brickMesh.receiveShadow = true;
      group.add(brickMesh);
    }

    // ── FLOOR SLABS ──
    // Organic typology creates its own curved floor plates, so skip rectangular slabs
    if (typology !== 'organic') {
      const slabMat = typology === 'brutalist' ? MATS.concrete() : MATS.steel_dark();
      for (let f = 0; f <= sec.floors; f++) {
        const fy = y0 + f * floorH;
        const slabW = sec.width + (f === 0 && si > 0 ? 1.5 : 0.6);
        const slabD = sec.depth + (f === 0 && si > 0 ? 1.5 : 0.6);
        const slabH = typology === 'brutalist' ? rr(0.6, 1.0) : rr(0.25, 0.45);

        const slab = box(slabW, slabH, slabD, slabMat);
        slab.position.y = fy;
        slab.receiveShadow = true;

        if (twist > 0) {
          const t = fy / totalHeight;
          slab.rotation.y = t * twist;
        }

        group.add(slab);
      }
    }

    // ── STRUCTURAL EXPRESSION BY TYPOLOGY ──
    if (typology === 'diagrid') {
      addDiagridStructure(group, sec, y0, mullionRadius, mullionDensity, structMat, twist, totalHeight);
    } else if (typology === 'curtainwall') {
      addCurtainwallStructure(group, sec, y0, floorH, mullionRadius, mullionDensity, structMat, twist, totalHeight);
    } else if (typology === 'brutalist') {
      addBrutalistStructure(group, sec, y0, floorH, facadeMat, MATS.glass_tower_dark());
    } else if (typology === 'modular') {
      addModularStructure(group, sec, y0, floorH, facadeMat, MATS.glass_tower_dark());
    } else if (typology === 'twisted') {
      addTwistedStructure(group, sec, y0, floorH, mullionRadius, structMat, twist, totalHeight);
    } else if (typology === 'spire') {
      addSpireStructure(group, sec, y0, floorH, mullionRadius, structMat, taper, totalHeight);
    } else if (typology === 'timber') {
      addTimberStructure(group, sec, y0, floorH, facadeMat, structMat, twist, totalHeight);
    } else if (typology === 'stone') {
      addStoneStructure(group, sec, y0, floorH, facadeMat);
    } else if (typology === 'skeletal') {
      addSkeletalStructure(group, sec, y0, floorH, mullionRadius * 1.5, structMat, MATS.glass_clear());
    } else if (typology === 'organic') {
      addOrganicStructure(group, sec, y0, floorH, facadeMat, structMat, twist, totalHeight);
    } else if (typology === 'masonry') {
      // Pick window type from typology settings (arch or rect)
      const windowTypes = typ.windowTypes || ['rect'];
      const windowType = pick(windowTypes);
      addMasonryStructure(group, sec, y0, floorH, facadeMat, windowType);
    }

    // ── CORNER COLUMNS (for non-specialized types) ──
    if (!['brutalist', 'modular', 'twisted', 'spire', 'timber', 'stone', 'skeletal', 'organic', 'masonry'].includes(typology)) {
      const corners = [[-shw, -shd], [shw, -shd], [shw, shd], [-shw, shd]];
      corners.forEach(([cx, cz]) => {
        const col = tube([cx, y0, cz], [cx, y0 + sec.height, cz], mullionRadius * 0.8, structMat);
        if (col) group.add(col);
      });
    }
  });

  // ── BASE/LOBBY TREATMENT ──
  // Add distinct ground floor with higher ceiling, entrance, columns
  const baseSec = sections[0];
  if (baseSec && typology !== 'brutalist') {
    const entryType = typ.entryTypes ? pick(typ.entryTypes) : null;
    addTowerBase(group, baseSec, floorH, structMat, entryType);
  }

  // ── CROWN ──
  if (rng() < typ.crownChance) {
    const topSec = sections[sections.length - 1];
    const crownType = pick(CROWN_TYPES);
    const crownH = rr(8, 25);
    addTowerCrown(group, topSec, crownType, crownH, structMat, facadeMat);
  }

  return {
    typology,
    totalHeight: currentY,
    sections: sections.length,
    taper,
    twist,
    facade: facadeMatName,
    structure: structMatName,
  };
}

// ══════════════════════════════════════════════════════════════════
// SHED GENERATOR (flat, object-like buildings: museums, libraries, schools)
// ══════════════════════════════════════════════════════════════════

/**
 * Generate a shed building - flat, horizontal, sculptural object-like form
 * Museums, libraries, schools, galleries, community centers, warehouses
 */
function generateShedBuilding(group, width, depth, floors, floorH, typology, archetype) {
  const typ = SHED_TYPOLOGIES[typology] || SHED_TYPOLOGIES.museum;
  const totalHeight = floors * floorH;
  const hw = width / 2;
  const hd = depth / 2;

  // Pick materials from typology or archetype
  const facadeMatName = pick(typ.facadeMats);
  const structMatName = pick(typ.structMats);
  const roofMatName = pick(typ.roofMats || ['metal_roof']);
  const facadeMat = MATS[facadeMatName] ? MATS[facadeMatName]() : MATS.concrete_light();
  const structMat = MATS[structMatName] ? MATS[structMatName]() : MATS.steel();
  const roofMat = MATS[roofMatName] ? MATS[roofMatName]() : MATS.metal_roof();
  const glassMat = MATS.glass_tower_light();

  // ═══════════════════════════════════════════════════════════════
  // BASE VOLUME
  // ═══════════════════════════════════════════════════════════════

  // Ground slab
  const slabMat = MATS.concrete();
  const slab = box(width + 4, 0.6, depth + 4, slabMat);
  slab.position.y = -0.3;
  slab.receiveShadow = true;
  group.add(slab);

  // Main mass - may be articulated based on typology
  const hasCantilever = rng() < (typ.cantileverChance || 0);
  const hasVoid = rng() < (typ.voidChance || 0);
  const hasClerestory = rng() < (typ.clerestoryChance || 0);
  const hasCourtyard = rng() < (typ.courtyardChance || 0);
  const hasArcade = rng() < (typ.arcadeChance || 0);
  const hasSkylight = rng() < (typ.skylightChance || 0);
  const hasCanopy = rng() < (typ.canopyChance || 0);

  // ═══════════════════════════════════════════════════════════════
  // MASSING STRATEGY
  // ═══════════════════════════════════════════════════════════════

  if (hasCourtyard && width > 60 && depth > 60) {
    // U-shape or courtyard configuration
    const courtW = width * 0.4;
    const courtD = depth * 0.4;
    const wingW = (width - courtW) / 2;
    const wingD = (depth - courtD) / 2;

    // Left wing
    const leftWing = box(wingW, totalHeight, depth, facadeMat);
    leftWing.position.set(-hw + wingW / 2, totalHeight / 2, 0);
    leftWing.castShadow = true;
    group.add(leftWing);

    // Right wing
    const rightWing = box(wingW, totalHeight, depth, facadeMat);
    rightWing.position.set(hw - wingW / 2, totalHeight / 2, 0);
    rightWing.castShadow = true;
    group.add(rightWing);

    // Back connector
    const backBar = box(courtW, totalHeight, wingD, facadeMat);
    backBar.position.set(0, totalHeight / 2, -hd + wingD / 2);
    backBar.castShadow = true;
    group.add(backBar);

  } else if (hasCantilever) {
    // Cantilever form: lower base with dramatic overhang
    const baseHeight = totalHeight * 0.4;
    const cantileverHeight = totalHeight - baseHeight;
    const cantileverOffset = width * rr(0.15, 0.3);

    // Solid base (narrower)
    const baseW = width * 0.7;
    const baseVol = box(baseW, baseHeight, depth, facadeMat);
    baseVol.position.set(0, baseHeight / 2, 0);
    baseVol.castShadow = true;
    group.add(baseVol);

    // Cantilevered upper volume
    const upperVol = box(width, cantileverHeight, depth * 0.9, facadeMat);
    upperVol.position.set(cantileverOffset, baseHeight + cantileverHeight / 2, 0);
    upperVol.castShadow = true;
    group.add(upperVol);

    // Structure: exposed columns supporting cantilever
    const colR = 0.6;
    const colMat = structMat;
    for (let i = 0; i < 3; i++) {
      const col = cylinder(colR, baseHeight, colMat);
      col.position.set(-baseW / 2 - 3 + cantileverOffset + i * (width * 0.4), baseHeight / 2, hd * 0.7);
      col.castShadow = true;
      group.add(col);
    }

  } else if (hasVoid) {
    // Void/cut form: solid mass with dramatic cutout
    const mainVol = box(width, totalHeight, depth, facadeMat);
    mainVol.position.set(0, totalHeight / 2, 0);
    mainVol.castShadow = true;
    group.add(mainVol);

    // Cut void (represented as darker inset)
    const voidW = width * rr(0.25, 0.4);
    const voidH = totalHeight * rr(0.5, 0.8);
    const voidD = depth * 0.5;
    const voidMat = MATS.steel_dark();
    const voidBox = box(voidW, voidH, voidD + 1, voidMat);
    const voidOffsetX = rr(-0.2, 0.2) * width;
    voidBox.position.set(voidOffsetX, voidH / 2 + (totalHeight - voidH) * 0.3, hd - voidD / 2);
    group.add(voidBox);

    // Glass back wall of void
    const voidGlass = box(voidW - 0.5, voidH - 0.5, 0.3, glassMat);
    voidGlass.position.set(voidOffsetX, voidH / 2 + (totalHeight - voidH) * 0.3, hd - voidD + 0.2);
    group.add(voidGlass);

  } else {
    // Simple bar/box form
    const mainVol = box(width, totalHeight, depth, facadeMat);
    mainVol.position.set(0, totalHeight / 2, 0);
    mainVol.castShadow = true;
    group.add(mainVol);
  }

  // ═══════════════════════════════════════════════════════════════
  // ARCADE / COVERED WALKWAY
  // ═══════════════════════════════════════════════════════════════
  if (hasArcade) {
    const arcadeH = floorH;
    const arcadeD = 8;
    const arcadeW = width + 4;
    const nCols = Math.floor(arcadeW / 12);

    // Arcade roof
    const arcadeRoof = box(arcadeW, 0.5, arcadeD, structMat);
    arcadeRoof.position.set(0, arcadeH, hd + arcadeD / 2);
    arcadeRoof.castShadow = true;
    group.add(arcadeRoof);

    // Columns
    for (let i = 0; i <= nCols; i++) {
      const cx = -arcadeW / 2 + 2 + i * (arcadeW - 4) / nCols;
      const col = cylinder(0.4, arcadeH, structMat, 8);
      col.position.set(cx, arcadeH / 2, hd + arcadeD - 1);
      col.castShadow = true;
      group.add(col);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ENTRY CANOPY
  // ═══════════════════════════════════════════════════════════════
  if (hasCanopy) {
    const canopyW = Math.min(20, width * 0.4);
    const canopyD = 12;
    const canopyH = floorH * 0.8;

    // Canopy slab
    const canopy = box(canopyW, 0.4, canopyD, structMat);
    canopy.position.set(0, canopyH, hd + canopyD / 2);
    canopy.castShadow = true;
    group.add(canopy);

    // V-columns or simple columns
    if (rng() > 0.5) {
      // V-columns
      addVColumn(group, -canopyW / 4, hd + canopyD - 2, canopyH, () => structMat);
      addVColumn(group, canopyW / 4, hd + canopyD - 2, canopyH, () => structMat);
    } else {
      // Tube columns
      const col1 = cylinder(0.3, canopyH, structMat, 12);
      col1.position.set(-canopyW / 3, canopyH / 2, hd + canopyD - 1);
      group.add(col1);
      const col2 = cylinder(0.3, canopyH, structMat, 12);
      col2.position.set(canopyW / 3, canopyH / 2, hd + canopyD - 1);
      group.add(col2);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FENESTRATION (windows)
  // ═══════════════════════════════════════════════════════════════
  const windowMat = MATS.steel_dark();

  // Add strip windows or punched windows based on typology
  if (typology === 'warehouse' || typology === 'school') {
    // Regular punched windows
    const windowW = 4;
    const windowH = floorH * 0.5;
    const frameMat = windowMat;

    const faces = [
      { axis: 'z', sign: 1, faceW: width, off: hd }, // front
      { axis: 'z', sign: -1, faceW: width, off: hd }, // back
      { axis: 'x', sign: 1, faceW: depth, off: hw }, // right
      { axis: 'x', sign: -1, faceW: depth, off: hw }, // left
    ];

    for (let f = 0; f < floors; f++) {
      const windowY = f * floorH + floorH * 0.5;
      faces.forEach(face => {
        const nWin = Math.floor(face.faceW / 10);
        const spacing = face.faceW / (nWin + 1);
        for (let w = 1; w <= nWin; w++) {
          const wPos = -face.faceW / 2 + spacing * w;
          const winGeo = new THREE.BoxGeometry(
            face.axis === 'x' ? 0.3 : windowW,
            windowH,
            face.axis === 'z' ? 0.3 : windowW
          );
          const win = new THREE.Mesh(winGeo, glassMat);
          if (face.axis === 'x') {
            win.position.set(face.sign * (face.off + 0.15), windowY, wPos);
          } else {
            win.position.set(wPos, windowY, face.sign * (face.off + 0.15));
          }
          group.add(win);
        }
      });
    }
  } else {
    // Ribbon windows (modern)
    const ribbonH = floorH * 0.4;

    for (let f = 0; f < floors; f++) {
      const ribbonY = f * floorH + floorH * 0.45;

      // Front ribbon
      const frontRibbon = box(width - 4, ribbonH, 0.3, glassMat);
      frontRibbon.position.set(0, ribbonY, hd + 0.15);
      group.add(frontRibbon);

      // Back ribbon
      const backRibbon = box(width - 4, ribbonH, 0.3, glassMat);
      backRibbon.position.set(0, ribbonY, -hd - 0.15);
      group.add(backRibbon);

      // Frame mullions
      const nMullions = Math.floor(width / 8);
      for (let m = 0; m <= nMullions; m++) {
        const mx = -width / 2 + 2 + m * (width - 4) / nMullions;
        const mullion = box(0.15, ribbonH + 0.3, 0.4, windowMat);
        mullion.position.set(mx, ribbonY, hd + 0.2);
        group.add(mullion);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ROOF
  // ═══════════════════════════════════════════════════════════════
  const roofType = pick(typ.roofTypes || ['flat']);

  if (roofType === 'pitched' || roofType === 'gable') {
    const ridgeH = floorH * 0.6;
    addPitchedRoof(group, width, depth, ridgeH, 'z', roofMat);
  } else if (roofType === 'shed') {
    // Shed roof (single slope) - CCW winding for upward normals
    const shedH = floorH * 0.4;
    const roofGeo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      // Triangle 1: back-left → front-right → back-right (CCW from above)
      -hw, totalHeight, -hd,
      hw, totalHeight + shedH, hd,
      hw, totalHeight, -hd,
      // Triangle 2: back-left → front-left → front-right (CCW from above)
      -hw, totalHeight, -hd,
      -hw, totalHeight + shedH, hd,
      hw, totalHeight + shedH, hd,
    ]);
    roofGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    roofGeo.computeVertexNormals();
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.castShadow = true;
    group.add(roof);
  } else if (roofType === 'butterfly') {
    // Butterfly roof (inverted gable) - CCW winding for upward normals
    const dip = floorH * 0.3;
    // Left slope (slopes down toward center)
    const leftGeo = new THREE.BufferGeometry();
    const leftVerts = new Float32Array([
      // Triangle 1: CCW from above
      -hw, totalHeight + dip, -hd,
      0, totalHeight, hd,
      0, totalHeight, -hd,
      // Triangle 2: CCW from above
      -hw, totalHeight + dip, -hd,
      -hw, totalHeight + dip, hd,
      0, totalHeight, hd,
    ]);
    leftGeo.setAttribute('position', new THREE.BufferAttribute(leftVerts, 3));
    leftGeo.computeVertexNormals();
    const leftRoof = new THREE.Mesh(leftGeo, roofMat);
    leftRoof.castShadow = true;
    group.add(leftRoof);

    // Right slope (slopes down toward center)
    const rightGeo = new THREE.BufferGeometry();
    const rightVerts = new Float32Array([
      // Triangle 1: CCW from above
      0, totalHeight, -hd,
      hw, totalHeight + dip, hd,
      hw, totalHeight + dip, -hd,
      // Triangle 2: CCW from above
      0, totalHeight, -hd,
      0, totalHeight, hd,
      hw, totalHeight + dip, hd,
    ]);
    rightGeo.setAttribute('position', new THREE.BufferAttribute(rightVerts, 3));
    rightGeo.computeVertexNormals();
    const rightRoof = new THREE.Mesh(rightGeo, roofMat);
    rightRoof.castShadow = true;
    group.add(rightRoof);
  } else if (roofType === 'sawtooth') {
    // Sawtooth roof (industrial) - CCW winding for upward normals
    const nTeeth = Math.max(2, Math.floor(depth / 25));
    const toothD = depth / nTeeth;
    const toothH = floorH * 0.5;

    for (let t = 0; t < nTeeth; t++) {
      const tz = -hd + t * toothD + toothD / 2;

      // Sloped surface - CCW winding
      const slopeGeo = new THREE.BufferGeometry();
      const slopeVerts = new Float32Array([
        // Triangle 1: CCW from above
        -hw + 1, totalHeight, tz - toothD / 2 + 0.5,
        hw - 1, totalHeight + toothH, tz + toothD / 2 - 0.5,
        hw - 1, totalHeight, tz - toothD / 2 + 0.5,
        // Triangle 2: CCW from above
        -hw + 1, totalHeight, tz - toothD / 2 + 0.5,
        -hw + 1, totalHeight + toothH, tz + toothD / 2 - 0.5,
        hw - 1, totalHeight + toothH, tz + toothD / 2 - 0.5,
      ]);
      slopeGeo.setAttribute('position', new THREE.BufferAttribute(slopeVerts, 3));
      slopeGeo.computeVertexNormals();
      const slopeMesh = new THREE.Mesh(slopeGeo, roofMat);
      slopeMesh.castShadow = true;
      group.add(slopeMesh);

      // Vertical glass face
      const glassPane = box(width - 4, toothH * 0.8, 0.2, glassMat);
      glassPane.position.set(0, totalHeight + toothH * 0.5, tz + toothD / 2 - 0.3);
      group.add(glassPane);
    }
  } else if (roofType === 'skylight' && hasSkylight) {
    // Flat roof with skylights
    const roofSlab = box(width, 0.5, depth, facadeMat);
    roofSlab.position.set(0, totalHeight + 0.25, 0);
    roofSlab.castShadow = true;
    group.add(roofSlab);

    // Skylights
    const nSkylights = ri(2, 4);
    const skylightW = (width - 8) / nSkylights - 2;
    for (let s = 0; s < nSkylights; s++) {
      const sx = -width / 2 + 4 + skylightW / 2 + s * (skylightW + 2);
      const skylight = box(skylightW, 0.3, depth * 0.5, glassMat);
      skylight.position.set(sx, totalHeight + 0.6, 0);
      group.add(skylight);
    }
  } else if (roofType === 'curved') {
    // Curved/barrel roof - CCW winding for upward normals
    const curveH = floorH * 0.4;
    const segments = 12;
    for (let s = 0; s < segments; s++) {
      const t0 = s / segments;
      const t1 = (s + 1) / segments;
      const angle0 = Math.PI * t0;
      const angle1 = Math.PI * t1;
      const y0 = totalHeight + Math.sin(angle0) * curveH;
      const y1 = totalHeight + Math.sin(angle1) * curveH;
      const x0 = -hw + t0 * width;
      const x1 = -hw + t1 * width;

      const segGeo = new THREE.BufferGeometry();
      const segVerts = new Float32Array([
        // Triangle 1: CCW from above
        x0, y0, -hd,
        x1, y1, hd,
        x1, y1, -hd,
        // Triangle 2: CCW from above
        x0, y0, -hd,
        x0, y0, hd,
        x1, y1, hd,
      ]);
      segGeo.setAttribute('position', new THREE.BufferAttribute(segVerts, 3));
      segGeo.computeVertexNormals();
      const segMesh = new THREE.Mesh(segGeo, roofMat);
      segMesh.castShadow = true;
      group.add(segMesh);
    }
  } else {
    // Flat roof with parapet
    const roofSlab = box(width, 0.5, depth, facadeMat);
    roofSlab.position.set(0, totalHeight + 0.25, 0);
    roofSlab.castShadow = true;
    group.add(roofSlab);

    // Parapet
    const parapetH = 2;
    const parapetThick = 0.4;
    const frontParapet = box(width, parapetH, parapetThick, facadeMat);
    frontParapet.position.set(0, totalHeight + 0.5 + parapetH / 2, hd - parapetThick / 2);
    group.add(frontParapet);
    const backParapet = box(width, parapetH, parapetThick, facadeMat);
    backParapet.position.set(0, totalHeight + 0.5 + parapetH / 2, -hd + parapetThick / 2);
    group.add(backParapet);
  }

  // ═══════════════════════════════════════════════════════════════
  // VARIED ENTRYWAY (if not already has arcade/canopy)
  // ═══════════════════════════════════════════════════════════════
  if (!hasArcade && !hasCanopy && typ.entryTypes) {
    const entryType = pick(typ.entryTypes);
    // Create a section-like object for the entry function
    const entrySec = { width, depth, height: totalHeight };
    addVariedEntryway(group, entrySec, floorH, structMat, entryType);
  }

  // ═══════════════════════════════════════════════════════════════
  // CLERESTORY (if library/community type)
  // ═══════════════════════════════════════════════════════════════
  if (hasClerestory && floors > 1) {
    const clerestoryH = floorH * 0.3;
    const clerestoryInset = 5;

    // Raised clerestory volume
    const clerestoryVol = box(width - clerestoryInset * 2, clerestoryH, depth * 0.6, facadeMat);
    clerestoryVol.position.set(0, totalHeight + clerestoryH / 2, 0);
    clerestoryVol.castShadow = true;
    group.add(clerestoryVol);

    // Clerestory glass bands
    const clerestoryGlass = box(width - clerestoryInset * 2 - 1, clerestoryH * 0.7, 0.3, glassMat);
    clerestoryGlass.position.set(0, totalHeight + clerestoryH / 2, depth * 0.3 + 0.15);
    group.add(clerestoryGlass);
  }

  return {
    typology,
    category: 'shed',
    totalHeight,
    floors,
    facade: facadeMatName,
    structure: structMatName,
    features: {
      cantilever: hasCantilever,
      void: hasVoid,
      courtyard: hasCourtyard,
      arcade: hasArcade,
      clerestory: hasClerestory,
      canopy: hasCanopy,
    }
  };
}

/**
 * Tower base: distinct lobby-scale ground floor with columns and entrance
 */
function addTowerBase(group, sec, floorH, structMat, entryType) {
  const hw = sec.width / 2, hd = sec.depth / 2;
  const lobbyH = floorH * 1.5; // Higher ground floor

  // Ground-level base slab (lobby floor)
  const baseMat = MATS.stone_gray ? MATS.stone_gray() : MATS.concrete();
  const baseSlab = box(sec.width + 2, 0.5, sec.depth + 2, baseMat);
  baseSlab.position.y = -0.25;
  baseSlab.receiveShadow = true;
  group.add(baseSlab);

  // Colonnade/pilotis at ground level
  const columnR = 0.8;
  const columnInset = 3;
  const nColsPerSide = Math.max(2, Math.floor(sec.width / 15));

  // Front columns (z positive)
  for (let c = 0; c < nColsPerSide; c++) {
    const cx = -hw + columnInset + (sec.width - columnInset * 2) / (nColsPerSide - 1) * c;
    const col = tube([cx, 0, hd + columnInset], [cx, lobbyH, hd + columnInset], columnR, structMat);
    if (col) {
      col.castShadow = true;
      group.add(col);
    }
  }

  // Add varied entryway
  const selectedEntry = entryType || pick(['canopy', 'recessed', 'glass_box', 'portal', 'portico']);
  addVariedEntryway(group, sec, lobbyH, structMat, selectedEntry);
}

/**
 * Varied entryway designs - creates distinct entry experiences
 * Supports: canopy, recessed, glass_box, portal, portico, arcade, sculptural, void, porch, timber_frame, monumental
 */
function addVariedEntryway(group, sec, lobbyH, structMat, entryType) {
  const hw = sec.width / 2, hd = sec.depth / 2;
  const entryW = Math.min(sec.width * 0.4, 25); // Max entry width
  const doorH = Math.min(lobbyH * 0.7, 12);
  const doorW = 4;

  switch (entryType) {
    case 'canopy': {
      // Modern projecting canopy with thin profile
      const canopyW = entryW;
      const canopyD = rr(8, 12);
      const canopyThick = rr(0.3, 0.6);
      const canopyMat = getVariedMaterial(MATS.steel_dark, 0.03);

      const canopy = box(canopyW, canopyThick, canopyD, canopyMat);
      canopy.position.set(0, lobbyH - 1, hd + canopyD / 2);
      canopy.castShadow = true;
      group.add(canopy);

      // Canopy supports - vary between columns and cantilever
      if (rng() > 0.5) {
        // Column supports
        const supportR = 0.25;
        [-canopyW / 2 + 1, canopyW / 2 - 1].forEach(sx => {
          const support = tube(
            [sx, 0, hd + canopyD - 1],
            [sx, lobbyH - 1, hd + canopyD - 1],
            supportR, structMat
          );
          if (support) group.add(support);
        });
      } else {
        // Cantilever with tension rods
        const rodR = 0.08;
        [-canopyW / 2 + 2, canopyW / 2 - 2].forEach(sx => {
          const rod = tube(
            [sx, lobbyH + 3, hd],
            [sx, lobbyH - 1, hd + canopyD - 1],
            rodR, structMat
          );
          if (rod) group.add(rod);
        });
      }

      // Glass doors
      addGlassEntryDoors(group, hd, doorW, doorH);
      break;
    }

    case 'recessed': {
      // Entry cut into the building mass
      const recessD = rr(6, 10);
      const recessW = entryW;
      const recessH = lobbyH;

      // Void/recess (darker material to suggest depth)
      const recessMat = getVariedMaterial(MATS.concrete, 0.03);
      const voidBack = box(recessW, recessH, 0.3, recessMat);
      voidBack.position.set(0, recessH / 2, hd - recessD);
      group.add(voidBack);

      // Side walls of recess
      const sidewallMat = getVariedMaterial(MATS.concrete_light, 0.03);
      [-recessW / 2, recessW / 2].forEach(sx => {
        const sidewall = box(0.3, recessH, recessD, sidewallMat);
        sidewall.position.set(sx, recessH / 2, hd - recessD / 2);
        group.add(sidewall);
      });

      // Ceiling of recess with lighting slot
      const ceiling = box(recessW - 0.6, 0.3, recessD, sidewallMat);
      ceiling.position.set(0, recessH - 0.15, hd - recessD / 2);
      group.add(ceiling);

      // Recessed glass doors
      const glassMat = MATS.glass_tower_dark();
      const door = box(doorW * 1.5, doorH, 0.2, glassMat);
      door.position.set(0, doorH / 2, hd - recessD + 0.3);
      group.add(door);
      break;
    }

    case 'glass_box': {
      // Modern glass vestibule projecting from facade
      const vestibuleW = entryW * 0.8;
      const vestibuleD = rr(8, 14);
      const vestibuleH = lobbyH * 0.9;
      const glassMat = MATS.glass_tower_light();
      const frameMat = getVariedMaterial(MATS.steel, 0.02);
      const frameSize = 0.15;

      // Glass walls
      // Front
      const frontGlass = box(vestibuleW, vestibuleH, 0.15, glassMat);
      frontGlass.position.set(0, vestibuleH / 2, hd + vestibuleD);
      group.add(frontGlass);

      // Sides
      [-vestibuleW / 2, vestibuleW / 2].forEach(sx => {
        const sideGlass = box(0.15, vestibuleH, vestibuleD, glassMat);
        sideGlass.position.set(sx, vestibuleH / 2, hd + vestibuleD / 2);
        group.add(sideGlass);
      });

      // Glass roof
      const roofGlass = box(vestibuleW, 0.2, vestibuleD, glassMat);
      roofGlass.position.set(0, vestibuleH, hd + vestibuleD / 2);
      group.add(roofGlass);

      // Steel frame edges
      // Vertical corners
      [[-vestibuleW / 2, hd], [vestibuleW / 2, hd], [-vestibuleW / 2, hd + vestibuleD], [vestibuleW / 2, hd + vestibuleD]].forEach(([fx, fz]) => {
        const corner = box(frameSize, vestibuleH, frameSize, frameMat);
        corner.position.set(fx, vestibuleH / 2, fz);
        group.add(corner);
      });

      // Horizontal frame at top
      const topFrameW = box(vestibuleW, frameSize, frameSize, frameMat);
      topFrameW.position.set(0, vestibuleH, hd + vestibuleD);
      group.add(topFrameW);
      break;
    }

    case 'portal': {
      // Monumental framed opening
      const portalW = entryW;
      const portalH = lobbyH * 1.1;
      const portalD = rr(2, 4);
      const frameMat = getVariedMaterial(MATS.concrete_light, 0.04);
      const frameThick = rr(1.5, 2.5);

      // Portal frame - thick concrete or stone surround
      // Left jamb
      const leftJamb = box(frameThick, portalH, portalD, frameMat);
      leftJamb.position.set(-portalW / 2 - frameThick / 2, portalH / 2, hd + portalD / 2);
      leftJamb.castShadow = true;
      group.add(leftJamb);

      // Right jamb
      const rightJamb = box(frameThick, portalH, portalD, frameMat);
      rightJamb.position.set(portalW / 2 + frameThick / 2, portalH / 2, hd + portalD / 2);
      rightJamb.castShadow = true;
      group.add(rightJamb);

      // Lintel/header
      const lintel = box(portalW + frameThick * 2, frameThick, portalD, frameMat);
      lintel.position.set(0, portalH + frameThick / 2, hd + portalD / 2);
      lintel.castShadow = true;
      group.add(lintel);

      // Recessed glass within portal
      addGlassEntryDoors(group, hd + portalD - 1, doorW * 1.2, doorH * 0.9);
      break;
    }

    case 'portico': {
      // Classical columns supporting projecting roof
      const porticoW = entryW;
      const porticoD = rr(10, 16);
      const nCols = ri(2, 4);
      const colR = rr(0.6, 1.0);
      const colMat = getVariedMaterial(MATS.concrete_light, 0.03);

      // Portico columns
      for (let c = 0; c <= nCols; c++) {
        const cx = -porticoW / 2 + c * (porticoW / nCols);
        const col = tube([cx, 0, hd + porticoD], [cx, lobbyH, hd + porticoD], colR, colMat);
        if (col) {
          col.castShadow = true;
          group.add(col);
        }

        // Column base
        const base = box(colR * 3, 0.5, colR * 3, colMat);
        base.position.set(cx, 0.25, hd + porticoD);
        group.add(base);

        // Column capital
        const cap = box(colR * 2.5, 0.4, colR * 2.5, colMat);
        cap.position.set(cx, lobbyH - 0.2, hd + porticoD);
        group.add(cap);
      }

      // Portico roof/entablature
      const roofMat = getVariedMaterial(MATS.concrete_light, 0.02);
      const roof = box(porticoW + 2, 0.8, porticoD + 1, roofMat);
      roof.position.set(0, lobbyH + 0.4, hd + porticoD / 2);
      roof.castShadow = true;
      group.add(roof);

      // Pediment (triangular)
      if (rng() > 0.4) {
        const pedimentH = rr(3, 5);
        const pedimentGeo = new THREE.BufferGeometry();
        const vertices = new Float32Array([
          -porticoW / 2 - 1, lobbyH + 0.8, hd + porticoD + 0.5,
          porticoW / 2 + 1, lobbyH + 0.8, hd + porticoD + 0.5,
          0, lobbyH + 0.8 + pedimentH, hd + porticoD + 0.5,
        ]);
        pedimentGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        pedimentGeo.computeVertexNormals();
        const pediment = new THREE.Mesh(pedimentGeo, roofMat);
        pediment.castShadow = true;
        group.add(pediment);
      }

      // Entry doors
      addGlassEntryDoors(group, hd, doorW, doorH);
      break;
    }

    case 'arcade': {
      // Series of arched openings
      const arcadeW = entryW;
      const arcadeD = rr(8, 12);
      const nArches = ri(3, 5);
      const archW = arcadeW / nArches;
      const archMat = getVariedMaterial(MATS.brick_red, 0.04);

      for (let a = 0; a < nArches; a++) {
        const ax = -arcadeW / 2 + archW / 2 + a * archW;

        // Arch piers
        const pierW = archW * 0.2;
        const pier = box(pierW, lobbyH, arcadeD, archMat);
        pier.position.set(ax - archW / 2 + pierW / 2, lobbyH / 2, hd + arcadeD / 2);
        pier.castShadow = true;
        group.add(pier);

        // Arch voussoirs (semicircular arch)
        const archRadius = (archW - pierW) / 2;
        const archSegments = 8;
        for (let s = 0; s <= archSegments; s++) {
          const angle = Math.PI * s / archSegments;
          const vx = ax + Math.cos(angle) * archRadius;
          const vy = lobbyH - archRadius + Math.sin(angle) * archRadius;
          const voussoir = box(0.5, 0.8, arcadeD * 0.3, archMat);
          voussoir.position.set(vx, vy, hd + arcadeD);
          voussoir.rotation.z = angle - Math.PI / 2;
          group.add(voussoir);
        }
      }

      // Final pier
      const finalPier = box(archW * 0.2, lobbyH, arcadeD, archMat);
      finalPier.position.set(arcadeW / 2 - archW * 0.1, lobbyH / 2, hd + arcadeD / 2);
      group.add(finalPier);

      // Arcade roof
      const roof = box(arcadeW, 0.5, arcadeD, archMat);
      roof.position.set(0, lobbyH + 0.25, hd + arcadeD / 2);
      group.add(roof);
      break;
    }

    case 'sculptural': {
      // Organic/artistic entry form
      const sculptW = entryW * 0.7;
      const sculptD = rr(6, 10);
      const sculptH = lobbyH * 1.2;
      const sculptMat = getVariedMaterial(MATS.concrete_light, 0.05);

      // Curved/tilted canopy element
      const canopyPoints = [];
      const segments = 12;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = -sculptW / 2 + t * sculptW;
        const y = sculptH + Math.sin(t * Math.PI) * 3;
        canopyPoints.push(new THREE.Vector3(x, y, hd + sculptD));
      }
      const canopyCurve = new THREE.CatmullRomCurve3(canopyPoints);
      const canopyGeo = new THREE.TubeGeometry(canopyCurve, segments, 0.8, 8, false);
      const canopyMesh = new THREE.Mesh(canopyGeo, sculptMat);
      canopyMesh.castShadow = true;
      group.add(canopyMesh);

      // Sculptural support columns (angled)
      const supportMat = getVariedMaterial(MATS.steel, 0.02);
      [-sculptW / 3, sculptW / 3].forEach((sx, i) => {
        const lean = (i === 0 ? -1 : 1) * rr(0.1, 0.2);
        const support = tube(
          [sx + lean * lobbyH, 0, hd + sculptD],
          [sx, sculptH, hd + sculptD],
          0.3, supportMat
        );
        if (support) group.add(support);
      });

      // Abstract glass entry
      addGlassEntryDoors(group, hd, doorW, doorH);
      break;
    }

    case 'void': {
      // Large carved-out entry void
      const voidW = entryW;
      const voidD = rr(10, 18);
      const voidH = lobbyH * 1.3;
      const voidMat = getVariedMaterial(MATS.concrete, 0.04);

      // Void ceiling (soffit)
      const soffit = box(voidW, 0.5, voidD, voidMat);
      soffit.position.set(0, voidH, hd + voidD / 2);
      group.add(soffit);

      // Void sides
      [-voidW / 2, voidW / 2].forEach(sx => {
        const side = box(0.4, voidH, voidD, voidMat);
        side.position.set(sx, voidH / 2, hd + voidD / 2);
        group.add(side);
      });

      // Set-back doors deep in void
      const glassMat = MATS.glass_tower_dark();
      const door = box(doorW * 2, doorH, 0.2, glassMat);
      door.position.set(0, doorH / 2, hd + 0.5);
      group.add(door);
      break;
    }

    case 'porch': {
      // Covered porch - at ground level for timber sheds
      const porchW = entryW * 0.9;
      const porchD = rr(6, 10);
      const porchH = lobbyH * 0.85;
      const woodMat = getVariedMaterial(MATS.wood_medium, 0.04);

      // Porch deck - small step up from ground (0.4 ft / ~5 inches)
      const deckHeight = 0.4;
      const deck = box(porchW, 0.3, porchD, woodMat);
      deck.position.set(0, deckHeight, hd + porchD / 2);
      group.add(deck);

      // Single step at front of porch
      const stepW = porchW * 0.7;
      const stepMat = getVariedMaterial(MATS.concrete_light, 0.02);
      const step = box(stepW, deckHeight, 1.5, stepMat);
      step.position.set(0, deckHeight / 2, hd + porchD + 0.75);
      group.add(step);

      // Porch posts - from deck level to roof
      const postSize = 0.35;
      const postH = porchH - deckHeight;
      [[-porchW / 2 + postSize, hd + porchD - postSize], [porchW / 2 - postSize, hd + porchD - postSize]].forEach(([px, pz]) => {
        const post = box(postSize, postH, postSize, woodMat);
        post.position.set(px, deckHeight + postH / 2, pz);
        group.add(post);
      });

      // Porch roof
      const roof = box(porchW + 1, 0.3, porchD + 1.5, woodMat);
      roof.position.set(0, porchH, hd + porchD / 2);
      roof.castShadow = true;
      group.add(roof);

      // Door at ground/deck level
      const doorMat = getVariedMaterial(MATS.timber_dark, 0.03);
      const actualDoorH = doorH * 0.85;
      const door = box(doorW, actualDoorH, 0.3, doorMat);
      door.position.set(0, deckHeight + actualDoorH / 2, hd + 0.2);
      group.add(door);
      break;
    }

    case 'timber_frame': {
      // Exposed timber entry structure
      const frameW = entryW * 0.8;
      const frameD = rr(6, 10);
      const frameH = lobbyH;
      const timberMat = getVariedMaterial(MATS.wood_dark, 0.04);
      const beamSize = rr(0.6, 1.0);

      // Timber posts
      [[-frameW / 2, hd], [frameW / 2, hd], [-frameW / 2, hd + frameD], [frameW / 2, hd + frameD]].forEach(([px, pz]) => {
        const post = box(beamSize, frameH, beamSize, timberMat);
        post.position.set(px, frameH / 2, pz);
        post.castShadow = true;
        group.add(post);
      });

      // Header beams
      // Front beam
      const frontBeam = box(frameW + beamSize, beamSize, beamSize, timberMat);
      frontBeam.position.set(0, frameH - beamSize / 2, hd + frameD);
      group.add(frontBeam);

      // Side beams
      [-frameW / 2, frameW / 2].forEach(sx => {
        const sideBeam = box(beamSize, beamSize, frameD, timberMat);
        sideBeam.position.set(sx, frameH - beamSize / 2, hd + frameD / 2);
        group.add(sideBeam);
      });

      // Cross bracing
      const braceR = 0.15;
      // Front X-brace
      group.add(tube([-frameW / 2 + beamSize, 0, hd + frameD], [frameW / 2 - beamSize, frameH * 0.6, hd + frameD], braceR, timberMat));
      group.add(tube([frameW / 2 - beamSize, 0, hd + frameD], [-frameW / 2 + beamSize, frameH * 0.6, hd + frameD], braceR, timberMat));

      // Glass doors
      addGlassEntryDoors(group, hd, doorW, doorH * 0.9);
      break;
    }

    case 'monumental': {
      // Oversized dramatic entry
      const monuW = entryW * 1.2;
      const monuH = lobbyH * 1.5;
      const monuD = rr(3, 6);
      const stoneMat = getVariedMaterial(MATS.stone_warm, 0.04);

      // Massive stone frame
      const frameThick = 3;

      // Jambs
      [-monuW / 2 - frameThick / 2, monuW / 2 + frameThick / 2].forEach(jx => {
        const jamb = box(frameThick, monuH, monuD, stoneMat);
        jamb.position.set(jx, monuH / 2, hd + monuD / 2);
        jamb.castShadow = true;
        group.add(jamb);
      });

      // Lintel
      const lintel = box(monuW + frameThick * 2, frameThick, monuD, stoneMat);
      lintel.position.set(0, monuH + frameThick / 2, hd + monuD / 2);
      lintel.castShadow = true;
      group.add(lintel);

      // Decorative keystone
      const keystone = box(frameThick, frameThick * 1.5, monuD * 0.8, stoneMat);
      keystone.position.set(0, monuH + frameThick, hd + monuD / 2);
      group.add(keystone);

      // Grand double doors
      const doorMat = getVariedMaterial(MATS.timber_dark, 0.02);
      [-monuW / 4, monuW / 4].forEach(dx => {
        const door = box(monuW / 2 - 1, monuH - 2, 0.5, doorMat);
        door.position.set(dx, (monuH - 2) / 2, hd + 0.3);
        group.add(door);
      });
      break;
    }

    default: {
      // Default: simple canopy fallback
      const canopyW = entryW;
      const canopyD = 8;
      const canopyMat = getVariedMaterial(MATS.steel_dark, 0.03);

      const canopy = box(canopyW, 0.4, canopyD, canopyMat);
      canopy.position.set(0, lobbyH - 1, hd + canopyD / 2);
      canopy.castShadow = true;
      group.add(canopy);

      addGlassEntryDoors(group, hd, doorW, doorH);
    }
  }
}

/**
 * Helper: add standard glass entry doors
 */
function addGlassEntryDoors(group, zPos, doorW, doorH) {
  const glassMat = MATS.glass_tower_dark();
  const frameMat = getVariedMaterial(MATS.steel, 0.02);
  const frameSize = 0.12;

  // Double doors
  const doorSpacing = doorW * 0.1;
  [-doorW / 2 - doorSpacing / 2, doorW / 2 + doorSpacing / 2].forEach(dx => {
    // Glass panel
    const door = box(doorW, doorH, 0.15, glassMat);
    door.position.set(dx, doorH / 2, zPos + 0.3);
    group.add(door);

    // Door frame
    // Top
    const topFrame = box(doorW + 0.2, frameSize, 0.2, frameMat);
    topFrame.position.set(dx, doorH, zPos + 0.35);
    group.add(topFrame);

    // Sides
    [-doorW / 2, doorW / 2].forEach(fx => {
      const sideFrame = box(frameSize, doorH, 0.2, frameMat);
      sideFrame.position.set(dx + fx, doorH / 2, zPos + 0.35);
      group.add(sideFrame);
    });
  });

  // Handle bars
  const handleMat = MATS.steel();
  [-doorW / 2 - doorSpacing / 2 + doorW * 0.3, doorW / 2 + doorSpacing / 2 - doorW * 0.3].forEach(hx => {
    const handle = box(0.08, doorH * 0.4, 0.15, handleMat);
    handle.position.set(hx, doorH * 0.5, zPos + 0.5);
    group.add(handle);
  });
}

/**
 * Diagrid structure: X-pattern on each face
 */
function addDiagridStructure(group, sec, y0, mr, density, mat, twist, totalH) {
  const hw = sec.width / 2, hd = sec.depth / 2;
  const faces = [
    { axis: 'x', sign: 1, span: sec.depth, off: hw },
    { axis: 'x', sign: -1, span: sec.depth, off: hw },
    { axis: 'z', sign: 1, span: sec.width, off: hd },
    { axis: 'z', sign: -1, span: sec.width, off: hd },
  ];

  faces.forEach(face => {
    const nDiv = Math.max(1, Math.round(face.span / rr(8, 14)));
    const divW = face.span / nDiv;

    for (let d = 0; d < nDiv; d++) {
      const localStart = -face.span / 2 + d * divW;
      const localEnd = localStart + divW;
      const localMid = (localStart + localEnd) / 2;
      const yB = y0, yT = y0 + sec.height, yM = (yB + yT) / 2;

      let p1, p2, p3;
      if (face.axis === 'x') {
        p1 = [face.sign * face.off, yB, localStart];
        p2 = [face.sign * face.off, yB, localEnd];
        p3 = [face.sign * face.off, yT, localMid];
      } else {
        p1 = [localStart, yB, face.sign * face.off];
        p2 = [localEnd, yB, face.sign * face.off];
        p3 = [localMid, yT, face.sign * face.off];
      }

      // X pattern
      group.add(tube(p1, p3, mr, mat));
      group.add(tube(p2, p3, mr, mat));

      // Cross member at mid
      if (rng() < density) {
        const mL = face.axis === 'x'
          ? [face.sign * face.off, yM, localStart]
          : [localStart, yM, face.sign * face.off];
        const mR = face.axis === 'x'
          ? [face.sign * face.off, yM, localEnd]
          : [localEnd, yM, face.sign * face.off];
        group.add(tube(mL, mR, mr * 0.6, mat));
      }
    }

    // Horizontal spandrels at top and bottom
    [y0, y0 + sec.height].forEach(yy => {
      const s1 = face.axis === 'x'
        ? [face.sign * face.off, yy, -face.span / 2]
        : [-face.span / 2, yy, face.sign * face.off];
      const s2 = face.axis === 'x'
        ? [face.sign * face.off, yy, face.span / 2]
        : [face.span / 2, yy, face.sign * face.off];
      group.add(tube(s1, s2, mr * 0.5, mat));
    });
  });
}

/**
 * Curtainwall structure: vertical mullions + horizontal spandrels at EVERY floor
 * Proper construction: mullions with actual depth, offset from glass to prevent z-fighting
 */
function addCurtainwallStructure(group, sec, y0, floorH, mr, density, mat, twist, totalH) {
  const hw = sec.width / 2, hd = sec.depth / 2;

  // Mullion sits in front of glass by this amount
  const mullionOffset = GEOM.LAYER_2;
  const spandrelOffset = GEOM.LAYER_3;

  const faces = [
    { axis: 'x', sign: 1, span: sec.depth, off: hw },
    { axis: 'x', sign: -1, span: sec.depth, off: hw },
    { axis: 'z', sign: 1, span: sec.width, off: hd },
    { axis: 'z', sign: -1, span: sec.width, off: hd },
  ];

  // Mullion spacing based on density (typically 4-6 ft for curtain wall)
  const mullionSpacing = rr(4, 6) / density;
  const mullionW = GEOM.MULLION_WIDTH;
  const mullionD = GEOM.MULLION_DEPTH;

  faces.forEach(face => {
    const nMullions = Math.max(2, Math.round(face.span / mullionSpacing));
    const mStep = face.span / nMullions;
    // Offset position to sit in front of glass
    const mullionPos = face.off + mullionOffset;

    // Vertical mullions - full height, as actual box geometry (not tubes)
    for (let m = 0; m <= nMullions; m++) {
      const localPos = -face.span / 2 + m * mStep;

      // Use box geometry for cleaner rectangular mullions
      const mullionGeo = face.axis === 'x'
        ? new THREE.BoxGeometry(mullionD, sec.height, mullionW)
        : new THREE.BoxGeometry(mullionW, sec.height, mullionD);
      const mullion = new THREE.Mesh(mullionGeo, mat);

      if (face.axis === 'x') {
        mullion.position.set(face.sign * mullionPos, y0 + sec.height / 2, localPos);
      } else {
        mullion.position.set(localPos, y0 + sec.height / 2, face.sign * mullionPos);
      }
      mullion.castShadow = true;
      group.add(mullion);
    }

    // Horizontal spandrels at EVERY floor (aligned with floor slabs)
    for (let f = 0; f <= sec.floors; f++) {
      const fy = y0 + f * floorH;

      // Horizontal mullion (transom)
      const transomGeo = face.axis === 'x'
        ? new THREE.BoxGeometry(mullionD, mullionW, face.span)
        : new THREE.BoxGeometry(face.span, mullionW, mullionD);
      const transom = new THREE.Mesh(transomGeo, mat);
      if (face.axis === 'x') {
        transom.position.set(face.sign * mullionPos, fy, 0);
      } else {
        transom.position.set(0, fy, face.sign * mullionPos);
      }
      group.add(transom);

      // Add spandrel panel (solid band 1.5ft tall at floor level)
      // Offset slightly behind mullions to prevent z-fighting
      if (f < sec.floors) {
        const spandrelH = 1.4;
        const spandrelMat = MATS.steel_dark();
        const spandrelThickness = 0.15;
        const spandrelGeo = face.axis === 'x'
          ? new THREE.BoxGeometry(spandrelThickness, spandrelH, face.span - mullionW * 2)
          : new THREE.BoxGeometry(face.span - mullionW * 2, spandrelH, spandrelThickness);
        const spandrel = new THREE.Mesh(spandrelGeo, spandrelMat);
        // Position just behind mullions
        const spandrelPos = face.off + spandrelOffset;
        if (face.axis === 'x') {
          spandrel.position.set(face.sign * spandrelPos, fy + spandrelH / 2, 0);
        } else {
          spandrel.position.set(0, fy + spandrelH / 2, face.sign * spandrelPos);
        }
        spandrel.receiveShadow = true;
        group.add(spandrel);
      }
    }
  });
}

/**
 * Brutalist structure: concrete shell with punched windows aligned to floors
 */
function addBrutalistStructure(group, sec, y0, floorH, wallMat, glassMat) {
  const hw = sec.width / 2, hd = sec.depth / 2;

  // Slight color variation for concrete - warm soft gray (illustrative style)
  const colorVariation = rr(-0.015, 0.015);
  const variedWallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xE8E4E0).offsetHSL(0, 0, colorVariation),
    metalness: 0.0,
    roughness: rr(0.85, 0.92)
  });

  // Main concrete shell
  const shell = box(sec.width, sec.height, sec.depth, variedWallMat);
  shell.position.y = y0 + sec.height / 2;
  shell.castShadow = true;
  group.add(shell);

  // Window parameters with per-building variation
  const windowH = floorH * rr(0.4, 0.6);  // Varied window height
  const windowW = rr(2.5, 5);              // Window width varies
  const windowSpacing = windowW + rr(2, 5); // Spacing varies
  const windowInset = (floorH - windowH) / 2;

  // Glass with slight tint variation - soft blue (illustrative style)
  const glassTint = rr(-0.02, 0.02);
  const variedGlassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x88b0c8).offsetHSL(glassTint, 0, 0),
    metalness: 0.1,
    roughness: 0.05,
    transparent: true,
    opacity: rr(0.38, 0.52),
    side: THREE.DoubleSide
  });

  const faces = [
    { axis: 'x', sign: 1, spanW: sec.depth, off: hw + 0.1 },
    { axis: 'x', sign: -1, spanW: sec.depth, off: hw + 0.1 },
    { axis: 'z', sign: 1, spanW: sec.width, off: hd + 0.1 },
    { axis: 'z', sign: -1, spanW: sec.width, off: hd + 0.1 },
  ];

  faces.forEach(face => {
    // Calculate centered window layout
    const margin = rr(3, 6); // Edge margin
    const availableWidth = face.spanW - margin * 2;
    const nW = Math.max(1, Math.floor(availableWidth / windowSpacing));
    const actualSpacing = availableWidth / nW;
    const startW = -availableWidth / 2 + actualSpacing / 2;

    // One row of windows per floor
    for (let f = 0; f < sec.floors; f++) {
      const floorY = y0 + f * floorH;
      const windowY = floorY + windowInset + windowH / 2;

      for (let wi = 0; wi < nW; wi++) {
        if (rng() > 0.94) continue; // occasional skip for variety

        const wX = startW + wi * actualSpacing;

        // Slight size variation per window
        const wScale = rr(0.9, 1.1);
        const winGeo = new THREE.BoxGeometry(
          face.axis === 'x' ? 0.3 : windowW * wScale,
          windowH * wScale,
          face.axis === 'z' ? 0.3 : windowW * wScale
        );
        const win = new THREE.Mesh(winGeo, variedGlassMat);

        if (face.axis === 'x') {
          win.position.set(face.sign * face.off, windowY, wX);
        } else {
          win.position.set(wX, windowY, face.sign * face.off);
        }
        group.add(win);
      }
    }
  });
}

/**
 * Modular structure: stacked prefab units
 */
function addModularStructure(group, sec, y0, floorH, modMat, glassMat) {
  const moduleW = rr(4, 6);
  const nModW = Math.max(2, Math.round(sec.width / moduleW));
  const nModD = Math.max(2, Math.round(sec.depth / moduleW));
  const actualModW = sec.width / nModW;
  const actualModD = sec.depth / nModD;

  for (let f = 0; f < sec.floors; f++) {
    const fy = y0 + f * floorH;
    for (let mx = 0; mx < nModW; mx++) {
      for (let mz = 0; mz < nModD; mz++) {
        // Only perimeter
        if (mx > 0 && mx < nModW - 1 && mz > 0 && mz < nModD - 1) continue;
        if (rng() > 0.95) continue; // occasional void

        const px = -sec.width / 2 + mx * actualModW + actualModW / 2;
        const pz = -sec.depth / 2 + mz * actualModD + actualModD / 2;

        const mod = box(actualModW - 0.2, floorH - 0.2, actualModD - 0.2, modMat);
        mod.position.set(px, fy + floorH / 2, pz);
        group.add(mod);

        // Window on exposed face
        if (mx === 0 || mx === nModW - 1 || mz === 0 || mz === nModD - 1) {
          const winW = actualModW * 0.55;
          const winH = floorH * 0.45;
          const winGeo = new THREE.BoxGeometry(
            mz === 0 || mz === nModD - 1 ? winW : 0.15,
            winH,
            mx === 0 || mx === nModW - 1 ? winW : 0.15
          );
          const win = new THREE.Mesh(winGeo, glassMat);
          const offX = mx === 0 ? -1 : mx === nModW - 1 ? 1 : 0;
          const offZ = mz === 0 ? -1 : mz === nModD - 1 ? 1 : 0;
          win.position.set(
            px + offX * (actualModW / 2 + 0.05),
            fy + floorH / 2,
            pz + offZ * (actualModD / 2 + 0.05)
          );
          group.add(win);
        }
      }
    }
  }
}

/**
 * Twisted structure: edge members that show the twist + horizontal spandrels
 * Based on original skyscraper engine with more dramatic visual expression
 */
function addTwistedStructure(group, sec, y0, floorH, mr, mat, twist, totalH) {
  const hw = sec.width / 2, hd = sec.depth / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];

  // Edge members connecting twisted corners floor by floor
  for (let f = 0; f < sec.floors; f++) {
    const t0 = (y0 + f * floorH) / totalH;
    const t1 = (y0 + (f + 1) * floorH) / totalH;
    const a0 = t0 * twist;
    const a1 = t1 * twist;

    // Calculate rotated corner positions for this floor and next
    const cornersAtF0 = corners.map(([cx, cz]) => {
      const c = Math.cos(a0), s = Math.sin(a0);
      return [cx * c - cz * s, cx * s + cz * c];
    });
    const cornersAtF1 = corners.map(([cx, cz]) => {
      const c = Math.cos(a1), s = Math.sin(a1);
      return [cx * c - cz * s, cx * s + cz * c];
    });

    // Vertical edge members (twisted columns)
    corners.forEach(([cx, cz], i) => {
      const [x0, z0] = cornersAtF0[i];
      const [x1, z1] = cornersAtF1[i];
      group.add(tube(
        [x0, y0 + f * floorH, z0],
        [x1, y0 + (f + 1) * floorH, z1],
        mr * 0.8, mat
      ));
    });

    // Horizontal spandrels at each floor connecting the twisted corners
    const fy = y0 + f * floorH;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const [x0, z0] = cornersAtF0[i];
      const [x1, z1] = cornersAtF0[j];
      group.add(tube([x0, fy, z0], [x1, fy, z1], mr * 0.5, mat));
    }

    // Mid-floor cross bracing (every 2-3 floors for visual interest)
    if (f % ri(2, 3) === 0 && f > 0) {
      const midY = y0 + f * floorH + floorH / 2;
      const tMid = midY / totalH;
      const aMid = tMid * twist;
      const cornersMid = corners.map(([cx, cz]) => {
        const c = Math.cos(aMid), s = Math.sin(aMid);
        return [cx * c - cz * s, cx * s + cz * c];
      });

      // Diagonal bracing on alternating faces
      if (rng() > 0.3) {
        const face = ri(0, 3);
        const next = (face + 1) % 4;
        const [ax, az] = cornersAtF0[face];
        const [bx, bz] = cornersAtF1[next];
        group.add(tube([ax, y0 + f * floorH, az], [bx, y0 + (f + 1) * floorH, bz], mr * 0.35, mat));
      }
    }
  }

  // Top floor spandrels
  const topF = sec.floors;
  const tTop = (y0 + topF * floorH) / totalH;
  const aTop = tTop * twist;
  const cornersTop = corners.map(([cx, cz]) => {
    const c = Math.cos(aTop), s = Math.sin(aTop);
    return [cx * c - cz * s, cx * s + cz * c];
  });
  const topY = y0 + topF * floorH;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const [x0, z0] = cornersTop[i];
    const [x1, z1] = cornersTop[j];
    group.add(tube([x0, topY, z0], [x1, topY, z1], mr * 0.5, mat));
  }
}

/**
 * Spire structure: converging corner columns
 */
function addSpireStructure(group, sec, y0, floorH, mr, mat, taper, totalH) {
  const hw = sec.width / 2, hd = sec.depth / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];

  const topScale = 1.0 - taper * ((y0 + sec.height) / totalH);
  const topHW = hw * topScale * rr(0.6, 0.9);
  const topHD = hd * topScale * rr(0.6, 0.9);
  const topCorners = [[-topHW, -topHD], [topHW, -topHD], [topHW, topHD], [-topHW, topHD]];

  // Converging corner columns
  corners.forEach((c, i) => {
    const tc = topCorners[i];
    group.add(tube(
      [c[0], y0, c[1]],
      [tc[0], y0 + sec.height, tc[1]],
      mr * 1.2, mat
    ));
  });

  // Cross bracing
  for (let f = 0; f < sec.floors; f += ri(2, 4)) {
    const fy = y0 + f * floorH;
    const t = fy / totalH;
    const s = 1.0 - taper * t;
    const cHW = hw * s, cHD = hd * s;
    const pts = [[-cHW, -cHD], [cHW, -cHD], [cHW, cHD], [-cHW, cHD]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      group.add(tube(
        [pts[i][0], fy, pts[i][1]],
        [pts[j][0], fy, pts[j][1]],
        mr * 0.5, mat
      ));
    }
  }
}

/**
 * Tower crown: spire, lantern, stepped, antenna, shards
 */
function addTowerCrown(group, topSec, type, crownH, structMat, facadeMat) {
  const crownY = topSec.y + topSec.height;
  const w = topSec.width, d = topSec.depth;

  switch (type) {
    case 'spire': {
      const spireR = rr(0.4, 1.0);
      group.add(tube([0, crownY, 0], [0, crownY + crownH, 0], spireR, structMat));
      // Support struts
      const sw = w * 0.3;
      [[-sw, -sw], [sw, -sw], [sw, sw], [-sw, sw]].forEach(([x, z]) => {
        group.add(tube([x, crownY, z], [0, crownY + crownH * 0.7, 0], spireR * 0.4, structMat));
      });
      break;
    }
    case 'lantern': {
      const lanternW = w * rr(0.4, 0.7);
      const lanternD = d * rr(0.4, 0.7);
      const lanternMat = MATS.glass_tower_light();
      const lantern = box(lanternW, crownH, lanternD, lanternMat);
      lantern.position.y = crownY + crownH / 2;
      group.add(lantern);
      // Frame
      const lhw = lanternW / 2, lhd = lanternD / 2;
      [[-lhw, -lhd], [lhw, -lhd], [lhw, lhd], [-lhw, lhd]].forEach(([x, z]) => {
        group.add(tube([x, crownY, z], [x, crownY + crownH, z], 0.3, structMat));
      });
      break;
    }
    case 'stepped': {
      const nSteps = ri(2, 5);
      for (let s = 0; s < nSteps; s++) {
        const t = s / nSteps;
        const stepW = w * (1 - t * 0.7) * rr(0.3, 0.6);
        const stepD = d * (1 - t * 0.7) * rr(0.3, 0.6);
        const stepH = crownH / nSteps;
        const step = box(stepW, stepH, stepD, structMat);
        step.position.y = crownY + s * stepH + stepH / 2;
        group.add(step);
      }
      break;
    }
    case 'antenna': {
      group.add(tube([0, crownY, 0], [0, crownY + crownH, 0], rr(0.2, 0.5), structMat));
      const armY = crownY + crownH * 0.6;
      const armW = rr(3, 8);
      group.add(tube([-armW, armY, 0], [armW, armY, 0], 0.15, structMat));
      group.add(tube([0, armY, -armW], [0, armY, armW], 0.15, structMat));
      break;
    }
    case 'shards': {
      const nShards = ri(2, 4);
      for (let s = 0; s < nShards; s++) {
        const sw = rr(2, 5), sh = rr(crownH * 0.4, crownH), sd = rr(2, 4);
        const sx = rr(-w * 0.25, w * 0.25);
        const sz = rr(-d * 0.25, d * 0.25);
        const shardMat = rng() > 0.5 ? MATS.titanium() : MATS.glass_tower_light();
        const shard = box(sw, sh, sd, shardMat);
        shard.position.set(sx, crownY + sh / 2, sz);
        shard.rotation.y = rr(-0.3, 0.3);
        shard.rotation.z = rr(-0.08, 0.08);
        group.add(shard);
      }
      break;
    }
    case 'mechanical': {
      // Mechanical penthouse with HVAC equipment
      const mechW = w * rr(0.5, 0.8);
      const mechD = d * rr(0.5, 0.8);
      const mechH = crownH * 0.6;
      const mechMat = MATS.precast();

      // Mechanical enclosure
      const mechBox = box(mechW, mechH, mechD, mechMat);
      mechBox.position.y = crownY + mechH / 2;
      mechBox.castShadow = true;
      group.add(mechBox);

      // Louvers/vents on sides
      const louverMat = MATS.steel_dark();
      const nLouvers = ri(2, 4);
      for (let l = 0; l < nLouvers; l++) {
        const louverW = mechW * 0.25;
        const louverH = mechH * 0.6;
        const louverGeo = new THREE.BoxGeometry(louverW, louverH, 0.15);
        const louver = new THREE.Mesh(louverGeo, louverMat);
        const lx = -mechW / 2 + mechW / (nLouvers + 1) * (l + 1);
        louver.position.set(lx, crownY + mechH * 0.5, mechD / 2 + 0.08);
        group.add(louver);
      }

      // Cooling tower / exhaust on top
      const coolW = rr(3, 6);
      const coolH = crownH * 0.35;
      const cooling = box(coolW, coolH, coolW, MATS.steel());
      cooling.position.set(rr(-mechW * 0.2, mechW * 0.2), crownY + mechH + coolH / 2, 0);
      group.add(cooling);
      break;
    }
    case 'parapet': {
      // Simple parapet wall around perimeter
      const parapetH = rr(2, 4);
      const parapetW = 0.8;
      const capMat = MATS.precast();

      // Four parapet walls
      const hw = w / 2, hd = d / 2;

      // Front and back
      [hd, -hd].forEach(zPos => {
        const parapet = box(w + parapetW, parapetH, parapetW, capMat);
        parapet.position.set(0, crownY + parapetH / 2, zPos);
        parapet.castShadow = true;
        group.add(parapet);
      });

      // Left and right
      [hw, -hw].forEach(xPos => {
        const parapet = box(parapetW, parapetH, d - parapetW, capMat);
        parapet.position.set(xPos, crownY + parapetH / 2, 0);
        parapet.castShadow = true;
        group.add(parapet);
      });

      // Cap on parapet
      const capH = 0.2;
      const cap = box(w + parapetW * 2, capH, d + parapetW * 2, MATS.stone_light());
      cap.position.y = crownY + parapetH + capH / 2;
      group.add(cap);
      break;
    }
  }
}

/**
 * Mass Timber structure: clear exposed column/beam grid with prominent structure
 * Creates visible post-and-beam or CLT-style construction
 */
function addTimberStructure(group, sec, y0, floorH, woodMat, structMat, twist, totalH) {
  const hw = sec.width / 2, hd = sec.depth / 2;

  // Get varied wood materials for visual interest
  const primaryWoodMat = getVariedMaterial(MATS.wood_dark, 0.04);   // Columns - darker
  const secondaryWoodMat = getVariedMaterial(MATS.wood_medium, 0.04); // Primary beams
  const tertiaryWoodMat = getVariedMaterial(MATS.wood_light, 0.04);  // Secondary beams/joists

  // Structural grid - consistent column spacing (bay size)
  const baySize = rr(12, 18); // 12-18 foot bays typical for mass timber
  const nBaysW = Math.max(1, Math.round(sec.width / baySize));
  const nBaysD = Math.max(1, Math.round(sec.depth / baySize));
  const actualBayW = sec.width / nBaysW;
  const actualBayD = sec.depth / nBaysD;

  // Column dimensions - substantial for mass timber
  const colSize = rr(1.5, 2.2); // 18-26 inch columns

  // Store column positions for beam connections
  const columnPositions = [];

  // COLUMNS - clear grid at every bay intersection
  for (let ix = 0; ix <= nBaysW; ix++) {
    for (let iz = 0; iz <= nBaysD; iz++) {
      const x = -hw + ix * actualBayW;
      const z = -hd + iz * actualBayD;

      // Full-height columns
      const col = box(colSize, sec.height, colSize, primaryWoodMat);
      col.position.set(x, y0 + sec.height / 2, z);
      col.castShadow = true;
      col.receiveShadow = true;
      group.add(col);

      columnPositions.push({ x, z, ix, iz });
    }
  }

  // PRIMARY BEAMS - span between columns at each floor
  const primaryBeamH = rr(1.2, 1.8); // Deep beams - 14-22 inches
  const primaryBeamW = rr(0.8, 1.2); // 10-14 inch wide

  for (let f = 1; f <= sec.floors; f++) {
    const fy = y0 + f * floorH;

    // Beams spanning in X direction (along width)
    for (let iz = 0; iz <= nBaysD; iz++) {
      const z = -hd + iz * actualBayD;
      const beam = box(sec.width, primaryBeamH, primaryBeamW, secondaryWoodMat);
      beam.position.set(0, fy - primaryBeamH / 2, z);
      beam.castShadow = true;
      group.add(beam);
    }

    // Beams spanning in Z direction (along depth) - at perimeter and key interior points
    for (let ix = 0; ix <= nBaysW; ix++) {
      const x = -hw + ix * actualBayW;
      // Full depth beams at perimeter
      if (ix === 0 || ix === nBaysW) {
        const beam = box(primaryBeamW, primaryBeamH, sec.depth, secondaryWoodMat);
        beam.position.set(x, fy - primaryBeamH / 2, 0);
        beam.castShadow = true;
        group.add(beam);
      }
    }

    // SECONDARY BEAMS (joists) - span between primary beams
    const joistSpacing = rr(2.5, 4); // 2.5-4 foot joist spacing
    const joistH = rr(0.6, 0.9);
    const joistW = rr(0.4, 0.6);

    for (let ibay = 0; ibay < nBaysD; ibay++) {
      const z0 = -hd + ibay * actualBayD + primaryBeamW / 2;
      const z1 = -hd + (ibay + 1) * actualBayD - primaryBeamW / 2;
      const joistLen = z1 - z0;
      const nJoists = Math.max(2, Math.round(actualBayW / joistSpacing));

      for (let j = 1; j < nJoists; j++) {
        const jx = -hw + j * (sec.width / nJoists);
        const joist = box(joistW, joistH, joistLen, tertiaryWoodMat);
        joist.position.set(jx, fy - primaryBeamH - joistH / 2, (z0 + z1) / 2);
        group.add(joist);
      }
    }

    // DIAGONAL BRACING - X-bracing in select bays for lateral stability
    if (f === 1 || (f === sec.floors && sec.floors > 3)) {
      const braceSize = rr(0.4, 0.6);
      // Pick random bay for bracing on each face
      const braceBayX = ri(0, nBaysW - 1);
      const braceBayZ = ri(0, nBaysD - 1);

      // X-brace on front face (z = -hd)
      const x0 = -hw + braceBayX * actualBayW;
      const x1 = x0 + actualBayW;
      const braceY0 = fy - floorH;
      const braceY1 = fy;

      // Two diagonal members forming X
      group.add(tube([x0 + colSize/2, braceY0, -hd], [x1 - colSize/2, braceY1, -hd], braceSize, primaryWoodMat));
      group.add(tube([x1 - colSize/2, braceY0, -hd], [x0 + colSize/2, braceY1, -hd], braceSize, primaryWoodMat));

      // X-brace on side face (x = -hw)
      const z0b = -hd + braceBayZ * actualBayD;
      const z1b = z0b + actualBayD;
      group.add(tube([-hw, braceY0, z0b + colSize/2], [-hw, braceY1, z1b - colSize/2], braceSize, primaryWoodMat));
      group.add(tube([-hw, braceY0, z1b - colSize/2], [-hw, braceY1, z0b + colSize/2], braceSize, primaryWoodMat));
    }
  }

  // FLOOR DECK - visible timber decking (CLT panels implied)
  const deckMat = getVariedMaterial(MATS.wood_light, 0.03);
  const deckThickness = 0.4;

  for (let f = 1; f <= sec.floors; f++) {
    const fy = y0 + f * floorH - primaryBeamH - deckThickness / 2;
    const deck = box(sec.width - colSize, deckThickness, sec.depth - colSize, deckMat);
    deck.position.set(0, fy, 0);
    group.add(deck);
  }

  // GLAZING INFILL - between columns with visible timber frames
  const glassMat = MATS.glass_clear();
  const mullionMat = getVariedMaterial(MATS.wood_medium, 0.03);

  for (let f = 0; f < sec.floors; f++) {
    const fy = y0 + f * floorH;
    const winH = floorH - primaryBeamH - 1.5; // Window height (leave spandrel at top)
    const winBottom = 1.2; // Sill height

    // Windows on each facade
    const facades = [
      { axis: 'z', pos: -hd, dir: 1, len: sec.width, nBays: nBaysW },
      { axis: 'z', pos: hd, dir: -1, len: sec.width, nBays: nBaysW },
      { axis: 'x', pos: -hw, dir: 1, len: sec.depth, nBays: nBaysD },
      { axis: 'x', pos: hw, dir: -1, len: sec.depth, nBays: nBaysD },
    ];

    facades.forEach(facade => {
      const bayLen = facade.len / facade.nBays;

      for (let b = 0; b < facade.nBays; b++) {
        // Skip occasional bays for solid panels
        if (rng() > 0.88) continue;

        const bayStart = -facade.len / 2 + b * bayLen + colSize / 2;
        const bayEnd = bayStart + bayLen - colSize;
        const winW = bayEnd - bayStart - 0.5;
        const winCenter = (bayStart + bayEnd) / 2;

        // Glass panel
        const glassGeo = new THREE.BoxGeometry(
          facade.axis === 'x' ? 0.15 : winW,
          winH,
          facade.axis === 'z' ? 0.15 : winW
        );
        const glass = new THREE.Mesh(glassGeo, glassMat);
        if (facade.axis === 'z') {
          glass.position.set(winCenter, fy + winBottom + winH / 2, facade.pos);
        } else {
          glass.position.set(facade.pos, fy + winBottom + winH / 2, winCenter);
        }
        group.add(glass);

        // Timber mullions - vertical dividers
        const nMullions = ri(1, 3);
        const mullionH = winH;
        const mullionW = 0.25;

        for (let m = 1; m <= nMullions; m++) {
          const mullionPos = bayStart + m * (bayEnd - bayStart) / (nMullions + 1);
          const mullionGeo = new THREE.BoxGeometry(
            facade.axis === 'x' ? 0.3 : mullionW,
            mullionH,
            facade.axis === 'z' ? 0.3 : mullionW
          );
          const mullion = new THREE.Mesh(mullionGeo, mullionMat);
          if (facade.axis === 'z') {
            mullion.position.set(mullionPos, fy + winBottom + mullionH / 2, facade.pos + 0.1 * facade.dir);
          } else {
            mullion.position.set(facade.pos + 0.1 * facade.dir, fy + winBottom + mullionH / 2, mullionPos);
          }
          group.add(mullion);
        }

        // Horizontal timber rail at mid-height
        const railH = 0.2;
        const railGeo = new THREE.BoxGeometry(
          facade.axis === 'x' ? 0.3 : winW,
          railH,
          facade.axis === 'z' ? 0.3 : winW
        );
        const rail = new THREE.Mesh(railGeo, mullionMat);
        if (facade.axis === 'z') {
          rail.position.set(winCenter, fy + winBottom + winH / 2, facade.pos + 0.1 * facade.dir);
        } else {
          rail.position.set(facade.pos + 0.1 * facade.dir, fy + winBottom + winH / 2, winCenter);
        }
        group.add(rail);
      }
    });
  }
}

/**
 * Stone structure: massive carved monolith with deep voids
 */
function addStoneStructure(group, sec, y0, floorH, stoneMat) {
  const hw = sec.width / 2, hd = sec.depth / 2;

  // Solid stone mass (the main volume is already added as facade)
  // Add carved void windows - deep and irregular
  const glassMat = MATS.glass_tower_dark();

  for (let f = 0; f < sec.floors; f++) {
    const fy = y0 + f * floorH;

    // Each face gets carved voids
    const faces = [
      { axis: 'x', sign: -1, w: sec.depth, h: floorH, off: hw },
      { axis: 'x', sign: 1, w: sec.depth, h: floorH, off: hw },
      { axis: 'z', sign: -1, w: sec.width, h: floorH, off: hd },
      { axis: 'z', sign: 1, w: sec.width, h: floorH, off: hd },
    ];

    faces.forEach(face => {
      // Irregular window placement
      const nVoids = ri(1, 3);
      for (let v = 0; v < nVoids; v++) {
        if (rng() > 0.7) continue;

        const voidW = rr(3, 8);
        const voidH = rr(floorH * 0.3, floorH * 0.6);
        const voidD = rr(1.5, 3); // Deep reveal
        const voidX = rr(-face.w / 2 + voidW, face.w / 2 - voidW);
        const voidY = fy + rr(floorH * 0.2, floorH * 0.5);

        // Dark recessed void
        const voidGeo = new THREE.BoxGeometry(
          face.axis === 'x' ? voidD : voidW,
          voidH,
          face.axis === 'z' ? voidD : voidW
        );
        const voidMesh = new THREE.Mesh(voidGeo, MATS.steel_dark());
        if (face.axis === 'x') {
          voidMesh.position.set(face.sign * (face.off - voidD / 2 + 0.5), voidY, voidX);
        } else {
          voidMesh.position.set(voidX, voidY, face.sign * (face.off - voidD / 2 + 0.5));
        }
        group.add(voidMesh);

        // Glass set deep in the void
        const glassGeo = new THREE.BoxGeometry(
          face.axis === 'x' ? 0.15 : voidW - 0.5,
          voidH - 0.5,
          face.axis === 'z' ? 0.15 : voidW - 0.5
        );
        const glassMesh = new THREE.Mesh(glassGeo, glassMat);
        if (face.axis === 'x') {
          glassMesh.position.set(face.sign * (face.off - voidD + 0.8), voidY, voidX);
        } else {
          glassMesh.position.set(voidX, voidY, face.sign * (face.off - voidD + 0.8));
        }
        group.add(glassMesh);
      }
    });
  }
}

/**
 * Masonry structure: red brick with visible courses and punched windows
 * Proper construction: actual coursing geometry, projecting sills/lintels, inset windows
 * windowType: 'rect' or 'arch' for window shape
 */
function addMasonryStructure(group, sec, y0, floorH, brickMat, windowType = 'rect') {
  const hw = sec.width / 2, hd = sec.depth / 2;

  // Randomly decide arch vs rect per building (weighted by type)
  const useArchWindows = windowType === 'arch' || (windowType !== 'rect' && rng() > 0.6);

  // Materials
  const mortarMat = new THREE.MeshStandardMaterial({ color: 0xC8C4B8, roughness: 0.95 });
  const glassMat = MATS.glass_tower_dark();
  const stoneMat = new THREE.MeshStandardMaterial({ color: varyColor(0xE0DCD4, 0.05), roughness: 0.75 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2A2A2A, roughness: 0.6 });

  // Geometry constants
  const courseH = GEOM.COURSE_HEIGHT;       // Height of one brick course
  const mortarRecess = GEOM.MORTAR_RECESS;  // How deep mortar is recessed
  const revealDepth = GEOM.REVEAL_DEPTH;    // Window reveal depth
  const sillProj = GEOM.SILL_PROJECTION;    // Sill projection
  const sillH = GEOM.SILL_HEIGHT;
  const lintelH = GEOM.LINTEL_HEIGHT;

  // ── BRICK COURSING ──
  // Create actual course bands ON TOP of the main brick volume
  // Main volume is at hw/hd, so bands sit slightly outside (+0.04) to avoid z-fighting
  const nCourses = Math.floor(sec.height / courseH);
  const bandThickness = 0.06;
  const bandOffset = 0.04; // Offset from main surface to prevent z-fighting

  for (let c = 0; c < nCourses; c++) {
    const cy = y0 + c * courseH + courseH / 2;
    // Slight random depth variation per course (always positive to stay outside)
    const depthVar = rr(0.0, GEOM.COURSE_DEPTH_VAR);

    // Front face course band
    const bandFront = new THREE.Mesh(
      new THREE.BoxGeometry(sec.width - 0.2, courseH - mortarRecess, bandThickness),
      brickMat
    );
    bandFront.position.set(0, cy, hd + bandOffset + depthVar);
    group.add(bandFront);

    // Back face
    const bandBack = bandFront.clone();
    bandBack.position.z = -hd - bandOffset - depthVar;
    group.add(bandBack);

    // Left face
    const bandLeft = new THREE.Mesh(
      new THREE.BoxGeometry(bandThickness, courseH - mortarRecess, sec.depth - 0.2),
      brickMat
    );
    bandLeft.position.set(-hw - bandOffset - depthVar, cy, 0);
    group.add(bandLeft);

    // Right face
    const bandRight = bandLeft.clone();
    bandRight.position.x = hw + bandOffset + depthVar;
    group.add(bandRight);
  }

  // ── PUNCHED WINDOWS WITH PROPER REVEALS ──
  const windowW = 3.2;
  const windowH = floorH * 0.55;
  const frameW = GEOM.MULLION_WIDTH;

  const faces = [
    { axis: 'x', sign: -1, faceW: sec.depth, off: hw },
    { axis: 'x', sign: 1, faceW: sec.depth, off: hw },
    { axis: 'z', sign: -1, faceW: sec.width, off: hd },
    { axis: 'z', sign: 1, faceW: sec.width, off: hd },
  ];

  for (let f = 0; f < sec.floors; f++) {
    const floorY = y0 + f * floorH;
    const windowY = floorY + floorH * 0.38; // Window center Y

    faces.forEach(face => {
      const nWin = Math.max(1, Math.floor(face.faceW / 7));
      const spacing = face.faceW / (nWin + 1);

      for (let w = 1; w <= nWin; w++) {
        const wPos = -face.faceW / 2 + spacing * w;

        // ── REVEAL (dark recess - must be IN FRONT of coursing bands to be visible) ──
        // Brick courses are at face.off + bandOffset (~0.04-0.06), reveal must start beyond that
        const revealFront = face.off + bandOffset + 0.08; // Front face of reveal (visible surface)
        const revealGeo = new THREE.BoxGeometry(
          face.axis === 'x' ? revealDepth : windowW + frameW * 2,
          windowH + lintelH + sillH,
          face.axis === 'z' ? revealDepth : windowW + frameW * 2
        );
        const reveal = new THREE.Mesh(revealGeo, MATS.steel_dark());
        // Reveal center is positioned so front face is at revealFront
        const revealCenter = revealFront - revealDepth / 2;
        if (face.axis === 'x') {
          reveal.position.set(face.sign * revealCenter, windowY, wPos);
        } else {
          reveal.position.set(wPos, windowY, face.sign * revealCenter);
        }
        reveal.castShadow = true;
        group.add(reveal);

        // ── WINDOW FRAME (set at back of reveal) ──
        const frameDepth = 0.12;
        const frameGeo = new THREE.BoxGeometry(
          face.axis === 'x' ? frameDepth : windowW + frameW,
          windowH + frameW,
          face.axis === 'z' ? frameDepth : windowW + frameW
        );
        const frame = new THREE.Mesh(frameGeo, frameMat);
        // Frame is at back of reveal (innermost part)
        const framePos = revealFront - revealDepth + frameDepth / 2;
        if (face.axis === 'x') {
          frame.position.set(face.sign * framePos, windowY, wPos);
        } else {
          frame.position.set(wPos, windowY, face.sign * framePos);
        }
        group.add(frame);

        // ── GLASS (behind frame at back of reveal) ──
        const glassGeo = new THREE.BoxGeometry(
          face.axis === 'x' ? 0.06 : windowW - frameW,
          windowH - frameW,
          face.axis === 'z' ? 0.06 : windowW - frameW
        );
        const glass = new THREE.Mesh(glassGeo, glassMat);
        // Glass sits at very back of reveal, behind frame
        const glassPos = revealFront - revealDepth + 0.03;
        if (face.axis === 'x') {
          glass.position.set(face.sign * glassPos, windowY, wPos);
        } else {
          glass.position.set(wPos, windowY, face.sign * glassPos);
        }
        group.add(glass);

        // ── STONE SILL (projects outward) ──
        const sillGeo = new THREE.BoxGeometry(
          face.axis === 'x' ? sillProj + 0.1 : windowW + 0.5,
          sillH,
          face.axis === 'z' ? sillProj + 0.1 : windowW + 0.5
        );
        const sill = new THREE.Mesh(sillGeo, stoneMat);
        const sillY = windowY - windowH / 2 - sillH / 2;
        if (face.axis === 'x') {
          sill.position.set(face.sign * (face.off + sillProj / 2), sillY, wPos);
        } else {
          sill.position.set(wPos, sillY, face.sign * (face.off + sillProj / 2));
        }
        sill.castShadow = true;
        group.add(sill);

        // ── STONE LINTEL or ARCH (spans above window) ──
        if (useArchWindows) {
          // Create arch keystone and voussoirs
          const archRadius = windowW / 2 + 0.2;
          const archSegments = 7;
          for (let a = 0; a < archSegments; a++) {
            const angle = Math.PI * (a / (archSegments - 1));
            const nextAngle = Math.PI * ((a + 1) / (archSegments - 1));
            const midAngle = (angle + nextAngle) / 2;

            const voussoirW = archRadius * Math.sin(nextAngle) - archRadius * Math.sin(angle);
            const voussoirH = lintelH * (a === Math.floor(archSegments / 2) ? 1.3 : 1.0); // Keystone taller
            const voussoirGeo = new THREE.BoxGeometry(
              face.axis === 'x' ? sillProj * 0.6 : Math.abs(voussoirW) + 0.1,
              voussoirH,
              face.axis === 'z' ? sillProj * 0.6 : Math.abs(voussoirW) + 0.1
            );
            const voussoir = new THREE.Mesh(voussoirGeo, stoneMat);
            const vX = archRadius * Math.cos(midAngle);
            const vY = windowY + windowH / 2 - archRadius * 0.2 + archRadius * Math.sin(midAngle);
            if (face.axis === 'x') {
              voussoir.position.set(face.sign * (face.off + sillProj * 0.2), vY, wPos + vX);
            } else {
              voussoir.position.set(wPos + vX, vY, face.sign * (face.off + sillProj * 0.2));
            }
            voussoir.castShadow = true;
            group.add(voussoir);
          }
        } else {
          // Standard rectangular lintel
          const lintelGeo = new THREE.BoxGeometry(
            face.axis === 'x' ? sillProj * 0.7 : windowW + 0.8,
            lintelH,
            face.axis === 'z' ? sillProj * 0.7 : windowW + 0.8
          );
          const lintel = new THREE.Mesh(lintelGeo, stoneMat);
          const lintelY = windowY + windowH / 2 + lintelH / 2;
          if (face.axis === 'x') {
            lintel.position.set(face.sign * (face.off + sillProj * 0.3), lintelY, wPos);
          } else {
            lintel.position.set(wPos, lintelY, face.sign * (face.off + sillProj * 0.3));
          }
          lintel.castShadow = true;
          group.add(lintel);
        }
      }
    });
  }

  // ── CORNER QUOINS (stone blocks at corners) ──
  const quoinMat = stoneMat;
  const quoinSize = 1.0;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];

  corners.forEach(([cx, cz]) => {
    for (let y = y0; y < y0 + sec.height; y += quoinSize * 2) {
      const quoinGeo = new THREE.BoxGeometry(quoinSize, quoinSize, quoinSize);
      const quoin = new THREE.Mesh(quoinGeo, quoinMat);
      quoin.position.set(cx, y + quoinSize / 2, cz);
      group.add(quoin);
    }
  });
}

/**
 * Skeletal structure: bold exposed frame with minimal infill
 */
function addSkeletalStructure(group, sec, y0, floorH, beamR, frameMat, glassMat) {
  const hw = sec.width / 2, hd = sec.depth / 2;

  // Bold corner columns
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  corners.forEach(([cx, cz]) => {
    const col = tube([cx, y0, cz], [cx, y0 + sec.height, cz], beamR, frameMat);
    if (col) {
      col.castShadow = true;
      group.add(col);
    }
  });

  // Mid columns on long spans
  if (sec.width > 30) {
    [[-hw, 0], [hw, 0]].forEach(([x, z]) => {
      group.add(tube([x, y0, z], [x, y0 + sec.height, z], beamR * 0.8, frameMat));
    });
  }
  if (sec.depth > 30) {
    [[0, -hd], [0, hd]].forEach(([x, z]) => {
      group.add(tube([x, y0, z], [x, y0 + sec.height, z], beamR * 0.8, frameMat));
    });
  }

  // Floor beams - prominent
  for (let f = 0; f <= sec.floors; f++) {
    const fy = y0 + f * floorH;

    // Perimeter beams
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const [x0, z0] = corners[i];
      const [x1, z1] = corners[j];
      group.add(tube([x0, fy, z0], [x1, fy, z1], beamR * 0.6, frameMat));
    }

    // X-bracing on alternate floors
    if (f < sec.floors && f % 2 === 0) {
      const side = ri(0, 3);
      const [c0, c1, c2, c3] = corners;
      if (side === 0) {
        group.add(tube([c0[0], fy, c0[1]], [c1[0], fy + floorH, c1[1]], beamR * 0.4, frameMat));
        group.add(tube([c1[0], fy, c1[1]], [c0[0], fy + floorH, c0[1]], beamR * 0.4, frameMat));
      }
    }
  }

  // Minimal glass infill - just the bays
  for (let f = 0; f < sec.floors; f++) {
    const fy = y0 + f * floorH;
    const glassH = floorH * 0.75;
    const glassInset = floorH * 0.1;

    // Glass panels on perimeter
    [[-hw + 0.3, sec.depth - 1], [hw - 0.3, sec.depth - 1]].forEach(([x, w]) => {
      const glass = box(0.15, glassH, w, glassMat);
      glass.position.set(x, fy + glassInset + glassH / 2, 0);
      group.add(glass);
    });
    [[-hd + 0.3, sec.width - 1], [hd - 0.3, sec.width - 1]].forEach(([z, w]) => {
      const glass = box(w, glassH, 0.15, glassMat);
      glass.position.set(0, fy + glassInset + glassH / 2, z);
      group.add(glass);
    });
  }
}

/**
 * Organic/Sculptural structure: flowing curves with irregular floor plates
 * Supports two facade modes: curtainwall (flush glass) or punched windows
 */
function addOrganicStructure(group, sec, y0, floorH, facadeMat, structMat, twist, totalH) {
  const hw = sec.width / 2, hd = sec.depth / 2;

  // Determine facade type: curtainwall (60%) or punched (40%)
  const facadeType = rng() > 0.4 ? 'curtainwall' : 'punched';
  const segments = 24; // Higher resolution for smooth curves

  // Store floor shapes for curtainwall creation
  const floorShapes = [];

  // Helper to get organic radius at given angle and floor
  function getRadius(angle, floorIndex, floorCount) {
    const t = floorIndex / Math.max(1, floorCount);
    // Organic variation: combination of sin waves creates flowing form
    const variation = 1 + Math.sin(angle * 3 + floorIndex * 0.5) * 0.12 + Math.cos(angle * 2 + floorIndex * 0.3) * 0.08;
    // Slight taper toward top
    const taper = 1 - t * 0.15;
    return Math.min(hw, hd) * variation * taper;
  }

  // Create organic floor plates
  for (let f = 0; f <= sec.floors; f++) {
    const fy = y0 + f * floorH;
    const floorTwist = (f / Math.max(1, sec.floors)) * (twist || 0);

    const points = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = getRadius(angle, f, sec.floors);
      points.push(new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r));
    }

    floorShapes.push({ fy, points, twist: floorTwist });

    // Floor slab
    const shape = new THREE.Shape(points);
    const slabThickness = 0.5;
    const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: slabThickness, bevelEnabled: false });
    slabGeo.rotateX(-Math.PI / 2);
    const slabMat = getVariedMaterial(MATS.concrete_light, 0.03);
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.y = fy;
    slab.rotation.y = floorTwist;
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);

    // Slab edge band (gives definition to floor lines)
    if (facadeType === 'curtainwall' && f > 0) {
      const edgeBandH = 0.4;
      for (let i = 0; i < segments; i++) {
        const angle0 = (i / segments) * Math.PI * 2;
        const angle1 = ((i + 1) / segments) * Math.PI * 2;
        const r0 = getRadius(angle0, f, sec.floors);
        const r1 = getRadius(angle1, f, sec.floors);

        const midAngle = (angle0 + angle1) / 2;
        const avgR = (r0 + r1) / 2;
        const panelW = avgR * (angle1 - angle0) * 1.02; // Slight overlap

        const edgeBand = box(panelW, edgeBandH, 0.3, slabMat);
        const worldAngle = midAngle + floorTwist;
        edgeBand.position.set(
          Math.cos(worldAngle) * avgR,
          fy + slabThickness / 2,
          Math.sin(worldAngle) * avgR
        );
        edgeBand.rotation.y = -worldAngle + Math.PI / 2;
        group.add(edgeBand);
      }
    }
  }

  // CURTAINWALL MODE: flush glass from floor to floor
  if (facadeType === 'curtainwall') {
    const glassMat = MATS.glass_tower_light();
    const mullionMat = getVariedMaterial(MATS.steel, 0.02);
    const mullionSize = 0.12;

    for (let f = 0; f < sec.floors; f++) {
      const bottomShape = floorShapes[f];
      const topShape = floorShapes[f + 1];
      const glassH = floorH - 0.5; // Full floor height minus slab
      const glassBottom = bottomShape.fy + 0.5;

      // Create glass panels for each segment - flush with slab edge
      for (let i = 0; i < segments; i++) {
        const angle0 = (i / segments) * Math.PI * 2;
        const angle1 = ((i + 1) / segments) * Math.PI * 2;

        // Get radii at bottom and top of this floor
        const rBottom0 = getRadius(angle0, f, sec.floors);
        const rBottom1 = getRadius(angle1, f, sec.floors);
        const rTop0 = getRadius(angle0, f + 1, sec.floors);
        const rTop1 = getRadius(angle1, f + 1, sec.floors);

        // Average values for panel positioning
        const midAngle = (angle0 + angle1) / 2;
        const avgRBottom = (rBottom0 + rBottom1) / 2;
        const avgRTop = (rTop0 + rTop1) / 2;
        const avgR = (avgRBottom + avgRTop) / 2;
        const avgTwist = (bottomShape.twist + topShape.twist) / 2;

        // Panel width based on arc length
        const panelW = avgR * (angle1 - angle0);

        // Glass panel - flush with slab edge
        const worldAngle = midAngle + avgTwist;
        const glass = box(panelW, glassH, 0.15, glassMat);
        glass.position.set(
          Math.cos(worldAngle) * avgR,
          glassBottom + glassH / 2,
          Math.sin(worldAngle) * avgR
        );
        glass.rotation.y = -worldAngle + Math.PI / 2;
        group.add(glass);

        // Vertical mullions at segment edges
        if (i % 2 === 0) { // Every other segment
          const mullionR = avgR + 0.08;
          const mullion = box(mullionSize, glassH, mullionSize, mullionMat);
          const mullionWorldAngle = angle0 + avgTwist;
          mullion.position.set(
            Math.cos(mullionWorldAngle) * mullionR,
            glassBottom + glassH / 2,
            Math.sin(mullionWorldAngle) * mullionR
          );
          group.add(mullion);
        }
      }
    }

    // Minimal vertical ribs at key points (structural expression)
    const nRibs = ri(4, 6);
    for (let i = 0; i < nRibs; i++) {
      const angle = (i / nRibs) * Math.PI * 2;
      const ribPoints = [];
      for (let f = 0; f <= sec.floors; f++) {
        const fy = y0 + f * floorH;
        const r = getRadius(angle, f, sec.floors) + 0.1;
        const ribTwist = (f / Math.max(1, sec.floors)) * (twist || 0);
        const ribAngle = angle + ribTwist;
        ribPoints.push(new THREE.Vector3(Math.cos(ribAngle) * r, fy, Math.sin(ribAngle) * r));
      }
      const curve = new THREE.CatmullRomCurve3(ribPoints);
      const tubeGeo = new THREE.TubeGeometry(curve, sec.floors * 3, 0.2, 6, false);
      const tubeMesh = new THREE.Mesh(tubeGeo, mullionMat);
      tubeMesh.castShadow = true;
      group.add(tubeMesh);
    }
  }

  // PUNCHED WINDOW MODE: solid facade with carved openings
  else {
    const wallMat = facadeMat || getVariedMaterial(MATS.concrete_light, 0.04);
    const glassMat = MATS.glass_tower_dark();

    // Create continuous wall surface for each floor
    for (let f = 0; f < sec.floors; f++) {
      const bottomShape = floorShapes[f];
      const fy = bottomShape.fy;
      const wallH = floorH;
      const floorTwist = bottomShape.twist;

      // Wall panels around perimeter
      for (let i = 0; i < segments; i++) {
        const angle0 = (i / segments) * Math.PI * 2;
        const angle1 = ((i + 1) / segments) * Math.PI * 2;
        const midAngle = (angle0 + angle1) / 2;
        const r = getRadius(midAngle, f, sec.floors);
        const panelW = r * (angle1 - angle0) * 1.02;

        const worldAngle = midAngle + floorTwist;
        const wall = box(panelW, wallH, 0.4, wallMat);
        wall.position.set(
          Math.cos(worldAngle) * r,
          fy + wallH / 2,
          Math.sin(worldAngle) * r
        );
        wall.rotation.y = -worldAngle + Math.PI / 2;
        wall.castShadow = true;
        wall.receiveShadow = true;
        group.add(wall);

        // Punched window opening (randomly skip some)
        if (rng() > 0.25) {
          const winW = panelW * rr(0.5, 0.75);
          const winH = wallH * rr(0.4, 0.6);
          const winY = fy + wallH * rr(0.25, 0.4);
          const winR = r + 0.15; // Slightly proud of wall for depth

          const win = box(winW, winH, 0.2, glassMat);
          win.position.set(
            Math.cos(worldAngle) * winR,
            winY + winH / 2,
            Math.sin(worldAngle) * winR
          );
          win.rotation.y = -worldAngle + Math.PI / 2;
          group.add(win);

          // Deep reveal around window
          const revealDepth = 0.5;
          const revealMat = getVariedMaterial(MATS.concrete, 0.03);

          // Top reveal
          const topReveal = box(winW + 0.3, 0.15, revealDepth, revealMat);
          topReveal.position.set(
            Math.cos(worldAngle) * (r + revealDepth / 2),
            winY + winH + 0.08,
            Math.sin(worldAngle) * (r + revealDepth / 2)
          );
          topReveal.rotation.y = -worldAngle + Math.PI / 2;
          group.add(topReveal);

          // Sill
          const sill = box(winW + 0.3, 0.15, revealDepth + 0.2, revealMat);
          sill.position.set(
            Math.cos(worldAngle) * (r + revealDepth / 2 + 0.1),
            winY - 0.08,
            Math.sin(worldAngle) * (r + revealDepth / 2 + 0.1)
          );
          sill.rotation.y = -worldAngle + Math.PI / 2;
          group.add(sill);
        }
      }
    }

    // Structural ribs (more prominent for punched facade)
    const nRibs = ri(6, 10);
    for (let i = 0; i < nRibs; i++) {
      const angle = (i / nRibs) * Math.PI * 2;
      const ribPoints = [];
      for (let f = 0; f <= sec.floors; f++) {
        const fy = y0 + f * floorH;
        const r = getRadius(angle, f, sec.floors);
        const ribTwist = (f / Math.max(1, sec.floors)) * (twist || 0);
        const ribAngle = angle + ribTwist;
        ribPoints.push(new THREE.Vector3(Math.cos(ribAngle) * r, fy, Math.sin(ribAngle) * r));
      }
      const curve = new THREE.CatmullRomCurve3(ribPoints);
      const tubeGeo = new THREE.TubeGeometry(curve, sec.floors * 2, rr(0.3, 0.5), 6, false);
      const tubeMesh = new THREE.Mesh(tubeGeo, structMat);
      tubeMesh.castShadow = true;
      group.add(tubeMesh);
    }
  }
}

// Material palettes by building type
const PALETTES = {
  cottage: { wall: ['timber_light', 'timber_weathered', 'brick_cream'], roof: ['slate', 'shingle_gray'], trim: ['white_trim'], struct: ['timber_dark'] },
  townhouse: { wall: ['brick_red', 'brick_brown', 'limestone'], roof: ['slate', 'metal_roof'], trim: ['white_trim', 'dark_trim'], struct: ['steel_dark'] },
  shop: { wall: ['brick_red', 'brick_cream', 'precast'], roof: ['metal_roof'], trim: ['steel'], struct: ['steel'] },
  pavilion: { wall: ['timber_light', 'concrete_light'], roof: ['metal_roof', 'timber_light'], trim: ['steel'], struct: ['steel', 'timber_dark'] },
  chapel: { wall: ['stone_warm', 'limestone', 'brick_cream'], roof: ['slate', 'copper_patina'], trim: ['white_trim'], struct: ['stone_gray'] },
  rowhouse: { wall: ['brick_red', 'brick_brown'], roof: ['slate', 'shingle_dark'], trim: ['white_trim', 'cream_trim'], struct: ['steel_dark'] },
  brownstone: { wall: ['brownstone', 'stone_warm'], roof: ['slate'], trim: ['cream_trim'], struct: ['steel_dark'] },
  restaurant: { wall: ['brick_red', 'precast'], roof: ['metal_roof'], trim: ['steel', 'bronze'], struct: ['steel'] },
  gallery: { wall: ['concrete_light', 'limestone', 'precast'], roof: ['metal_roof', 'green_roof'], trim: ['steel'], struct: ['steel', 'concrete'] },
  clinic: { wall: ['brick_cream', 'precast', 'limestone'], roof: ['metal_roof'], trim: ['white_trim'], struct: ['steel'] },
  apartment: { wall: ['brick_red', 'precast', 'concrete_light'], roof: ['metal_roof', 'green_roof'], trim: ['steel'], struct: ['steel', 'concrete'] },
  library: { wall: ['limestone', 'brick_cream', 'concrete_board'], roof: ['copper_patina', 'green_roof'], trim: ['bronze'], struct: ['concrete', 'steel'] },
  hotel: { wall: ['limestone', 'precast'], roof: ['metal_roof'], trim: ['bronze', 'steel'], struct: ['steel'] },
  market: { wall: ['brick_red', 'steel_weathered'], roof: ['metal_roof'], trim: ['steel'], struct: ['steel', 'steel_dark'] },
  workshop: { wall: ['concrete', 'brick_brown', 'corten'], roof: ['metal_roof'], trim: ['steel_dark'], struct: ['steel'] },
  museum: { wall: ['limestone', 'concrete_light', 'precast'], roof: ['metal_roof', 'copper_patina'], trim: ['bronze', 'steel'], struct: ['concrete', 'steel'] },
  stadium: { wall: ['concrete', 'steel'], roof: ['metal_roof'], trim: ['steel'], struct: ['steel', 'concrete'] },
  school: { wall: ['brick_red', 'brick_cream', 'precast'], roof: ['metal_roof'], trim: ['steel'], struct: ['steel', 'concrete'] },
  tower: { wall: ['precast', 'limestone'], roof: ['metal_roof'], trim: ['steel', 'bronze'], struct: ['steel'] },
  park: { wall: ['timber_weathered', 'stone_gray'], roof: ['green_roof', 'timber_light'], trim: ['steel_dark'], struct: ['timber_dark', 'steel'] },
};

// ── STATE ──────────────────────────────────────────────────────────
let scene, camera, renderer, controls;
let buildingGroup, groundGroup, buildingMeshGroup;
let isRotating = true;
let initialized = false;

let selectedTiles = [];
let footprintGrid = [];
let currentProgram = null;
let currentParams = {
  floors: 2,
  material: 'timber',
  raised: false
};

// Building position/rotation within tile (for user adjustment)
let buildingOffset = { x: 0, z: 0 };
let buildingRotation = 0; // radians

// Preview buildings system - allows multiple buildings before committing
let previewBuildings = []; // Array of { group: THREE.Group, offset: {x, z}, rotation: number, stats: {...} }
let selectedBuildingIndex = -1; // Which preview building is selected (-1 = none)
let selectionHelper = null; // Visual selection indicator (bounding box outline)

// Multiple buildings on the same tile (after committing)
let committedBuildings = []; // Array of { group: THREE.Group, boundingBox: { minX, maxX, minZ, maxZ }, stats: {...} }
let currentBuildingStats = null; // Stats for the current uncommitted building

// Scale figures
let scaleFigures = null; // Group containing human figures for scale

// ══════════════════════════════════════════════════════════════════
// GEOMETRY HELPERS
// ══════════════════════════════════════════════════════════════════

// Create a tube/cylinder between two 3D points
function tube(p1, p2, radius, mat) {
  const a = new THREE.Vector3(p1[0], p1[1], p1[2]);
  const b = new THREE.Vector3(p2[0], p2[1], p2[2]);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 0.01) return null;

  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  // Use 16 segments for small tubes, 24 for larger visible ones
  const segments = radius < 1 ? 16 : 24;
  const geo = new THREE.CylinderGeometry(radius, radius, len, segments);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Create a box with position at center-bottom
function box(w, h, d, mat, centerBottom = true) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, mat);
  if (centerBottom) mesh.position.y = h / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Create a prism (triangular profile extruded along depth)
function prism(w, h, d, mat) {
  const shape = new THREE.Shape();
  shape.moveTo(-w/2, 0);
  shape.lineTo(w/2, 0);
  shape.lineTo(0, h);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, d/2);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Create a cylinder
function cylinder(radius, height, mat, segments = 16) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, segments);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Create a cone
function cone(radiusBottom, radiusTop, height, mat, segments = 16) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = height / 2;
  mesh.castShadow = true;
  return mesh;
}

// ══════════════════════════════════════════════════════════════════
// BUILDING COMPONENT GENERATORS
// ══════════════════════════════════════════════════════════════════

/**
 * Create an arched window shape geometry
 * Returns a THREE.Shape for use with ExtrudeGeometry
 */
function createArchWindowShape(width, height, archRatio = 0.3) {
  const shape = new THREE.Shape();
  const hw = width / 2;
  const archHeight = width * archRatio; // Arch height proportional to width
  const rectHeight = height - archHeight;

  // Start at bottom left
  shape.moveTo(-hw, 0);
  // Up the left side
  shape.lineTo(-hw, rectHeight);
  // Arch at top (semicircular or segmented arch)
  shape.quadraticCurveTo(-hw, rectHeight + archHeight, 0, rectHeight + archHeight);
  shape.quadraticCurveTo(hw, rectHeight + archHeight, hw, rectHeight);
  // Down the right side
  shape.lineTo(hw, 0);
  // Close at bottom
  shape.lineTo(-hw, 0);

  return shape;
}

/**
 * Create arched window geometry (for masonry and sculptural buildings)
 */
function createArchWindow(width, height, depth, mat, glassMat, archRatio = 0.3) {
  const group = new THREE.Group();

  // Create arch shape
  const archShape = createArchWindowShape(width - 0.3, height - 0.3, archRatio);

  // Frame (extruded arch shape)
  const frameGeo = new THREE.ExtrudeGeometry(archShape, { depth: 0.15, bevelEnabled: false });
  const frame = new THREE.Mesh(frameGeo, mat);
  frame.rotation.x = Math.PI / 2;
  group.add(frame);

  // Glass (slightly smaller, set back)
  const glassShape = createArchWindowShape(width - 0.6, height - 0.5, archRatio);
  const glassGeo = new THREE.ExtrudeGeometry(glassShape, { depth: 0.05, bevelEnabled: false });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.rotation.x = Math.PI / 2;
  glass.position.z = -depth + 0.1;
  group.add(glass);

  return group;
}

// Generate window openings on a wall face
function addWindows(group, faceAxis, faceSign, faceOffset, spanW, spanH, baseY, mat, options = {}) {
  const {
    windowW = 3,
    windowH = 5,
    spacingH = 8,
    spacingV = 12,
    inset = 0.3,
    sillH = 0.4,
    frameW = 0.3,
  } = options;

  const glassMat = MATS.glass_dark();
  const nCols = Math.max(1, Math.floor((spanW - 4) / spacingH));
  const nRows = Math.max(1, Math.floor((spanH - 4) / spacingV));

  const startX = -(nCols - 1) * spacingH / 2;
  const startY = baseY + spacingV / 2 + 2;

  for (let col = 0; col < nCols; col++) {
    for (let row = 0; row < nRows; row++) {
      const wx = startX + col * spacingH;
      const wy = startY + row * spacingV;

      if (wy + windowH / 2 > baseY + spanH - 2) continue;

      // Window frame
      const frameGeo = new THREE.BoxGeometry(
        faceAxis === 'x' ? inset + 0.1 : windowW + frameW * 2,
        windowH + frameW * 2,
        faceAxis === 'z' ? inset + 0.1 : windowW + frameW * 2
      );
      const frame = new THREE.Mesh(frameGeo, mat);

      // Glass pane
      const glassGeo = new THREE.BoxGeometry(
        faceAxis === 'x' ? 0.1 : windowW,
        windowH,
        faceAxis === 'z' ? 0.1 : windowW
      );
      const glass = new THREE.Mesh(glassGeo, glassMat);

      // Window sill
      const sillGeo = new THREE.BoxGeometry(
        faceAxis === 'x' ? inset + 0.5 : windowW + 1,
        sillH,
        faceAxis === 'z' ? inset + 0.5 : windowW + 1
      );
      const sill = new THREE.Mesh(sillGeo, mat);

      if (faceAxis === 'x') {
        frame.position.set(faceSign * faceOffset, wy, wx);
        glass.position.set(faceSign * (faceOffset + 0.1), wy, wx);
        sill.position.set(faceSign * (faceOffset + 0.3), wy - windowH/2 - sillH/2, wx);
      } else {
        frame.position.set(wx, wy, faceSign * faceOffset);
        glass.position.set(wx, wy, faceSign * (faceOffset + 0.1));
        sill.position.set(wx, wy - windowH/2 - sillH/2, faceSign * (faceOffset + 0.3));
      }

      group.add(frame);
      group.add(glass);
      group.add(sill);
    }
  }
}

// Generate a pitched roof
function addPitchedRoof(group, w, d, h, ridgeDir, mat, options = {}) {
  const { overhang = 1.5, ridgeOffset = 0 } = options;

  const roofW = w + overhang * 2;
  const roofD = d + overhang * 2;

  if (ridgeDir === 'x') {
    // Ridge runs along X axis - roof slopes down along Z
    // Cross-section is in ZY plane (triangle with base along Z, peak up in Y)
    const shape = new THREE.Shape();
    shape.moveTo(-roofD/2, 0);  // back-bottom
    shape.lineTo(roofD/2, 0);   // front-bottom
    shape.lineTo(ridgeOffset, h); // peak
    shape.closePath();

    // Extrude along X for the ridge length
    const geo = new THREE.ExtrudeGeometry(shape, { depth: roofW, bevelEnabled: false });
    // Rotate so shape XY becomes ZY, extrusion Z becomes X
    geo.rotateY(-Math.PI / 2);
    geo.translate(roofW/2, 0, 0);

    const roof = new THREE.Mesh(geo, mat);
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);
  } else {
    // Ridge runs along Z axis - roof slopes down along X
    // Cross-section is in XY plane (triangle with base along X, peak up in Y)
    const shape = new THREE.Shape();
    shape.moveTo(-roofW/2, 0);  // left-bottom
    shape.lineTo(roofW/2, 0);   // right-bottom
    shape.lineTo(ridgeOffset, h); // peak
    shape.closePath();

    // Extrude along Z for depth - no rotation needed!
    const geo = new THREE.ExtrudeGeometry(shape, { depth: roofD, bevelEnabled: false });
    geo.translate(0, 0, -roofD/2);

    const roof = new THREE.Mesh(geo, mat);
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);
  }
}

// Generate a hip roof (slopes on all four sides)
function addHipRoof(group, w, d, h, mat, options = {}) {
  const { overhang = 1.5 } = options;
  const roofW = w + overhang * 2;
  const roofD = d + overhang * 2;

  // Create as four triangular faces meeting at a ridge
  const ridgeLen = Math.abs(roofW - roofD) * 0.5;
  const ridgeH = h;

  const geometry = new THREE.BufferGeometry();
  const hw = roofW / 2, hd = roofD / 2;
  const rhl = ridgeLen / 2;

  // If nearly square, meet at a point
  if (ridgeLen < 2) {
    const vertices = new Float32Array([
      // Front face
      -hw, 0, hd,  hw, 0, hd,  0, ridgeH, 0,
      // Back face
      hw, 0, -hd,  -hw, 0, -hd,  0, ridgeH, 0,
      // Left face
      -hw, 0, -hd,  -hw, 0, hd,  0, ridgeH, 0,
      // Right face
      hw, 0, hd,  hw, 0, -hd,  0, ridgeH, 0,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
  } else {
    // Has a ridge line
    const isWider = roofW > roofD;
    const vertices = isWider ? new Float32Array([
      // Front slope
      -hw, 0, hd,  hw, 0, hd,  rhl, ridgeH, 0,
      -hw, 0, hd,  rhl, ridgeH, 0,  -rhl, ridgeH, 0,
      // Back slope
      hw, 0, -hd,  -hw, 0, -hd,  -rhl, ridgeH, 0,
      hw, 0, -hd,  -rhl, ridgeH, 0,  rhl, ridgeH, 0,
      // Left end
      -hw, 0, -hd,  -hw, 0, hd,  -rhl, ridgeH, 0,
      // Right end
      hw, 0, hd,  hw, 0, -hd,  rhl, ridgeH, 0,
    ]) : new Float32Array([
      // Front slope
      -hw, 0, hd,  hw, 0, hd,  0, ridgeH, rhl,
      // Back slope
      hw, 0, -hd,  -hw, 0, -hd,  0, ridgeH, -rhl,
      // Left slope
      -hw, 0, -hd,  -hw, 0, hd,  0, ridgeH, -rhl,
      -hw, 0, hd,  0, ridgeH, rhl,  0, ridgeH, -rhl,
      // Right slope
      hw, 0, hd,  hw, 0, -hd,  0, ridgeH, rhl,
      hw, 0, -hd,  0, ridgeH, -rhl,  0, ridgeH, rhl,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
  }

  const roof = new THREE.Mesh(geometry, mat);
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);
}

// Generate storefront glazing
function addStorefront(group, faceAxis, faceSign, faceOffset, spanW, height, baseY, mat) {
  const glassMat = MATS.glass_clear();
  const frameMat = MATS.steel_dark();

  const mullionSpacing = rr(4, 6);
  const nMullions = Math.max(2, Math.round(spanW / mullionSpacing));
  const actualSpacing = spanW / nMullions;

  // Glass panels
  for (let i = 0; i < nMullions; i++) {
    const px = -spanW/2 + actualSpacing/2 + i * actualSpacing;
    const panelW = actualSpacing - 0.5;

    const glassGeo = new THREE.BoxGeometry(
      faceAxis === 'x' ? 0.2 : panelW,
      height - 1,
      faceAxis === 'z' ? 0.2 : panelW
    );
    const glass = new THREE.Mesh(glassGeo, glassMat);

    if (faceAxis === 'x') {
      glass.position.set(faceSign * faceOffset, baseY + height/2, px);
    } else {
      glass.position.set(px, baseY + height/2, faceSign * faceOffset);
    }
    group.add(glass);
  }

  // Vertical mullions
  for (let i = 0; i <= nMullions; i++) {
    const px = -spanW/2 + i * actualSpacing;
    const mullion = tube(
      faceAxis === 'x' ? [faceSign * faceOffset, baseY + 0.5, px] : [px, baseY + 0.5, faceSign * faceOffset],
      faceAxis === 'x' ? [faceSign * faceOffset, baseY + height - 0.5, px] : [px, baseY + height - 0.5, faceSign * faceOffset],
      0.15, frameMat
    );
    if (mullion) group.add(mullion);
  }

  // Horizontal transoms
  [baseY + 0.5, baseY + height - 0.5].forEach(y => {
    const transom = tube(
      faceAxis === 'x' ? [faceSign * faceOffset, y, -spanW/2] : [-spanW/2, y, faceSign * faceOffset],
      faceAxis === 'x' ? [faceSign * faceOffset, y, spanW/2] : [spanW/2, y, faceSign * faceOffset],
      0.12, frameMat
    );
    if (transom) group.add(transom);
  });
}

// Generate floor slab with edge expression
function addFloorSlab(group, w, d, y, mat, options = {}) {
  const { thickness = 0.8, edgeOverhang = 0.3 } = options;

  const slab = box(w + edgeOverhang * 2, thickness, d + edgeOverhang * 2, mat);
  slab.position.y = y;
  group.add(slab);

  return slab;
}

// Generate corner columns
function addCornerColumns(group, w, d, h, baseY, mat, options = {}) {
  const { radius = 0.4, inset = 0 } = options;
  const hw = w/2 - inset, hd = d/2 - inset;

  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];

  corners.forEach(([cx, cz]) => {
    const col = tube([cx, baseY, cz], [cx, baseY + h, cz], radius, mat);
    if (col) group.add(col);
  });
}

// Generate a stoop/entrance stairs
function addStoop(group, w, d, h, nSteps, mat) {
  const stepH = h / nSteps;
  const stepD = d / nSteps;

  for (let i = 0; i < nSteps; i++) {
    const stepW = w - i * 0.5;
    const step = box(stepW, stepH, stepD, mat);
    step.position.set(0, i * stepH + stepH/2, -d/2 + (i + 0.5) * stepD);
    group.add(step);
  }
}

// Generate a cornice/crown molding
function addCornice(group, w, d, y, mat, options = {}) {
  const { depth = 1.5, height = 1.2 } = options;

  // Front cornice
  const frontGeo = new THREE.BoxGeometry(w + depth * 2, height, depth);
  const front = new THREE.Mesh(frontGeo, mat);
  front.position.set(0, y + height/2, d/2 + depth/2);
  group.add(front);

  // Back cornice
  const back = new THREE.Mesh(frontGeo, mat);
  back.position.set(0, y + height/2, -d/2 - depth/2);
  group.add(back);

  // Side cornices
  const sideGeo = new THREE.BoxGeometry(depth, height, d);
  const left = new THREE.Mesh(sideGeo, mat);
  left.position.set(-w/2 - depth/2, y + height/2, 0);
  group.add(left);

  const right = new THREE.Mesh(sideGeo, mat);
  right.position.set(w/2 + depth/2, y + height/2, 0);
  group.add(right);
}

// Generate bay windows
function addBayWindow(group, faceAxis, faceSign, faceOffset, x, baseY, h, mat) {
  const bayW = 6;
  const bayD = 3;
  const glassMat = MATS.glass_dark();

  const bayGroup = new THREE.Group();

  // Bay floor and ceiling
  const floor = box(bayW, 0.4, bayD, mat);
  const ceiling = box(bayW, 0.4, bayD, mat);
  ceiling.position.y = h - 0.4;
  bayGroup.add(floor);
  bayGroup.add(ceiling);

  // Bay walls (angled sides)
  const sideW = bayD * 0.7;

  // Center glass
  const centerGlass = box(bayW - 2, h - 2, 0.2, glassMat);
  centerGlass.position.set(0, h/2, bayD/2);
  bayGroup.add(centerGlass);

  // Side glass panels (angled)
  const sideGlass = box(sideW, h - 2, 0.2, glassMat);
  sideGlass.position.set(-bayW/2 + 0.5, h/2, bayD/4);
  sideGlass.rotation.y = Math.PI / 6;
  bayGroup.add(sideGlass);

  const sideGlass2 = sideGlass.clone();
  sideGlass2.position.set(bayW/2 - 0.5, h/2, bayD/4);
  sideGlass2.rotation.y = -Math.PI / 6;
  bayGroup.add(sideGlass2);

  // Position bay window
  if (faceAxis === 'x') {
    bayGroup.rotation.y = faceSign > 0 ? -Math.PI/2 : Math.PI/2;
    bayGroup.position.set(faceSign * (faceOffset + bayD/2), baseY, x);
  } else {
    if (faceSign < 0) bayGroup.rotation.y = Math.PI;
    bayGroup.position.set(x, baseY, faceSign * (faceOffset + bayD/2));
  }

  group.add(bayGroup);
}

// ══════════════════════════════════════════════════════════════════
// PROGRAM-SPECIFIC BUILDING GENERATORS
// ══════════════════════════════════════════════════════════════════

function generateCottage(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();
  const structMat = MATS[pick(palette.struct)]();

  // Main volume
  const mainBody = box(w, h, d, wallMat);
  group.add(mainBody);

  // Add windows
  addWindows(group, 'z', 1, d/2, w, h, 0, trimMat, { windowW: 2.5, windowH: 4, spacingH: 7, spacingV: floorH });
  addWindows(group, 'z', -1, d/2, w, h, 0, trimMat, { windowW: 2.5, windowH: 4, spacingH: 7, spacingV: floorH });
  addWindows(group, 'x', 1, w/2, d, h, 0, trimMat, { windowW: 2.5, windowH: 4, spacingH: 8, spacingV: floorH });
  addWindows(group, 'x', -1, w/2, d, h, 0, trimMat, { windowW: 2.5, windowH: 4, spacingH: 8, spacingV: floorH });

  // Pitched roof
  const roofGroup = new THREE.Group();
  roofGroup.position.y = h;
  const roofH = Math.min(w, d) * 0.4;
  addPitchedRoof(roofGroup, w, d, roofH, w > d ? 'x' : 'z', roofMat);
  group.add(roofGroup);

  // Chimney
  const chimneyW = 2.5;
  const chimneyH = roofH + 4;
  const chimney = box(chimneyW, chimneyH, chimneyW, MATS.brick_red());
  chimney.position.set(w/4, h + chimneyH/2, 0);
  group.add(chimney);

  // Front door
  const doorMat = MATS.timber_dark();
  const door = box(3.5, 7.5, 0.5, doorMat);
  door.position.set(0, 3.75, d/2 + 0.25);
  group.add(door);

  // Small porch overhang
  const porchRoof = box(6, 0.4, 3, roofMat);
  porchRoof.position.set(0, 8, d/2 + 1.5);
  group.add(porchRoof);

  // Porch columns
  const pCol1 = tube([-2.5, 0, d/2 + 2.5], [-2.5, 8, d/2 + 2.5], 0.25, trimMat);
  const pCol2 = tube([2.5, 0, d/2 + 2.5], [2.5, 8, d/2 + 2.5], 0.25, trimMat);
  if (pCol1) group.add(pCol1);
  if (pCol2) group.add(pCol2);

  return { totalHeight: h + roofH + 4 };
}

function generateTownhouse(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();

  // Main volume
  const mainBody = box(w, h, d, wallMat);
  group.add(mainBody);

  // Floor lines
  for (let f = 1; f < floors; f++) {
    const floorLine = box(w + 0.4, 0.3, d + 0.4, trimMat);
    floorLine.position.y = f * floorH;
    group.add(floorLine);
  }

  // Tall narrow windows
  addWindows(group, 'z', 1, d/2, w, h, 0, trimMat, { windowW: 2, windowH: 6, spacingH: 5, spacingV: floorH, frameW: 0.4 });
  addWindows(group, 'z', -1, d/2, w, h, 0, trimMat, { windowW: 2, windowH: 6, spacingH: 5, spacingV: floorH, frameW: 0.4 });

  // Cornice at top
  addCornice(group, w, d, h, trimMat, { depth: 1.2, height: 1.5 });

  // Flat roof with parapet
  const parapet = box(w + 0.6, 2, d + 0.6, wallMat);
  parapet.position.y = h + 1;
  group.add(parapet);

  const roofTop = box(w - 1, 0.3, d - 1, roofMat);
  roofTop.position.y = h + 0.15;
  group.add(roofTop);

  // Stoop
  const stoopGroup = new THREE.Group();
  stoopGroup.position.set(0, 0, d/2);
  addStoop(stoopGroup, 5, 4, 3, 4, MATS.stone_gray());
  group.add(stoopGroup);

  // Front door (raised)
  const door = box(3.5, 8, 0.5, MATS.timber_dark());
  door.position.set(0, 3 + 4, d/2 + 0.25);
  group.add(door);

  // Door surround
  const doorFrame = box(5, 9, 0.8, trimMat);
  doorFrame.position.set(0, 3 + 4.5, d/2 + 0.1);
  group.add(doorFrame);

  return { totalHeight: h + 3.5 };
}

function generateShop(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;
  const storefrontH = floorH - 2;

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();

  // Upper floors
  if (floors > 1) {
    const upperBody = box(w, h - floorH, d, wallMat);
    upperBody.position.y = floorH + (h - floorH) / 2;
    group.add(upperBody);

    // Upper windows
    addWindows(group, 'z', 1, d/2, w, h - floorH, floorH, trimMat, { windowW: 3, windowH: 5, spacingH: 6, spacingV: floorH });
  }

  // Ground floor - storefront
  const groundBody = box(w, storefrontH, d, wallMat);
  groundBody.position.y = storefrontH / 2;
  group.add(groundBody);

  // Storefront glazing on front
  addStorefront(group, 'z', 1, d/2 + 0.1, w - 4, storefrontH - 2, 1, trimMat);

  // Signage band
  const signBand = box(w + 0.5, 2, 0.5, trimMat);
  signBand.position.set(0, storefrontH + 1, d/2 + 0.25);
  group.add(signBand);

  // Awning
  const awningMat = MATS.terracotta();
  const awning = box(w - 2, 0.15, 4, awningMat);
  awning.position.set(0, storefrontH - 1, d/2 + 2);
  awning.rotation.x = -0.15;
  group.add(awning);

  // Flat roof
  const roofTop = box(w, 0.5, d, roofMat);
  roofTop.position.y = h + 0.25;
  group.add(roofTop);

  // Rooftop mechanical
  const mech = box(w * 0.3, 3, d * 0.3, MATS.steel_dark());
  mech.position.set(w/4, h + 1.5, -d/4);
  group.add(mech);

  return { totalHeight: h + 3.5 };
}

function generatePavilion(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floorH * 1.5; // Pavilions are typically single-height

  const roofMat = MATS[pick(palette.roof)]();
  const structMat = MATS[pick(palette.struct)]();
  const trimMat = MATS[pick(palette.trim)]();

  // Column grid
  const nColsX = Math.max(2, Math.floor(w / 12));
  const nColsZ = Math.max(2, Math.floor(d / 12));
  const colSpacingX = w / (nColsX - 1);
  const colSpacingZ = d / (nColsZ - 1);

  for (let ix = 0; ix < nColsX; ix++) {
    for (let iz = 0; iz < nColsZ; iz++) {
      const cx = -w/2 + ix * colSpacingX;
      const cz = -d/2 + iz * colSpacingZ;

      // Only perimeter columns
      if (ix > 0 && ix < nColsX - 1 && iz > 0 && iz < nColsZ - 1) continue;

      const col = tube([cx, 0, cz], [cx, h, cz], 0.5, structMat);
      if (col) group.add(col);

      // Column base
      const base = box(1.5, 0.6, 1.5, structMat);
      base.position.set(cx, 0.3, cz);
      group.add(base);

      // Column capital
      const capital = box(1.2, 0.4, 1.2, structMat);
      capital.position.set(cx, h - 0.2, cz);
      group.add(capital);
    }
  }

  // Roof beams
  for (let ix = 0; ix < nColsX; ix++) {
    const cx = -w/2 + ix * colSpacingX;
    const beam = tube([cx, h, -d/2], [cx, h, d/2], 0.3, structMat);
    if (beam) group.add(beam);
  }

  for (let iz = 0; iz < nColsZ; iz++) {
    const cz = -d/2 + iz * colSpacingZ;
    const beam = tube([-w/2, h, cz], [w/2, h, cz], 0.3, structMat);
    if (beam) group.add(beam);
  }

  // Roof plane
  const roofPlane = box(w + 3, 0.4, d + 3, roofMat);
  roofPlane.position.y = h + 0.2;
  group.add(roofPlane);

  // Floor platform
  const platform = box(w + 2, 0.5, d + 2, MATS.concrete_light());
  platform.position.y = -0.25;
  group.add(platform);

  return { totalHeight: h + 0.6 };
}

function generateChapel(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;
  const naveH = h * 0.8;

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();

  // Main nave
  const nave = box(w, naveH, d, wallMat);
  group.add(nave);

  // Tall narrow windows (gothic style)
  addWindows(group, 'x', 1, w/2, d * 0.7, naveH, 0, trimMat, { windowW: 2, windowH: 8, spacingH: 8, spacingV: naveH });
  addWindows(group, 'x', -1, w/2, d * 0.7, naveH, 0, trimMat, { windowW: 2, windowH: 8, spacingH: 8, spacingV: naveH });

  // Large front window (rose window)
  const roseMat = MATS.glass_tinted();
  const roseGeo = new THREE.CircleGeometry(4, 24);
  const rose = new THREE.Mesh(roseGeo, roseMat);
  rose.position.set(0, naveH - 6, d/2 + 0.1);
  group.add(rose);

  // Steep pitched roof
  const roofGroup = new THREE.Group();
  roofGroup.position.y = naveH;
  const roofH = w * 0.5;
  addPitchedRoof(roofGroup, w, d, roofH, 'z', roofMat, { overhang: 1 });
  group.add(roofGroup);

  // Bell tower
  const towerW = w * 0.25;
  const towerH = naveH * 1.5;
  const tower = box(towerW, towerH, towerW, wallMat);
  tower.position.set(0, towerH/2, d/2 + towerW/2);
  group.add(tower);

  // Tower spire
  const spire = cone(towerW/2, 0.5, towerH * 0.4, roofMat, 4);
  spire.position.set(0, towerH, d/2 + towerW/2);
  spire.rotation.y = Math.PI / 4;
  group.add(spire);

  // Cross on spire
  const crossV = tube([0, towerH + towerH * 0.4, d/2 + towerW/2], [0, towerH + towerH * 0.4 + 3, d/2 + towerW/2], 0.15, MATS.bronze());
  const crossH = tube([-1, towerH + towerH * 0.4 + 2, d/2 + towerW/2], [1, towerH + towerH * 0.4 + 2, d/2 + towerW/2], 0.15, MATS.bronze());
  if (crossV) group.add(crossV);
  if (crossH) group.add(crossH);

  // Front door
  const doorH = 10;
  const door = box(4, doorH, 0.5, MATS.timber_dark());
  door.position.set(0, doorH/2, d/2 + 0.25);
  group.add(door);

  // Door arch
  const archGeo = new THREE.TorusGeometry(2.5, 0.4, 8, 16, Math.PI);
  const arch = new THREE.Mesh(archGeo, wallMat);
  arch.position.set(0, doorH, d/2 + 0.3);
  arch.rotation.x = Math.PI / 2;
  group.add(arch);

  return { totalHeight: towerH + towerH * 0.4 + 3 };
}

function generateRowhouse(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;
  const unitW = w / 2; // Two units

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();

  // Main volumes (two units)
  for (let u = 0; u < 2; u++) {
    const unitX = -w/4 + u * unitW;

    const unit = box(unitW - 0.5, h, d, wallMat);
    unit.position.x = unitX;
    group.add(unit);

    // Windows per unit
    addWindows(group, 'z', 1, d/2, unitW - 2, h, 0, trimMat, { windowW: 2.5, windowH: 5, spacingH: 6, spacingV: floorH });

    // Stoop
    const stoopGroup = new THREE.Group();
    stoopGroup.position.set(unitX, 0, d/2);
    addStoop(stoopGroup, 4, 3.5, 2.5, 4, MATS.stone_gray());
    group.add(stoopGroup);

    // Front door
    const door = box(3, 7.5, 0.5, MATS.timber_dark());
    door.position.set(unitX, 2.5 + 3.75, d/2 + 0.25);
    group.add(door);
  }

  // Shared cornice
  addCornice(group, w, d, h, trimMat, { depth: 1.5, height: 1.8 });

  // Mansard roof
  const mansardH = floorH * 0.6;
  const mansardGeo = new THREE.BoxGeometry(w, mansardH, d);
  const mansard = new THREE.Mesh(mansardGeo, roofMat);
  mansard.position.y = h + mansardH/2;
  group.add(mansard);

  // Dormers
  for (let u = 0; u < 2; u++) {
    const dormerX = -w/4 + u * unitW;
    const dormer = box(3, 4, 2.5, wallMat);
    dormer.position.set(dormerX, h + 2, d/2);
    group.add(dormer);

    const dormerRoof = prism(4, 2, 3, roofMat);
    dormerRoof.position.set(dormerX, h + 4, d/2 - 1.5);
    group.add(dormerRoof);
  }

  return { totalHeight: h + mansardH + 4 };
}

function generateBrownstone(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;

  const wallMat = MATS.brownstone();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();

  // Main volume
  const mainBody = box(w, h, d, wallMat);
  group.add(mainBody);

  // Rusticated base (ground floor)
  const baseH = floorH;
  const baseMat = MATS.stone_warm();
  for (let i = 0; i < 4; i++) {
    const course = box(w + 0.3, baseH/4 - 0.1, d + 0.3, baseMat);
    course.position.y = i * baseH/4 + baseH/8;
    group.add(course);
  }

  // Heavy cornice
  addCornice(group, w, d, h, trimMat, { depth: 2, height: 2.5 });

  // String courses between floors
  for (let f = 1; f < floors; f++) {
    const stringCourse = box(w + 0.5, 0.5, d + 0.5, trimMat);
    stringCourse.position.y = f * floorH;
    group.add(stringCourse);
  }

  // Bay windows on front
  addBayWindow(group, 'z', 1, d/2, -w/4, floorH, floorH * 2, trimMat);
  addBayWindow(group, 'z', 1, d/2, w/4, floorH, floorH * 2, trimMat);

  // Regular windows on upper floors
  addWindows(group, 'z', 1, d/2, w, h - floorH * 3, floorH * 3, trimMat, { windowW: 2.5, windowH: 6, spacingH: 6, spacingV: floorH });

  // High stoop
  const stoopGroup = new THREE.Group();
  stoopGroup.position.set(0, 0, d/2);
  addStoop(stoopGroup, 6, 6, 5, 8, MATS.brownstone());
  group.add(stoopGroup);

  // Grand entrance door
  const door = box(4, 9, 0.6, MATS.timber_dark());
  door.position.set(0, 5 + 4.5, d/2 + 0.3);
  group.add(door);

  // Ornate door surround
  const doorSurround = box(6, 11, 1, trimMat);
  doorSurround.position.set(0, 5 + 5.5, d/2 + 0.2);
  group.add(doorSurround);

  // Roof with parapet
  const parapet = box(w + 0.8, 3, d + 0.8, wallMat);
  parapet.position.y = h + 1.5;
  group.add(parapet);

  return { totalHeight: h + 5.5 };
}

function generateApartment(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();
  const structMat = MATS[pick(palette.struct)]();

  // Main volume
  const mainBody = box(w, h, d, wallMat);
  group.add(mainBody);

  // Floor slabs expressed
  for (let f = 0; f <= floors; f++) {
    addFloorSlab(group, w, d, f * floorH, MATS.concrete_light(), { thickness: 0.6, edgeOverhang: 0.4 });
  }

  // Window grid
  addWindows(group, 'z', 1, d/2, w, h, 0, trimMat, { windowW: 4, windowH: 6, spacingH: 8, spacingV: floorH });
  addWindows(group, 'z', -1, d/2, w, h, 0, trimMat, { windowW: 4, windowH: 6, spacingH: 8, spacingV: floorH });
  addWindows(group, 'x', 1, w/2, d, h, 0, trimMat, { windowW: 4, windowH: 6, spacingH: 8, spacingV: floorH });
  addWindows(group, 'x', -1, w/2, d, h, 0, trimMat, { windowW: 4, windowH: 6, spacingH: 8, spacingV: floorH });

  // Balconies on one side
  const balconySpacing = 12;
  const nBalconies = Math.floor(w / balconySpacing);

  for (let f = 1; f < floors; f++) {
    for (let b = 0; b < nBalconies; b++) {
      const bx = -w/2 + balconySpacing/2 + b * balconySpacing;

      // Balcony slab
      const slab = box(6, 0.4, 4, MATS.concrete());
      slab.position.set(bx, f * floorH, d/2 + 2);
      group.add(slab);

      // Railing
      const railingH = 3.5;
      const rail = tube([bx - 2.5, f * floorH + 0.4, d/2 + 3.5], [bx + 2.5, f * floorH + 0.4, d/2 + 3.5], 0.08, structMat);
      const railTop = tube([bx - 2.5, f * floorH + railingH, d/2 + 3.5], [bx + 2.5, f * floorH + railingH, d/2 + 3.5], 0.08, structMat);
      if (rail) group.add(rail);
      if (railTop) group.add(railTop);

      // Railing posts
      for (let p = -2; p <= 2; p++) {
        const post = tube([bx + p, f * floorH + 0.4, d/2 + 3.5], [bx + p, f * floorH + railingH, d/2 + 3.5], 0.05, structMat);
        if (post) group.add(post);
      }
    }
  }

  // Entrance canopy
  const canopy = box(12, 0.4, 6, structMat);
  canopy.position.set(0, 10, d/2 + 3);
  group.add(canopy);

  // Canopy columns
  const cCol1 = tube([-5, 0, d/2 + 5], [-5, 10, d/2 + 5], 0.4, structMat);
  const cCol2 = tube([5, 0, d/2 + 5], [5, 10, d/2 + 5], 0.4, structMat);
  if (cCol1) group.add(cCol1);
  if (cCol2) group.add(cCol2);

  // Roof with mechanical
  const roofTop = box(w - 2, 0.4, d - 2, roofMat);
  roofTop.position.y = h + 0.2;
  group.add(roofTop);

  const mech = box(w * 0.4, 5, d * 0.3, MATS.steel_dark());
  mech.position.set(0, h + 2.5, 0);
  group.add(mech);

  return { totalHeight: h + 7.5 };
}

function generateLibrary(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();
  const structMat = MATS[pick(palette.struct)]();

  // Main reading room (taller central volume)
  const mainW = w * 0.6;
  const mainH = h * 1.2;
  const mainBody = box(mainW, mainH, d * 0.7, wallMat);
  mainBody.position.z = -d * 0.15;
  group.add(mainBody);

  // Side wings
  const wingW = (w - mainW) / 2;
  const wingH = h * 0.8;

  const leftWing = box(wingW, wingH, d, wallMat);
  leftWing.position.set(-mainW/2 - wingW/2, wingH/2, 0);
  group.add(leftWing);

  const rightWing = box(wingW, wingH, d, wallMat);
  rightWing.position.set(mainW/2 + wingW/2, wingH/2, 0);
  group.add(rightWing);

  // Large windows in main reading room
  addWindows(group, 'z', 1, d * 0.35, mainW - 4, mainH, 0, trimMat, { windowW: 5, windowH: 10, spacingH: 10, spacingV: mainH });

  // Clerestory
  const clerestory = box(mainW - 2, 4, d * 0.5, MATS.glass_clear());
  clerestory.position.set(0, mainH - 2, -d * 0.15);
  group.add(clerestory);

  // Grand entrance portico
  const porticoW = 20;
  const porticoD = 8;
  const porticoH = wingH - 2;

  // Portico roof
  const porticoRoofGroup = new THREE.Group();
  porticoRoofGroup.position.set(0, porticoH, d/2 + porticoD/2);
  addPitchedRoof(porticoRoofGroup, porticoW, porticoD, 4, 'z', roofMat, { overhang: 1.5 });
  group.add(porticoRoofGroup);

  // Portico columns
  const nCols = 4;
  for (let c = 0; c < nCols; c++) {
    const cx = -porticoW/2 + porticoW/(nCols - 1) * c;
    const col = cylinder(1, porticoH, MATS.limestone(), 16);
    col.position.set(cx, 0, d/2 + porticoD - 2);
    group.add(col);

    // Column capital
    const capital = box(2.5, 1, 2.5, MATS.limestone());
    capital.position.set(cx, porticoH, d/2 + porticoD - 2);
    group.add(capital);
  }

  // Steps
  const stepsGroup = new THREE.Group();
  stepsGroup.position.set(0, 0, d/2 + porticoD);
  addStoop(stepsGroup, porticoW - 2, 6, 3, 5, MATS.limestone());
  group.add(stepsGroup);

  // Main roof
  const mainRoof = box(mainW + 2, 0.6, d * 0.75, roofMat);
  mainRoof.position.set(0, mainH + 0.3, -d * 0.15);
  group.add(mainRoof);

  return { totalHeight: mainH + 4 };
}

function generateHotel(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();
  const structMat = MATS[pick(palette.struct)]();

  // Main tower
  const mainBody = box(w, h, d, wallMat);
  group.add(mainBody);

  // Expressed floor slabs
  for (let f = 0; f <= floors; f++) {
    addFloorSlab(group, w, d, f * floorH, MATS.precast(), { thickness: 0.5, edgeOverhang: 0.3 });
  }

  // Regular window grid (hotel rooms)
  addWindows(group, 'z', 1, d/2, w, h, 0, trimMat, { windowW: 4, windowH: 5.5, spacingH: 7, spacingV: floorH });
  addWindows(group, 'z', -1, d/2, w, h, 0, trimMat, { windowW: 4, windowH: 5.5, spacingH: 7, spacingV: floorH });
  addWindows(group, 'x', 1, w/2, d, h, 0, trimMat, { windowW: 4, windowH: 5.5, spacingH: 7, spacingV: floorH });
  addWindows(group, 'x', -1, w/2, d, h, 0, trimMat, { windowW: 4, windowH: 5.5, spacingH: 7, spacingV: floorH });

  // Grand entrance - double height lobby
  const lobbyH = floorH * 2;
  const lobbyW = w * 0.5;

  // Entrance canopy
  const canopy = box(lobbyW + 8, 0.5, 10, MATS.steel());
  canopy.position.set(0, lobbyH, d/2 + 5);
  group.add(canopy);

  // Canopy supports
  const supp1 = tube([-lobbyW/2 - 3, 0, d/2 + 9], [-lobbyW/2 - 3, lobbyH, d/2 + 9], 0.5, structMat);
  const supp2 = tube([lobbyW/2 + 3, 0, d/2 + 9], [lobbyW/2 + 3, lobbyH, d/2 + 9], 0.5, structMat);
  if (supp1) group.add(supp1);
  if (supp2) group.add(supp2);

  // Lobby glazing
  addStorefront(group, 'z', 1, d/2 + 0.1, lobbyW, lobbyH - 2, 1, trimMat);

  // Rooftop amenity
  const roofAmenity = box(w * 0.6, 4, d * 0.4, MATS.glass_tinted());
  roofAmenity.position.set(0, h + 2, -d * 0.2);
  group.add(roofAmenity);

  // Mechanical penthouse
  const mech = box(w * 0.3, 5, d * 0.3, MATS.steel_dark());
  mech.position.set(w/4, h + 2.5, d/4);
  group.add(mech);

  return { totalHeight: h + 7 };
}

function generateMarket(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floorH * 1.8; // Markets have tall single volumes

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const structMat = MATS[pick(palette.struct)]();

  // Main hall with saw-tooth roof
  const hallH = h * 0.7;
  const hall = box(w, hallH, d, wallMat);
  group.add(hall);

  // Saw-tooth roof monitors
  const nMonitors = Math.max(2, Math.floor(d / 20));
  const monitorD = d / nMonitors;

  for (let m = 0; m < nMonitors; m++) {
    const mz = -d/2 + monitorD/2 + m * monitorD;

    // Sloped roof section
    const roofSlope = box(w, 0.4, monitorD - 1, roofMat);
    roofSlope.rotation.x = -0.2;
    roofSlope.position.set(0, hallH + 3, mz);
    group.add(roofSlope);

    // North-facing glazing
    const monitor = box(w - 4, 6, 0.3, MATS.glass_clear());
    monitor.position.set(0, hallH + 3, mz - monitorD/2 + 1);
    group.add(monitor);
  }

  // Exposed steel trusses
  const nTrusses = Math.max(2, Math.floor(w / 15));
  const trussSpacing = w / (nTrusses - 1);

  for (let t = 0; t < nTrusses; t++) {
    const tx = -w/2 + t * trussSpacing;

    // Bottom chord
    const bottom = tube([tx, hallH - 2, -d/2 + 2], [tx, hallH - 2, d/2 - 2], 0.25, structMat);
    if (bottom) group.add(bottom);

    // Top chord
    const top = tube([tx, hallH + 4, -d/2 + 2], [tx, hallH + 4, d/2 - 2], 0.25, structMat);
    if (top) group.add(top);

    // Verticals
    for (let v = 0; v < 5; v++) {
      const vz = -d/2 + d/5 * (v + 0.5);
      const vert = tube([tx, hallH - 2, vz], [tx, hallH + 4, vz], 0.15, structMat);
      if (vert) group.add(vert);
    }
  }

  // Large openings
  addStorefront(group, 'z', 1, d/2 + 0.1, w - 8, hallH - 4, 2, MATS.steel_dark());
  addStorefront(group, 'z', -1, d/2 + 0.1, w - 8, hallH - 4, 2, MATS.steel_dark());

  // Loading doors on sides
  for (let side of [-1, 1]) {
    const loadingDoor = box(12, 14, 0.5, MATS.steel_dark());
    loadingDoor.position.set(side * (w/2 + 0.25), 7, 0);
    group.add(loadingDoor);
  }

  return { totalHeight: hallH + 8 };
}

function generateMuseum(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();
  const structMat = MATS[pick(palette.struct)]();

  // Main gallery wing
  const mainW = w * 0.7;
  const mainH = h;
  const mainBody = box(mainW, mainH, d, wallMat);
  mainBody.position.x = -w * 0.15;
  group.add(mainBody);

  // Entrance pavilion (glazed atrium)
  const atriumW = w * 0.35;
  const atriumH = mainH * 1.3;

  // Atrium structure
  const atriumStruct = MATS.steel();
  addCornerColumns(group, atriumW, d * 0.5, atriumH, 0, atriumStruct, { radius: 0.4, inset: 2 });

  // Atrium glazing
  const atriumGlass = box(atriumW - 2, atriumH, d * 0.5 - 2, MATS.glass_clear());
  atriumGlass.position.set(w * 0.35 - atriumW/2, atriumH/2, d/4);
  group.add(atriumGlass);

  // Atrium roof
  const atriumRoof = box(atriumW, 0.5, d * 0.5, MATS.steel());
  atriumRoof.position.set(w * 0.35 - atriumW/2, atriumH + 0.25, d/4);
  group.add(atriumRoof);

  // Gallery skylights
  const nSkylights = 3;
  for (let s = 0; s < nSkylights; s++) {
    const sx = -w * 0.15 - mainW/2 + mainW/(nSkylights + 1) * (s + 1);
    const skylight = box(6, 3, 6, MATS.glass_clear());
    skylight.position.set(sx, mainH + 1.5, 0);
    group.add(skylight);
  }

  // Minimal fenestration on galleries
  addWindows(group, 'x', -1, w/2, d * 0.6, mainH, 0, trimMat, { windowW: 2, windowH: 3, spacingH: 20, spacingV: mainH });

  // Grand steps
  const stepsGroup = new THREE.Group();
  stepsGroup.position.set(w * 0.35 - atriumW/2, 0, d * 0.5);
  addStoop(stepsGroup, atriumW - 4, 8, 4, 6, MATS.limestone());
  group.add(stepsGroup);

  // Cantilevered canopy
  const canopy = box(atriumW + 8, 0.6, 8, structMat);
  canopy.position.set(w * 0.35 - atriumW/2, 15, d * 0.5 + 4);
  group.add(canopy);

  // Main roof
  const roof = box(mainW + 2, 0.6, d + 2, roofMat);
  roof.position.set(-w * 0.15, mainH + 0.3, 0);
  group.add(roof);

  return { totalHeight: atriumH + 3 };
}

function generateTower(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;

  const wallMat = MATS[pick(palette.wall)]();
  const structMat = MATS[pick(palette.struct)]();
  const glassMat = MATS.glass_dark();

  // Determine tower typology
  const typologies = ['curtainwall', 'diagrid', 'setback'];
  const typ = pick(typologies);

  // Taper for height
  const taperFactor = 0.15;

  if (typ === 'curtainwall') {
    // Glass curtain wall with expressed mullions
    const towerBody = box(w, h, d, glassMat);
    group.add(towerBody);

    // Floor slabs
    for (let f = 0; f <= floors; f++) {
      addFloorSlab(group, w, d, f * floorH, MATS.precast(), { thickness: 0.5, edgeOverhang: 0.3 });
    }

    // Vertical mullions
    const mullionSpacing = 5;
    const faces = [
      { axis: 'x', sign: 1, span: d, off: w/2 },
      { axis: 'x', sign: -1, span: d, off: w/2 },
      { axis: 'z', sign: 1, span: w, off: d/2 },
      { axis: 'z', sign: -1, span: w, off: d/2 },
    ];

    faces.forEach(face => {
      const nMullions = Math.floor(face.span / mullionSpacing);
      for (let m = 0; m <= nMullions; m++) {
        const pos = -face.span/2 + m * mullionSpacing;
        const p1 = face.axis === 'x' ? [face.sign * face.off, 0, pos] : [pos, 0, face.sign * face.off];
        const p2 = face.axis === 'x' ? [face.sign * face.off, h, pos] : [pos, h, face.sign * face.off];
        const mullion = tube(p1, p2, 0.2, structMat);
        if (mullion) group.add(mullion);
      }
    });

  } else if (typ === 'diagrid') {
    // Diagrid structural expression
    const towerBody = box(w - 1, h, d - 1, glassMat);
    group.add(towerBody);

    // Diagrid on each face
    const faces = [
      { axis: 'x', sign: 1, span: d, off: w/2 },
      { axis: 'x', sign: -1, span: d, off: w/2 },
      { axis: 'z', sign: 1, span: w, off: d/2 },
      { axis: 'z', sign: -1, span: w, off: d/2 },
    ];

    faces.forEach(face => {
      const diagSpacing = 15;
      const nDiags = Math.max(2, Math.floor(face.span / diagSpacing));
      const actualSpacing = face.span / nDiags;

      for (let f = 0; f < floors; f += 3) {
        const y0 = f * floorH;
        const y1 = Math.min((f + 3) * floorH, h);

        for (let di = 0; di < nDiags; di++) {
          const p0 = -face.span/2 + di * actualSpacing;
          const p1 = p0 + actualSpacing;
          const mid = (p0 + p1) / 2;

          // X pattern
          const diag1Start = face.axis === 'x' ? [face.sign * face.off, y0, p0] : [p0, y0, face.sign * face.off];
          const diag1End = face.axis === 'x' ? [face.sign * face.off, y1, mid] : [mid, y1, face.sign * face.off];
          const diag2Start = face.axis === 'x' ? [face.sign * face.off, y0, p1] : [p1, y0, face.sign * face.off];
          const diag2End = face.axis === 'x' ? [face.sign * face.off, y1, mid] : [mid, y1, face.sign * face.off];

          const d1 = tube(diag1Start, diag1End, 0.35, structMat);
          const d2 = tube(diag2Start, diag2End, 0.35, structMat);
          if (d1) group.add(d1);
          if (d2) group.add(d2);
        }
      }
    });

  } else {
    // Setback tower
    const sections = [
      { h: h * 0.4, wScale: 1, dScale: 1 },
      { h: h * 0.3, wScale: 0.85, dScale: 0.85 },
      { h: h * 0.3, wScale: 0.7, dScale: 0.7 },
    ];

    let currentY = 0;
    sections.forEach((sec, i) => {
      const secW = w * sec.wScale;
      const secD = d * sec.dScale;
      const secH = sec.h;

      const secBody = box(secW, secH, secD, wallMat);
      secBody.position.y = currentY + secH/2;
      group.add(secBody);

      // Windows per section
      const secFloors = Math.floor(secH / floorH);
      addWindows(group, 'z', 1, secD/2, secW, secH, currentY, MATS.dark_trim(), { windowW: 4, windowH: 5, spacingH: 7, spacingV: floorH });
      addWindows(group, 'z', -1, secD/2, secW, secH, currentY, MATS.dark_trim(), { windowW: 4, windowH: 5, spacingH: 7, spacingV: floorH });

      currentY += secH;
    });
  }

  // Crown/spire
  const spireH = 15;
  const spire = tube([0, h, 0], [0, h + spireH, 0], 0.8, structMat);
  if (spire) group.add(spire);

  // Mechanical floors
  const mechH = 8;
  const mech = box(w * 0.4, mechH, d * 0.4, MATS.steel_dark());
  mech.position.set(0, h + mechH/2, 0);
  group.add(mech);

  return { totalHeight: h + spireH };
}

function generateStadium(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;

  const structMat = MATS[pick(palette.struct)]();
  const roofMat = MATS[pick(palette.roof)]();
  const seatMat = MATS.concrete();

  // Bowl shape for seating
  const bowlH = 25;
  const innerW = w * 0.6;
  const innerD = d * 0.6;

  // Seating tiers
  const nTiers = 3;
  for (let t = 0; t < nTiers; t++) {
    const tierH = bowlH / nTiers;
    const tierInnerW = innerW + t * (w - innerW) / nTiers / 2;
    const tierInnerD = innerD + t * (d - innerD) / nTiers / 2;
    const tierOuterW = innerW + (t + 1) * (w - innerW) / nTiers / 2;
    const tierOuterD = innerD + (t + 1) * (d - innerD) / nTiers / 2;

    // Simplified tier as angled box
    const tier = box(tierOuterW, tierH, tierOuterD, seatMat);
    tier.position.y = t * tierH + tierH/2;
    group.add(tier);
  }

  // Playing field
  const field = box(innerW - 4, 0.3, innerD - 4, MATS.green_roof());
  field.position.y = 0.15;
  group.add(field);

  // Structural columns supporting roof
  const nCols = 8;
  const colRadius = w / 2 + 5;
  for (let c = 0; c < nCols; c++) {
    const angle = (c / nCols) * Math.PI * 2;
    const cx = Math.cos(angle) * colRadius * 0.9;
    const cz = Math.sin(angle) * colRadius * 0.7;

    const col = tube([cx, 0, cz], [cx, bowlH + 15, cz], 1.5, structMat);
    if (col) group.add(col);
  }

  // Canopy roof (partial)
  const canopyInner = w * 0.3;
  const canopyOuter = w / 2 + 8;

  const canopyShape = new THREE.RingGeometry(canopyInner, canopyOuter, 32, 1, 0, Math.PI * 1.5);
  const canopy = new THREE.Mesh(canopyShape, roofMat);
  canopy.rotation.x = -Math.PI / 2;
  canopy.position.y = bowlH + 15;
  canopy.castShadow = true;
  group.add(canopy);

  // Entrance ramps
  for (let r = 0; r < 4; r++) {
    const angle = (r / 4) * Math.PI * 2 + Math.PI / 4;
    const rx = Math.cos(angle) * (w / 2 + 8);
    const rz = Math.sin(angle) * (d / 2 + 8);

    const ramp = box(8, 1, 20, MATS.concrete());
    ramp.position.set(rx, 5, rz);
    ramp.rotation.y = angle + Math.PI / 2;
    ramp.rotation.x = 0.15;
    group.add(ramp);
  }

  return { totalHeight: bowlH + 20 };
}

function generateSchool(recipe, group, palette) {
  const { w, d, floors, floorH } = recipe;
  const h = floors * floorH;

  const wallMat = MATS[pick(palette.wall)]();
  const roofMat = MATS[pick(palette.roof)]();
  const trimMat = MATS[pick(palette.trim)]();

  // L-shaped or U-shaped plan
  const wingW = w * 0.3;
  const wingD = d;

  // Main wing
  const mainBody = box(w, h, d * 0.4, wallMat);
  mainBody.position.z = -d * 0.3;
  group.add(mainBody);

  // Side wings
  const leftWing = box(wingW, h, wingD * 0.6, wallMat);
  leftWing.position.set(-w/2 + wingW/2, h/2, 0);
  group.add(leftWing);

  const rightWing = box(wingW, h, wingD * 0.6, wallMat);
  rightWing.position.set(w/2 - wingW/2, h/2, 0);
  group.add(rightWing);

  // Classroom windows (regular grid)
  // Main wing
  addWindows(group, 'z', -1, d * 0.5, w - 4, h, 0, trimMat, { windowW: 5, windowH: 5, spacingH: 8, spacingV: floorH });

  // Wings
  addWindows(group, 'x', -1, w/2, d * 0.5, h, 0, trimMat, { windowW: 5, windowH: 5, spacingH: 8, spacingV: floorH });
  addWindows(group, 'x', 1, w/2, d * 0.5, h, 0, trimMat, { windowW: 5, windowH: 5, spacingH: 8, spacingV: floorH });

  // Courtyard (implied by the layout)
  const courtyard = box(w - wingW * 2 - 4, 0.2, d * 0.5, MATS.concrete_light());
  courtyard.position.set(0, 0.1, d * 0.15);
  group.add(courtyard);

  // Main entrance
  const entranceW = 15;
  const entranceH = floorH * 1.5;

  const entranceCanopy = box(entranceW + 4, 0.5, 8, MATS.steel());
  entranceCanopy.position.set(0, entranceH, -d * 0.5 - 4);
  group.add(entranceCanopy);

  // Canopy columns
  const eCol1 = tube([-entranceW/2 - 1, 0, -d * 0.5 - 7], [-entranceW/2 - 1, entranceH, -d * 0.5 - 7], 0.4, MATS.steel());
  const eCol2 = tube([entranceW/2 + 1, 0, -d * 0.5 - 7], [entranceW/2 + 1, entranceH, -d * 0.5 - 7], 0.4, MATS.steel());
  if (eCol1) group.add(eCol1);
  if (eCol2) group.add(eCol2);

  // Flat roofs
  const roofMain = box(w + 1, 0.4, d * 0.4 + 1, roofMat);
  roofMain.position.set(0, h + 0.2, -d * 0.3);
  group.add(roofMain);

  const roofLeft = box(wingW + 1, 0.4, wingD * 0.6 + 1, roofMat);
  roofLeft.position.set(-w/2 + wingW/2, h + 0.2, 0);
  group.add(roofLeft);

  const roofRight = box(wingW + 1, 0.4, wingD * 0.6 + 1, roofMat);
  roofRight.position.set(w/2 - wingW/2, h + 0.2, 0);
  group.add(roofRight);

  return { totalHeight: h + 1 };
}

function generatePark(recipe, group, palette) {
  const { w, d } = recipe;

  const pathMat = MATS.concrete_light();
  const structMat = MATS[pick(palette.struct)]();
  const roofMat = MATS[pick(palette.roof)]();

  // Ground plane
  const ground = box(w, 0.2, d, MATS.green_roof());
  ground.position.y = 0.1;
  group.add(ground);

  // Winding path
  const pathW = 6;
  const mainPath = box(pathW, 0.15, d - 4, pathMat);
  mainPath.position.set(-w/4, 0.25, 0);
  group.add(mainPath);

  const crossPath = box(w - 4, 0.15, pathW, pathMat);
  crossPath.position.set(0, 0.25, -d/4);
  group.add(crossPath);

  // Small pavilion
  const pavW = 12;
  const pavH = 10;

  const pavGroup = new THREE.Group();
  pavGroup.position.set(w/4, 0, d/4);

  // Pavilion columns
  const pavCols = [[-pavW/2 + 1, -pavW/2 + 1], [pavW/2 - 1, -pavW/2 + 1], [pavW/2 - 1, pavW/2 - 1], [-pavW/2 + 1, pavW/2 - 1]];
  pavCols.forEach(([px, pz]) => {
    const col = tube([px, 0, pz], [px, pavH, pz], 0.35, structMat);
    if (col) pavGroup.add(col);
  });

  // Pavilion roof
  const pavRoof = box(pavW + 2, 0.4, pavW + 2, roofMat);
  pavRoof.position.y = pavH + 0.2;
  pavGroup.add(pavRoof);

  // Pavilion platform
  const pavPlatform = box(pavW + 1, 0.4, pavW + 1, MATS.concrete());
  pavPlatform.position.y = 0.2;
  pavGroup.add(pavPlatform);

  group.add(pavGroup);

  // Benches along path
  for (let b = 0; b < 3; b++) {
    const bz = -d/3 + b * d/3;
    const bench = box(6, 1.5, 2, MATS.timber_weathered());
    bench.position.set(-w/4 + 5, 0.75, bz);
    group.add(bench);
  }

  // Simple tree representations (cones)
  const treeMat = MATS.green_roof();
  const trunkMat = MATS.timber_dark();

  const treePositions = [
    [-w/3, d/3], [w/3, d/3], [-w/3, -d/3], [w/5, -d/5],
    [w/2.5, 0], [-w/2.5, d/5], [0, d/2.5]
  ];

  treePositions.forEach(([tx, tz]) => {
    const trunk = cylinder(0.8, 6, trunkMat, 8);
    trunk.position.set(tx, 0, tz);
    group.add(trunk);

    const canopy = cone(0, 5, 10, treeMat, 8);
    canopy.position.set(tx, 6, tz);
    group.add(canopy);
  });

  return { totalHeight: pavH + 1 };
}

// Simple fallback generators for remaining types
function generateRestaurant(recipe, group, palette) {
  return generateShop(recipe, group, palette);
}

function generateGallery(recipe, group, palette) {
  const result = generateLibrary(recipe, group, palette);
  return result;
}

function generateClinic(recipe, group, palette) {
  return generateSchool(recipe, group, palette);
}

function generateWorkshop(recipe, group, palette) {
  return generateMarket(recipe, group, palette);
}

// ══════════════════════════════════════════════════════════════════
// MAIN GENERATION ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════

const GENERATORS = {
  cottage: generateCottage,
  townhouse: generateTownhouse,
  shop: generateShop,
  pavilion: generatePavilion,
  chapel: generateChapel,
  rowhouse: generateRowhouse,
  brownstone: generateBrownstone,
  restaurant: generateRestaurant,
  gallery: generateGallery,
  clinic: generateClinic,
  apartment: generateApartment,
  library: generateLibrary,
  hotel: generateHotel,
  market: generateMarket,
  workshop: generateWorkshop,
  museum: generateMuseum,
  stadium: generateStadium,
  school: generateSchool,
  tower: generateTower,
  park: generatePark,
};

function generateBuilding() {
  if (!currentProgram || !buildingGroup) return null;

  // Clear existing
  while (buildingGroup.children.length > 0) {
    buildingGroup.remove(buildingGroup.children[0]);
  }

  // If we have a polygon, use polygon-based generation
  if (currentPolygon && currentPolygon.vertices && currentPolygon.vertices.length > 0) {
    return generateBuildingFromPolygon();
  }

  // Fallback: Calculate dimensions from selected tiles (rectangular)
  const bounds = getTileBounds();
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxY - bounds.minY;

  // Create recipe
  const recipe = {
    program: currentProgram.id,
    w: w * TILE_SIZE - PERIMETER_INSET * 2,
    d: d * TILE_SIZE - PERIMETER_INSET * 2,
    floors: currentParams.floors,
    floorH: FLOOR_HEIGHT,
    material: currentParams.material,
    raised: currentParams.raised,
  };

  // Seed RNG for reproducibility
  seed(Date.now());

  // Get palette for this program
  const palette = PALETTES[currentProgram.id] || PALETTES.cottage;

  // Generate using appropriate generator
  const generator = GENERATORS[currentProgram.id] || generateCottage;
  const result = generator(recipe, buildingGroup, palette);

  // Apply raised/pilotis if specified
  if (currentParams.raised) {
    const pilotisH = 8;
    buildingGroup.position.y = pilotisH;

    // Add pilotis columns
    const pilotisGroup = new THREE.Group();
    const structMat = MATS.concrete();

    const nColsX = Math.max(2, Math.ceil(recipe.w / 15));
    const nColsZ = Math.max(2, Math.ceil(recipe.d / 15));
    const spacingX = recipe.w / (nColsX - 1);
    const spacingZ = recipe.d / (nColsZ - 1);

    for (let ix = 0; ix < nColsX; ix++) {
      for (let iz = 0; iz < nColsZ; iz++) {
        const cx = -recipe.w/2 + ix * spacingX;
        const cz = -recipe.d/2 + iz * spacingZ;
        const col = tube([cx, -pilotisH, cz], [cx, 0, cz], 0.8, structMat);
        if (col) pilotisGroup.add(col);
      }
    }

    buildingGroup.add(pilotisGroup);
  } else {
    buildingGroup.position.y = 0;
  }

  // Calculate stats
  const footprintArea = recipe.w * recipe.d;
  const grossArea = footprintArea * recipe.floors;
  const height = result?.totalHeight || recipe.floors * FLOOR_HEIGHT;

  return {
    footprintArea: Math.round(footprintArea),
    grossArea: Math.round(grossArea),
    floors: recipe.floors,
    height: Math.round(height),
    program: currentProgram.name,
  };
}

/**
 * Generate building using the polygon footprint shape.
 * This creates buildings that follow the actual tile selection shape (L, linear, etc.)
 */
function generateBuildingFromPolygon() {
  const polygon = currentPolygon;
  const floors = currentParams.floors || 3;
  const floorH = FLOOR_HEIGHT;
  const totalHeight = floors * floorH;

  // Seed RNG
  seed(Date.now());

  // Get material based on current params
  const matName = currentParams.material || 'brick';
  const matFn = getMaterialFn(matName);
  const roofMatFn = getMaterialFn('slate');
  const trimMatFn = getMaterialFn('stone');

  // Extrude the polygon to create the main building volume
  extrudePolygon(buildingGroup, polygon.vertices, totalHeight, 0, matFn);

  // Add windows along polygon edges
  const edges = getPolygonEdges(polygon);
  addWindowsToPolygonEdges(buildingGroup, edges, totalHeight, floors, floorH, trimMatFn);

  // Add roof based on shape type
  addRoofForPolygon(buildingGroup, polygon, totalHeight, roofMatFn);

  // Add pilotis if raised
  if (currentParams.raised) {
    const pilotisH = 8;
    buildingGroup.position.y = pilotisH;
    addPilotisColumns(buildingGroup, polygon, pilotisH, 20, getMaterialFn('concrete'));
  } else {
    buildingGroup.position.y = 0;
  }

  // Calculate stats
  const footprintArea = polygon.area || 0;
  const grossArea = footprintArea * floors;

  return {
    footprintArea: Math.round(footprintArea),
    grossArea: Math.round(grossArea),
    floors: floors,
    height: Math.round(totalHeight),
    program: currentProgram?.name || 'Custom',
    polygon: polygon
  };
}

/**
 * Add windows along polygon edges.
 * Polygon (x, y) maps directly to THREE.js (x, ?, y) after extrusion handles coord transform.
 */
function addWindowsToPolygonEdges(group, edges, totalHeight, floors, floorH, frameMat) {
  const windowW = 4;
  const windowH = 5;
  const spacing = 10;
  const glassMat = MATS.glass_dark;

  for (const edge of edges) {
    if (edge.length < spacing * 2) continue;

    const nWindows = Math.floor((edge.length - spacing) / spacing);

    for (let floor = 0; floor < floors; floor++) {
      const floorY = floor * floorH + floorH * 0.4;

      for (let wi = 0; wi < nWindows; wi++) {
        const t = (wi + 1) / (nWindows + 1);
        const wx = edge.start.x + (edge.end.x - edge.start.x) * t;
        const wz = edge.start.y + (edge.end.y - edge.start.y) * t;

        // Offset from wall
        const ox = edge.normal.x * 0.3;
        const oz = edge.normal.y * 0.3;

        // Window frame
        const frameGeo = new THREE.BoxGeometry(windowW + 0.5, windowH + 0.5, 0.3);
        const frame = new THREE.Mesh(frameGeo, frameMat());

        // Glass
        const glassGeo = new THREE.BoxGeometry(windowW - 0.5, windowH - 0.5, 0.1);
        const glass = new THREE.Mesh(glassGeo, glassMat());

        // Orient to face outward
        const angle = Math.atan2(edge.normal.y, edge.normal.x);

        frame.position.set(wx + ox, floorY + windowH / 2, wz + oz);
        frame.rotation.y = -angle + Math.PI / 2;

        glass.position.set(wx + ox * 1.2, floorY + windowH / 2, wz + oz * 1.2);
        glass.rotation.y = -angle + Math.PI / 2;

        group.add(frame);
        group.add(glass);
      }
    }
  }
}

/**
 * Add roof appropriate for the polygon shape.
 * Polygon (x, y) maps directly to THREE.js (x, ?, y) coordinates.
 */
function addRoofForPolygon(group, polygon, baseY, matFn) {
  const bounds = polygon.bounds;
  const w = bounds.width;
  const h = bounds.height;

  // For L-shapes and complex shapes, use flat roof with parapet
  if (polygon.shapeType === 'L' || polygon.shapeType === 'irregular') {
    // Flat roof follows polygon shape (same coord transform as building)
    const roofShape = new THREE.Shape();
    const verts = polygon.vertices;
    if (verts.length > 0) {
      roofShape.moveTo(verts[0].x, -verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        roofShape.lineTo(verts[i].x, -verts[i].y);
      }
      roofShape.closePath();
    }

    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 2, bevelEnabled: false });
    roofGeo.rotateX(-Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, matFn());
    roof.position.y = baseY;
    roof.castShadow = true;
    group.add(roof);

    // Parapet walls along edges
    const edges = getPolygonEdges(polygon);
    for (const edge of edges) {
      const parapetH = 3;
      const parapetW = edge.length;
      const parapetGeo = new THREE.BoxGeometry(parapetW, parapetH, 0.8);
      const parapet = new THREE.Mesh(parapetGeo, matFn());

      const mx = (edge.start.x + edge.end.x) / 2;
      const mz = (edge.start.y + edge.end.y) / 2;
      const angle = Math.atan2(edge.end.y - edge.start.y, edge.end.x - edge.start.x);

      parapet.position.set(mx, baseY + parapetH / 2 + 1, mz);
      parapet.rotation.y = -angle;
      group.add(parapet);
    }
  } else if (polygon.shapeType === 'linear') {
    // Linear buildings get shed roof
    const roofH = Math.min(w, h) * 0.15;
    const roofGroup = new THREE.Group();
    roofGroup.position.y = baseY;

    // Determine roof direction based on longest edge
    const ridgeDir = polygon.longestEdge?.axis === 'x' ? 'z' : 'x';
    addPitchedRoof(roofGroup, w + 4, h + 4, roofH, ridgeDir, matFn(), { overhang: 2 });
    group.add(roofGroup);
  } else {
    // Rectangular/square - pitched roof
    const roofH = Math.min(w, h) * 0.25;
    const roofGroup = new THREE.Group();
    roofGroup.position.y = baseY;

    const ridgeDir = w > h ? 'x' : 'z';
    addPitchedRoof(roofGroup, w + 4, h + 4, roofH, ridgeDir, matFn(), { overhang: 2 });
    group.add(roofGroup);
  }
}

// ══════════════════════════════════════════════════════════════════
// THREE.JS SETUP & API
// ══════════════════════════════════════════════════════════════════

export function initFormPreview(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || initialized) return;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  // Camera
  camera = new THREE.PerspectiveCamera(35, canvas.clientWidth / canvas.clientHeight, 1, 2000);
  camera.position.set(80, 60, 100);

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 20, 0);
  controls.minDistance = 30;
  controls.maxDistance = 500;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;

  // Lighting
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(60, 100, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.bias = -0.0002;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x8899aa, 0.5);
  fill.position.set(-40, 60, -30);
  scene.add(fill);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, 0.3);
  scene.add(hemi);

  // Building group (contains both building and ground so they rotate together)
  buildingGroup = new THREE.Group();
  scene.add(buildingGroup);

  // Ground group (inside building group so it rotates with the building)
  groundGroup = new THREE.Group();
  buildingGroup.add(groundGroup);

  // Building mesh group (separate from ground, can be moved/rotated by user)
  buildingMeshGroup = new THREE.Group();
  buildingGroup.add(buildingMeshGroup);

  // No large ground plane - we'll only show the actual tiles and boundary

  // Animation loop with scale figure movement
  let animTime = 0;
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    animTime += 0.016; // ~60fps timing

    if (isRotating) {
      buildingGroup.rotation.y += 0.002;
    }

    // Animate scale figures
    animateScaleFigures(animTime);

    renderer.render(scene, camera);
  }
  animate();

  // Resize handler
  const resizeObserver = new ResizeObserver(() => {
    if (!canvas.parentElement) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  });
  resizeObserver.observe(canvas);

  initialized = true;
}

/**
 * Fit the camera to show the entire building.
 * Calculates bounding box and adjusts camera position/target.
 */
export function fitCameraToBuilding() {
  if (!buildingMeshGroup || !camera || !controls) return;

  // Calculate bounding box of all building geometry
  const box = new THREE.Box3();

  // Include all preview buildings
  previewBuildings.forEach(b => {
    if (b.group) {
      const buildingBox = new THREE.Box3().setFromObject(b.group);
      box.union(buildingBox);
    }
  });

  // Include current building mesh group
  if (buildingMeshGroup.children.length > 0) {
    const currentBox = new THREE.Box3().setFromObject(buildingMeshGroup);
    box.union(currentBox);
  }

  // If no geometry, use defaults
  if (box.isEmpty()) {
    camera.position.set(80, 60, 100);
    controls.target.set(0, 20, 0);
    controls.update();
    return;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Calculate required distance to fit building in view
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const cameraDistance = (maxDim / 2) / Math.tan(fov / 2);

  // Add some padding (1.5x)
  const distance = cameraDistance * 1.5;

  // Position camera at an angle to show the building nicely
  const angle = Math.PI / 6; // 30 degrees from horizontal
  const horizontalAngle = Math.PI / 4; // 45 degrees around

  camera.position.set(
    center.x + distance * Math.cos(angle) * Math.cos(horizontalAngle),
    center.y + distance * Math.sin(angle) + size.y * 0.3,
    center.z + distance * Math.cos(angle) * Math.sin(horizontalAngle)
  );

  // Look at the center of the building, slightly above ground
  controls.target.set(center.x, center.y, center.z);

  // Update far plane if needed
  if (camera.far < distance * 2) {
    camera.far = distance * 3;
    camera.updateProjectionMatrix();
  }

  controls.update();
}

/**
 * Update ground display to show selected tiles and boundary.
 */
export function updateGroundDisplay() {
  if (!groundGroup || !currentPolygon) return;

  // Clear all existing ground elements
  while (groundGroup.children.length > 0) {
    groundGroup.remove(groundGroup.children[0]);
  }

  const polygon = currentPolygon;
  const bounds = polygon.bounds;

  // Draw tile outlines (subtle grid showing selected tiles)
  if (polygon.tiles) {
    const tileMat = new THREE.LineBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.5 });

    for (const tile of polygon.tiles) {
      // Tile outline relative to centroid
      const tileW = 130;
      const tileX = (tile.gx * tileW) - (polygon.worldOffset?.x || 0);
      const tileZ = (tile.gy * tileW) - (polygon.worldOffset?.y || 0);

      const tilePoints = [
        new THREE.Vector3(tileX, 0.05, tileZ),
        new THREE.Vector3(tileX + tileW, 0.05, tileZ),
        new THREE.Vector3(tileX + tileW, 0.05, tileZ + tileW),
        new THREE.Vector3(tileX, 0.05, tileZ + tileW),
        new THREE.Vector3(tileX, 0.05, tileZ)
      ];

      const tileGeo = new THREE.BufferGeometry().setFromPoints(tilePoints);
      const tileLine = new THREE.Line(tileGeo, tileMat);
      groundGroup.add(tileLine);

      // Fill tile with subtle color
      const fillGeo = new THREE.PlaneGeometry(tileW - 2, tileW - 2);
      const fillMat = new THREE.MeshBasicMaterial({
        color: 0xd0d0c8,
        transparent: true,
        opacity: 0.3
      });
      const fill = new THREE.Mesh(fillGeo, fillMat);
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(tileX + tileW / 2, 0.02, tileZ + tileW / 2);
      groundGroup.add(fill);
    }
  }

  // Draw dashed inset boundary
  const dashMat = new THREE.LineDashedMaterial({
    color: 0x666666,
    dashSize: 3,
    gapSize: 2,
    linewidth: 2
  });

  const boundaryPoints = polygon.vertices.map(v =>
    new THREE.Vector3(v.x, 0.1, v.y)
  );
  // Close the loop
  if (boundaryPoints.length > 0) {
    boundaryPoints.push(boundaryPoints[0].clone());
  }

  const boundaryGeo = new THREE.BufferGeometry().setFromPoints(boundaryPoints);
  const boundaryLine = new THREE.Line(boundaryGeo, dashMat);
  boundaryLine.computeLineDistances(); // Required for dashed lines
  groundGroup.add(boundaryLine);

  // Add corner markers
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
  for (const v of polygon.vertices) {
    const markerGeo = new THREE.CircleGeometry(1, 8);
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(v.x, 0.12, v.y);
    groundGroup.add(marker);
  }
}

function getTileBounds() {
  if (selectedTiles.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  selectedTiles.forEach(tile => {
    minX = Math.min(minX, tile.gx);
    maxX = Math.max(maxX, tile.gx + 1);
    minY = Math.min(minY, tile.gy);
    maxY = Math.max(maxY, tile.gy + 1);
  });

  return { minX, maxX, minY, maxY };
}

// ══════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════

export function reset() {
  selectedTiles = [];
  footprintGrid = [];
  currentProgram = null;
  currentPolygon = null;
  currentGenes = null;
  currentArchetypeResult = null;

  // Reset building position/rotation
  buildingOffset = { x: 0, z: 0 };
  buildingRotation = 0;

  // Clear preview and committed buildings
  previewBuildings = [];
  selectedBuildingIndex = -1;
  committedBuildings = [];
  currentBuildingStats = null;

  // Clear scale figures
  scaleFigures = null;

  // Clear selection helper
  selectionHelper = null;

  if (buildingGroup) {
    // Clear all children from buildingGroup
    while (buildingGroup.children.length > 0) {
      buildingGroup.remove(buildingGroup.children[0]);
    }

    // Re-create groundGroup inside buildingGroup (so it rotates with building)
    groundGroup = new THREE.Group();
    buildingGroup.add(groundGroup);

    // Re-create buildingMeshGroup (contains the actual building, separate from ground)
    buildingMeshGroup = new THREE.Group();
    buildingGroup.add(buildingMeshGroup);
  }
}

export function setTiles(tiles) {
  selectedTiles = tiles;
  initializeFootprintGrid();

  // Compute polygon from tiles (new system)
  computePolygonFromTiles();

  // Auto-select first program
  const programs = getAvailablePrograms();
  if (programs.length > 0 && !currentProgram) {
    currentProgram = programs[0];
  }
}

function initializeFootprintGrid() {
  // Initialize footprint grid based on selected tiles
  const bounds = getTileBounds();
  const gridW = (bounds.maxX - bounds.minX) * 8;
  const gridH = (bounds.maxY - bounds.minY) * 8;

  footprintGrid = [];
  for (let y = 0; y < gridH; y++) {
    footprintGrid[y] = [];
    for (let x = 0; x < gridW; x++) {
      footprintGrid[y][x] = true; // Default filled
    }
  }
}

export function getAvailablePrograms() {
  const count = Math.min(4, Math.max(1, selectedTiles.length));
  return PROGRAMS[count] || PROGRAMS[1];
}

export function setProgram(programId) {
  const programs = getAvailablePrograms();
  currentProgram = programs.find(p => p.id === programId) || programs[0];
  return currentProgram;
}

export function getCurrentProgram() {
  return currentProgram;
}

export function updateParams(params) {
  Object.assign(currentParams, params);
}

export function getFootprintGrid() {
  return footprintGrid;
}

export function getFootprintDimensions() {
  const bounds = getTileBounds();
  return {
    width: (bounds.maxX - bounds.minX) * 8,
    height: (bounds.maxY - bounds.minY) * 8
  };
}

export function isCellBuildable(x, y) {
  return true; // Simplified - all cells buildable
}

export function setFootprintCell(x, y, filled) {
  if (footprintGrid[y]) {
    footprintGrid[y][x] = filled;
  }
}

export function toggleFootprintCell(x, y) {
  if (footprintGrid[y]) {
    footprintGrid[y][x] = !footprintGrid[y][x];
  }
}

export function fillFootprint() { initializeFootprintGrid(); }
export function clearFootprint() { footprintGrid = footprintGrid.map(row => row.map(() => false)); }
export function invertFootprint() {
  footprintGrid = footprintGrid.map(row => row.map(cell => !cell));
}

export function getFilledCellCount() { return footprintGrid.flat().filter(Boolean).length; }

export function generateForm() {
  return generateBuilding();
}

export function toggleRotation() {
  isRotating = !isRotating;
  return isRotating;
}

export function setOrthoView() {
  if (camera) {
    camera.position.set(0, 150, 0.1);
    controls.target.set(0, 0, 0);
  }
}

export function resetView() {
  if (camera && controls) {
    camera.position.set(80, 60, 100);
    controls.target.set(0, 20, 0);
  }
}

export function dispose() {
  if (renderer) {
    renderer.dispose();
  }
  initialized = false;
}

/**
 * Force refresh the preview (call when canvas becomes visible again)
 */
export function refreshPreview() {
  if (!renderer || !camera || !scene) return;

  const canvas = renderer.domElement;
  if (!canvas) return;

  // Force resize update
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width > 0 && height > 0) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.render(scene, camera);
  }
}

// ══════════════════════════════════════════════════════════════════
// BUILDING POSITION/ROTATION CONTROLS
// ══════════════════════════════════════════════════════════════════

/**
 * Get current building offset within tile (in feet)
 */
export function getBuildingOffset() {
  return { ...buildingOffset };
}

/**
 * Set building offset within tile (in feet)
 */
export function setBuildingOffset(x, z) {
  buildingOffset.x = x;
  buildingOffset.z = z;
  applyBuildingTransform();
}

// ══════════════════════════════════════════════════════════════════
// PREVIEW BUILDINGS SYSTEM
// Allows adding/editing/removing multiple buildings before committing
// ══════════════════════════════════════════════════════════════════

/**
 * Move selected building by delta amount (in feet)
 * Falls back to staging building if no preview building is selected
 */
export function moveBuildingBy(dx, dz) {
  // Calculate boundary limits based on polygon and building size
  const polygon = currentPolygon;
  const boundaryMargin = 5; // feet from edge

  // If a preview building is selected, move that
  if (selectedBuildingIndex >= 0 && selectedBuildingIndex < previewBuildings.length) {
    const building = previewBuildings[selectedBuildingIndex];
    const stats = building.stats;
    const halfW = (stats?.polygon?.bounds?.width || 30) / 2;
    const halfD = (stats?.polygon?.bounds?.height || 30) / 2;

    // Calculate max offset based on polygon bounds and building size
    const maxX = polygon ? (polygon.bounds.width / 2) - halfW - boundaryMargin : 50;
    const maxZ = polygon ? (polygon.bounds.height / 2) - halfD - boundaryMargin : 50;

    building.offset.x = Math.max(-maxX, Math.min(maxX, building.offset.x + dx));
    building.offset.z = Math.max(-maxZ, Math.min(maxZ, building.offset.z + dz));
    applyBuildingTransform(selectedBuildingIndex);
    updateSelectionHelper();
    return { ...building.offset };
  }

  // Otherwise, move the staging building
  const stats = currentBuildingStats;
  const halfW = (stats?.polygon?.bounds?.width || 30) / 2;
  const halfD = (stats?.polygon?.bounds?.height || 30) / 2;

  const maxX = polygon ? (polygon.bounds.width / 2) - halfW - boundaryMargin : 50;
  const maxZ = polygon ? (polygon.bounds.height / 2) - halfD - boundaryMargin : 50;

  buildingOffset.x = Math.max(-maxX, Math.min(maxX, buildingOffset.x + dx));
  buildingOffset.z = Math.max(-maxZ, Math.min(maxZ, buildingOffset.z + dz));
  applyStagingBuildingTransform();
  return { ...buildingOffset };
}

/**
 * Get current building rotation (in radians)
 */
export function getBuildingRotation() {
  if (selectedBuildingIndex >= 0 && selectedBuildingIndex < previewBuildings.length) {
    return previewBuildings[selectedBuildingIndex].rotation;
  }
  return buildingRotation;
}

/**
 * Set building rotation (in radians)
 */
export function setBuildingRotation(radians) {
  if (selectedBuildingIndex >= 0 && selectedBuildingIndex < previewBuildings.length) {
    previewBuildings[selectedBuildingIndex].rotation = radians;
    applyBuildingTransform(selectedBuildingIndex);
    updateSelectionHelper();
  } else {
    buildingRotation = radians;
    applyStagingBuildingTransform();
  }
}

/**
 * Rotate selected building by delta amount (in radians)
 * Falls back to staging building if no preview building is selected
 */
export function rotateBuildingBy(deltaRadians) {
  // Normalize helper
  const normalize = (r) => {
    while (r < 0) r += Math.PI * 2;
    while (r >= Math.PI * 2) r -= Math.PI * 2;
    return r;
  };

  // If a preview building is selected, rotate that
  if (selectedBuildingIndex >= 0 && selectedBuildingIndex < previewBuildings.length) {
    const building = previewBuildings[selectedBuildingIndex];
    building.rotation = normalize(building.rotation + deltaRadians);
    applyBuildingTransform(selectedBuildingIndex);
    updateSelectionHelper();
    return building.rotation;
  }

  // Otherwise, rotate the staging building
  buildingRotation = normalize(buildingRotation + deltaRadians);
  applyStagingBuildingTransform();
  return buildingRotation;
}

/**
 * Apply offset and rotation to a preview building's group
 */
function applyBuildingTransform(index) {
  if (index < 0 || index >= previewBuildings.length) return;
  const building = previewBuildings[index];
  if (!building.group) return;
  building.group.position.x = building.offset.x;
  building.group.position.z = building.offset.z;
  building.group.rotation.y = building.rotation;
}

/**
 * Apply offset and rotation to the staging building (buildingMeshGroup)
 */
function applyStagingBuildingTransform() {
  if (!buildingMeshGroup) return;
  buildingMeshGroup.position.x = buildingOffset.x;
  buildingMeshGroup.position.z = buildingOffset.z;
  buildingMeshGroup.rotation.y = buildingRotation;
}

/**
 * Reset selected building position/rotation to center
 * Falls back to staging building if no preview building is selected
 */
export function resetBuildingTransform() {
  if (selectedBuildingIndex >= 0 && selectedBuildingIndex < previewBuildings.length) {
    const building = previewBuildings[selectedBuildingIndex];
    building.offset = { x: 0, z: 0 };
    building.rotation = 0;
    applyBuildingTransform(selectedBuildingIndex);
    updateSelectionHelper();
  } else {
    buildingOffset = { x: 0, z: 0 };
    buildingRotation = 0;
    applyStagingBuildingTransform();
  }
}

/**
 * Get selected building index
 */
export function getSelectedBuildingIndex() {
  return selectedBuildingIndex;
}

/**
 * Select a preview building by index
 */
export function selectPreviewBuilding(index) {
  if (index < -1 || index >= previewBuildings.length) return false;
  selectedBuildingIndex = index;
  updateSelectionHelper();
  return true;
}

/**
 * Get all preview buildings info
 */
export function getPreviewBuildings() {
  return previewBuildings.map((b, i) => ({
    index: i,
    stats: b.stats || {},
    selected: i === selectedBuildingIndex
  }));
}

/**
 * Get count of preview buildings
 */
export function getPreviewBuildingCount() {
  return previewBuildings.length;
}

/**
 * Remove a preview building by index
 */
export function removePreviewBuilding(index) {
  if (index < 0 || index >= previewBuildings.length) return false;

  const building = previewBuildings[index];
  if (building.group && buildingGroup) {
    buildingGroup.remove(building.group);
  }

  previewBuildings.splice(index, 1);

  // Adjust selection
  if (selectedBuildingIndex >= previewBuildings.length) {
    selectedBuildingIndex = previewBuildings.length - 1;
  }
  if (selectedBuildingIndex === index) {
    selectedBuildingIndex = previewBuildings.length > 0 ? 0 : -1;
  }

  updateSelectionHelper();
  return true;
}

/**
 * Add current generated building to preview (keeps it and allows generating another)
 */
export function addBuildingToPreview() {
  if (!buildingMeshGroup || buildingMeshGroup.children.length === 0) {
    return { success: false, reason: 'No building to add' };
  }

  // Check collision with existing preview buildings
  const collision = checkPreviewCollision();
  if (collision.collides) {
    return { success: false, reason: 'Building overlaps with another building' };
  }

  // Create preview building entry
  const previewGroup = new THREE.Group();

  // Move all children from buildingMeshGroup to previewGroup
  while (buildingMeshGroup.children.length > 0) {
    const child = buildingMeshGroup.children[0];
    buildingMeshGroup.remove(child);
    previewGroup.add(child);
  }

  // Apply current transform
  previewGroup.position.x = buildingOffset.x;
  previewGroup.position.z = buildingOffset.z;
  previewGroup.rotation.y = buildingRotation;

  // Add to preview buildings array with full data
  previewBuildings.push({
    group: previewGroup,
    offset: { ...buildingOffset },
    rotation: buildingRotation,
    stats: currentBuildingStats ? { ...currentBuildingStats } : null,
    boundingBox: getCurrentBuildingBBox(),
    name: currentBuildingStats?.name || `Building ${previewBuildings.length + 1}`,
    genes: currentBuildingStats?.genes || null,
    formData: currentBuildingStats?.formData || null
  });

  // Add to scene
  buildingGroup.add(previewGroup);

  // Select the new building
  selectedBuildingIndex = previewBuildings.length - 1;

  // Reset for next building
  buildingOffset = { x: 0, z: 0 };
  buildingRotation = 0;
  currentBuildingStats = null;

  // Create fresh buildingMeshGroup for next building
  buildingMeshGroup = new THREE.Group();
  buildingGroup.add(buildingMeshGroup);

  updateSelectionHelper();

  return { success: true, count: previewBuildings.length };
}

/**
 * Create selection helper (wireframe box around selected building)
 */
function createSelectionHelper() {
  if (selectionHelper) {
    buildingGroup?.remove(selectionHelper);
  }

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(geometry);
  const material = new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 });
  selectionHelper = new THREE.LineSegments(edges, material);
  selectionHelper.visible = false;

  if (buildingGroup) {
    buildingGroup.add(selectionHelper);
  }
}

/**
 * Update selection helper position and size.
 * Only shows for preview buildings (not the current uncommitted building).
 */
function updateSelectionHelper() {
  if (!selectionHelper) {
    createSelectionHelper();
  }

  // Hide selection helper if:
  // - No preview buildings exist
  // - No building is selected
  // - Selected index is invalid
  if (previewBuildings.length === 0 ||
      selectedBuildingIndex < 0 ||
      selectedBuildingIndex >= previewBuildings.length) {
    if (selectionHelper) selectionHelper.visible = false;
    return;
  }

  const building = previewBuildings[selectedBuildingIndex];
  const stats = building.stats;

  if (!stats || !stats.polygon) {
    if (selectionHelper) selectionHelper.visible = false;
    return;
  }

  // Get building dimensions
  const width = stats.polygon.bounds?.width || 40;
  const depth = stats.polygon.bounds?.height || 40;
  const height = stats.height || 30;

  // Update selection helper geometry
  selectionHelper.scale.set(width + 4, height + 4, depth + 4);
  selectionHelper.position.set(
    building.offset.x,
    height / 2 + 2,
    building.offset.z
  );
  selectionHelper.rotation.y = building.rotation;
  selectionHelper.visible = true;
}

/**
 * Hide the selection helper (used during generation)
 */
function hideSelectionHelper() {
  if (selectionHelper) {
    selectionHelper.visible = false;
  }
}

/**
 * Get bounding box for the current (uncommitted) building
 */
function getCurrentBuildingBBox() {
  if (!currentBuildingStats || !currentBuildingStats.polygon) return null;

  const poly = currentBuildingStats.polygon;
  const hw = poly.bounds.width / 2;
  const hd = poly.bounds.height / 2;

  const maxDim = Math.max(hw, hd);
  const ox = buildingOffset.x + (poly.centroid?.x || 0);
  const oz = buildingOffset.z + (poly.centroid?.y || 0);

  return {
    minX: ox - maxDim - 2,
    maxX: ox + maxDim + 2,
    minZ: oz - maxDim - 2,
    maxZ: oz + maxDim + 2,
    centerX: ox,
    centerZ: oz
  };
}

/**
 * Get bounding box for a preview building
 */
function getPreviewBuildingBBox(index) {
  if (index < 0 || index >= previewBuildings.length) return null;
  const building = previewBuildings[index];
  if (!building.stats || !building.stats.polygon) return null;

  const poly = building.stats.polygon;
  const hw = poly.bounds.width / 2;
  const hd = poly.bounds.height / 2;

  const maxDim = Math.max(hw, hd);
  const ox = building.offset.x + (poly.centroid?.x || 0);
  const oz = building.offset.z + (poly.centroid?.y || 0);

  return {
    minX: ox - maxDim - 2,
    maxX: ox + maxDim + 2,
    minZ: oz - maxDim - 2,
    maxZ: oz + maxDim + 2,
    centerX: ox,
    centerZ: oz
  };
}

/**
 * Check if two bounding boxes overlap
 */
function boxesOverlap(a, b) {
  if (!a || !b) return false;
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ);
}

/**
 * Check if current building collides with preview buildings
 */
export function checkPreviewCollision() {
  const currentBox = getCurrentBuildingBBox();
  if (!currentBox) return { collides: false };

  for (let i = 0; i < previewBuildings.length; i++) {
    const bbox = getPreviewBuildingBBox(i);
    if (boxesOverlap(currentBox, bbox)) {
      return { collides: true, withIndex: i };
    }
  }
  return { collides: false };
}

/**
 * Check if selected building collides with other preview buildings
 */
export function checkBuildingCollision() {
  if (selectedBuildingIndex < 0) {
    return checkPreviewCollision();
  }

  const selectedBox = getPreviewBuildingBBox(selectedBuildingIndex);
  if (!selectedBox) return { collides: false };

  for (let i = 0; i < previewBuildings.length; i++) {
    if (i === selectedBuildingIndex) continue;
    const bbox = getPreviewBuildingBBox(i);
    if (boxesOverlap(selectedBox, bbox)) {
      return { collides: true, withIndex: i };
    }
  }
  return { collides: false };
}

/**
 * Find an empty spawn location for a new building with given dimensions
 * Tries to find a spot that doesn't overlap with existing preview buildings
 * @param {number} width - Building width
 * @param {number} depth - Building depth
 * @param {number} padding - Minimum padding between buildings (default 25ft for skyscrapers)
 * @returns {{x: number, z: number}} - Spawn offset
 */
export function findEmptySpawnLocation(width, depth, padding = 25) {
  const polygon = currentPolygon;
  if (!polygon) return { x: 0, z: 0 };

  const bounds = polygon.bounds;
  const halfW = width / 2;
  const halfD = depth / 2;

  // Calculate safe boundary limits (keep building fully inside with margin)
  const boundaryMargin = 10; // feet from edge
  const maxX = Math.max(0, (bounds.width / 2) - halfW - boundaryMargin);
  const maxZ = Math.max(0, (bounds.height / 2) - halfD - boundaryMargin);

  // Helper to clamp position within boundary
  const clampToBounds = (x, z) => ({
    x: Math.max(-maxX, Math.min(maxX, x)),
    z: Math.max(-maxZ, Math.min(maxZ, z))
  });

  // Collect all existing building bounding boxes (preview + current uncommitted)
  const existingBoxes = [];

  // Add preview buildings
  for (const building of previewBuildings) {
    if (building.boundingBox) {
      existingBoxes.push(building.boundingBox);
    }
  }

  // Add current uncommitted building if it exists
  if (currentBuildingStats?.polygon) {
    const poly = currentBuildingStats.polygon;
    existingBoxes.push({
      minX: poly.bounds.minX + buildingOffset.x,
      maxX: poly.bounds.maxX + buildingOffset.x,
      minZ: poly.bounds.minY + buildingOffset.z,
      maxZ: poly.bounds.maxY + buildingOffset.z
    });
  }

  // If no existing buildings, return center
  if (existingBoxes.length === 0) {
    return clampToBounds(0, 0);
  }

  // Try different spawn positions in a grid pattern
  const maxOffset = Math.max(maxX, maxZ);
  const step = 20; // feet between attempts

  // Generate positions spiraling outward from center
  const positions = [{ x: 0, z: 0, dist: 0 }];
  for (let dist = step; dist <= maxOffset + step; dist += step) {
    const angles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, -3*Math.PI/4, -Math.PI/2, -Math.PI/4];
    for (const angle of angles) {
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      positions.push({ x, z, dist });
    }
  }

  // Sort by distance from center
  positions.sort((a, b) => a.dist - b.dist);

  // Check each position for collisions
  for (const pos of positions) {
    // Clamp position to bounds first
    const clamped = clampToBounds(pos.x, pos.z);

    // Check if this position is within boundary (with building dimensions)
    if (Math.abs(clamped.x) + halfW > bounds.width / 2 - 5 ||
        Math.abs(clamped.z) + halfD > bounds.height / 2 - 5) {
      continue; // Skip - would go outside boundary
    }

    const testBox = {
      minX: clamped.x - halfW,
      maxX: clamped.x + halfW,
      minZ: clamped.z - halfD,
      maxZ: clamped.z + halfD
    };

    let collision = false;
    for (const bbox of existingBoxes) {
      // Add padding when checking collision
      const paddedBox = {
        minX: bbox.minX - padding,
        maxX: bbox.maxX + padding,
        minZ: bbox.minZ - padding,
        maxZ: bbox.maxZ + padding
      };

      if (boxesOverlap(testBox, paddedBox)) {
        collision = true;
        break;
      }
    }

    if (!collision) {
      return clamped;
    }
  }

  // No empty spot found - place at edge of last building
  const lastBox = existingBoxes[existingBoxes.length - 1];
  if (lastBox) {
    // Try to the right of the last building
    const newX = lastBox.maxX + halfW + padding;
    return clampToBounds(newX, (lastBox.minZ + lastBox.maxZ) / 2);
  }

  return clampToBounds(0, 0);
}

/**
 * Commit all preview buildings (finalize them)
 */
export function commitCurrentBuilding() {
  // First, add any uncommitted building to preview
  if (buildingMeshGroup && buildingMeshGroup.children.length > 0) {
    const result = addBuildingToPreview();
    if (!result.success) {
      return result;
    }
  }

  if (previewBuildings.length === 0) {
    return { success: false, reason: 'No buildings to commit' };
  }

  // Move all preview buildings to committed
  for (const building of previewBuildings) {
    committedBuildings.push({
      group: building.group,
      boundingBox: building.boundingBox,
      stats: building.stats,
      name: building.name,
      genes: building.genes,
      formData: building.formData,
      offset: building.offset,
      rotation: building.rotation
    });
  }

  // Clear preview buildings array (don't remove from scene, they're now committed)
  previewBuildings = [];
  selectedBuildingIndex = -1;

  // Hide selection helper
  if (selectionHelper) {
    selectionHelper.visible = false;
  }

  return { success: true, count: committedBuildings.length };
}

/**
 * Get all committed buildings with full data for build completion
 */
export function getCommittedBuildings() {
  // Return both committed and preview buildings with full data
  const all = [
    ...committedBuildings.map(b => ({
      stats: b.stats,
      name: b.name || `Building ${committedBuildings.indexOf(b) + 1}`,
      genes: b.genes,
      formData: b.formData,
      offset: b.offset || { x: 0, z: 0 },
      rotation: b.rotation || 0,
      boundingBox: b.boundingBox
    })),
    ...previewBuildings.map(b => ({
      stats: b.stats,
      name: b.name || `Building ${previewBuildings.indexOf(b) + committedBuildings.length + 1}`,
      genes: b.genes,
      formData: b.formData,
      offset: b.offset || { x: 0, z: 0 },
      rotation: b.rotation || 0,
      boundingBox: b.boundingBox
    }))
  ];
  return all;
}

/**
 * Get count of committed buildings
 */
export function getCommittedBuildingCount() {
  return committedBuildings.length + previewBuildings.length;
}

/**
 * Check if there's an uncommitted building in the staging area
 */
export function hasUncommittedBuilding() {
  return buildingMeshGroup && buildingMeshGroup.children.length > 0;
}

/**
 * Get the stats for the current uncommitted building
 */
export function getCurrentBuildingStats() {
  return currentBuildingStats;
}

/**
 * Clear all preview buildings and current building from the scene
 */
export function clearPreview() {
  // Remove preview buildings from scene
  for (const building of previewBuildings) {
    if (building.group && buildingGroup) {
      buildingGroup.remove(building.group);
      building.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }
  }
  previewBuildings = [];

  // Clear current building
  if (buildingMeshGroup) {
    buildingMeshGroup.clear();
  }
  currentBuildingStats = null;

  // Reset selection
  selectedBuildingIndex = -1;
  if (selectionHelper) {
    selectionHelper.visible = false;
  }

  // Reset offset
  buildingOffset = { x: 0, z: 0 };
  buildingRotation = 0;
}

/**
 * Calculate material requirements for all preview buildings
 * Returns object with material amounts, source types, and total requirements
 */
export function calculateMaterialRequirements() {
  // Include committed buildings, preview buildings, AND current uncommitted building
  const allBuildings = [
    ...committedBuildings,
    ...previewBuildings
  ];

  // Also include current uncommitted building if exists
  if (currentBuildingStats) {
    allBuildings.push({ stats: currentBuildingStats, offset: buildingOffset });
  }

  console.log('[FormGenerator] calculateMaterialRequirements: buildings count =', allBuildings.length);

  const totals = {
    steel: 0,      // tons - imported
    glass: 0,      // sq ft - processed from sand
    concrete: 0,   // cu ft - processed from sand + stone + water
    timber: 0,     // bf - extracted from forest
    stone: 0,      // cu ft - extracted from mountain
    brick: 0       // units - processed from clay
  };

  const buildings = [];
  let totalExcavation = 0; // cu ft of earth to remove for foundations

  for (const building of allBuildings) {
    const stats = building.stats;
    if (!stats) continue;

    const floors = stats.floors || 3;
    const grossArea = stats.grossArea || 5000;
    const typology = stats.typology || 'curtainwall';
    const height = stats.height || floors * 12;

    // Material calculations based on building type and size
    let buildingMats = {};

    // Tower buildings (4+ floors) use steel frame
    if (floors >= 4) {
      // Steel structure: ~2 tons per 1000 sq ft gross area
      buildingMats.steel = Math.round((grossArea / 1000) * 2);
      // Glass curtain wall: ~60% of facade area
      const facadeArea = (height * Math.sqrt(grossArea / floors) * 4) * 0.6;
      buildingMats.glass = Math.round(facadeArea);
      // Concrete for floors and core: ~8 cu ft per 100 sq ft
      buildingMats.concrete = Math.round(grossArea * 0.08);
    }
    // Mid-rise buildings (2-3 floors) - concrete or masonry
    else if (floors >= 2) {
      buildingMats.concrete = Math.round(grossArea * 0.1);
      buildingMats.brick = Math.round(grossArea * 0.3);
      buildingMats.glass = Math.round(grossArea * 0.15);
      buildingMats.timber = Math.round(grossArea * 0.05);
    }
    // Low buildings (1 floor) - timber or masonry
    else {
      buildingMats.timber = Math.round(grossArea * 0.2);
      buildingMats.stone = Math.round(grossArea * 0.05);
      buildingMats.glass = Math.round(grossArea * 0.1);
    }

    // Adjust by typology
    if (typology === 'brutalist') {
      buildingMats.concrete = Math.round((buildingMats.concrete || 0) * 1.8);
      buildingMats.steel = Math.round((buildingMats.steel || 0) * 0.7);
      buildingMats.glass = Math.round((buildingMats.glass || 0) * 0.5);
    } else if (typology === 'twisted' || typology === 'diagrid') {
      buildingMats.steel = Math.round((buildingMats.steel || 0) * 1.4);
    } else if (typology === 'modular') {
      buildingMats.concrete = Math.round((buildingMats.concrete || 0) * 1.2);
      buildingMats.steel = Math.round((buildingMats.steel || 0) * 0.8);
    }

    // Calculate excavation for foundation
    // Foundation depth depends on building height: 4ft for 1-floor, 6ft for 2-3, 10ft for 4+
    const footprintArea = grossArea / floors; // sq ft per floor
    let foundationDepth = 4;
    if (floors >= 4) foundationDepth = 10;
    else if (floors >= 2) foundationDepth = 6;
    const excavation = Math.round(footprintArea * foundationDepth);
    totalExcavation += excavation;

    // Add to totals
    for (const mat of Object.keys(totals)) {
      totals[mat] += buildingMats[mat] || 0;
    }

    buildings.push({
      name: stats.name || 'Building',
      floors,
      grossArea,
      materials: buildingMats,
      excavation
    });
  }

  // Calculate source types for each material
  const sources = {
    steel: { type: 'imported', desc: 'IMPORTED weekly shipment' },
    glass: { type: 'processed', desc: 'PROCESSED from sand (beach)' },
    concrete: { type: 'processed', desc: 'PROCESSED from sand + stone + water' },
    timber: { type: 'extracted', desc: 'EXTRACTED from forest tiles' },
    stone: { type: 'extracted', desc: 'EXTRACTED from mountain tiles' },
    brick: { type: 'processed', desc: 'PROCESSED from clay (lowlands)' }
  };

  return {
    totals,
    sources,
    buildings,
    buildingCount: allBuildings.length,
    excavation: totalExcavation
  };
}

/**
 * Get all preview buildings data for commit
 */
export function getPreviewBuildingsForCommit() {
  return previewBuildings.map(b => ({
    stats: b.stats,
    offset: b.offset,
    rotation: b.rotation,
    boundingBox: b.boundingBox
  }));
}

/**
 * Get all preview buildings WITH their THREE.js groups for ISO rendering
 * This includes both committed preview buildings AND the current uncommitted building
 */
export function getPreviewBuildingsWithGroups() {
  const result = [];

  // Add all committed preview buildings
  for (const building of previewBuildings) {
    if (building.group && building.group.children.length > 0) {
      result.push({
        group: building.group,
        offset: building.offset || { x: 0, z: 0 },
        rotation: building.rotation || 0
      });
    }
  }

  // Also include current uncommitted building mesh
  if (buildingMeshGroup && buildingMeshGroup.children.length > 0) {
    result.push({
      group: buildingMeshGroup,
      offset: buildingOffset || { x: 0, z: 0 },
      rotation: buildingRotation || 0
    });
  }

  return result;
}

/**
 * Get cloned THREE.js mesh groups for all preview buildings
 * These can be directly added to the walk scene
 */
export function getPreviewMeshesForWalk() {
  const meshes = [];

  // Clone preview buildings
  for (const building of previewBuildings) {
    if (building.group) {
      const cloned = building.group.clone(true);
      // Deep clone materials to avoid shared state
      cloned.traverse(obj => {
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material = obj.material.map(m => m.clone());
          } else {
            obj.material = obj.material.clone();
          }
        }
      });
      meshes.push({
        group: cloned,
        offset: { ...building.offset },
        rotation: building.rotation,
        stats: building.stats
      });
    }
  }

  // Also clone current uncommitted building if it exists
  if (buildingMeshGroup && buildingMeshGroup.children.length > 0) {
    const cloned = buildingMeshGroup.clone(true);
    cloned.traverse(obj => {
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material = obj.material.map(m => m.clone());
        } else {
          obj.material = obj.material.clone();
        }
      }
    });
    meshes.push({
      group: cloned,
      offset: { ...buildingOffset },
      rotation: buildingRotation,
      stats: currentBuildingStats
    });
  }

  return meshes;
}

/**
 * Render all preview buildings to an isometric image for ISO view
 * Returns a data URL of the rendered image
 */
export function renderPreviewToIsoImage(width = 200, height = 300) {
  // Create a temporary renderer for the isometric capture
  const isoRenderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  });
  isoRenderer.setSize(width, height);
  isoRenderer.setClearColor(0x000000, 0); // Transparent background

  // Create isometric camera (orthographic for true isometric)
  const aspect = width / height;

  // Calculate bounds of all buildings
  let minX = Infinity, maxX = -Infinity;
  let minY = 0, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  const allGroups = [];

  // Collect all preview buildings
  for (const building of previewBuildings) {
    if (building.group) {
      allGroups.push({ group: building.group, offset: building.offset });
    }
  }

  // Also include current uncommitted building
  if (buildingMeshGroup && buildingMeshGroup.children.length > 0) {
    allGroups.push({ group: buildingMeshGroup, offset: buildingOffset });
  }

  if (allGroups.length === 0) {
    isoRenderer.dispose();
    return null;
  }

  // Calculate bounding box of all buildings WITH their offsets (so image shows them spread apart)
  for (const { group, offset } of allGroups) {
    const box = new THREE.Box3().setFromObject(group);
    const ox = offset?.x || 0;
    const oz = offset?.z || 0;
    minX = Math.min(minX, box.min.x + ox);
    maxX = Math.max(maxX, box.max.x + ox);
    minY = Math.min(minY, box.min.y);
    maxY = Math.max(maxY, box.max.y);
    minZ = Math.min(minZ, box.min.z + oz);
    maxZ = Math.max(maxZ, box.max.z + oz);
  }

  // Create scene for rendering
  const isoScene = new THREE.Scene();
  isoScene.background = null; // Transparent

  // Clone and add all buildings to the iso scene at their actual offset positions
  for (const { group, offset } of allGroups) {
    const cloned = group.clone(true);
    cloned.position.set(offset?.x || 0, 0, offset?.z || 0);
    isoScene.add(cloned);
  }

  // Add lighting similar to the preview
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  isoScene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(50, 100, 50);
  isoScene.add(directionalLight);

  // Calculate camera size to fit the building
  const buildingWidth = maxX - minX;
  const buildingDepth = maxZ - minZ;
  const buildingHeight = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;

  // Isometric camera setup
  const maxDim = Math.max(buildingWidth, buildingDepth, buildingHeight);
  const cameraSize = maxDim * 0.8;

  const isoCamera = new THREE.OrthographicCamera(
    -cameraSize * aspect, cameraSize * aspect,
    cameraSize, -cameraSize,
    0.1, maxDim * 10
  );

  // Position camera to match the map's 2:1 dimetric projection
  // Map uses TILE_W:TILE_H = 38:19 = 2:1 ratio
  // This corresponds to elevation angle arctan(0.5) ≈ 26.57° (not true isometric 35.264°)
  const distance = maxDim * 2;
  const isoAngle = Math.PI / 4; // 45 degrees horizontal rotation
  const elevAngle = Math.atan(0.5); // ~26.57 degrees to match 2:1 dimetric projection

  isoCamera.position.set(
    centerX + distance * Math.cos(elevAngle) * Math.sin(isoAngle),
    centerY + distance * Math.sin(elevAngle),
    centerZ + distance * Math.cos(elevAngle) * Math.cos(isoAngle)
  );
  isoCamera.lookAt(centerX, centerY, centerZ);

  // Render
  isoRenderer.render(isoScene, isoCamera);

  // Get image data
  const dataURL = isoRenderer.domElement.toDataURL('image/png');

  // Cleanup
  isoRenderer.dispose();
  isoScene.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });

  return {
    dataURL,
    width,
    height,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    center: { x: centerX, y: centerY, z: centerZ }
  };
}

// ══════════════════════════════════════════════════════════════════
// SCALE FIGURES
// ══════════════════════════════════════════════════════════════════

/**
 * Create human figure for scale (simplified silhouette) with walking animation data
 */
function createScaleFigure(x, z, rotation = 0) {
  const group = new THREE.Group();
  const figureMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    metalness: 0,
    roughness: 0.9
  });

  // Human proportions - scaled down for visual clarity (appears ~3ft in model)
  const scale = 0.5;
  const height = 5.67 * scale;
  const headRadius = 0.4 * scale;
  const bodyWidth = 1.2 * scale;
  const bodyDepth = 0.6 * scale;
  const bodyHeight = 2.8 * scale;
  const legHeight = 2.5 * scale;
  const legWidth = 0.4 * scale;

  // Head (sphere)
  const headGeo = new THREE.SphereGeometry(headRadius, 8, 8);
  const head = new THREE.Mesh(headGeo, figureMat);
  head.position.y = height - headRadius;
  head.castShadow = true;
  group.add(head);

  // Body (box)
  const bodyGeo = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
  const body = new THREE.Mesh(bodyGeo, figureMat);
  body.position.y = legHeight + bodyHeight / 2;
  body.castShadow = true;
  group.add(body);

  // Legs (two boxes) - store references for animation
  const legGeo = new THREE.BoxGeometry(legWidth, legHeight, bodyDepth);
  const leftLeg = new THREE.Mesh(legGeo, figureMat);
  leftLeg.position.set(-bodyWidth / 4, legHeight / 2, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, figureMat);
  rightLeg.position.set(bodyWidth / 4, legHeight / 2, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  group.position.set(x, 0, z);
  group.rotation.y = rotation;

  // Store animation data for walking
  group.userData = {
    velocity: rr(0.3, 0.8), // Walking speed (feet/frame)
    direction: rotation,
    targetDirection: rotation,
    turnSpeed: rr(0.02, 0.05),
    walkPhase: rr(0, Math.PI * 2), // Random start phase
    leftLeg,
    rightLeg,
    legHeight,
    bounds: 55, // Stay within tile bounds
    pauseTime: 0,
    isPaused: rng() > 0.7, // Some figures start paused
  };

  return group;
}

/**
 * Animate all scale figures - walking around avoiding buildings
 */
function animateScaleFigures(time) {
  if (!scaleFigures) return;

  scaleFigures.children.forEach(figure => {
    const data = figure.userData;
    if (!data) return;

    // Handle pausing
    if (data.isPaused) {
      data.pauseTime -= 0.016;
      if (data.pauseTime <= 0) {
        data.isPaused = false;
        // Pick new direction when resuming
        data.targetDirection = rr(0, Math.PI * 2);
      }
      return;
    }

    // Random pause chance
    if (rng() > 0.998) {
      data.isPaused = true;
      data.pauseTime = rr(1, 4); // Pause for 1-4 seconds
      return;
    }

    // Smoothly turn toward target direction
    let angleDiff = data.targetDirection - data.direction;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    data.direction += angleDiff * data.turnSpeed;

    // Move forward
    const dx = Math.sin(data.direction) * data.velocity;
    const dz = Math.cos(data.direction) * data.velocity;
    const newX = figure.position.x + dx;
    const newZ = figure.position.z + dz;

    // Check boundaries and buildings
    const hitBoundary = Math.abs(newX) > data.bounds || Math.abs(newZ) > data.bounds;
    const hitBuilding = isPointInBuilding(newX, newZ, 3);

    if (hitBoundary || hitBuilding) {
      // Turn around
      data.targetDirection = data.direction + Math.PI + rr(-0.5, 0.5);
    } else {
      figure.position.x = newX;
      figure.position.z = newZ;
    }

    // Update rotation to face walking direction
    figure.rotation.y = data.direction;

    // Animate legs with walking motion
    data.walkPhase += data.velocity * 0.3;
    const legSwing = Math.sin(data.walkPhase) * 0.3;
    if (data.leftLeg) data.leftLeg.rotation.x = legSwing;
    if (data.rightLeg) data.rightLeg.rotation.x = -legSwing;

    // Random direction changes
    if (rng() > 0.995) {
      data.targetDirection = data.direction + rr(-Math.PI / 2, Math.PI / 2);
    }
  });
}

/**
 * Check if a point is inside any building footprint
 */
function isPointInBuilding(x, z, buffer = 5) {
  // Check preview buildings
  for (const building of previewBuildings) {
    if (!building.stats?.polygon) continue;
    const poly = building.stats.polygon;
    const ox = building.offset.x;
    const oz = building.offset.z;
    const hw = (poly.bounds?.width || 40) / 2 + buffer;
    const hd = (poly.bounds?.height || 40) / 2 + buffer;

    if (x >= ox - hw && x <= ox + hw && z >= oz - hd && z <= oz + hd) {
      return true;
    }
  }

  // Check current building in staging
  if (currentBuildingStats?.polygon) {
    const poly = currentBuildingStats.polygon;
    const ox = buildingOffset.x;
    const oz = buildingOffset.z;
    const hw = (poly.bounds?.width || 40) / 2 + buffer;
    const hd = (poly.bounds?.height || 40) / 2 + buffer;

    if (x >= ox - hw && x <= ox + hw && z >= oz - hd && z <= oz + hd) {
      return true;
    }
  }

  return false;
}

/**
 * Find a valid position for a figure that doesn't collide with buildings
 */
function findValidFigurePosition(preferredX, preferredZ, tileSize = 130) {
  const halfTile = tileSize / 2 - 10; // Stay 10ft from edge

  // Try preferred position first
  if (!isPointInBuilding(preferredX, preferredZ)) {
    return { x: preferredX, z: preferredZ };
  }

  // Try random positions around the tile
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = rr(-halfTile, halfTile);
    const z = rr(-halfTile, halfTile);
    if (!isPointInBuilding(x, z)) {
      return { x, z };
    }
  }

  // Fallback to edge of tile
  return { x: halfTile, z: halfTile };
}

/**
 * Add scale figures to the scene - always visible, avoiding buildings
 */
export function addScaleFigures(count = 6) {
  removeScaleFigures();

  if (!buildingGroup) return;

  scaleFigures = new THREE.Group();
  const tileSize = 130;
  const halfTile = tileSize / 2;

  // Place figures around the perimeter and in clear areas
  const positions = [
    // Corners
    { x: -halfTile + 15, z: -halfTile + 15 },
    { x: halfTile - 15, z: -halfTile + 15 },
    { x: halfTile - 15, z: halfTile - 15 },
    { x: -halfTile + 15, z: halfTile - 15 },
    // Midpoints of edges
    { x: 0, z: -halfTile + 10 },
    { x: 0, z: halfTile - 10 },
    { x: -halfTile + 10, z: 0 },
    { x: halfTile - 10, z: 0 },
  ];

  // Add figures at valid positions
  let added = 0;
  for (const pos of positions) {
    if (added >= count) break;

    const validPos = findValidFigurePosition(pos.x, pos.z, tileSize);
    if (validPos) {
      // Face toward center
      const angleToCenter = Math.atan2(-validPos.z, -validPos.x);
      const rotation = angleToCenter + rr(-0.3, 0.3);
      const figure = createScaleFigure(validPos.x, validPos.z, rotation);
      scaleFigures.add(figure);
      added++;
    }
  }

  // Add a few more random figures
  for (let i = 0; i < 3; i++) {
    const x = rr(-halfTile + 20, halfTile - 20);
    const z = rr(-halfTile + 20, halfTile - 20);
    const validPos = findValidFigurePosition(x, z, tileSize);
    if (validPos && !isPointInBuilding(validPos.x, validPos.z, 8)) {
      const rotation = rr(0, Math.PI * 2);
      const figure = createScaleFigure(validPos.x, validPos.z, rotation);
      scaleFigures.add(figure);
    }
  }

  buildingGroup.add(scaleFigures);
}

/**
 * Remove scale figures from the scene
 */
export function removeScaleFigures() {
  if (scaleFigures && buildingGroup) {
    buildingGroup.remove(scaleFigures);
    scaleFigures = null;
  }
}

/**
 * Refresh scale figures (call after building position changes)
 */
export function refreshScaleFigures() {
  addScaleFigures();
}

// ══════════════════════════════════════════════════════════════════
// POLYGON-AWARE GENERATION API (NEW)
// ══════════════════════════════════════════════════════════════════

/**
 * Set the footprint polygon directly (from tile selection).
 * This is the primary way to specify building footprint in the new system.
 */
export function setPolygon(polygon) {
  currentPolygon = polygon ? centerPolygon(polygon) : null;
}

/**
 * Compute polygon from current selected tiles.
 * Call this after setTiles() to compute the polygon automatically.
 */
export function computePolygonFromTiles() {
  if (!selectedTiles || selectedTiles.length === 0) {
    currentPolygon = null;
    return null;
  }
  const rawPolygon = computeTileUnionPolygon(selectedTiles, PERIMETER_INSET);
  currentPolygon = rawPolygon ? centerPolygon(rawPolygon) : null;

  // Update ground display with tiles and boundary
  updateGroundDisplay();

  return currentPolygon;
}

/**
 * Get the current footprint polygon.
 */
export function getPolygon() {
  return currentPolygon;
}

/**
 * Set architectural genes for hybrid AI + shape grammar generation.
 */
export function setGenes(genes) {
  currentGenes = genes;
}

/**
 * Get current genes.
 */
export function getGenes() {
  return currentGenes;
}

/**
 * Generate building from polygon + genes using shape grammar.
 * This is the main entry point for the new hybrid system.
 */
export function generateFromGenes(genes = null, polygon = null) {
  const useGenes = genes || currentGenes || (currentProgram ? getDefaultGenes(currentProgram.id, selectedTiles) : null);
  const usePolygon = polygon || currentPolygon;

  if (!useGenes || !usePolygon || !buildingGroup) {
    return null;
  }

  // Clear existing geometry
  while (buildingGroup.children.length > 0) {
    buildingGroup.remove(buildingGroup.children[0]);
  }

  // Seed RNG for this building
  const tileSeed = usePolygon.tiles?.reduce((s, t) => s + t.gx * 1000 + t.gy, 0) || Date.now();
  seed(tileSeed);

  // Interpret genes into shape grammar operations
  const operations = interpretGenes(useGenes, usePolygon);

  // Execute shape grammar operations
  const result = executeShapeGrammar(operations, useGenes, usePolygon);

  return result;
}

/**
 * Execute shape grammar operations to build geometry.
 */
function executeShapeGrammar(operations, genes, polygon) {
  const floorH = genes.floorHeight || FLOOR_HEIGHT;
  const totalFloors = genes.floors?.preferred || 3;
  const totalHeight = totalFloors * floorH;
  const bounds = polygon.bounds;
  const w = bounds.width;
  const d = bounds.height;

  // Get material functions
  const primaryMatFn = getMaterialFn(genes.materialPalette?.primary || 'brick');
  const secondaryMatFn = getMaterialFn(genes.materialPalette?.secondary || 'concrete');
  const accentMatFn = getMaterialFn(genes.materialPalette?.accent || 'steel');
  const glassFn = MATS.glass_dark;

  let baseY = 0;

  // Process each operation
  for (const op of operations) {
    switch (op.type) {
      case 'pilotis':
        baseY = op.height || floorH;
        addPilotisColumns(buildingGroup, polygon, baseY, op.columnSpacing || 15, secondaryMatFn);
        break;

      case 'plinth':
        addPlinth(buildingGroup, polygon, op.height || 4, primaryMatFn);
        baseY = op.height || 4;
        break;

      case 'extrude':
        extrudePolygon(buildingGroup, op.polygon || polygon.vertices, op.height || totalHeight, op.baseY || baseY, primaryMatFn);
        break;

      case 'box':
        addBoxVolume(buildingGroup, op, primaryMatFn);
        break;

      case 'courtyard':
        carveCourtyard(buildingGroup, polygon, op.inset || 20, op.height || totalHeight, op.baseY || baseY);
        break;

      case 'setback':
        // Setback is handled during floor generation
        break;

      case 'cantilever':
        addCantilever(buildingGroup, polygon, op, primaryMatFn, secondaryMatFn);
        break;

      case 'bay_window':
        addBayWindowToPolygon(buildingGroup, polygon, op, floorH, primaryMatFn, glassFn);
        break;

      case 'void':
        // Voids are carved during main extrusion
        break;

      case 'arcade':
        addArcade(buildingGroup, polygon, op, secondaryMatFn);
        break;

      case 'tower':
        addTowerElement(buildingGroup, polygon, op, floorH, primaryMatFn);
        break;

      case 'roof_pitched':
        addPitchedRoofToPolygon(buildingGroup, polygon, op, secondaryMatFn);
        break;

      case 'roof_shed':
        addShedRoofToPolygon(buildingGroup, polygon, op, secondaryMatFn);
        break;

      case 'roof_sawtooth':
        addSawtoothRoof(buildingGroup, polygon, op, secondaryMatFn, glassFn);
        break;

      case 'roof_flat':
        addFlatRoofToPolygon(buildingGroup, polygon, op, primaryMatFn);
        break;

      case 'fenestration':
        addFenestrationToPolygon(buildingGroup, polygon, op, totalHeight, baseY, floorH, accentMatFn, glassFn);
        break;
    }
  }

  // Apply raised position if pilotis/raised base
  if (baseY > 0 && genes.baseCondition !== 'at-grade') {
    // Ground plane already at 0, building raised above
  }

  // Calculate stats
  const footprintArea = polygon.area;
  const grossArea = footprintArea * totalFloors;

  return {
    footprintArea: Math.round(footprintArea),
    grossArea: Math.round(grossArea),
    floors: totalFloors,
    height: Math.round(totalHeight + baseY),
    program: currentProgram?.name || 'Custom',
    genes: genes,
    polygon: polygon
  };
}

/**
 * Get material function by name.
 */
function getMaterialFn(materialName) {
  const matMap = {
    timber: MATS.timber_light,
    stone: MATS.stone_warm,
    brick: MATS.brick_red,
    concrete: MATS.concrete,
    glass: MATS.glass_dark,
    steel: MATS.steel,
    copper: MATS.copper,
    slate: MATS.slate,
    bronze: MATS.bronze,
    terracotta: MATS.terracotta
  };
  return matMap[materialName] || MATS.concrete;
}

/**
 * Extrude polygon to create building volume.
 *
 * Coordinate mapping:
 * - Polygon (x, y) → THREE.js (x, 0, y) on ground plane
 * - Extrusion goes up along THREE.js Y axis
 *
 * We negate y when creating the shape so that after rotateX(-PI/2),
 * the final z coordinate equals the original polygon y (not negated).
 */
function extrudePolygon(group, vertices, height, baseY, matFn) {
  const shape = new THREE.Shape();
  if (vertices.length > 0) {
    // Negate y so after rotation: z = -(-y) = y (matches polygon coords)
    shape.moveTo(vertices[0].x, -vertices[0].y);
    for (let i = 1; i < vertices.length; i++) {
      shape.lineTo(vertices[i].x, -vertices[i].y);
    }
    shape.closePath();
  }

  const extrudeSettings = {
    depth: height,
    bevelEnabled: false,
    steps: 1
  };

  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

  // Rotate to put shape on ground plane (XZ) with extrusion going up (Y)
  // After rotateX(-PI/2): shape in XY → shape in XZ, extrusion +Z → +Y
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, matFn());
  mesh.position.y = baseY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  group.add(mesh);
  return mesh;
}

/**
 * Add pilotis (columns) supporting the building.
 */
/**
 * Add pilotis (columns) supporting the building.
 * Polygon (x, y) maps directly to THREE.js (x, ?, y) coordinates.
 */
function addPilotisColumns(group, polygon, height, spacing, matFn) {
  const bounds = polygon.bounds;
  const nColsX = Math.max(2, Math.ceil(bounds.width / spacing));
  const nColsZ = Math.max(2, Math.ceil(bounds.height / spacing));
  const spacingX = bounds.width / (nColsX - 1);
  const spacingZ = bounds.height / (nColsZ - 1);

  for (let ix = 0; ix < nColsX; ix++) {
    for (let iz = 0; iz < nColsZ; iz++) {
      const cx = bounds.minX + ix * spacingX;
      const cz = bounds.minY + iz * spacingZ;

      const col = tube([cx, 0, cz], [cx, height, cz], 0.8, matFn());
      if (col) group.add(col);
    }
  }
}

/**
 * Add plinth/base under building.
 */
function addPlinth(group, polygon, height, matFn) {
  const insetVerts = polygon.vertices.map(v => ({
    x: v.x * 1.05,
    y: v.y * 1.05
  }));
  extrudePolygon(group, insetVerts, height, 0, matFn);
}

/**
 * Add box volume (for additive massing).
 */
function addBoxVolume(group, op, matFn) {
  const bx = box(op.width, op.height, op.depth, matFn());
  bx.position.set(op.x || 0, (op.baseY || 0) + op.height / 2, op.z || 0);
  group.add(bx);
}

/**
 * Carve courtyard from building.
 * In practice, we create the building as a ring/donut shape.
 */
function carveCourtyard(group, polygon, inset, height, baseY) {
  // For now, we'll just mark that a courtyard exists
  // Full implementation would create a shape with hole
  console.log('Courtyard carve requested, inset:', inset);
}

/**
 * Add cantilever projection.
 */
function addCantilever(group, polygon, op, primaryMatFn, structMatFn) {
  const bounds = polygon.bounds;
  const w = bounds.width;
  const d = bounds.height;
  const extension = op.extension || 8;
  const startY = (op.startFloor || 2) * FLOOR_HEIGHT;
  const endY = (op.endFloor || 4) * FLOOR_HEIGHT;
  const height = endY - startY;

  let cx = 0, cz = 0;
  switch (op.side) {
    case 'north': cz = bounds.minY - extension / 2; break;
    case 'south': cz = bounds.maxY + extension / 2; break;
    case 'east': cx = bounds.maxX + extension / 2; break;
    case 'west': cx = bounds.minX - extension / 2; break;
  }

  const cantileverBox = box(
    op.side === 'north' || op.side === 'south' ? w * 0.6 : extension,
    height,
    op.side === 'east' || op.side === 'west' ? d * 0.6 : extension,
    primaryMatFn()
  );
  cantileverBox.position.set(cx, startY + height / 2, cz);
  group.add(cantileverBox);
}

/**
 * Add bay windows along polygon edges.
 */
function addBayWindowToPolygon(group, polygon, op, floorH, matFn, glassFn) {
  const edges = getPolygonEdges(polygon);
  const targetEdge = edges.find(e => e.facing === 'south') || edges[0];

  if (!targetEdge) return;

  const bayW = op.width || 6;
  const bayD = op.depth || 3;
  const bayH = op.height || floorH * 2;

  for (const floor of (op.floors || [1])) {
    const baseY = floor * floorH;
    const bayGroup = new THREE.Group();

    // Bay floor and ceiling
    const bayFloor = box(bayW, 0.4, bayD, matFn());
    const bayCeiling = box(bayW, 0.4, bayD, matFn());
    bayCeiling.position.y = bayH - 0.4;
    bayGroup.add(bayFloor);
    bayGroup.add(bayCeiling);

    // Glass panels
    const centerGlass = box(bayW - 2, bayH - 2, 0.2, glassFn());
    centerGlass.position.set(0, bayH / 2, bayD / 2);
    bayGroup.add(centerGlass);

    // Position at edge midpoint
    bayGroup.position.set(targetEdge.midpoint.x, baseY, targetEdge.midpoint.y + bayD / 2);

    group.add(bayGroup);
  }
}

/**
 * Add arcade at ground level.
 */
function addArcade(group, polygon, op, matFn) {
  const edges = getPolygonEdges(polygon);
  const targetEdge = edges.find(e => e.length > 30) || edges[0];

  if (!targetEdge) return;

  const depth = op.depth || 8;
  const height = op.height || FLOOR_HEIGHT;
  const colSpacing = op.columnSpacing || 8;
  const nCols = Math.floor(targetEdge.length / colSpacing);

  for (let i = 0; i <= nCols; i++) {
    const t = i / nCols;
    const cx = targetEdge.start.x + (targetEdge.end.x - targetEdge.start.x) * t;
    const cz = targetEdge.start.y + (targetEdge.end.y - targetEdge.start.y) * t;

    const col = cylinder(0.5, height, matFn(), 12);
    col.position.set(cx + targetEdge.normal.x * depth, 0, cz + targetEdge.normal.y * depth);
    group.add(col);
  }
}

/**
 * Add tower element at corner.
 */
function addTowerElement(group, polygon, op, floorH, matFn) {
  const bounds = polygon.bounds;
  const towerW = op.width || 15;
  const extraFloors = op.extraFloors || 3;
  const towerH = (polygon.tileCount * 3 + extraFloors) * floorH;

  // Position at corner based on location
  let cx = 0, cz = 0;
  switch (op.location) {
    case 'corner':
    default:
      cx = bounds.maxX - towerW / 2;
      cz = bounds.maxY - towerW / 2;
  }

  const tower = box(towerW, towerH, towerW, matFn());
  tower.position.set(cx, towerH / 2, cz);
  group.add(tower);
}

/**
 * Add pitched roof following polygon shape.
 */
function addPitchedRoofToPolygon(group, polygon, op, matFn) {
  const baseY = op.baseY || 36;
  const pitch = op.pitch || 30;
  const bounds = polygon.bounds;
  const w = bounds.width + 3;
  const d = bounds.height + 3;
  const ridgeH = Math.min(w, d) / 2 * Math.tan(pitch * Math.PI / 180);

  const roofGroup = new THREE.Group();
  roofGroup.position.y = baseY;

  addPitchedRoof(roofGroup, w, d, ridgeH, op.ridgeDirection || 'z', matFn);
  group.add(roofGroup);
}

/**
 * Add shed roof following polygon shape.
 */
function addShedRoofToPolygon(group, polygon, op, matFn) {
  const baseY = op.baseY || 36;
  const pitch = op.pitch || 15;
  const bounds = polygon.bounds;
  const w = bounds.width + 3;
  const d = bounds.height + 3;
  const rise = Math.min(w, d) * Math.tan(pitch * Math.PI / 180);

  // Create sloped roof plane
  const roofGeo = new THREE.BoxGeometry(w, 0.4, d);
  const roof = new THREE.Mesh(roofGeo, matFn());
  roof.position.set(0, baseY + rise / 2, 0);
  roof.rotation.x = pitch * Math.PI / 180;
  roof.castShadow = true;
  group.add(roof);
}

/**
 * Add sawtooth roof (industrial).
 */
function addSawtoothRoof(group, polygon, op, matFn, glassFn) {
  const baseY = op.baseY || 36;
  const bounds = polygon.bounds;
  const toothCount = op.toothCount || 3;
  const toothH = op.toothHeight || 8;
  const toothD = bounds.height / toothCount;

  for (let i = 0; i < toothCount; i++) {
    const tz = bounds.minY + toothD / 2 + i * toothD;

    // Sloped section
    const slope = box(bounds.width, 0.4, toothD - 1, matFn());
    slope.rotation.x = -0.2;
    slope.position.set(0, baseY + toothH / 2, tz);
    group.add(slope);

    // Glazed section
    const glass = box(bounds.width - 4, toothH * 0.7, 0.3, glassFn());
    glass.position.set(0, baseY + toothH / 2, tz - toothD / 2 + 1);
    group.add(glass);
  }
}

/**
 * Add flat roof with parapet.
 */
function addFlatRoofToPolygon(group, polygon, op, matFn) {
  const baseY = op.baseY || 36;
  const parapetH = op.parapetHeight || 3;
  const bounds = polygon.bounds;

  // Roof plane
  const roofGeo = new THREE.BoxGeometry(bounds.width + 1, 0.5, bounds.height + 1);
  const roof = new THREE.Mesh(roofGeo, matFn());
  roof.position.set(0, baseY + 0.25, 0);
  roof.receiveShadow = true;
  group.add(roof);

  // Parapet walls
  const parapetThickness = 0.8;
  const parapets = [
    { x: 0, z: bounds.height / 2 + parapetThickness / 2, w: bounds.width + 2, d: parapetThickness },
    { x: 0, z: -bounds.height / 2 - parapetThickness / 2, w: bounds.width + 2, d: parapetThickness },
    { x: bounds.width / 2 + parapetThickness / 2, z: 0, w: parapetThickness, d: bounds.height },
    { x: -bounds.width / 2 - parapetThickness / 2, z: 0, w: parapetThickness, d: bounds.height }
  ];

  for (const p of parapets) {
    const parapet = box(p.w, parapetH, p.d, matFn());
    parapet.position.set(p.x, baseY + parapetH / 2, p.z);
    group.add(parapet);
  }
}

/**
 * Add windows/fenestration along polygon edges.
 */
function addFenestrationToPolygon(group, polygon, op, totalHeight, baseY, floorH, frameMat, glassMat) {
  const edges = getPolygonEdges(polygon);
  const density = op.density || 0.4;
  const windowW = op.windowWidth || 4;
  const windowH = op.windowHeight || 5;
  const spacing = op.spacing || 8;

  const nFloors = Math.floor(totalHeight / floorH);

  for (const edge of edges) {
    if (edge.length < spacing * 2) continue;

    const nWindows = Math.floor((edge.length - spacing) / spacing);

    for (let floor = 0; floor < nFloors; floor++) {
      const floorY = baseY + floor * floorH + floorH * 0.4;

      for (let wi = 0; wi < nWindows; wi++) {
        // Skip some windows based on density
        if (rng() > density) continue;

        const t = (wi + 1) / (nWindows + 1);
        const wx = edge.start.x + (edge.end.x - edge.start.x) * t;
        const wz = edge.start.y + (edge.end.y - edge.start.y) * t;

        // Offset slightly from wall
        const ox = edge.normal.x * 0.2;
        const oz = edge.normal.y * 0.2;

        // Window frame
        const frameGeo = new THREE.BoxGeometry(windowW + 0.6, windowH + 0.6, 0.2);
        const frame = new THREE.Mesh(frameGeo, frameMat());

        // Glass pane
        const glassGeo = new THREE.BoxGeometry(windowW, windowH, 0.1);
        const glass = new THREE.Mesh(glassGeo, glassMat());

        // Orient window to face outward
        const angle = Math.atan2(edge.normal.y, edge.normal.x);

        frame.position.set(wx + ox, floorY + windowH / 2, wz + oz);
        frame.rotation.y = -angle + Math.PI / 2;

        glass.position.set(wx + ox * 1.5, floorY + windowH / 2, wz + oz * 1.5);
        glass.rotation.y = -angle + Math.PI / 2;

        group.add(frame);
        group.add(glass);
      }
    }
  }
}

/**
 * Generate building from polygon only (using default genes for program).
 * This is the simplified path when no AI genes are provided.
 */
export function generateFromPolygon(polygon = null) {
  const usePolygon = polygon || currentPolygon;
  if (!usePolygon) return null;

  const genes = currentProgram ? getDefaultGenes(currentProgram.id, selectedTiles) : getDefaultGenes('cottage', []);
  return generateFromGenes(genes, usePolygon);
}

// ══════════════════════════════════════════════════════════════════
// ARCHETYPE-BASED GENERATION
// ══════════════════════════════════════════════════════════════════

// Store current archetype result
let currentArchetypeResult = null;

/**
 * Set the archetype result from AI generation.
 */
export function setArchetypeResult(result) {
  currentArchetypeResult = result;
}

/**
 * Get current archetype result.
 */
export function getArchetypeResult() {
  return currentArchetypeResult;
}

// ── REALISTIC BUILDING DIMENSIONS ────────────────────────────────────
// Buildings should be realistically sized, not fill the entire tile
const BUILDING_SCALES = {
  // Small: cabins, pavilions, chapels (1 floor)
  small: { width: [16, 28], depth: [20, 32], aspectRange: [0.6, 1.2] },
  // Medium: houses, shops, galleries (2-3 floors)
  medium: { width: [28, 45], depth: [32, 50], aspectRange: [0.5, 1.5] },
  // Large: apartments, offices
  large: { width: [50, 80], depth: [40, 70], aspectRange: [0.4, 2.0] },
  // Tower: tall and narrow (4+ floors) - SMALLER footprint for verticality
  tower: { width: [20, 35], depth: [20, 35], aspectRange: [0.8, 1.2] },
  // Slim tower: very tall (6+ floors) - even narrower
  slimTower: { width: [18, 28], depth: [18, 28], aspectRange: [0.9, 1.1] },
  // Linear: long and narrow
  linear: { width: [16, 30], depth: [60, 120], aspectRange: [0.15, 0.4] },
  // Monolith low: bold singular form (1-2 floors)
  monolithLow: { width: [35, 50], depth: [35, 50], aspectRange: [0.8, 1.2] },
  // Monolith tower: tall monolith (3+ floors) - narrower for verticality
  monolithTower: { width: [22, 32], depth: [22, 32], aspectRange: [0.85, 1.15] }
};

function getBuildingScale(archetype, params) {
  // Determine scale based on archetype and parameters
  const strategy = archetype.massing?.strategy || 'pure_volumes';
  const floors = params.floors || 3;

  // Brutalist/monolith: narrower when taller for proper proportions
  if (strategy === 'carved_monolith') {
    if (floors >= 4) return BUILDING_SCALES.monolithTower;
    if (floors >= 3) return BUILDING_SCALES.monolithTower;
    return BUILDING_SCALES.monolithLow;
  }

  // Parametric stacked: tower when 4+ floors
  if (strategy === 'stack_and_shift') {
    if (floors >= 6) return BUILDING_SCALES.slimTower;
    if (floors >= 4) return BUILDING_SCALES.tower;
    return BUILDING_SCALES.medium;
  }

  if (strategy === 'additive_rooms') return BUILDING_SCALES.medium;
  if (strategy === 'frame_and_infill') return floors >= 4 ? BUILDING_SCALES.tower : BUILDING_SCALES.large;
  if (strategy === 'flowing_shell') return BUILDING_SCALES.medium;

  // General floor-based scaling
  if (floors === 1) return BUILDING_SCALES.small;
  if (floors >= 6) return BUILDING_SCALES.slimTower;
  if (floors >= 4) return BUILDING_SCALES.tower;

  return BUILDING_SCALES.medium;
}

/**
 * Generate building from archetype result.
 * This is the main entry point for the new prompt-driven system.
 */
export function generateFromArchetype(archetypeResult = null, polygon = null) {
  const result = archetypeResult || currentArchetypeResult;
  const usePolygon = polygon || currentPolygon;

  if (!result || !usePolygon || !buildingGroup) {
    return null;
  }

  // Hide selection helper while generating new building
  hideSelectionHelper();

  // Ensure buildingMeshGroup exists
  if (!buildingMeshGroup) {
    buildingMeshGroup = new THREE.Group();
    buildingGroup.add(buildingMeshGroup);
  }

  // Clear existing building geometry (keep ground display separate)
  while (buildingMeshGroup.children.length > 0) {
    buildingMeshGroup.remove(buildingMeshGroup.children[0]);
  }

  // Seed RNG for this building (do this before calculating dimensions)
  const tileSeed = usePolygon.tiles?.reduce((s, t) => s + t.gx * 1000 + t.gy, 0) || Date.now();
  seed(tileSeed + previewBuildings.length * 12345); // Different seed for each building

  // Get archetype definition
  const archetype = result.archetypeDefinition;
  const params = result.parameters;
  const features = result.features || {};
  const mutations = result.mutations || {};

  // Get REALISTIC building dimensions based on archetype
  const scale = getBuildingScale(archetype, params);
  const buildingW = rr(scale.width[0], scale.width[1]);
  const buildingD = rr(scale.depth[0], scale.depth[1]);

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDING CATEGORY SELECTION (tower vs shed)
  // ═══════════════════════════════════════════════════════════════════════════
  const buildingCategory = selectBuildingCategory(archetype, result?.name || '');
  const isShed = buildingCategory === 'shed';

  // Get typology early so we can apply height limits
  let typology;
  if (isShed) {
    typology = selectShedTypology(archetype, result?.name || '');
  } else {
    typology = selectTowerTypology(archetype, params.floors || 3, result?.name || '');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLOOR COUNT (using proper height ranges per category)
  // ═══════════════════════════════════════════════════════════════════════════
  let floors;

  if (isShed) {
    // Sheds: max 6 floors, use shed typology limits
    const shedDef = SHED_TYPOLOGIES[typology] || SHED_TYPOLOGIES.sculptural;
    const maxFloors = Math.min(6, shedDef.maxFloors || 4);
    floors = ri(1, maxFloors);
  } else {
    // Towers: use TOWER_HEIGHT_RANGES for proper min/max per category
    const heightRange = TOWER_HEIGHT_RANGES[typology] || { min: 4, max: 20 };
    // Random floor count within the range, with slight variation
    floors = ri(heightRange.min, heightRange.max);
  }

  const floorH = params.floorHeight || 12;
  const totalHeight = floors * floorH;

  // Find spawn location - if there are existing buildings, find an empty spot with padding
  let spawnOffset;
  if (previewBuildings.length > 0) {
    // Use findEmptySpawnLocation for subsequent buildings (25ft padding for skyscrapers)
    spawnOffset = findEmptySpawnLocation(buildingW, buildingD, 25);
  } else {
    // First building - small random offset from center
    const bounds = usePolygon.bounds;
    const maxOffsetX = Math.max(0, (bounds.width - buildingW) / 2 - 10);
    const maxOffsetZ = Math.max(0, (bounds.height - buildingD) / 2 - 10);
    spawnOffset = {
      x: rr(-maxOffsetX * 0.3, maxOffsetX * 0.3),
      z: rr(-maxOffsetZ * 0.3, maxOffsetZ * 0.3)
    };
  }

  // Set building offset and transform
  buildingOffset = { x: spawnOffset.x, z: spawnOffset.z };
  buildingRotation = 0;
  buildingMeshGroup.position.set(spawnOffset.x, 0, spawnOffset.z);
  buildingMeshGroup.rotation.set(0, 0, 0);

  const offsetX = spawnOffset.x;
  const offsetZ = spawnOffset.z;

  // Create building polygon (rectangular, properly sized)
  const buildingPolygon = createBuildingPolygon(buildingW, buildingD, offsetX, offsetZ);

  // Get material functions based on archetype
  const primaryMatFn = getArchetypeMaterial(archetype, 'primary');
  const secondaryMatFn = getArchetypeMaterial(archetype, 'secondary');
  const accentMatFn = getArchetypeMaterial(archetype, 'accent');
  const glassMatFn = () => MATS.glass_dark();

  let baseY = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDING GENERATION (route to appropriate generator)
  // ═══════════════════════════════════════════════════════════════════════════

  if (isShed) {
    // SHED: flat, object-like buildings (museums, libraries, schools, etc.)
    generateShedBuilding(buildingMeshGroup, buildingW, buildingD, floors, floorH, typology, archetype);

    const footprintArea = buildingW * buildingD;
    const grossArea = footprintArea * floors;
    const totalHeightShed = floors * floorH;

    const stats = {
      footprintArea: Math.round(footprintArea),
      grossArea: Math.round(grossArea),
      floors: floors,
      height: Math.round(totalHeightShed),
      archetype: archetype.name,
      archetypeId: archetype.id,
      category: 'shed',
      typology: typology,
      name: result.name,
      description: result.description,
      designer_intent: result.designer_intent,
      value_system_critique: result.value_system_critique,
      polygon: buildingPolygon
    };

    currentBuildingStats = stats;
    fitCameraToBuilding();
    return stats;
  }

  // TOWER: vertical buildings (offices, residential, hotels)
  const isTower = floors >= 4 || !isShed;
  if (isTower) {
    generateSkyscraperTower(buildingMeshGroup, buildingW, buildingD, floors, floorH, typology);

    const footprintArea = buildingW * buildingD;
    const grossArea = footprintArea * floors;
    const totalHeightTower = floors * floorH;

    const stats = {
      footprintArea: Math.round(footprintArea),
      grossArea: Math.round(grossArea),
      floors: floors,
      height: Math.round(totalHeightTower),
      archetype: archetype.name,
      archetypeId: archetype.id,
      category: 'tower',
      typology: typology,
      name: result.name,
      description: result.description,
      designer_intent: result.designer_intent,
      value_system_critique: result.value_system_critique,
      polygon: buildingPolygon
    };

    currentBuildingStats = stats;
    fitCameraToBuilding();
    return stats;
  }

  // Handle pilotis (only for non-tower buildings)
  if (features.pilotis?.enabled) {
    const pilotisH = features.pilotis.height || 10;
    baseY = pilotisH;
    addArchetypePilotis(buildingMeshGroup, buildingPolygon, pilotisH, archetype, secondaryMatFn);
  }

  // Generate massing based on archetype strategy (non-tower buildings)
  switch (archetype.massing.strategy) {
      case 'stack_and_shift':
        generateStackedMassing(buildingMeshGroup, buildingPolygon, floors, floorH, baseY, params, features, archetype, primaryMatFn, secondaryMatFn);
        break;

      case 'carved_monolith':
        generateCarvedMassing(buildingMeshGroup, buildingPolygon, totalHeight, baseY, features, archetype, primaryMatFn);
        break;

      case 'flowing_shell':
        generateOrganicMassing(buildingMeshGroup, buildingPolygon, totalHeight, baseY, features, archetype, primaryMatFn, secondaryMatFn);
        break;

      case 'additive_rooms':
        generateAdditiveMassing(buildingMeshGroup, buildingPolygon, floors, floorH, baseY, features, archetype, primaryMatFn, secondaryMatFn);
        break;

      case 'frame_and_infill':
        generateFrameMassing(buildingMeshGroup, buildingPolygon, floors, floorH, baseY, features, archetype, primaryMatFn, secondaryMatFn, glassMatFn);
        break;

      case 'pure_volumes':
        generateMinimalistMassing(buildingMeshGroup, buildingPolygon, totalHeight, baseY, features, archetype, primaryMatFn);
        break;

      default:
        // Default: simple extrusion with facade detail
        extrudePolygonWithDetail(buildingMeshGroup, buildingPolygon, totalHeight, baseY, primaryMatFn, archetype);
  }

  // Add cantilever if enabled
  if (features.cantilever?.enabled) {
    addArchetypeCantilever(buildingMeshGroup, buildingPolygon, features.cantilever, totalHeight, baseY, archetype, primaryMatFn, secondaryMatFn);
  }

  // Add courtyard if enabled
  if (features.courtyard?.enabled) {
    addArchetypeCourtyard(buildingMeshGroup, buildingPolygon, features.courtyard, totalHeight, baseY, archetype);
  }

  // Add tower if enabled
  if (features.tower?.enabled) {
    addArchetypeTower(buildingMeshGroup, buildingPolygon, features.tower, floorH, totalHeight, baseY, archetype, primaryMatFn);
  }

  // Add roof based on archetype (skip for brutalist - already has roof slab)
  if (archetype.massing.strategy !== 'carved_monolith') {
    addArchetypeRoof(buildingMeshGroup, buildingPolygon, result.roof, totalHeight, baseY, archetype, secondaryMatFn, primaryMatFn);
  }

  // Add facade detail for non-brutalist (brutalist has its own board-form lines)
  if (archetype.massing.strategy !== 'carved_monolith') {
    addFacadeDetail(buildingMeshGroup, buildingPolygon, totalHeight, baseY, floors, floorH, archetype);
  }

  // NO applied windows - voids are carved into the walls for brutalist
  // Other archetypes can have fenestration if needed in future

  // Calculate stats
  const footprintArea = buildingW * buildingD;
  const grossArea = footprintArea * floors;

  const stats = {
    footprintArea: Math.round(footprintArea),
    grossArea: Math.round(grossArea),
    footprint: Math.round(footprintArea),
    floors: floors,
    height: Math.round(totalHeight + baseY),
    archetype: archetype.name,
    archetypeId: archetype.id,
    typology: result.typology || archetype.typology || 'structure',
    name: result.name,
    description: result.description,
    designer_intent: result.designer_intent,
    value_system_critique: result.value_system_critique,
    polygon: buildingPolygon,
    genes: {
      materialPalette: result.materialPalette || { primary: 'timber', secondary: 'stone' },
      roofForm: result.roofForm || archetype.roof?.form || 'flat',
      floors: { preferred: floors }
    },
    formData: {
      geometry: buildingPolygon,
      dimensions: { width: buildingW, depth: buildingD, height: totalHeight }
    }
  };

  // Store for collision detection with multiple buildings
  currentBuildingStats = stats;

  // Auto-fit camera to show entire building
  fitCameraToBuilding();

  return stats;
}

/**
 * Create a rectangular building polygon with given dimensions and offset.
 */
function createBuildingPolygon(width, depth, offsetX, offsetZ) {
  const hw = width / 2;
  const hd = depth / 2;

  const vertices = [
    { x: -hw + offsetX, y: -hd + offsetZ },
    { x:  hw + offsetX, y: -hd + offsetZ },
    { x:  hw + offsetX, y:  hd + offsetZ },
    { x: -hw + offsetX, y:  hd + offsetZ }
  ];

  return {
    vertices,
    bounds: {
      minX: -hw + offsetX,
      maxX:  hw + offsetX,
      minY: -hd + offsetZ,
      maxY:  hd + offsetZ,
      width: width,
      height: depth
    },
    centroid: { x: offsetX, y: offsetZ },
    area: width * depth,
    shapeType: 'rect'
  };
}

/**
 * Scale and offset polygon within boundary.
 */
function scaleAndOffsetPolygon(polygon, scale, offsetX, offsetZ) {
  const cx = polygon.centroid?.x || 0;
  const cy = polygon.centroid?.y || 0;

  const scaledVertices = polygon.vertices.map(v => ({
    x: cx + (v.x - cx) * scale + offsetX,
    y: cy + (v.y - cy) * scale + offsetZ
  }));

  const newBounds = {
    minX: Math.min(...scaledVertices.map(v => v.x)),
    maxX: Math.max(...scaledVertices.map(v => v.x)),
    minY: Math.min(...scaledVertices.map(v => v.y)),
    maxY: Math.max(...scaledVertices.map(v => v.y))
  };
  newBounds.width = newBounds.maxX - newBounds.minX;
  newBounds.height = newBounds.maxY - newBounds.minY;

  return {
    ...polygon,
    vertices: scaledVertices,
    bounds: newBounds,
    area: polygon.area * scale * scale
  };
}

/**
 * Extrude polygon with facade detail (panel lines, reveals).
 */
function extrudePolygonWithDetail(group, polygon, height, baseY, matFn, archetype) {
  // Main volume
  extrudePolygon(group, polygon.vertices, height, baseY, matFn);

  // Add facade detail
  addFacadeDetail(group, polygon, height, baseY, Math.ceil(height / 12), 12, archetype);
}

/**
 * Add facade detail: panel lines, reveals, texture patterns.
 */
function addFacadeDetail(group, polygon, totalHeight, baseY, floors, floorH, archetype) {
  const bounds = polygon.bounds;
  const w = bounds.width;
  const d = bounds.height;
  const cx = polygon.centroid?.x || 0;
  const cz = polygon.centroid?.y || 0;

  const lineMat = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.3 });

  // Panel width based on archetype
  const panelW = archetype?.id === 'brutalist' ? rr(3, 5) : rr(4, 8);
  const panelH = floorH;

  // Horizontal floor lines (every floor)
  for (let f = 1; f < floors; f++) {
    const y = baseY + f * floorH;

    // Front and back
    for (const zOff of [-d / 2 + 0.1, d / 2 - 0.1]) {
      const pts = [
        new THREE.Vector3(cx - w / 2, y, cz + zOff),
        new THREE.Vector3(cx + w / 2, y, cz + zOff)
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(geo, lineMat));
    }

    // Left and right
    for (const xOff of [-w / 2 + 0.1, w / 2 - 0.1]) {
      const pts = [
        new THREE.Vector3(cx + xOff, y, cz - d / 2),
        new THREE.Vector3(cx + xOff, y, cz + d / 2)
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(geo, lineMat));
    }
  }

  // Vertical panel lines (front and back facades)
  const numPanelsW = Math.floor(w / panelW);
  for (let i = 1; i < numPanelsW; i++) {
    const x = cx - w / 2 + i * panelW;
    for (const zOff of [-d / 2 + 0.1, d / 2 - 0.1]) {
      const pts = [
        new THREE.Vector3(x, baseY, cz + zOff),
        new THREE.Vector3(x, baseY + totalHeight, cz + zOff)
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(geo, lineMat));
    }
  }

  // Vertical panel lines (left and right facades)
  const numPanelsD = Math.floor(d / panelW);
  for (let i = 1; i < numPanelsD; i++) {
    const z = cz - d / 2 + i * panelW;
    for (const xOff of [-w / 2 + 0.1, w / 2 - 0.1]) {
      const pts = [
        new THREE.Vector3(cx + xOff, baseY, z),
        new THREE.Vector3(cx + xOff, baseY + totalHeight, z)
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(geo, lineMat));
    }
  }

  // Add reveal/shadow lines at base and top
  const revealMat = new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.5 });
  const revealY = [baseY + 0.3, baseY + totalHeight - 0.3];

  for (const y of revealY) {
    // Full perimeter reveal
    const pts = [
      new THREE.Vector3(cx - w / 2, y, cz - d / 2),
      new THREE.Vector3(cx + w / 2, y, cz - d / 2),
      new THREE.Vector3(cx + w / 2, y, cz + d / 2),
      new THREE.Vector3(cx - w / 2, y, cz + d / 2),
      new THREE.Vector3(cx - w / 2, y, cz - d / 2)
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    group.add(new THREE.Line(geo, revealMat));
  }
}

/**
 * Get material function for archetype.
 */
function getArchetypeMaterial(archetype, type) {
  const color = archetype.colors?.[type] || archetype.colors?.primary || 0xCCCCCC;

  // Create material with archetype color
  return () => new THREE.MeshStandardMaterial({
    color: color,
    roughness: type === 'glass' ? 0.1 : 0.7,
    metalness: type === 'structure' || type === 'accent' ? 0.3 : 0.1
  });
}

/**
 * Add pilotis for archetype.
 */
function addArchetypePilotis(group, polygon, height, archetype, matFn) {
  const bounds = polygon.bounds;
  const spacing = 20;
  const nColsX = Math.max(2, Math.ceil(bounds.width / spacing));
  const nColsZ = Math.max(2, Math.ceil(bounds.height / spacing));

  // Determine column form based on archetype
  const columnForms = archetype.structure?.columnForms || ['round'];
  const columnForm = columnForms[Math.floor(rnd() * columnForms.length)];

  for (let ix = 0; ix < nColsX; ix++) {
    for (let iz = 0; iz < nColsZ; iz++) {
      const cx = bounds.minX + (ix + 0.5) * (bounds.width / nColsX);
      const cz = bounds.minY + (iz + 0.5) * (bounds.height / nColsZ);

      if (columnForm === 'V') {
        // V-shaped column
        addVColumn(group, cx, cz, height, matFn);
      } else if (columnForm === 'Y') {
        // Y-shaped column (tree-like)
        addYColumn(group, cx, cz, height, matFn);
      } else {
        // Round column
        const col = tube([cx, 0, cz], [cx, height, cz], 1.2, matFn());
        if (col) group.add(col);
      }
    }
  }
}

/**
 * Add V-shaped column.
 */
function addVColumn(group, cx, cz, height, matFn) {
  const spread = 4;
  const col1 = tube([cx - spread, 0, cz], [cx, height, cz], 0.8, matFn());
  const col2 = tube([cx + spread, 0, cz], [cx, height, cz], 0.8, matFn());
  if (col1) group.add(col1);
  if (col2) group.add(col2);
}

/**
 * Add Y-shaped column.
 */
function addYColumn(group, cx, cz, height, matFn) {
  const branchH = height * 0.6;
  const spread = 3;

  // Main trunk
  const trunk = tube([cx, 0, cz], [cx, branchH, cz], 1.0, matFn());
  if (trunk) group.add(trunk);

  // Branches
  const b1 = tube([cx, branchH, cz], [cx - spread, height, cz - spread], 0.6, matFn());
  const b2 = tube([cx, branchH, cz], [cx + spread, height, cz - spread], 0.6, matFn());
  const b3 = tube([cx, branchH, cz], [cx, height, cz + spread], 0.6, matFn());
  if (b1) group.add(b1);
  if (b2) group.add(b2);
  if (b3) group.add(b3);
}

// ── MASSING GENERATORS BY ARCHETYPE ────────────────────────────────────

/**
 * PARAMETRIC: Stacked and shifted volumes.
 */
function generateStackedMassing(group, polygon, floors, floorH, baseY, params, features, archetype, primaryMatFn, secondaryMatFn) {
  const bounds = polygon.bounds;
  const w = bounds.width;
  const d = bounds.height;

  // Generate stacked volumes
  let currentY = baseY;
  let currentW = w;
  let currentD = d;
  let currentOffsetX = 0;
  let currentOffsetZ = 0;

  const stackCount = Math.ceil(floors / 2);

  for (let i = 0; i < stackCount; i++) {
    const stackFloors = i < stackCount - 1 ? 2 : floors - i * 2;
    const stackHeight = stackFloors * floorH;

    // Create box for this stack
    const boxGeo = new THREE.BoxGeometry(currentW, stackHeight, currentD);
    const box = new THREE.Mesh(boxGeo, primaryMatFn());
    box.position.set(currentOffsetX, currentY + stackHeight / 2, currentOffsetZ);
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);

    currentY += stackHeight;

    // Apply shift for next stack
    if (i < stackCount - 1 && archetype.massing.rules?.stackedVolumes) {
      const shiftRange = archetype.massing.rules.stackedVolumes.shiftX || [-0.2, 0.2];
      const scaleRange = archetype.massing.rules.stackedVolumes.scale || [0.8, 1.0];

      currentOffsetX += (rnd() * (shiftRange[1] - shiftRange[0]) + shiftRange[0]) * w * 0.3;
      currentOffsetZ += (rnd() * (shiftRange[1] - shiftRange[0]) + shiftRange[0]) * d * 0.3;

      const scaleFactor = rnd() * (scaleRange[1] - scaleRange[0]) + scaleRange[0];
      currentW *= scaleFactor;
      currentD *= scaleFactor;
    }
  }
}

/**
 * BRUTALIST: Monolithic volume with ORGANIC PUNCHED VOIDS you can see through.
 * No windows - just sculptural light slots carved into solid concrete.
 * Board-formed texture lines for material authenticity.
 * Edge-drawn aesthetic matching streetview.
 */
function generateCarvedMassing(group, polygon, height, baseY, features, archetype, primaryMatFn) {
  const bounds = polygon.bounds;
  const w = bounds.width;
  const d = bounds.height;
  const cx = polygon.centroid?.x || 0;
  const cz = polygon.centroid?.y || 0;

  // Light concrete - matches streetview aesthetic
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xD8D8D0, // Light warm gray
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide
  });

  // Slightly darker for depth/shadow areas
  const concreteAccent = new THREE.MeshStandardMaterial({
    color: 0xC8C8C0,
    roughness: 0.9,
    metalness: 0.0
  });

  // Create monolith as 4 walls (so we can punch through)
  const wallThickness = rr(1.5, 2.5);

  // Generate organic void positions for each wall
  const voids = generateOrganicVoids(w, d, height, baseY);

  // Front wall (positive Z) with punched voids
  createWallWithVoids(group, {
    width: w,
    height: height,
    thickness: wallThickness,
    position: new THREE.Vector3(cx, baseY + height / 2, cz + d / 2 - wallThickness / 2),
    rotation: 0,
    voids: voids.front,
    material: concreteMat
  });

  // Back wall (negative Z)
  createWallWithVoids(group, {
    width: w,
    height: height,
    thickness: wallThickness,
    position: new THREE.Vector3(cx, baseY + height / 2, cz - d / 2 + wallThickness / 2),
    rotation: 0,
    voids: voids.back,
    material: concreteMat
  });

  // Right wall (positive X)
  createWallWithVoids(group, {
    width: d,
    height: height,
    thickness: wallThickness,
    position: new THREE.Vector3(cx + w / 2 - wallThickness / 2, baseY + height / 2, cz),
    rotation: Math.PI / 2,
    voids: voids.right,
    material: concreteMat
  });

  // Left wall (negative X)
  createWallWithVoids(group, {
    width: d,
    height: height,
    thickness: wallThickness,
    position: new THREE.Vector3(cx - w / 2 + wallThickness / 2, baseY + height / 2, cz),
    rotation: Math.PI / 2,
    voids: voids.left,
    material: concreteMat
  });

  // Roof slab with slight overhang
  const overhang = 1;
  const roofGeo = new THREE.BoxGeometry(w + overhang * 2, wallThickness * 0.8, d + overhang * 2);
  const roof = new THREE.Mesh(roofGeo, concreteMat);
  roof.position.set(cx, baseY + height - wallThickness * 0.4, cz);
  roof.castShadow = true;
  group.add(roof);

  // Floor slab (visible from inside)
  const floorGeo = new THREE.BoxGeometry(w - wallThickness * 2, 0.5, d - wallThickness * 2);
  const floor = new THREE.Mesh(floorGeo, concreteMat);
  floor.position.set(cx, baseY + 0.25, cz);
  group.add(floor);

  // Ground floor / plinth with slight recess
  const plinthH = 1.5;
  const plinthMat = new THREE.MeshStandardMaterial({ color: 0xB8B8B0, roughness: 0.95 });
  const plinthGeo = new THREE.BoxGeometry(w + 0.2, plinthH, d + 0.2);
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.position.set(cx, baseY - plinthH / 2, cz);
  plinth.receiveShadow = true;
  group.add(plinth);

  // Door - recessed entry on front facade
  addBrutalistDoor(group, cx, cz, d, baseY, wallThickness, concreteMat);

  // Add board-formed concrete texture lines on ALL exterior faces
  addBoardFormLines(group, w, d, height, baseY, cx, cz, wallThickness);

  // Add edge lines for that drawn/sketch aesthetic
  addEdgeLines(group, w, d, height, baseY, cx, cz);
}

/**
 * Add a recessed brutalist door/entry.
 */
function addBrutalistDoor(group, cx, cz, d, baseY, wallThickness, concreteMat) {
  const doorW = rr(4, 6);
  const doorH = rr(9, 11);
  const recessDepth = rr(1.5, 2.5);

  // Dark recessed entry void
  const entryMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95 });
  const entryGeo = new THREE.BoxGeometry(doorW + 1, doorH + 0.5, recessDepth);
  const entry = new THREE.Mesh(entryGeo, entryMat);
  entry.position.set(cx, baseY + doorH / 2, cz + d / 2 - recessDepth / 2);
  group.add(entry);

  // Door frame lines
  const frameMat = new THREE.LineBasicMaterial({ color: 0x333333 });
  const framePoints = [
    new THREE.Vector3(cx - doorW / 2, baseY, cz + d / 2 + 0.1),
    new THREE.Vector3(cx - doorW / 2, baseY + doorH, cz + d / 2 + 0.1),
    new THREE.Vector3(cx + doorW / 2, baseY + doorH, cz + d / 2 + 0.1),
    new THREE.Vector3(cx + doorW / 2, baseY, cz + d / 2 + 0.1)
  ];
  const frameGeo = new THREE.BufferGeometry().setFromPoints(framePoints);
  group.add(new THREE.Line(frameGeo, frameMat));

  // Threshold/step
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xA0A098, roughness: 0.9 });
  const stepGeo = new THREE.BoxGeometry(doorW + 2, 0.4, 1.5);
  const step = new THREE.Mesh(stepGeo, stepMat);
  step.position.set(cx, baseY - 0.2, cz + d / 2 + 0.75);
  group.add(step);
}

/**
 * Add edge lines for sketch/drawn aesthetic.
 */
function addEdgeLines(group, w, d, height, baseY, cx, cz) {
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.7 });

  // Vertical corner edges
  const corners = [
    [cx - w / 2, cz - d / 2],
    [cx + w / 2, cz - d / 2],
    [cx + w / 2, cz + d / 2],
    [cx - w / 2, cz + d / 2]
  ];

  for (const [x, z] of corners) {
    const pts = [
      new THREE.Vector3(x, baseY, z),
      new THREE.Vector3(x, baseY + height, z)
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeMat));
  }

  // Top edges
  const topPts = corners.map(([x, z]) => new THREE.Vector3(x, baseY + height, z));
  topPts.push(topPts[0].clone());
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(topPts), edgeMat));

  // Bottom edges
  const botPts = corners.map(([x, z]) => new THREE.Vector3(x, baseY, z));
  botPts.push(botPts[0].clone());
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(botPts), edgeMat));
}

/**
 * Generate organic void shapes for brutalist walls.
 * Mix of circles, ellipses, and irregular rounded shapes.
 */
function generateOrganicVoids(w, d, height, baseY) {
  const voids = { front: [], back: [], left: [], right: [] };

  // Number of voids based on building size
  const numVoids = ri(2, 5);

  // Generate voids for front/back (width-based)
  for (let i = 0; i < numVoids; i++) {
    const voidType = pick(['circle', 'ellipse', 'slot', 'cross']);
    const void1 = createOrganicVoidShape(voidType, w, height);
    const void2 = createOrganicVoidShape(pick(['circle', 'ellipse', 'slot']), w, height);

    voids.front.push(void1);
    voids.back.push(void2);
  }

  // Generate voids for left/right (depth-based)
  for (let i = 0; i < Math.max(1, numVoids - 1); i++) {
    const voidType = pick(['circle', 'ellipse', 'slot']);
    const void1 = createOrganicVoidShape(voidType, d, height);
    const void2 = createOrganicVoidShape(pick(['circle', 'slot']), d, height);

    voids.left.push(void1);
    voids.right.push(void2);
  }

  return voids;
}

/**
 * Create an organic void shape definition.
 */
function createOrganicVoidShape(type, wallWidth, wallHeight) {
  const margin = 4;
  const maxW = wallWidth * 0.35;
  const maxH = wallHeight * 0.25;

  switch (type) {
    case 'circle':
      const radius = rr(2, Math.min(maxW, maxH) / 2);
      return {
        type: 'circle',
        x: rr(-wallWidth / 2 + margin + radius, wallWidth / 2 - margin - radius),
        y: rr(margin + radius, wallHeight - margin - radius),
        radius: radius
      };

    case 'ellipse':
      const rx = rr(2, maxW / 2);
      const ry = rr(3, maxH / 2);
      return {
        type: 'ellipse',
        x: rr(-wallWidth / 2 + margin + rx, wallWidth / 2 - margin - rx),
        y: rr(margin + ry, wallHeight - margin - ry),
        rx: rx,
        ry: ry,
        rotation: rr(-0.3, 0.3)
      };

    case 'slot':
      // Vertical or horizontal slot
      const isVertical = rnd() > 0.5;
      const slotW = isVertical ? rr(1.5, 3) : rr(4, maxW);
      const slotH = isVertical ? rr(6, maxH * 1.5) : rr(1.5, 3);
      return {
        type: 'slot',
        x: rr(-wallWidth / 2 + margin + slotW / 2, wallWidth / 2 - margin - slotW / 2),
        y: rr(margin + slotH / 2, wallHeight - margin - slotH / 2),
        width: slotW,
        height: slotH,
        cornerRadius: Math.min(slotW, slotH) * 0.3
      };

    case 'cross':
      const armW = rr(1.5, 2.5);
      const armL = rr(4, 8);
      return {
        type: 'cross',
        x: rr(-wallWidth / 2 + margin + armL / 2, wallWidth / 2 - margin - armL / 2),
        y: rr(margin + armL / 2, wallHeight - margin - armL / 2),
        armWidth: armW,
        armLength: armL
      };

    default:
      return createOrganicVoidShape('circle', wallWidth, wallHeight);
  }
}

/**
 * Create a wall with punched organic voids using THREE.Shape.
 */
function createWallWithVoids(group, config) {
  const { width, height, thickness, position, rotation, voids, material } = config;

  // Create wall shape
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height / 2);
  shape.lineTo(-width / 2, height / 2);
  shape.closePath();

  // Punch holes for each void
  for (const v of voids) {
    const hole = new THREE.Path();

    switch (v.type) {
      case 'circle':
        hole.absarc(v.x, v.y - height / 2, v.radius, 0, Math.PI * 2, false);
        break;

      case 'ellipse':
        hole.absellipse(v.x, v.y - height / 2, v.rx, v.ry, 0, Math.PI * 2, false, v.rotation || 0);
        break;

      case 'slot':
        // Rounded rectangle
        const hw = v.width / 2;
        const hh = v.height / 2;
        const r = v.cornerRadius || 0.5;
        const cy = v.y - height / 2;
        hole.moveTo(v.x - hw + r, cy - hh);
        hole.lineTo(v.x + hw - r, cy - hh);
        hole.quadraticCurveTo(v.x + hw, cy - hh, v.x + hw, cy - hh + r);
        hole.lineTo(v.x + hw, cy + hh - r);
        hole.quadraticCurveTo(v.x + hw, cy + hh, v.x + hw - r, cy + hh);
        hole.lineTo(v.x - hw + r, cy + hh);
        hole.quadraticCurveTo(v.x - hw, cy + hh, v.x - hw, cy + hh - r);
        hole.lineTo(v.x - hw, cy - hh + r);
        hole.quadraticCurveTo(v.x - hw, cy - hh, v.x - hw + r, cy - hh);
        break;

      case 'cross':
        // Cross shape
        const aw = v.armWidth / 2;
        const al = v.armLength / 2;
        const ccY = v.y - height / 2;
        hole.moveTo(v.x - aw, ccY - al);
        hole.lineTo(v.x + aw, ccY - al);
        hole.lineTo(v.x + aw, ccY - aw);
        hole.lineTo(v.x + al, ccY - aw);
        hole.lineTo(v.x + al, ccY + aw);
        hole.lineTo(v.x + aw, ccY + aw);
        hole.lineTo(v.x + aw, ccY + al);
        hole.lineTo(v.x - aw, ccY + al);
        hole.lineTo(v.x - aw, ccY + aw);
        hole.lineTo(v.x - al, ccY + aw);
        hole.lineTo(v.x - al, ccY - aw);
        hole.lineTo(v.x - aw, ccY - aw);
        hole.closePath();
        break;
    }

    shape.holes.push(hole);
  }

  // Extrude the wall with holes
  const extrudeSettings = { depth: thickness, bevelEnabled: false };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.rotation.y = rotation;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/**
 * Add board-formed concrete texture lines to exterior walls.
 * Subtle lines on light concrete for that cast-in-place look.
 */
function addBoardFormLines(group, w, d, height, baseY, cx, cz, wallThickness) {
  const boardH = rr(1.0, 1.5); // Board height - tighter spacing
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x999990, // Subtle on light concrete
    transparent: true,
    opacity: 0.35
  });

  // Horizontal lines on all faces
  for (let y = baseY + boardH; y < baseY + height; y += boardH) {
    // Front face
    const frontPts = [
      new THREE.Vector3(cx - w / 2, y, cz + d / 2),
      new THREE.Vector3(cx + w / 2, y, cz + d / 2)
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(frontPts), lineMat));

    // Back face
    const backPts = [
      new THREE.Vector3(cx - w / 2, y, cz - d / 2),
      new THREE.Vector3(cx + w / 2, y, cz - d / 2)
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(backPts), lineMat));

    // Left face
    const leftPts = [
      new THREE.Vector3(cx - w / 2, y, cz - d / 2),
      new THREE.Vector3(cx - w / 2, y, cz + d / 2)
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), lineMat));

    // Right face
    const rightPts = [
      new THREE.Vector3(cx + w / 2, y, cz - d / 2),
      new THREE.Vector3(cx + w / 2, y, cz + d / 2)
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rightPts), lineMat));
  }
}

/**
 * ORGANIC: Flowing curved forms.
 */
function generateOrganicMassing(group, polygon, height, baseY, features, archetype, primaryMatFn, secondaryMatFn) {
  // For organic, we simplify to a curved-corner extrusion
  // In a full implementation, this would use shell geometry

  // Create rounded rectangle approximation
  const bounds = polygon.bounds;
  const w = bounds.width;
  const d = bounds.height;
  const cornerRadius = Math.min(w, d) * 0.2;

  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;

  shape.moveTo(x + cornerRadius, -y);
  shape.lineTo(x + w - cornerRadius, -y);
  shape.quadraticCurveTo(x + w, -y, x + w, -(y + cornerRadius));
  shape.lineTo(x + w, -(y + d - cornerRadius));
  shape.quadraticCurveTo(x + w, -(y + d), x + w - cornerRadius, -(y + d));
  shape.lineTo(x + cornerRadius, -(y + d));
  shape.quadraticCurveTo(x, -(y + d), x, -(y + d - cornerRadius));
  shape.lineTo(x, -(y + cornerRadius));
  shape.quadraticCurveTo(x, -y, x + cornerRadius, -y);

  const extrudeSettings = { depth: height, bevelEnabled: false };
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, primaryMatFn());
  mesh.position.y = baseY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/**
 * VERNACULAR: Additive rooms with pitched roofs.
 */
function generateAdditiveMassing(group, polygon, floors, floorH, baseY, features, archetype, primaryMatFn, secondaryMatFn) {
  const bounds = polygon.bounds;
  const w = bounds.width;
  const d = bounds.height;

  // Main volume
  const mainHeight = floors * floorH;
  const mainW = w * 0.7;
  const mainD = d * 0.8;

  const mainGeo = new THREE.BoxGeometry(mainW, mainHeight, mainD);
  const mainMesh = new THREE.Mesh(mainGeo, primaryMatFn());
  mainMesh.position.set(0, baseY + mainHeight / 2, 0);
  mainMesh.castShadow = true;
  mainMesh.receiveShadow = true;
  group.add(mainMesh);

  // Addition (wing)
  if (archetype.massing.rules?.additions?.probability > rnd()) {
    const addW = mainW * 0.6;
    const addD = mainD * 0.4;
    const addHeight = mainHeight * 0.7;

    const addGeo = new THREE.BoxGeometry(addW, addHeight, addD);
    const addMesh = new THREE.Mesh(addGeo, primaryMatFn());
    addMesh.position.set(mainW / 2 + addW / 2 - 2, baseY + addHeight / 2, mainD / 2 - addD / 2);
    addMesh.castShadow = true;
    addMesh.receiveShadow = true;
    group.add(addMesh);
  }
}

/**
 * INDUSTRIAL: Exposed frame with infill.
 */
function generateFrameMassing(group, polygon, floors, floorH, baseY, features, archetype, primaryMatFn, secondaryMatFn, glassMatFn) {
  const bounds = polygon.bounds;
  const w = bounds.width;
  const d = bounds.height;
  const height = floors * floorH;

  // Structural frame
  const frameSize = 1.5;
  const gridX = Math.ceil(w / 20);
  const gridZ = Math.ceil(d / 20);

  // Columns
  for (let ix = 0; ix <= gridX; ix++) {
    for (let iz = 0; iz <= gridZ; iz++) {
      const cx = bounds.minX + ix * (w / gridX);
      const cz = bounds.minY + iz * (d / gridZ);

      const colGeo = new THREE.BoxGeometry(frameSize, height, frameSize);
      const col = new THREE.Mesh(colGeo, secondaryMatFn());
      col.position.set(cx, baseY + height / 2, cz);
      col.castShadow = true;
      group.add(col);
    }
  }

  // Floor beams
  for (let f = 0; f <= floors; f++) {
    const beamY = baseY + f * floorH;

    // X-direction beams
    for (let iz = 0; iz <= gridZ; iz++) {
      const cz = bounds.minY + iz * (d / gridZ);
      const beamGeo = new THREE.BoxGeometry(w, frameSize * 0.6, frameSize * 0.6);
      const beam = new THREE.Mesh(beamGeo, secondaryMatFn());
      beam.position.set(0, beamY, cz);
      group.add(beam);
    }
  }

  // Infill panels
  const panelInset = 0.5;
  for (let f = 0; f < floors; f++) {
    const panelY = baseY + f * floorH + floorH / 2;

    // Front and back infill
    for (const side of [-1, 1]) {
      const panelGeo = new THREE.BoxGeometry(w - frameSize * 2, floorH - frameSize, 0.3);
      const panel = new THREE.Mesh(panelGeo, glassMatFn());
      panel.position.set(0, panelY, (d / 2 - panelInset) * side);
      group.add(panel);
    }
  }
}

/**
 * MINIMALIST: Pure volumes with precise proportions.
 */
function generateMinimalistMassing(group, polygon, height, baseY, features, archetype, primaryMatFn) {
  // Simple, pure extrusion
  extrudePolygon(group, polygon.vertices, height, baseY, primaryMatFn);
}

// ── FEATURE ADDITIONS ────────────────────────────────────────────────

/**
 * Add cantilever to building.
 */
function addArchetypeCantilever(group, polygon, cantilever, height, baseY, archetype, primaryMatFn, secondaryMatFn) {
  const bounds = polygon.bounds;
  const amount = cantilever.amount || 0.2;
  const direction = cantilever.direction || 'south';

  const cantileverW = bounds.width * 0.6;
  const cantileverD = bounds.height * amount;
  const cantileverH = height * 0.4;

  const geo = new THREE.BoxGeometry(cantileverW, cantileverH, cantileverD);
  const mesh = new THREE.Mesh(geo, primaryMatFn());

  let posZ = 0;
  if (direction === 'south') posZ = bounds.height / 2 + cantileverD / 2 - 2;
  else if (direction === 'north') posZ = -bounds.height / 2 - cantileverD / 2 + 2;

  mesh.position.set(0, baseY + height - cantileverH / 2, posZ);
  mesh.castShadow = true;
  group.add(mesh);

  // Support structure
  if (archetype.structure?.cantileverSupport?.visible) {
    const supportGeo = new THREE.BoxGeometry(2, cantileverH * 0.8, cantileverD);
    const support = new THREE.Mesh(supportGeo, secondaryMatFn());
    support.position.set(cantileverW / 2 - 3, baseY + height - cantileverH * 0.6, posZ);
    support.rotation.z = Math.PI * 0.1;
    group.add(support);
  }
}

/**
 * Add courtyard void.
 */
function addArchetypeCourtyard(group, polygon, courtyard, height, baseY, archetype) {
  // Courtyard is represented as a dark void in the center
  const bounds = polygon.bounds;
  const size = courtyard.size || 0.25;

  const voidW = bounds.width * size;
  const voidD = bounds.height * size;

  const voidGeo = new THREE.BoxGeometry(voidW, height + 1, voidD);
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const voidMesh = new THREE.Mesh(voidGeo, voidMat);
  voidMesh.position.set(0, baseY + height / 2, 0);
  group.add(voidMesh);
}

/**
 * Add tower element.
 */
function addArchetypeTower(group, polygon, tower, floorH, mainHeight, baseY, archetype, primaryMatFn) {
  const bounds = polygon.bounds;
  const position = tower.position || 'corner';
  const extraFloors = tower.extraFloors || 2;
  const towerHeight = mainHeight + extraFloors * floorH;

  const towerW = Math.min(bounds.width, bounds.height) * 0.3;

  let posX = 0, posZ = 0;
  if (position === 'corner') {
    posX = bounds.width / 2 - towerW / 2;
    posZ = bounds.height / 2 - towerW / 2;
  }

  const towerGeo = new THREE.BoxGeometry(towerW, towerHeight, towerW);
  const towerMesh = new THREE.Mesh(towerGeo, primaryMatFn());
  towerMesh.position.set(posX, baseY + towerHeight / 2, posZ);
  towerMesh.castShadow = true;
  group.add(towerMesh);
}

/**
 * Add roof based on archetype and params.
 */
function addArchetypeRoof(group, polygon, roofParams, height, baseY, archetype, roofMatFn, primaryMatFn) {
  const roofType = roofParams?.type || archetype.roof?.type || 'flat';
  const bounds = polygon.bounds;
  const w = bounds.width;
  const d = bounds.height;
  const cx = polygon.centroid?.x || 0;
  const cz = polygon.centroid?.y || 0;
  const roofY = baseY + height;

  switch (roofType) {
    case 'pitched':
      const pitch = roofParams?.pitch || 35;
      const roofH = Math.min(w, d) * 0.5 * Math.tan(pitch * Math.PI / 180);
      const pitchedRoof = createPitchedRoofGeometry(w + 4, d + 4, roofH, roofMatFn());
      pitchedRoof.position.set(cx, roofY, cz);
      group.add(pitchedRoof);
      break;

    case 'shed':
      const shedH = d * 0.15;
      const shedShape = new THREE.Shape();
      shedShape.moveTo(-w / 2 - 2, -d / 2 - 2);
      shedShape.lineTo(w / 2 + 2, -d / 2 - 2);
      shedShape.lineTo(w / 2 + 2, d / 2 + 2);
      shedShape.lineTo(-w / 2 - 2, d / 2 + 2);
      shedShape.closePath();

      const shedGeo = new THREE.ExtrudeGeometry(shedShape, { depth: 1, bevelEnabled: false });
      shedGeo.rotateX(-Math.PI / 2);
      const shedMesh = new THREE.Mesh(shedGeo, roofMatFn());
      shedMesh.position.set(cx, roofY, cz);
      group.add(shedMesh);
      break;

    case 'sawtooth':
      addSawtoothRoof(group, polygon, { baseY: roofY, count: 3 }, roofMatFn, () => MATS.glass_dark());
      break;

    case 'flat':
    default:
      // Flat roof with thin parapet - CENTERED on building
      const parapetH = 2;
      const parapetThickness = 0.8;

      // Four parapet walls around perimeter
      const parapetMat = primaryMatFn();

      // Front parapet
      const frontParapet = new THREE.Mesh(
        new THREE.BoxGeometry(w + parapetThickness * 2, parapetH, parapetThickness),
        parapetMat
      );
      frontParapet.position.set(cx, roofY + parapetH / 2, cz + d / 2 + parapetThickness / 2);
      group.add(frontParapet);

      // Back parapet
      const backParapet = new THREE.Mesh(
        new THREE.BoxGeometry(w + parapetThickness * 2, parapetH, parapetThickness),
        parapetMat
      );
      backParapet.position.set(cx, roofY + parapetH / 2, cz - d / 2 - parapetThickness / 2);
      group.add(backParapet);

      // Left parapet
      const leftParapet = new THREE.Mesh(
        new THREE.BoxGeometry(parapetThickness, parapetH, d),
        parapetMat
      );
      leftParapet.position.set(cx - w / 2 - parapetThickness / 2, roofY + parapetH / 2, cz);
      group.add(leftParapet);

      // Right parapet
      const rightParapet = new THREE.Mesh(
        new THREE.BoxGeometry(parapetThickness, parapetH, d),
        parapetMat
      );
      rightParapet.position.set(cx + w / 2 + parapetThickness / 2, roofY + parapetH / 2, cz);
      group.add(rightParapet);

      // Roof surface
      const roofGeo = new THREE.BoxGeometry(w, 0.5, d);
      const roof = new THREE.Mesh(roofGeo, roofMatFn());
      roof.position.set(cx, roofY + 0.25, cz);
      group.add(roof);
      break;
  }
}

/**
 * Create simple pitched roof geometry.
 */
function createPitchedRoofGeometry(w, d, h, mat) {
  const roofGroup = new THREE.Group();

  // Ridge along Z axis
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(0, h);
  shape.lineTo(w / 2, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.translate(0, 0, -d / 2);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  roofGroup.add(mesh);

  return roofGroup;
}

/**
 * Add fenestration based on archetype - windows on ALL 4 sides with proper depth.
 */
function addArchetypeFenestration(group, polygon, height, baseY, floors, floorH, archetype, frameMatFn, glassMatFn) {
  const windowDensity = archetype.openings?.windows?.density || [0.3, 0.5];
  const density = windowDensity[0] + rnd() * (windowDensity[1] - windowDensity[0]);

  const bounds = polygon.bounds;
  const cx = polygon.centroid?.x || 0;
  const cz = polygon.centroid?.y || 0;
  const w = bounds.width;
  const d = bounds.height;

  // Window dimensions
  const windowW = rr(3, 5);
  const windowH = floorH * rr(0.45, 0.6);
  const windowDepth = rr(0.8, 1.5); // Recess depth
  const windowSpacing = rr(8, 14);

  // Materials - recess should be visible but shadowed, not pitch black
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.6 });
  const glassMat = MATS.glass_dark();
  const recessMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.95 }); // Lighter so depth shows

  // All 4 edges with normals pointing outward
  const edges = [
    // Front (positive Z)
    { start: { x: cx - w / 2, z: cz + d / 2 }, end: { x: cx + w / 2, z: cz + d / 2 }, normal: { x: 0, z: 1 }, axis: 'x' },
    // Back (negative Z)
    { start: { x: cx + w / 2, z: cz - d / 2 }, end: { x: cx - w / 2, z: cz - d / 2 }, normal: { x: 0, z: -1 }, axis: 'x' },
    // Right (positive X)
    { start: { x: cx + w / 2, z: cz - d / 2 }, end: { x: cx + w / 2, z: cz + d / 2 }, normal: { x: 1, z: 0 }, axis: 'z' },
    // Left (negative X)
    { start: { x: cx - w / 2, z: cz + d / 2 }, end: { x: cx - w / 2, z: cz - d / 2 }, normal: { x: -1, z: 0 }, axis: 'z' }
  ];

  for (const edge of edges) {
    const edgeLen = edge.axis === 'x'
      ? Math.abs(edge.end.x - edge.start.x)
      : Math.abs(edge.end.z - edge.start.z);

    const nWindows = Math.max(1, Math.floor(edgeLen / windowSpacing * density));

    for (let floor = 0; floor < floors; floor++) {
      const windowY = baseY + floor * floorH + floorH * 0.5;

      for (let wi = 0; wi < nWindows; wi++) {
        const t = (wi + 1) / (nWindows + 1);

        // Calculate position along edge
        let wx, wz;
        if (edge.axis === 'x') {
          wx = edge.start.x + (edge.end.x - edge.start.x) * t;
          wz = edge.start.z;
        } else {
          wx = edge.start.x;
          wz = edge.start.z + (edge.end.z - edge.start.z) * t;
        }

        // Create deeply recessed window (void -> frame -> glass)
        const recessW = windowW + 1;
        const recessH = windowH + 0.5;

        // 1. Dark recess void (pushed into the wall)
        const recessGeo = new THREE.BoxGeometry(
          edge.axis === 'x' ? recessW : windowDepth,
          recessH,
          edge.axis === 'z' ? recessW : windowDepth
        );
        const recess = new THREE.Mesh(recessGeo, recessMat);
        recess.position.set(
          wx - edge.normal.x * windowDepth * 0.4,
          windowY,
          wz - edge.normal.z * windowDepth * 0.4
        );
        group.add(recess);

        // 2. Window frame at the outer edge
        const frameThickness = 0.4;
        const frameGeo = new THREE.BoxGeometry(
          edge.axis === 'x' ? windowW + frameThickness : frameThickness,
          windowH + frameThickness,
          edge.axis === 'z' ? windowW + frameThickness : frameThickness
        );
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.set(
          wx + edge.normal.x * 0.1,
          windowY,
          wz + edge.normal.z * 0.1
        );
        group.add(frame);

        // 3. Glass pane set back into the recess
        const glassGeo = new THREE.BoxGeometry(
          edge.axis === 'x' ? windowW - 0.3 : 0.1,
          windowH - 0.3,
          edge.axis === 'z' ? windowW - 0.3 : 0.1
        );
        const glass = new THREE.Mesh(glassGeo, glassMat);
        glass.position.set(
          wx - edge.normal.x * windowDepth * 0.3,
          windowY,
          wz - edge.normal.z * windowDepth * 0.3
        );
        group.add(glass);
      }
    }
  }
}

/**
 * Export polygon data for storage in build record.
 */
export function getPolygonData() {
  if (!currentPolygon) return null;

  return {
    vertices: currentPolygon.vertices,
    bounds: currentPolygon.bounds,
    centroid: currentPolygon.centroid,
    area: currentPolygon.area,
    shapeType: currentPolygon.shapeType,
    tileCount: currentPolygon.tileCount,
    tiles: currentPolygon.tiles,
    worldOffset: currentPolygon.worldOffset
  };
}

/**
 * Export genes data for storage in build record.
 */
export function getGenesData() {
  return currentGenes;
}

// ══════════════════════════════════════════════════════════════════
// HEADLESS BUILDING GENERATION (for prepopulation)
// ══════════════════════════════════════════════════════════════════

/**
 * Generate a building headlessly (without canvas/DOM) for prepopulation.
 * Returns THREE.js meshes and ISO image data.
 *
 * @param {Object} config - Building configuration
 * @param {string} config.category - 'tower' or 'shed'
 * @param {string} config.typology - One of: masonry, commercial, sculptural, timber, brutalist
 * @param {number} config.floors - Number of floors
 * @param {number} config.width - Building width in feet
 * @param {number} config.depth - Building depth in feet
 * @param {number} config.floorHeight - Floor height in feet (default 12)
 * @param {number} config.seed - RNG seed for reproducible variation
 * @returns {Object} - { group: THREE.Group, isoImage: string, stats: Object }
 */
export function generateBuildingHeadless(config) {
  const {
    category = 'tower',
    typology = 'commercial',
    floors = 6,
    width = 50,
    depth = 40,
    floorHeight = 12,
    seed: buildingSeed = Date.now()
  } = config;

  // Seed RNG for this building
  seed(buildingSeed);

  // Create building group
  const group = new THREE.Group();

  // Generate building based on category
  if (category === 'shed') {
    generateShedBuilding(group, width, depth, floors, floorHeight, typology, null);
  } else {
    generateSkyscraperTower(group, width, depth, floors, floorHeight, typology);
  }

  // Calculate stats
  const footprintArea = width * depth;
  const grossArea = footprintArea * floors;
  const totalHeight = floors * floorHeight;

  const stats = {
    category,
    typology,
    floors,
    height: totalHeight,
    width,
    depth,
    footprintArea: Math.round(footprintArea),
    grossArea: Math.round(grossArea)
  };

  // Render ISO image
  const isoImage = renderGroupToIsoImage(group, 200, 300);

  return {
    group,
    isoImage,
    stats
  };
}

// Shared WebGL renderer for ISO image generation (avoids context limit)
let sharedIsoRenderer = null;
let sharedIsoScene = null;

function getSharedIsoRenderer(width, height) {
  if (!sharedIsoRenderer) {
    try {
      sharedIsoRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      });
    } catch (err) {
      console.warn('[FormGenerator] Failed to create shared WebGL renderer:', err);
      return null;
    }
  }
  sharedIsoRenderer.setSize(width, height);
  sharedIsoRenderer.setClearColor(0x000000, 0);
  return sharedIsoRenderer;
}

function getSharedIsoScene() {
  if (!sharedIsoScene) {
    sharedIsoScene = new THREE.Scene();
    sharedIsoScene.background = null;

    // Add lighting (persistent)
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(60, 100, 40);
    sun.name = 'sun';
    sharedIsoScene.add(sun);

    const fill = new THREE.DirectionalLight(0x8899aa, 0.5);
    fill.position.set(-40, 60, -30);
    fill.name = 'fill';
    sharedIsoScene.add(fill);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    ambient.name = 'ambient';
    sharedIsoScene.add(ambient);
  }
  return sharedIsoScene;
}

/**
 * Render a THREE.Group to an isometric image (internal helper).
 * Uses shared renderer to avoid WebGL context limits.
 */
function renderGroupToIsoImage(group, width = 200, height = 300) {
  // Check if group has any geometry
  if (!group || group.children.length === 0) {
    console.warn('[FormGenerator] Empty group for ISO render');
    return null;
  }

  const isoRenderer = getSharedIsoRenderer(width, height);
  if (!isoRenderer) return null;

  // Calculate bounds of the building
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) {
    return null;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Use shared scene (has persistent lighting)
  const isoScene = getSharedIsoScene();

  // Clone and add the group
  const cloned = group.clone(true);
  cloned.position.set(0, 0, 0);
  cloned.name = '_temp_building'; // Mark for cleanup
  isoScene.add(cloned);

  // Create orthographic camera for isometric view
  const aspect = width / height;
  const maxDim = Math.max(size.x, size.y, size.z);
  const frustumSize = maxDim * 1.5;

  const isoCamera = new THREE.OrthographicCamera(
    -frustumSize * aspect / 2,
    frustumSize * aspect / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    maxDim * 10
  );

  // Position camera for 2:1 dimetric projection (matching the map view)
  const distance = maxDim * 2;
  const isoAngle = Math.PI / 4; // 45 degrees horizontal
  const elevAngle = Math.atan(0.5); // ~26.57 degrees for 2:1 dimetric

  isoCamera.position.set(
    center.x + distance * Math.cos(elevAngle) * Math.sin(isoAngle),
    center.y + distance * Math.sin(elevAngle),
    center.z + distance * Math.cos(elevAngle) * Math.cos(isoAngle)
  );
  isoCamera.lookAt(center.x, center.y, center.z);

  // Render and get image data
  let dataURL;
  try {
    isoRenderer.render(isoScene, isoCamera);
    dataURL = isoRenderer.domElement.toDataURL('image/png');
  } catch (err) {
    console.warn('[FormGenerator] Failed to render individual ISO image:', err);
    // Remove temp building from scene
    isoScene.remove(cloned);
    return null;
  }

  // Cleanup: remove cloned building from scene (keep scene/renderer)
  // NOTE: Do NOT dispose geometry/materials here - THREE.js clone() shares them with original
  // The original groups are still needed for walkMeshes in 3D explore view
  isoScene.remove(cloned);

  return {
    dataURL,
    width,
    height
  };
}

/**
 * Render multiple buildings on a tile to a single ISO image.
 * Each building has its own offset and rotation within the tile.
 * Uses shared renderer to avoid WebGL context limits.
 * @param {Array} buildings - Array of { group, offset: {x, z}, rotation }
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Object} - { dataURL, width, height, center }
 */
export function renderMultipleBuildingsToIsoImage(buildings, width = 300, height = 400) {
  if (!buildings || buildings.length === 0) return null;

  // Filter out buildings without valid groups
  const validBuildings = buildings.filter(b => b.group && b.group.children && b.group.children.length > 0);
  if (validBuildings.length === 0) return null;

  const isoRenderer = getSharedIsoRenderer(width, height);
  if (!isoRenderer) return null;

  // Use shared scene (has persistent lighting)
  const isoScene = getSharedIsoScene();

  // Container for all buildings (marked for cleanup)
  const container = new THREE.Group();
  container.name = '_temp_container';

  // Track building offsets for weighted average
  let totalOffsetX = 0;
  let totalOffsetZ = 0;
  let buildingCount = 0;

  // Add all buildings with their offsets and rotations
  for (const bldg of validBuildings) {
    const cloned = bldg.group.clone(true);

    // Apply offset (in feet, within tile)
    const offsetX = bldg.offset?.x || 0;
    const offsetZ = bldg.offset?.z || 0;
    cloned.position.set(offsetX, 0, offsetZ);

    // Accumulate offsets for weighted center
    totalOffsetX += offsetX;
    totalOffsetZ += offsetZ;
    buildingCount++;

    // Apply rotation
    if (bldg.rotation) {
      cloned.rotation.y = bldg.rotation;
    }

    container.add(cloned);
  }

  // Calculate average building offset (weighted center of buildings on tile)
  const avgOffsetX = buildingCount > 0 ? totalOffsetX / buildingCount : 0;
  const avgOffsetZ = buildingCount > 0 ? totalOffsetZ / buildingCount : 0;

  isoScene.add(container);

  // Calculate combined bounds
  const box = new THREE.Box3().setFromObject(container);
  if (box.isEmpty()) {
    isoScene.remove(container);
    return null;
  }

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Camera should look at BUILDING CENTER, not tile center
  // This ensures buildings appear centered in the image
  const buildingCenter = center.clone();

  // Calculate frustum size to fit the buildings with some margin
  const maxDim = Math.max(size.x, size.y, size.z);
  const frustumSize = maxDim * 1.3; // Small margin around buildings

  // Create orthographic camera for isometric view
  const aspect = width / height;

  const isoCamera = new THREE.OrthographicCamera(
    -frustumSize * aspect / 2,
    frustumSize * aspect / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    frustumSize * 10
  );

  // Position camera for 2:1 dimetric projection (matching the map view)
  const distance = frustumSize * 2;
  const isoAngle = Math.PI / 4; // 45 degrees horizontal
  const elevAngle = Math.atan(0.5); // ~26.57 degrees for 2:1 dimetric

  isoCamera.position.set(
    buildingCenter.x + distance * Math.cos(elevAngle) * Math.sin(isoAngle),
    buildingCenter.y + distance * Math.sin(elevAngle),
    buildingCenter.z + distance * Math.cos(elevAngle) * Math.cos(isoAngle)
  );
  isoCamera.lookAt(buildingCenter.x, buildingCenter.y, buildingCenter.z);

  // Render and get image data
  let dataURL;
  try {
    isoRenderer.render(isoScene, isoCamera);
    dataURL = isoRenderer.domElement.toDataURL('image/png');
  } catch (err) {
    console.warn('[FormGenerator] Failed to render ISO image:', err);
    // Cleanup container from scene
    isoScene.remove(container);
    return null;
  }

  // Cleanup: remove container from scene (keep scene/renderer)
  // NOTE: Do NOT dispose geometry/materials here - THREE.js clone() shares them with original
  // The original groups are still needed for walkMeshes in 3D explore view
  isoScene.remove(container);

  return {
    dataURL,
    width,
    height,
    center: { x: center.x, y: center.y, z: center.z },
    // Store the average building offset from tile center (in feet)
    // This is the actual position where buildings are located on the tile
    buildingOffset: { x: avgOffsetX, z: avgOffsetZ }
  };
}

/**
 * Get available tower typologies for headless generation.
 */
export function getTowerTypologies() {
  return Object.keys(TOWER_TYPOLOGIES);
}

/**
 * Get available shed typologies for headless generation.
 */
export function getShedTypologies() {
  return Object.keys(SHED_TYPOLOGIES);
}

/**
 * Get height range for a typology.
 */
export function getTypologyHeightRange(typology, category = 'tower') {
  if (category === 'shed') {
    const shed = SHED_TYPOLOGIES[typology];
    return shed ? { min: 1, max: shed.maxFloors || 4 } : { min: 1, max: 4 };
  }
  return TOWER_HEIGHT_RANGES[typology] || { min: 4, max: 20 };
}
