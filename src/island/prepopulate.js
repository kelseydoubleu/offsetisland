// ════════════════════════════════════════════════════════════════════
// PREPOPULATE — Generate buildings from specific agent personas
// Each agent has a distinct architectural style and builds portfolio.
// Supports multiple buildings per tile with rotation and collision detection.
// Geographic zoning: Downtown in lowlands, small builds in forest/mountains.
// ════════════════════════════════════════════════════════════════════

import { applyTileDepletion, tileExtractionFor, findBestDumpSite, addWasteToDumpSite } from '../state/extraction.js';
import { calculateBuildGrade } from '../render/buildProfile.js';
import * as FormGenerator from '../build/formGenerator.js';
import { ISLAND_MATERIALS, PROCESSING_FACILITIES, MATERIAL_TO_FACILITY, DUMP_SITE_CAPACITY } from '../state/materials.js';

// ══════════════════════════════════════════════════════════════════
// AGENT PERSONAS — Each with distinct architectural preferences
// ══════════════════════════════════════════════════════════════════

const AGENTS = {
  // ══════════════════════════════════════════════════════════════════
  // TRADITIONALISTS — Historic styles and craft-focused builders
  // ══════════════════════════════════════════════════════════════════

  'iloveaveryhall': {
    displayName: 'iloveaveryhall',
    species: 'human',
    style: 'Traditional brick enthusiast',
    builds: [
      { name: 'Heritage Lofts', category: 'tower', typology: 'masonry', floors: 8, width: 55, depth: 45 },
      { name: 'Foundry Row', category: 'tower', typology: 'masonry', floors: 6, width: 50, depth: 40 },
      { name: 'Brick Works', category: 'tower', typology: 'masonry', floors: 10, width: 60, depth: 50 },
      { name: 'Mason Hall', category: 'tower', typology: 'masonry', floors: 7, width: 45, depth: 40 },
      { name: 'Red House', category: 'tower', typology: 'masonry', floors: 5, width: 40, depth: 35 },
      { name: 'Community Center', category: 'shed', typology: 'masonry', floors: 2, width: 90, depth: 70 },
      { name: 'Public Library', category: 'shed', typology: 'masonry', floors: 3, width: 100, depth: 80 },
      { name: 'Market Hall', category: 'shed', typology: 'masonry', floors: 2, width: 110, depth: 75 },
      { name: 'School House', category: 'shed', typology: 'masonry', floors: 3, width: 85, depth: 65 },
      { name: 'Terrace One', category: 'tower', typology: 'masonry', floors: 4, width: 28, depth: 24, small: true },
      { name: 'Terrace Two', category: 'tower', typology: 'masonry', floors: 3, width: 26, depth: 22, small: true },
      { name: 'Terrace Three', category: 'tower', typology: 'masonry', floors: 4, width: 28, depth: 24, small: true }
    ]
  },

  'oldways_guild': {
    displayName: 'oldways_guild',
    species: 'human',
    style: 'Historic preservation society',
    builds: [
      { name: 'Guild Hall', category: 'shed', typology: 'masonry', floors: 3, width: 95, depth: 70 },
      { name: 'Clock Tower', category: 'tower', typology: 'masonry', floors: 6, width: 35, depth: 35 },
      { name: 'Merchant House', category: 'tower', typology: 'masonry', floors: 4, width: 42, depth: 38 },
      { name: 'Chapel', category: 'shed', typology: 'masonry', floors: 2, width: 50, depth: 80 },
      { name: 'Old Granary', category: 'shed', typology: 'masonry', floors: 3, width: 60, depth: 45 },
      { name: 'Stone Archive', category: 'shed', typology: 'masonry', floors: 2, width: 70, depth: 55 },
      { name: 'Heritage Cottage', category: 'shed', typology: 'masonry', floors: 2, width: 32, depth: 28, small: true },
      { name: 'Well House', category: 'shed', typology: 'masonry', floors: 1, width: 18, depth: 18, small: true }
    ]
  },

  'vernacular_99': {
    displayName: 'vernacular_99',
    species: 'human',
    style: 'Regional building traditions',
    builds: [
      { name: 'Farmhouse', category: 'shed', typology: 'timber', floors: 2, width: 55, depth: 40 },
      { name: 'Barn', category: 'shed', typology: 'timber', floors: 2, width: 70, depth: 50 },
      { name: 'Stone Barn', category: 'shed', typology: 'masonry', floors: 2, width: 65, depth: 45 },
      { name: 'Mill House', category: 'shed', typology: 'timber', floors: 3, width: 45, depth: 40 },
      { name: 'Creamery', category: 'shed', typology: 'masonry', floors: 1, width: 50, depth: 35 },
      { name: 'Root Cellar', category: 'shed', typology: 'masonry', floors: 1, width: 25, depth: 20, small: true },
      { name: 'Sheep Fold', category: 'shed', typology: 'masonry', floors: 1, width: 40, depth: 30, small: true },
      { name: 'Hay Loft', category: 'shed', typology: 'timber', floors: 2, width: 35, depth: 28, small: true },
      { name: 'Smoke House', category: 'shed', typology: 'masonry', floors: 1, width: 20, depth: 20, small: true },
      { name: 'Spring House', category: 'shed', typology: 'masonry', floors: 1, width: 22, depth: 18, small: true }
    ]
  },

  // ══════════════════════════════════════════════════════════════════
  // MODERNISTS — Glass, steel, concrete maximalists
  // ══════════════════════════════════════════════════════════════════

  'brutalist-fan': {
    displayName: 'brutalist-fan',
    species: 'human',
    style: 'Concrete monumentalism',
    builds: [
      { name: 'Monolith One', category: 'tower', typology: 'brutalist', floors: 14, width: 70, depth: 60 },
      { name: 'Unity Tower', category: 'tower', typology: 'brutalist', floors: 16, width: 65, depth: 55 },
      { name: 'Civic Spire', category: 'tower', typology: 'brutalist', floors: 12, width: 60, depth: 50 },
      { name: 'Arts Bunker', category: 'shed', typology: 'brutalist', floors: 3, width: 100, depth: 85 },
      { name: 'Memorial Hall', category: 'shed', typology: 'brutalist', floors: 2, width: 120, depth: 90 },
      { name: 'Concrete Pavilion', category: 'shed', typology: 'brutalist', floors: 2, width: 95, depth: 75 },
      { name: 'Form Study', category: 'shed', typology: 'sculptural', floors: 1, width: 80, depth: 60 },
      { name: 'Mass Gallery', category: 'shed', typology: 'sculptural', floors: 2, width: 90, depth: 70 }
    ]
  },

  'glass.and" ': {
    displayName: 'glass.and" ',
    species: 'human',
    style: 'Corporate glass maximalist',
    builds: [
      { name: 'Apex One', category: 'tower', typology: 'diagrid', floors: 35, width: 75, depth: 65 },
      { name: 'Skyline Twist', category: 'tower', typology: 'twisted', floors: 38, width: 70, depth: 60 },
      { name: 'Crystal Spire', category: 'tower', typology: 'spire', floors: 42, width: 80, depth: 70 },
      { name: 'Prism', category: 'tower', typology: 'setback', floors: 28, width: 70, depth: 60 },
      { name: 'Mirror Box', category: 'tower', typology: 'curtainwall', floors: 24, width: 55, depth: 55 },
      { name: 'Glass Cube', category: 'shed', typology: 'curtainwall', floors: 4, width: 80, depth: 80 }
    ]
  },

  'density_now': {
    displayName: 'density_now',
    species: 'human',
    style: 'Supertall enthusiast',
    builds: [
      { name: 'Helix Tower', category: 'tower', typology: 'twisted', floors: 52, width: 85, depth: 75 },
      { name: 'Diamond Core', category: 'tower', typology: 'diagrid', floors: 48, width: 80, depth: 70 },
      { name: 'Organic Peak', category: 'tower', typology: 'organic', floors: 45, width: 90, depth: 80 },
      { name: 'Needle', category: 'tower', typology: 'spire', floors: 55, width: 60, depth: 60 },
      { name: 'Stack', category: 'tower', typology: 'setback', floors: 40, width: 75, depth: 65 }
    ]
  },

  'starchitect_xyz': {
    displayName: 'starchitect_xyz',
    species: 'human',
    style: 'Signature form obsessive',
    builds: [
      { name: 'The Fold', category: 'shed', typology: 'sculptural', floors: 3, width: 120, depth: 90 },
      { name: 'Parametric One', category: 'tower', typology: 'organic', floors: 28, width: 65, depth: 60 },
      { name: 'Void Space', category: 'shed', typology: 'sculptural', floors: 4, width: 95, depth: 80 },
      { name: 'Cantilever House', category: 'tower', typology: 'organic', floors: 8, width: 50, depth: 45 },
      { name: 'The Ribbon', category: 'shed', typology: 'sculptural', floors: 2, width: 140, depth: 50 },
      { name: 'Floating Volume', category: 'tower', typology: 'organic', floors: 12, width: 55, depth: 50 }
    ]
  },

  // ══════════════════════════════════════════════════════════════════
  // SUSTAINABILISTS — Timber, earth, and ecological builders
  // ══════════════════════════════════════════════════════════════════

  'timber_emoji_tree': {
    displayName: 'timber_emoji_tree',
    species: 'human',
    style: 'Mass timber advocate',
    builds: [
      { name: 'Cedar Tower', category: 'tower', typology: 'timber', floors: 12, width: 55, depth: 50 },
      { name: 'Oak Rise', category: 'tower', typology: 'timber', floors: 18, width: 60, depth: 55 },
      { name: 'Forest One', category: 'tower', typology: 'timber', floors: 15, width: 50, depth: 45 },
      { name: 'Canopy', category: 'tower', typology: 'timber', floors: 20, width: 65, depth: 55 },
      { name: 'Grove', category: 'tower', typology: 'timber', floors: 10, width: 45, depth: 40 },
      { name: 'Wood Workshop', category: 'shed', typology: 'timber', floors: 1, width: 80, depth: 60 },
      { name: 'Timber Market', category: 'shed', typology: 'timber', floors: 2, width: 100, depth: 75 },
      { name: 'Pine Pavilion', category: 'shed', typology: 'timber', floors: 1, width: 70, depth: 55 },
      { name: 'Branch Studio', category: 'shed', typology: 'timber', floors: 2, width: 60, depth: 50 }
    ]
  },

  'carbon_negative': {
    displayName: 'carbon_negative',
    species: 'human',
    style: 'Regenerative design pioneer',
    builds: [
      { name: 'Sequestration Tower', category: 'tower', typology: 'timber', floors: 14, width: 52, depth: 48 },
      { name: 'Living Wall', category: 'tower', typology: 'timber', floors: 8, width: 45, depth: 40 },
      { name: 'Mycelium Lab', category: 'shed', typology: 'timber', floors: 2, width: 75, depth: 55 },
      { name: 'Hemp House', category: 'shed', typology: 'timber', floors: 2, width: 48, depth: 38 },
      { name: 'Earthship', category: 'shed', typology: 'timber', floors: 1, width: 55, depth: 45 },
      { name: 'Straw Bale Studio', category: 'shed', typology: 'timber', floors: 1, width: 35, depth: 28, small: true },
      { name: 'Cob Cottage', category: 'shed', typology: 'masonry', floors: 1, width: 30, depth: 25, small: true },
      { name: 'Green Roof Hut', category: 'shed', typology: 'timber', floors: 1, width: 28, depth: 24, small: true }
    ]
  },

  'passive_house': {
    displayName: 'passive_house',
    species: 'human',
    style: 'Net-zero energy specialist',
    builds: [
      { name: 'Solar Block', category: 'tower', typology: 'timber', floors: 6, width: 50, depth: 45 },
      { name: 'Zero Energy Flats', category: 'tower', typology: 'timber', floors: 5, width: 55, depth: 48 },
      { name: 'Passive Tower', category: 'tower', typology: 'timber', floors: 9, width: 48, depth: 42 },
      { name: 'Efficiency House', category: 'shed', typology: 'timber', floors: 2, width: 42, depth: 35 },
      { name: 'Thermal Mass', category: 'shed', typology: 'masonry', floors: 2, width: 50, depth: 40 },
      { name: 'Compact Living', category: 'tower', typology: 'timber', floors: 4, width: 32, depth: 28, small: true }
    ]
  },

  // ══════════════════════════════════════════════════════════════════
  // URBANISTS — Mixed-use and community-focused builders
  // ══════════════════════════════════════════════════════════════════

  'mixed_use_maven': {
    displayName: 'mixed_use_maven',
    species: 'human',
    style: 'Pragmatic urbanist',
    builds: [
      { name: 'Metro Hub', category: 'tower', typology: 'setback', floors: 22, width: 65, depth: 55 },
      { name: 'Central Office', category: 'tower', typology: 'curtainwall', floors: 18, width: 60, depth: 50 },
      { name: 'Commerce Block', category: 'tower', typology: 'diagrid', floors: 20, width: 70, depth: 60 },
      { name: 'Union Building', category: 'tower', typology: 'masonry', floors: 6, width: 50, depth: 45 },
      { name: 'Classic Flats', category: 'tower', typology: 'masonry', floors: 8, width: 55, depth: 50 },
      { name: 'Woodland Homes', category: 'tower', typology: 'timber', floors: 5, width: 45, depth: 40 },
      { name: 'Natural Living', category: 'tower', typology: 'timber', floors: 6, width: 50, depth: 45 },
      { name: 'Neighborhood Center', category: 'shed', typology: 'masonry', floors: 2, width: 80, depth: 65 }
    ]
  },

  'housing_for_all': {
    displayName: 'housing_for_all',
    species: 'human',
    style: 'Affordable housing advocate',
    builds: [
      { name: 'Commons One', category: 'tower', typology: 'masonry', floors: 6, width: 65, depth: 55 },
      { name: 'Commons Two', category: 'tower', typology: 'masonry', floors: 7, width: 60, depth: 52 },
      { name: 'Solidarity Block', category: 'tower', typology: 'brutalist', floors: 9, width: 70, depth: 60 },
      { name: 'Worker Housing', category: 'tower', typology: 'masonry', floors: 5, width: 55, depth: 48 },
      { name: 'Family Flats', category: 'tower', typology: 'masonry', floors: 4, width: 50, depth: 45 },
      { name: 'Elder Care', category: 'shed', typology: 'timber', floors: 2, width: 85, depth: 65 },
      { name: 'Youth Hostel', category: 'tower', typology: 'timber', floors: 4, width: 48, depth: 40 },
      { name: 'Micro Unit', category: 'tower', typology: 'timber', floors: 5, width: 35, depth: 30, small: true }
    ]
  },

  'co_op_collective': {
    displayName: 'co_op_collective',
    species: 'human',
    style: 'Cooperative housing builder',
    builds: [
      { name: 'Cohousing Block', category: 'tower', typology: 'timber', floors: 5, width: 70, depth: 60 },
      { name: 'Common House', category: 'shed', typology: 'timber', floors: 2, width: 90, depth: 70 },
      { name: 'Shared Kitchen', category: 'shed', typology: 'timber', floors: 1, width: 50, depth: 40 },
      { name: 'Tool Library', category: 'shed', typology: 'timber', floors: 1, width: 40, depth: 30, small: true },
      { name: 'Bike Coop', category: 'shed', typology: 'timber', floors: 1, width: 35, depth: 25, small: true },
      { name: 'Community Garden Shed', category: 'shed', typology: 'timber', floors: 1, width: 25, depth: 20, small: true },
      { name: 'Repair Cafe', category: 'shed', typology: 'masonry', floors: 1, width: 45, depth: 35, small: true }
    ]
  },

  // ══════════════════════════════════════════════════════════════════
  // EXPERIMENTALISTS — Sculptural and avant-garde builders
  // ══════════════════════════════════════════════════════════════════

  'organic_flow': {
    displayName: 'organic_flow',
    species: 'human',
    style: 'Sculptural expressionist',
    builds: [
      { name: 'Curve Gallery', category: 'shed', typology: 'sculptural', floors: 2, width: 100, depth: 80 },
      { name: 'Movement Center', category: 'shed', typology: 'sculptural', floors: 3, width: 110, depth: 85 },
      { name: 'Wave Pavilion', category: 'shed', typology: 'sculptural', floors: 1, width: 90, depth: 70 },
      { name: 'Flow Tower', category: 'tower', typology: 'organic', floors: 18, width: 60, depth: 55 },
      { name: 'Undulation', category: 'tower', typology: 'organic', floors: 22, width: 65, depth: 58 },
      { name: 'Spiral Rise', category: 'tower', typology: 'twisted', floors: 25, width: 55, depth: 50 },
      { name: 'Fluid Spire', category: 'tower', typology: 'organic', floors: 15, width: 50, depth: 45 }
    ]
  },

  'folly_builder': {
    displayName: 'folly_builder',
    species: 'human',
    style: 'Architectural provocateur',
    builds: [
      { name: 'Observation Tower', category: 'tower', typology: 'sculptural', floors: 8, width: 25, depth: 25 },
      { name: 'Impossible Stairs', category: 'shed', typology: 'sculptural', floors: 3, width: 40, depth: 35 },
      { name: 'Mirror Maze', category: 'shed', typology: 'sculptural', floors: 1, width: 50, depth: 50 },
      { name: 'Inverted Pyramid', category: 'shed', typology: 'sculptural', floors: 2, width: 55, depth: 55 },
      { name: 'Floating Room', category: 'shed', typology: 'sculptural', floors: 1, width: 30, depth: 30, small: true },
      { name: 'Endless Column', category: 'tower', typology: 'sculptural', floors: 12, width: 20, depth: 20 },
      { name: 'Sound Chamber', category: 'shed', typology: 'sculptural', floors: 1, width: 35, depth: 35, small: true }
    ]
  },

  // ══════════════════════════════════════════════════════════════════
  // SMALL SCALE — Cottages, cabins, and human-scale builders
  // ══════════════════════════════════════════════════════════════════

  'small_is_beautiful': {
    displayName: 'small_is_beautiful',
    species: 'human',
    style: 'Human-scale advocate',
    builds: [
      { name: 'Cottage One', category: 'shed', typology: 'timber', floors: 1, width: 28, depth: 24, small: true },
      { name: 'Cottage Two', category: 'shed', typology: 'timber', floors: 2, width: 32, depth: 28, small: true },
      { name: 'Garden Studio', category: 'shed', typology: 'timber', floors: 1, width: 24, depth: 20, small: true },
      { name: 'Reading Room', category: 'shed', typology: 'timber', floors: 1, width: 26, depth: 22, small: true },
      { name: 'Tea House', category: 'shed', typology: 'timber', floors: 1, width: 20, depth: 18, small: true },
      { name: 'Writer Cabin', category: 'shed', typology: 'timber', floors: 1, width: 25, depth: 22, small: true },
      { name: 'Art Shed', category: 'shed', typology: 'timber', floors: 1, width: 30, depth: 25, small: true },
      { name: 'Guest House', category: 'shed', typology: 'timber', floors: 2, width: 32, depth: 26, small: true },
      { name: 'Mountain Hut', category: 'shed', typology: 'timber', floors: 1, width: 22, depth: 20, small: true },
      { name: 'Forest Cabin', category: 'shed', typology: 'timber', floors: 1, width: 26, depth: 22, small: true },
      { name: 'Lookout', category: 'shed', typology: 'timber', floors: 2, width: 18, depth: 18, small: true },
      { name: 'Craft Workshop', category: 'shed', typology: 'masonry', floors: 1, width: 35, depth: 28, small: true },
      { name: 'Potter Studio', category: 'shed', typology: 'masonry', floors: 1, width: 32, depth: 26, small: true },
      { name: 'Forge', category: 'shed', typology: 'masonry', floors: 2, width: 38, depth: 30, small: true },
      { name: 'Kiln House', category: 'shed', typology: 'masonry', floors: 1, width: 28, depth: 24, small: true },
      { name: 'Stone Cottage', category: 'shed', typology: 'masonry', floors: 1, width: 30, depth: 25, small: true }
    ]
  },

  'tiny_house_nation': {
    displayName: 'tiny_house_nation',
    species: 'human',
    style: 'Minimalist living enthusiast',
    builds: [
      { name: 'Micro Cabin', category: 'shed', typology: 'timber', floors: 1, width: 16, depth: 14, small: true },
      { name: 'Tiny A-Frame', category: 'shed', typology: 'timber', floors: 2, width: 18, depth: 18, small: true },
      { name: 'Pod One', category: 'shed', typology: 'timber', floors: 1, width: 20, depth: 16, small: true },
      { name: 'Compact Studio', category: 'shed', typology: 'timber', floors: 1, width: 22, depth: 18, small: true },
      { name: 'Tree Platform', category: 'shed', typology: 'timber', floors: 1, width: 15, depth: 15, small: true },
      { name: 'Modular Unit', category: 'shed', typology: 'timber', floors: 1, width: 24, depth: 12, small: true },
      { name: 'Yurt Frame', category: 'shed', typology: 'timber', floors: 1, width: 20, depth: 20, small: true },
      { name: 'Sleep Pod', category: 'shed', typology: 'timber', floors: 1, width: 12, depth: 10, small: true }
    ]
  },

  'hermit_mode': {
    displayName: 'hermit_mode',
    species: 'human',
    style: 'Solitude seeker',
    builds: [
      { name: 'Retreat Cabin', category: 'shed', typology: 'timber', floors: 1, width: 24, depth: 20, small: true },
      { name: 'Meditation Hut', category: 'shed', typology: 'timber', floors: 1, width: 18, depth: 18, small: true },
      { name: 'Silent Studio', category: 'shed', typology: 'timber', floors: 1, width: 22, depth: 18, small: true },
      { name: 'Cliff Shelter', category: 'shed', typology: 'masonry', floors: 1, width: 20, depth: 16, small: true },
      { name: 'Cave House', category: 'shed', typology: 'masonry', floors: 1, width: 28, depth: 22, small: true },
      { name: 'Watch Tower', category: 'tower', typology: 'masonry', floors: 3, width: 18, depth: 18, small: true },
      { name: 'Fire Lookout', category: 'tower', typology: 'timber', floors: 2, width: 16, depth: 16, small: true }
    ]
  },

  // ══════════════════════════════════════════════════════════════════
  // CIVIC & CULTURAL — Public buildings and gathering spaces
  // ══════════════════════════════════════════════════════════════════

  'public_works': {
    displayName: 'public_works',
    species: 'human',
    style: 'Civic infrastructure builder',
    builds: [
      { name: 'Town Hall', category: 'shed', typology: 'masonry', floors: 4, width: 100, depth: 80 },
      { name: 'Fire Station', category: 'shed', typology: 'masonry', floors: 2, width: 70, depth: 55 },
      { name: 'Post Office', category: 'shed', typology: 'masonry', floors: 2, width: 55, depth: 45 },
      { name: 'Police Station', category: 'shed', typology: 'brutalist', floors: 3, width: 65, depth: 55 },
      { name: 'Water Tower', category: 'tower', typology: 'masonry', floors: 4, width: 30, depth: 30 },
      { name: 'Transit Hub', category: 'shed', typology: 'brutalist', floors: 2, width: 120, depth: 80 },
      { name: 'Power Station', category: 'shed', typology: 'brutalist', floors: 2, width: 90, depth: 70 },
      { name: 'Public Toilet', category: 'shed', typology: 'masonry', floors: 1, width: 20, depth: 15, small: true }
    ]
  },

  'culture_capital': {
    displayName: 'culture_capital',
    species: 'human',
    style: 'Arts and culture patron',
    builds: [
      { name: 'Concert Hall', category: 'shed', typology: 'sculptural', floors: 3, width: 130, depth: 100 },
      { name: 'Museum of Modern', category: 'shed', typology: 'sculptural', floors: 4, width: 120, depth: 90 },
      { name: 'Theater', category: 'shed', typology: 'masonry', floors: 3, width: 95, depth: 75 },
      { name: 'Opera House', category: 'shed', typology: 'sculptural', floors: 4, width: 110, depth: 85 },
      { name: 'Gallery Space', category: 'shed', typology: 'brutalist', floors: 2, width: 80, depth: 60 },
      { name: 'Dance Studio', category: 'shed', typology: 'timber', floors: 2, width: 60, depth: 50 },
      { name: 'Music School', category: 'shed', typology: 'masonry', floors: 3, width: 75, depth: 55 },
      { name: 'Artist Residence', category: 'tower', typology: 'timber', floors: 4, width: 45, depth: 40 }
    ]
  },

  'sacred_spaces': {
    displayName: 'sacred_spaces',
    species: 'human',
    style: 'Spiritual architecture devotee',
    builds: [
      { name: 'Temple', category: 'shed', typology: 'masonry', floors: 2, width: 70, depth: 90 },
      { name: 'Sanctuary', category: 'shed', typology: 'timber', floors: 2, width: 60, depth: 80 },
      { name: 'Meditation Center', category: 'shed', typology: 'timber', floors: 1, width: 80, depth: 60 },
      { name: 'Bell Tower', category: 'tower', typology: 'masonry', floors: 5, width: 25, depth: 25 },
      { name: 'Cloister', category: 'shed', typology: 'masonry', floors: 2, width: 90, depth: 90 },
      { name: 'Prayer Room', category: 'shed', typology: 'timber', floors: 1, width: 30, depth: 25, small: true },
      { name: 'Shrine', category: 'shed', typology: 'timber', floors: 1, width: 20, depth: 20, small: true },
      { name: 'Memorial', category: 'shed', typology: 'masonry', floors: 1, width: 25, depth: 25, small: true }
    ]
  },

  // ══════════════════════════════════════════════════════════════════
  // COMMERCIAL & INDUSTRIAL — Workshops, markets, and production
  // ══════════════════════════════════════════════════════════════════

  'market_maker': {
    displayName: 'market_maker',
    species: 'human',
    style: 'Commerce and exchange specialist',
    builds: [
      { name: 'Central Market', category: 'shed', typology: 'timber', floors: 2, width: 110, depth: 80 },
      { name: 'Fish Market', category: 'shed', typology: 'timber', floors: 1, width: 80, depth: 50 },
      { name: 'Produce Hall', category: 'shed', typology: 'timber', floors: 1, width: 90, depth: 60 },
      { name: 'Craft Bazaar', category: 'shed', typology: 'timber', floors: 2, width: 70, depth: 55 },
      { name: 'Food Hall', category: 'shed', typology: 'masonry', floors: 2, width: 85, depth: 65 },
      { name: 'Market Stall', category: 'shed', typology: 'timber', floors: 1, width: 25, depth: 20, small: true },
      { name: 'Vendor Booth', category: 'shed', typology: 'timber', floors: 1, width: 20, depth: 18, small: true },
      { name: 'Kiosk', category: 'shed', typology: 'timber', floors: 1, width: 15, depth: 15, small: true }
    ]
  },

  'maker_space': {
    displayName: 'maker_space',
    species: 'human',
    style: 'Workshop and fabrication expert',
    builds: [
      { name: 'Fab Lab', category: 'shed', typology: 'brutalist', floors: 2, width: 85, depth: 65 },
      { name: 'Woodshop', category: 'shed', typology: 'timber', floors: 2, width: 70, depth: 55 },
      { name: 'Metal Works', category: 'shed', typology: 'masonry', floors: 2, width: 75, depth: 60 },
      { name: 'Ceramics Studio', category: 'shed', typology: 'masonry', floors: 1, width: 50, depth: 40 },
      { name: 'Print Shop', category: 'shed', typology: 'masonry', floors: 2, width: 55, depth: 45 },
      { name: 'Textile Mill', category: 'shed', typology: 'masonry', floors: 3, width: 80, depth: 50 },
      { name: 'Dye House', category: 'shed', typology: 'masonry', floors: 1, width: 40, depth: 30, small: true },
      { name: 'Tool Shed', category: 'shed', typology: 'timber', floors: 1, width: 25, depth: 20, small: true }
    ]
  },

  'warehouse_district': {
    displayName: 'warehouse_district',
    species: 'human',
    style: 'Storage and logistics builder',
    builds: [
      { name: 'Main Warehouse', category: 'shed', typology: 'brutalist', floors: 2, width: 120, depth: 80 },
      { name: 'Cold Storage', category: 'shed', typology: 'brutalist', floors: 2, width: 90, depth: 70 },
      { name: 'Grain Silo', category: 'tower', typology: 'brutalist', floors: 6, width: 30, depth: 30 },
      { name: 'Loading Dock', category: 'shed', typology: 'brutalist', floors: 1, width: 80, depth: 40 },
      { name: 'Distribution Center', category: 'shed', typology: 'brutalist', floors: 2, width: 110, depth: 75 },
      { name: 'Storage Unit', category: 'shed', typology: 'brutalist', floors: 1, width: 40, depth: 30, small: true }
    ]
  },

  'industrial_works': {
    displayName: 'industrial_works',
    species: 'human',
    style: 'Utilitarian processor',
    builds: [
      { name: 'East Lumber Mill', category: 'shed', typology: 'industrial',
        subtype: 'sawmill', floors: 1, width: 100, depth: 80 },
      { name: 'Forest Sawmill', category: 'shed', typology: 'industrial',
        subtype: 'sawmill', floors: 2, width: 120, depth: 90 },
      { name: 'Red Earth Kiln', category: 'shed', typology: 'industrial',
        subtype: 'brickKiln', floors: 1, width: 90, depth: 70 },
      { name: 'Central Brick Works', category: 'shed', typology: 'industrial',
        subtype: 'brickKiln', floors: 2, width: 100, depth: 80 },
      { name: 'Aggregate Plant', category: 'shed', typology: 'industrial',
        subtype: 'concretePlant', floors: 1, width: 130, depth: 100 },
      { name: 'Glass Works', category: 'shed', typology: 'industrial',
        subtype: 'glassFurnace', floors: 2, width: 80, depth: 60 }
    ]
  },

  // ══════════════════════════════════════════════════════════════════
  // EDUCATION & RESEARCH — Schools, labs, and learning spaces
  // ══════════════════════════════════════════════════════════════════

  'campus_planner': {
    displayName: 'campus_planner',
    species: 'human',
    style: 'Educational institution builder',
    builds: [
      { name: 'Main Hall', category: 'shed', typology: 'masonry', floors: 4, width: 110, depth: 80 },
      { name: 'Science Building', category: 'tower', typology: 'brutalist', floors: 8, width: 70, depth: 60 },
      { name: 'Library Tower', category: 'tower', typology: 'masonry', floors: 6, width: 55, depth: 50 },
      { name: 'Lecture Hall', category: 'shed', typology: 'brutalist', floors: 2, width: 90, depth: 70 },
      { name: 'Dormitory', category: 'tower', typology: 'masonry', floors: 5, width: 60, depth: 45 },
      { name: 'Student Center', category: 'shed', typology: 'timber', floors: 2, width: 80, depth: 60 },
      { name: 'Lab Building', category: 'tower', typology: 'brutalist', floors: 6, width: 65, depth: 55 },
      { name: 'Greenhouse', category: 'shed', typology: 'timber', floors: 2, width: 50, depth: 40 }
    ]
  },

  'research_institute': {
    displayName: 'research_institute',
    species: 'human',
    style: 'Scientific facility designer',
    builds: [
      { name: 'Research Tower', category: 'tower', typology: 'brutalist', floors: 12, width: 65, depth: 55 },
      { name: 'Clean Room', category: 'shed', typology: 'brutalist', floors: 2, width: 75, depth: 60 },
      { name: 'Observatory', category: 'tower', typology: 'brutalist', floors: 4, width: 40, depth: 40 },
      { name: 'Data Center', category: 'shed', typology: 'brutalist', floors: 2, width: 80, depth: 65 },
      { name: 'Bio Lab', category: 'shed', typology: 'brutalist', floors: 3, width: 70, depth: 55 },
      { name: 'Field Station', category: 'shed', typology: 'timber', floors: 1, width: 45, depth: 35, small: true }
    ]
  },

  // ══════════════════════════════════════════════════════════════════
  // HOSPITALITY — Hotels, inns, and gathering places
  // ══════════════════════════════════════════════════════════════════

  'grand_hotel': {
    displayName: 'grand_hotel',
    species: 'human',
    style: 'Hospitality industry veteran',
    builds: [
      { name: 'Grand Hotel', category: 'tower', typology: 'masonry', floors: 12, width: 80, depth: 65 },
      { name: 'Boutique Hotel', category: 'tower', typology: 'masonry', floors: 6, width: 55, depth: 45 },
      { name: 'Beach Resort', category: 'shed', typology: 'timber', floors: 3, width: 100, depth: 70 },
      { name: 'Mountain Lodge', category: 'shed', typology: 'timber', floors: 3, width: 75, depth: 55 },
      { name: 'Inn', category: 'tower', typology: 'masonry', floors: 4, width: 45, depth: 40 },
      { name: 'Guesthouse', category: 'shed', typology: 'timber', floors: 2, width: 40, depth: 32, small: true },
      { name: 'Bungalow', category: 'shed', typology: 'timber', floors: 1, width: 30, depth: 25, small: true }
    ]
  },

  'pub_crawl': {
    displayName: 'pub_crawl',
    species: 'human',
    style: 'Social gathering space creator',
    builds: [
      { name: 'The Tavern', category: 'shed', typology: 'masonry', floors: 2, width: 50, depth: 40 },
      { name: 'Brewery', category: 'shed', typology: 'masonry', floors: 2, width: 70, depth: 55 },
      { name: 'Wine Cellar', category: 'shed', typology: 'masonry', floors: 1, width: 45, depth: 35 },
      { name: 'Coffee House', category: 'shed', typology: 'masonry', floors: 2, width: 35, depth: 30, small: true },
      { name: 'Tea Room', category: 'shed', typology: 'timber', floors: 1, width: 28, depth: 24, small: true },
      { name: 'Beer Garden Shelter', category: 'shed', typology: 'timber', floors: 1, width: 40, depth: 25, small: true },
      { name: 'Distillery', category: 'shed', typology: 'masonry', floors: 2, width: 55, depth: 45 }
    ]
  },

  // ══════════════════════════════════════════════════════════════════
  // HEALTH & WELLNESS — Medical and care facilities
  // ══════════════════════════════════════════════════════════════════

  'healthcare_hero': {
    displayName: 'healthcare_hero',
    species: 'human',
    style: 'Medical facility specialist',
    builds: [
      { name: 'Hospital', category: 'tower', typology: 'brutalist', floors: 10, width: 90, depth: 75 },
      { name: 'Clinic', category: 'shed', typology: 'masonry', floors: 2, width: 60, depth: 45 },
      { name: 'Pharmacy', category: 'shed', typology: 'masonry', floors: 2, width: 40, depth: 32 },
      { name: 'Rehabilitation Center', category: 'shed', typology: 'timber', floors: 2, width: 70, depth: 55 },
      { name: 'Wellness Center', category: 'shed', typology: 'timber', floors: 2, width: 65, depth: 50 },
      { name: 'First Aid Station', category: 'shed', typology: 'masonry', floors: 1, width: 25, depth: 20, small: true }
    ]
  },

  'retreat_builder': {
    displayName: 'retreat_builder',
    species: 'human',
    style: 'Wellness and spa designer',
    builds: [
      { name: 'Spa Complex', category: 'shed', typology: 'timber', floors: 2, width: 90, depth: 70 },
      { name: 'Hot Springs Bath', category: 'shed', typology: 'timber', floors: 1, width: 60, depth: 50 },
      { name: 'Sauna House', category: 'shed', typology: 'timber', floors: 1, width: 35, depth: 28, small: true },
      { name: 'Yoga Studio', category: 'shed', typology: 'timber', floors: 1, width: 40, depth: 35, small: true },
      { name: 'Massage Room', category: 'shed', typology: 'timber', floors: 1, width: 25, depth: 20, small: true },
      { name: 'Quiet Pool', category: 'shed', typology: 'timber', floors: 1, width: 50, depth: 40 }
    ]
  }
};

// Material to biome mapping for sourcing
const MATERIAL_BIOMES = {
  timber: 'forest',
  stone: 'mountain',
  sand: 'beach',
  clay: 'lowlands',
  brick: 'lowlands',
  concrete: 'mountain',
  thatch: 'lowlands'
};

// ══════════════════════════════════════════════════════════════════
// PREPOPULATION MAIN FUNCTION
// ══════════════════════════════════════════════════════════════════

/**
 * Prepopulate the island with agent-built buildings
 */
export function prepopulateIsland(state) {
  if (!state.island?.tiles) return;

  const tiles = state.island.tiles;
  const byKey = state.island.tilesByKey || new Map();

  // ══════════════════════════════════════════════════════════════════
  // INITIALIZE DUMP SITES — Dedicated landfill locations
  // ══════════════════════════════════════════════════════════════════
  // Place dump sites at edges of lowlands, away from downtown
  const avgX = tiles.reduce((sum, t) => sum + t.gx, 0) / tiles.length;
  const avgY = tiles.reduce((sum, t) => sum + t.gy, 0) / tiles.length;

  // Find candidate dump tiles: lowlands at the edges, not near center
  const dumpCandidates = tiles.filter(t =>
    t.biome === 'lowlands' &&
    !t.built &&
    t.elev <= 2 &&
    (Math.abs(t.gx - avgX) > 6 || Math.abs(t.gy - avgY) > 6)
  );

  // Select 3 dump sites spread around the island edges
  state.island.dumpSites = [];
  if (dumpCandidates.length >= 3) {
    // Sort by distance from center and pick spread-out ones
    dumpCandidates.sort((a, b) => {
      const distA = Math.abs(a.gx - avgX) + Math.abs(a.gy - avgY);
      const distB = Math.abs(b.gx - avgX) + Math.abs(b.gy - avgY);
      return distB - distA; // Furthest first
    });

    // Pick 3 tiles that are spread apart
    const selected = [dumpCandidates[0]];
    for (const candidate of dumpCandidates.slice(1)) {
      if (selected.length >= 3) break;
      // Ensure minimum distance from already selected
      const tooClose = selected.some(s =>
        Math.abs(s.gx - candidate.gx) < 4 && Math.abs(s.gy - candidate.gy) < 4
      );
      if (!tooClose) {
        selected.push(candidate);
      }
    }

    state.island.dumpSites = selected.map(t => `${t.gx}:${t.gy}`);
    console.log(`[PREPOPULATE] Initialized ${state.island.dumpSites.length} dump sites`);
  } else if (dumpCandidates.length > 0) {
    // Use what we have
    state.island.dumpSites = dumpCandidates.slice(0, 3).map(t => `${t.gx}:${t.gy}`);
    console.log(`[PREPOPULATE] Initialized ${state.island.dumpSites.length} dump sites (limited candidates)`);
  } else {
    console.warn('[PREPOPULATE] No suitable dump site locations found');
  }

  // Add test waste to dump sites so they're visible
  // Different amounts to show different fill levels
  if (state.island.dumpSites && state.island.dumpSites.length > 0) {
    const testFillLevels = [0.7, 0.4, 0.15]; // 70%, 40%, 15% full
    state.island.dumpSites.forEach((key, i) => {
      const [gx, gy] = key.split(':').map(Number);
      const ext = tileExtractionFor(state, gx, gy);
      const fillLevel = testFillLevels[i % testFillLevels.length];
      ext.soilDumped = Math.round(DUMP_SITE_CAPACITY * fillLevel);
      console.log(`[PREPOPULATE] Dump site ${key}: ${Math.round(fillLevel * 100)}% full (${ext.soilDumped} cu ft)`);
    });
  }

  // Find suitable building locations - allow more elevation for variety
  const buildableTiles = tiles.filter(t =>
    t.biome !== 'water' &&
    !t.built &&
    t.elev <= 8 &&
    // Exclude dump sites from building
    !state.island.dumpSites.includes(`${t.gx}:${t.gy}`)
  );

  // Beach-adjacent tiles for coastal buildings
  const coastalTiles = buildableTiles.filter(t =>
    t.biome !== 'beach' &&
    tiles.some(bt => bt.biome === 'beach' &&
      Math.abs(bt.gx - t.gx) <= 1 && Math.abs(bt.gy - t.gy) <= 1)
  );

  if (buildableTiles.length < 30) {
    console.warn('[PREPOPULATE] Not enough buildable tiles');
    return;
  }

  console.log('[PREPOPULATE] Starting organic island population...');
  console.log(`[PREPOPULATE] ${buildableTiles.length} buildable tiles available`);

  // Zone tiles by geography with expanded zones (avgX/avgY already computed above for dump sites)
  const downtownCore = buildableTiles.filter(t =>
    t.biome === 'lowlands' && Math.abs(t.gx - avgX) < 3 && Math.abs(t.gy - avgY) < 3
  );
  const downtownRing = buildableTiles.filter(t =>
    t.biome === 'lowlands' &&
    Math.abs(t.gx - avgX) >= 3 && Math.abs(t.gx - avgX) < 5 &&
    Math.abs(t.gy - avgY) >= 3 && Math.abs(t.gy - avgY) < 5
  );

  const forestTiles = buildableTiles.filter(t => t.biome === 'forest');
  const mountainTiles = buildableTiles.filter(t => t.biome === 'mountain');
  const desertTiles = buildableTiles.filter(t => t.biome === 'desert');
  const lowlandOuterTiles = buildableTiles.filter(t =>
    t.biome === 'lowlands' && (Math.abs(t.gx - avgX) >= 5 || Math.abs(t.gy - avgY) >= 5)
  );

  // Track used tiles
  const usedTiles = new Set();
  let totalBuildings = 0;

  // ══════════════════════════════════════════════════════════════════
  // PHASE 1: DOWNTOWN CORE — Supertalls and signature towers
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 1: Downtown core...');

  const supertallAgents = ['density_now', 'glass.and" ', 'starchitect_xyz'];
  for (const agentName of supertallAgents) {
    const agent = AGENTS[agentName];
    const bigBuilds = agent.builds.filter(b => b.floors >= 20 && !b.small);
    totalBuildings += placeBuildsInZone(
      state, downtownCore, bigBuilds, agent, agentName, usedTiles, byKey, 'downtown-core'
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 2: DOWNTOWN RING — Mid-rise mixed use
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 2: Downtown ring...');

  const midRiseAgents = ['mixed_use_maven', 'housing_for_all', 'iloveaveryhall', 'brutalist-fan'];
  for (const agentName of midRiseAgents) {
    const agent = AGENTS[agentName];
    const midBuilds = agent.builds.filter(b => b.floors >= 4 && b.floors < 20 && !b.small);
    totalBuildings += placeBuildsInZone(
      state, [...downtownRing, ...downtownCore.filter(t => !usedTiles.has(tileKey(t)))],
      midBuilds, agent, agentName, usedTiles, byKey, 'downtown-ring'
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 3: CIVIC & CULTURAL BUILDINGS — Scattered through lowlands
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 3: Civic and cultural...');

  const civicAgents = ['public_works', 'culture_capital', 'sacred_spaces', 'campus_planner'];
  for (const agentName of civicAgents) {
    const agent = AGENTS[agentName];
    const civicBuilds = agent.builds.filter(b => !b.small);
    const availableLowland = [...lowlandOuterTiles, ...downtownRing].filter(t => !usedTiles.has(tileKey(t)));
    totalBuildings += placeBuildsInZone(
      state, availableLowland, civicBuilds, agent, agentName, usedTiles, byKey, 'civic'
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 4: COMMERCIAL & MARKETS — Scattered through accessible areas
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 4: Commercial and markets...');

  const commercialAgents = ['market_maker', 'maker_space', 'warehouse_district', 'pub_crawl'];
  for (const agentName of commercialAgents) {
    const agent = AGENTS[agentName];
    const commercialBuilds = agent.builds.filter(b => !b.small);
    const availableTiles = buildableTiles.filter(t =>
      !usedTiles.has(tileKey(t)) && (t.biome === 'lowlands' || t.biome === 'forest')
    );
    totalBuildings += placeBuildsInZone(
      state, availableTiles, commercialBuilds, agent, agentName, usedTiles, byKey, 'commercial'
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 5: FOREST ZONE — Timber buildings and cabins
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 5: Forest settlements...');

  // Timber towers
  const timberTowerAgents = ['timber_emoji_tree', 'carbon_negative', 'passive_house'];
  for (const agentName of timberTowerAgents) {
    const agent = AGENTS[agentName];
    const timberBuilds = agent.builds.filter(b => !b.small && b.typology === 'timber');
    const availableForest = forestTiles.filter(t => !usedTiles.has(tileKey(t)));
    totalBuildings += placeBuildsInZone(
      state, availableForest, timberBuilds, agent, agentName, usedTiles, byKey, 'forest'
    );
  }

  // Small cabins and cottages
  const cabinAgents = ['small_is_beautiful', 'tiny_house_nation', 'hermit_mode', 'co_op_collective'];
  for (const agentName of cabinAgents) {
    const agent = AGENTS[agentName];
    const smallBuilds = agent.builds.filter(b => b.small && b.typology === 'timber');
    const availableForest = forestTiles.filter(t => !usedTiles.has(tileKey(t)));
    totalBuildings += placeSmallBuildsInZone(
      state, availableForest, smallBuilds, agent, agentName, usedTiles, byKey, 'forest-cabins', 8
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 6: MOUNTAIN ZONE — Stone cottages and observatories
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 6: Mountain structures...');

  // Research and observation buildings
  const mountainAgents = ['research_institute', 'hermit_mode', 'sacred_spaces'];
  for (const agentName of mountainAgents) {
    const agent = AGENTS[agentName];
    const builds = agent.builds.filter(b => !b.small);
    const availableMountain = mountainTiles.filter(t => !usedTiles.has(tileKey(t)));
    totalBuildings += placeBuildsInZone(
      state, availableMountain, builds, agent, agentName, usedTiles, byKey, 'mountain'
    );
  }

  // Small mountain structures
  const mountainSmallAgents = ['small_is_beautiful', 'hermit_mode', 'oldways_guild'];
  for (const agentName of mountainSmallAgents) {
    const agent = AGENTS[agentName];
    const smallBuilds = agent.builds.filter(b => b.small && b.typology === 'masonry');
    const availableMountain = mountainTiles.filter(t => !usedTiles.has(tileKey(t)));
    totalBuildings += placeSmallBuildsInZone(
      state, availableMountain, smallBuilds, agent, agentName, usedTiles, byKey, 'mountain-small', 6
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 7: VERNACULAR & RURAL — Farms and traditional buildings
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 7: Vernacular and rural...');

  const ruralAgents = ['vernacular_99', 'oldways_guild'];
  for (const agentName of ruralAgents) {
    const agent = AGENTS[agentName];
    const ruralBuilds = agent.builds.filter(b => !b.small);
    // Place in outer lowlands and forest edges
    const ruralTiles = buildableTiles.filter(t =>
      !usedTiles.has(tileKey(t)) &&
      (t.biome === 'lowlands' || t.biome === 'forest') &&
      Math.abs(t.gx - avgX) > 4
    );
    totalBuildings += placeBuildsInZone(
      state, ruralTiles, ruralBuilds, agent, agentName, usedTiles, byKey, 'rural'
    );
  }

  // Small rural outbuildings
  for (const agentName of ruralAgents) {
    const agent = AGENTS[agentName];
    const smallBuilds = agent.builds.filter(b => b.small);
    const ruralTiles = buildableTiles.filter(t =>
      !usedTiles.has(tileKey(t)) && t.biome === 'lowlands'
    );
    totalBuildings += placeSmallBuildsInZone(
      state, ruralTiles, smallBuilds, agent, agentName, usedTiles, byKey, 'rural-small', 5
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 8: COASTAL — Hotels and beach-adjacent buildings
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 8: Coastal development...');

  const coastalAgents = ['grand_hotel', 'retreat_builder'];
  for (const agentName of coastalAgents) {
    const agent = AGENTS[agentName];
    const coastalBuilds = agent.builds.filter(b => !b.small);
    const availableCoastal = coastalTiles.filter(t => !usedTiles.has(tileKey(t)));
    totalBuildings += placeBuildsInZone(
      state, availableCoastal, coastalBuilds, agent, agentName, usedTiles, byKey, 'coastal'
    );
  }

  // Small coastal structures
  for (const agentName of coastalAgents) {
    const agent = AGENTS[agentName];
    const smallBuilds = agent.builds.filter(b => b.small);
    const availableCoastal = coastalTiles.filter(t => !usedTiles.has(tileKey(t)));
    totalBuildings += placeSmallBuildsInZone(
      state, availableCoastal, smallBuilds, agent, agentName, usedTiles, byKey, 'coastal-small', 4
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 9: HEALTHCARE & WELLNESS
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 9: Healthcare...');

  const healthAgents = ['healthcare_hero', 'retreat_builder'];
  for (const agentName of healthAgents) {
    const agent = AGENTS[agentName];
    const healthBuilds = agent.builds.filter(b => !b.small);
    const availableTiles = buildableTiles.filter(t =>
      !usedTiles.has(tileKey(t)) && t.biome !== 'mountain'
    );
    totalBuildings += placeBuildsInZone(
      state, availableTiles, healthBuilds, agent, agentName, usedTiles, byKey, 'health'
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 10: FOLLY & EXPERIMENTAL — Scattered art installations
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 10: Experimental structures...');

  const follyAgent = AGENTS['folly_builder'];
  if (follyAgent) {
    const follyBuilds = follyAgent.builds;
    const scatteredTiles = buildableTiles.filter(t =>
      !usedTiles.has(tileKey(t)) && Math.random() < 0.3  // Random scatter
    );
    totalBuildings += placeBuildsInZone(
      state, scatteredTiles, follyBuilds, follyAgent, 'folly_builder', usedTiles, byKey, 'folly'
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // PHASE 11: PROCESSING FACILITIES — Strategic placement
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 11: Processing facilities...');
  const industrialAgent = AGENTS['industrial_works'];

  // Sawmills at forest edges
  const forestEdgeTiles = forestTiles.filter(t => {
    const neighbors = forestTiles.filter(ft =>
      Math.abs(ft.gx - t.gx) <= 1 && Math.abs(ft.gy - t.gy) <= 1
    ).length;
    return neighbors >= 2 && neighbors <= 6 && !usedTiles.has(tileKey(t));
  });
  const sawmills = industrialAgent.builds.filter(b => b.subtype === 'sawmill');
  totalBuildings += placeBuildsInZone(
    state, forestEdgeTiles, sawmills, industrialAgent, 'industrial_works', usedTiles, byKey, 'processing'
  );

  // Brick kilns in lowlands
  const availableLowlandTiles = lowlandOuterTiles.filter(t => !usedTiles.has(tileKey(t)));
  const brickKilns = industrialAgent.builds.filter(b => b.subtype === 'brickKiln');
  totalBuildings += placeBuildsInZone(
    state, availableLowlandTiles.slice(0, 4), brickKilns, industrialAgent, 'industrial_works', usedTiles, byKey, 'processing'
  );

  // Concrete plant near mountains
  const availableMountainTiles = mountainTiles.filter(t => !usedTiles.has(tileKey(t)));
  const concretePlants = industrialAgent.builds.filter(b => b.subtype === 'concretePlant');
  totalBuildings += placeBuildsInZone(
    state, availableMountainTiles.slice(0, 2), concretePlants, industrialAgent, 'industrial_works', usedTiles, byKey, 'processing'
  );

  // Glass furnace near beach
  const glassFurnaces = industrialAgent.builds.filter(b => b.subtype === 'glassFurnace');
  const beachAdjacentTiles = buildableTiles.filter(t =>
    !usedTiles.has(tileKey(t)) &&
    state.island.tiles.some(bt => bt.biome === 'beach' &&
      Math.abs(bt.gx - t.gx) <= 1 && Math.abs(bt.gy - t.gy) <= 1)
  );
  totalBuildings += placeBuildsInZone(
    state, beachAdjacentTiles.slice(0, 2), glassFurnaces, industrialAgent, 'industrial_works', usedTiles, byKey, 'processing'
  );

  // ══════════════════════════════════════════════════════════════════
  // PHASE 12: INFILL — Fill remaining spaces organically
  // ══════════════════════════════════════════════════════════════════
  console.log('[PREPOPULATE] Phase 12: Organic infill...');

  const remainingTiles = buildableTiles.filter(t => !usedTiles.has(tileKey(t)));
  console.log(`[PREPOPULATE] ${remainingTiles.length} tiles remaining for infill`);

  // Random agent selection for remaining tiles
  const infillAgents = [
    'small_is_beautiful', 'tiny_house_nation', 'co_op_collective',
    'vernacular_99', 'pub_crawl', 'market_maker'
  ];

  for (const tile of shuffleArray(remainingTiles).slice(0, Math.floor(remainingTiles.length * 0.4))) {
    if (usedTiles.has(tileKey(tile))) continue;

    const agentName = infillAgents[Math.floor(Math.random() * infillAgents.length)];
    const agent = AGENTS[agentName];
    if (!agent) continue;

    const smallBuilds = agent.builds.filter(b => b.small);
    if (smallBuilds.length > 0) {
      totalBuildings += placeSmallBuildsInZone(
        state, [tile], smallBuilds, agent, agentName, usedTiles, byKey, 'infill', 1
      );
    }
  }

  const finalCount = usedTiles.size;
  console.log(`[PREPOPULATE] ════════════════════════════════════════`);
  console.log(`[PREPOPULATE] Generated ${totalBuildings} buildings on ${finalCount} tiles`);
  console.log(`[PREPOPULATE] Tile utilization: ${Math.round(finalCount / buildableTiles.length * 100)}%`);
}

/**
 * Place regular builds in a zone (1-2 per tile)
 */
function placeBuildsInZone(state, zoneTiles, builds, agent, agentName, usedTiles, byKey, zoneName) {
  if (!builds || builds.length === 0) return 0;

  const shuffledTiles = shuffleArray([...zoneTiles]);
  const shuffledBuilds = shuffleArray([...builds]);
  let placed = 0;
  let buildIndex = 0;

  for (const tile of shuffledTiles) {
    if (buildIndex >= shuffledBuilds.length) break;
    if (usedTiles.has(tileKey(tile))) continue;

    // Decide 1 or 2 buildings per tile
    const numBuildings = (Math.random() < 0.3 && shuffledBuilds.length - buildIndex >= 2) ? 2 : 1;
    const tileBuildings = [];

    for (let b = 0; b < numBuildings && buildIndex < shuffledBuilds.length; b++) {
      const buildSpec = shuffledBuilds[buildIndex];

      const placement = findPlacementWithVariation(
        tileBuildings,
        buildSpec.width,
        buildSpec.depth,
        false // not small
      );

      if (!placement) break;

      const buildingResult = createAgentBuilding(
        state, tile, buildSpec, agent, agentName, placement, tileBuildings.length
      );

      if (buildingResult) {
        tileBuildings.push({
          offset: placement.offset,
          rotation: placement.rotation,
          width: buildSpec.width,
          depth: buildSpec.depth,
          result: buildingResult
        });
        buildIndex++;
        placed++;
      }
    }

    if (tileBuildings.length > 0) {
      finalizeTileBuildings(state, tile, tileBuildings);
      usedTiles.add(tileKey(tile));
    }
  }

  console.log(`[PREPOPULATE] ${agentName} in ${zoneName}: ${placed} buildings`);
  return placed;
}

/**
 * Place small builds in a zone (2-5 per tile)
 * @param {number} maxTilesOverride - Optional limit on number of tiles to use
 */
function placeSmallBuildsInZone(state, zoneTiles, builds, agent, agentName, usedTiles, byKey, zoneName, maxTilesOverride = null) {
  if (!builds || builds.length === 0) return 0;

  const shuffledTiles = shuffleArray([...zoneTiles]);
  const shuffledBuilds = shuffleArray([...builds]);
  let placed = 0;
  let buildIndex = 0;

  // Use override or calculate based on zone size
  const maxTiles = maxTilesOverride || Math.max(3, Math.floor(shuffledTiles.length * 0.25));
  let tilesUsed = 0;

  for (const tile of shuffledTiles) {
    if (tilesUsed >= maxTiles) break;
    if (usedTiles.has(tileKey(tile))) continue;

    // 2-5 small buildings per tile for organic clustering
    const numBuildings = 2 + Math.floor(Math.random() * 4);
    const tileBuildings = [];

    for (let b = 0; b < numBuildings; b++) {
      // Cycle through builds with some randomness
      const buildSpec = shuffledBuilds[(buildIndex + Math.floor(Math.random() * 3)) % shuffledBuilds.length];

      const placement = findPlacementWithVariation(
        tileBuildings,
        buildSpec.width,
        buildSpec.depth,
        true // small buildings
      );

      if (!placement) break;

      const buildingResult = createAgentBuilding(
        state, tile, buildSpec, agent, agentName, placement, tileBuildings.length
      );

      if (buildingResult) {
        tileBuildings.push({
          offset: placement.offset,
          rotation: placement.rotation,
          width: buildSpec.width,
          depth: buildSpec.depth,
          result: buildingResult
        });
        buildIndex++;
        placed++;
      }
    }

    if (tileBuildings.length > 0) {
      finalizeTileBuildings(state, tile, tileBuildings);
      usedTiles.add(tileKey(tile));
      tilesUsed++;
    }
  }

  if (placed > 0) {
    console.log(`[PREPOPULATE] ${agentName} in ${zoneName}: ${placed} buildings on ${tilesUsed} tiles`);
  }
  return placed;
}

/**
 * Find a non-colliding position with interesting variation
 */
function findPlacementWithVariation(existingBuildings, width, depth, isSmall) {
  const TILE_SIZE = 130;
  const PADDING = isSmall ? 5 : 10;
  const MAX_ATTEMPTS = 30;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Random rotation with more variation
    const rotation = pickVariedRotation();

    // Effective dimensions after rotation
    const rotCos = Math.abs(Math.cos(rotation));
    const rotSin = Math.abs(Math.sin(rotation));
    const effWidth = width * rotCos + depth * rotSin;
    const effDepth = width * rotSin + depth * rotCos;

    // Random position within tile bounds
    const maxOffsetX = (TILE_SIZE - effWidth) / 2 - PADDING;
    const maxOffsetZ = (TILE_SIZE - effDepth) / 2 - PADDING;

    if (maxOffsetX < 0 || maxOffsetZ < 0) continue;

    // Non-centered distribution - avoid center cluster
    let offsetX, offsetZ;
    if (existingBuildings.length === 0) {
      // First building: anywhere but dead center
      const r = Math.random();
      if (r < 0.5) {
        // Quadrant placement
        offsetX = (Math.random() * 0.6 + 0.2) * maxOffsetX * (Math.random() < 0.5 ? 1 : -1);
        offsetZ = (Math.random() * 0.6 + 0.2) * maxOffsetZ * (Math.random() < 0.5 ? 1 : -1);
      } else {
        // Edge placement
        if (Math.random() < 0.5) {
          offsetX = maxOffsetX * (Math.random() < 0.5 ? 0.8 : -0.8);
          offsetZ = (Math.random() - 0.5) * maxOffsetZ * 1.5;
        } else {
          offsetX = (Math.random() - 0.5) * maxOffsetX * 1.5;
          offsetZ = maxOffsetZ * (Math.random() < 0.5 ? 0.8 : -0.8);
        }
      }
    } else {
      // Subsequent buildings: random position
      offsetX = (Math.random() - 0.5) * 2 * maxOffsetX;
      offsetZ = (Math.random() - 0.5) * 2 * maxOffsetZ;
    }

    // Clamp to bounds
    offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, offsetX));
    offsetZ = Math.max(-maxOffsetZ, Math.min(maxOffsetZ, offsetZ));

    // Check collision with existing buildings
    let collides = false;
    for (const existing of existingBuildings) {
      if (checkCollision(
        offsetX, offsetZ, effWidth, effDepth,
        existing.offset.x, existing.offset.z, existing.width, existing.depth,
        PADDING
      )) {
        collides = true;
        break;
      }
    }

    if (!collides) {
      return { offset: { x: offsetX, z: offsetZ }, rotation };
    }
  }

  return null;
}

/**
 * Pick a varied rotation angle (not just 90 degree increments)
 */
function pickVariedRotation() {
  const r = Math.random();
  if (r < 0.4) {
    // Cardinal directions with slight variation
    const base = Math.floor(Math.random() * 4) * (Math.PI / 2);
    return base + (Math.random() - 0.5) * 0.15;
  } else if (r < 0.7) {
    // Diagonal directions
    const base = (Math.floor(Math.random() * 4) * (Math.PI / 2)) + (Math.PI / 4);
    return base + (Math.random() - 0.5) * 0.1;
  } else {
    // Fully random rotation
    return Math.random() * Math.PI * 2;
  }
}

/**
 * Check if two rectangles collide (with padding)
 */
function checkCollision(x1, z1, w1, d1, x2, z2, w2, d2, padding) {
  const left1 = x1 - w1 / 2 - padding;
  const right1 = x1 + w1 / 2 + padding;
  const top1 = z1 - d1 / 2 - padding;
  const bottom1 = z1 + d1 / 2 + padding;

  const left2 = x2 - w2 / 2;
  const right2 = x2 + w2 / 2;
  const top2 = z2 - d2 / 2;
  const bottom2 = z2 + d2 / 2;

  return !(right1 < left2 || left1 > right2 || bottom1 < top2 || top1 > bottom2);
}

/**
 * Create a single building for an agent
 */
function createAgentBuilding(state, tile, buildSpec, agent, agentName, placement, indexOnTile) {
  const { name, category, typology, floors, width, depth, subtype } = buildSpec;
  const { offset, rotation } = placement;

  const id = state.island.nextBuildId++;
  const buildingSeed = tile.gx * 10000 + tile.gy * 100 + id + indexOnTile * 7;

  // Generate the 3D building
  let buildingResult;
  try {
    buildingResult = FormGenerator.generateBuildingHeadless({
      category,
      typology,
      floors,
      width,
      depth,
      floorHeight: 12,
      seed: buildingSeed
    });
  } catch (err) {
    console.warn(`[PREPOPULATE] Failed to generate ${name}:`, err);
    return null;
  }

  if (!buildingResult || !buildingResult.group) {
    return null;
  }

  // Calculate stats
  const height = floors * 12;
  const grossArea = width * depth * floors;

  // Material based on typology
  const materialMap = {
    commercial: 'concrete',
    masonry: 'brick',
    sculptural: 'concrete',
    timber: 'timber',
    brutalist: 'concrete',
    industrial: 'concrete'
  };
  const primaryMaterial = materialMap[typology] || 'concrete';

  // Material requirements - include all materials based on typology and scale
  const isGlassTower = ['diagrid', 'twisted', 'spire', 'setback', 'curtainwall', 'organic'].includes(typology);
  const needsSteel = floors >= 6 || isGlassTower;  // Tall buildings need steel structure
  const isCommercial = ['commercial', 'diagrid', 'twisted', 'spire', 'setback', 'curtainwall'].includes(typology);

  const materialReq = {
    timber: primaryMaterial === 'timber' ? Math.round(grossArea * 0.1) : Math.round(grossArea * 0.02),
    stone: ['masonry', 'brutalist'].includes(typology) ? Math.round(grossArea * 0.08) : Math.round(grossArea * 0.01),
    brick: primaryMaterial === 'brick' ? Math.round(grossArea * 0.06) : 0,
    concrete: ['commercial', 'brutalist', 'sculptural', 'diagrid', 'twisted', 'organic'].includes(typology) ? Math.round(grossArea * 0.1) : Math.round(grossArea * 0.02),
    glass: isGlassTower ? Math.round(grossArea * 0.04) : (isCommercial ? Math.round(grossArea * 0.01) : 0),
    steel: needsSteel ? Math.round(grossArea * 0.03 * (floors / 10)) : 0
  };

  // Carbon - include glass and steel
  let embodiedCarbon = 0;
  embodiedCarbon += materialReq.timber * 0.0008;
  embodiedCarbon += materialReq.stone * 0.012;
  embodiedCarbon += materialReq.brick * 0.0006;
  embodiedCarbon += materialReq.concrete * 0.025;
  embodiedCarbon += materialReq.glass * 0.015;   // Glass has moderate embodied carbon
  embodiedCarbon += materialReq.steel * 0.05;    // Steel has high embodied carbon

  // Labor
  const laborRequired = Math.round(grossArea / 50) + floors * 10;

  // Sourcing - create full supply chain draws
  const supplyChainDraws = createSupplyChainDraws(state, tile, typology, floors, grossArea);
  const simplifiedDraws = createSimplifiedDraws(state, tile, typology, floors);
  const depletionFraction = floors >= 6 ? 1.0 : 0.5;

  // Calculate labor breakdown
  const extractionLabor = Math.round(grossArea / 200);  // hrs at source tiles
  const processingLabor = supplyChainDraws.reduce((sum, d) => sum + (d.processingLabor || 0), 0);
  const transportLabor = Math.round(grossArea / 500);   // hrs hauling
  const constructionLabor = laborRequired;              // hrs on site

  const laborBreakdown = {
    extraction: extractionLabor,
    processing: processingLabor,
    transport: transportLabor,
    construction: constructionLabor,
    total: extractionLabor + processingLabor + transportLabor + constructionLabor
  };

  // Build record
  const build = {
    id,
    name,
    author: agentName,
    authorSpecies: agent.species,
    authorStyle: agent.style,
    method: 'ai',
    primaryTile: { gx: tile.gx, gy: tile.gy },
    tiles: [{ gx: tile.gx, gy: tile.gy }],
    committedDay: Math.floor(Math.random() * 100) + 1,
    constructionDays: Math.round(laborRequired / 20),
    condition: 0.75 + Math.random() * 0.25,
    lastMaintained: Math.floor(Math.random() * 50) + 1,
    deathPlan: 'demolish-salvage',
    materialReq,
    laborReq: laborRequired,
    wasteReq: { soil: Math.round(grossArea * 0.05), debris: 0 },
    waterReq: Math.round(grossArea * 0.02),
    embodiedCarbon: +embodiedCarbon.toFixed(2),
    transportCarbon: +(Math.random() * 0.5).toFixed(3),
    status: 'standing',
    stats: {
      floors,
      height,
      grossArea: Math.round(grossArea),
      category,
      typology,
      primaryMaterial,
      width,
      depth,
      subtype    // Processing facility type (sawmill, brickKiln, concretePlant, glassFurnace)
    },
    offset: { x: offset.x, z: offset.z },
    rotation,
    simplifiedDraws,
    depletionFraction,
    laborBreakdown,
    draws: supplyChainDraws.length > 0 ? supplyChainDraws : simplifiedDraws.map(sd => ({
      fromTile: sd.tile,
      material: sd.material,
      amount: materialReq[sd.material] || 100,
      distanceFt: Math.round(Math.random() * 500) + 100,
      fromSalvage: false,
      depletionFraction: sd.depletionFraction
    }))
  };

  // Assign waste to a dump site
  const wasteAmount = build.wasteReq?.soil || 0;
  if (wasteAmount > 0) {
    const dumpSite = findBestDumpSite(state, wasteAmount);
    if (dumpSite) {
      const actualDumped = addWasteToDumpSite(state, dumpSite, wasteAmount);
      build.wasteDestination = {
        tile: { gx: dumpSite.gx, gy: dumpSite.gy },
        amount: actualDumped
      };
    }
  }

  // Calculate grade
  build.grade = calculateBuildGrade(build);

  // Add to state builds
  state.island.builds.push(build);

  // Apply depletion and record actual extraction amounts
  for (const draw of simplifiedDraws) {
    const sourceTile = state.island.tiles.find(t =>
      t.gx === draw.tile.gx && t.gy === draw.tile.gy
    );
    if (sourceTile) {
      // Apply visual depletion fraction
      applyTileDepletion(state, sourceTile, draw.material, draw.depletionFraction * 0.3);

      // Record actual extraction amount for resource tracking
      const ext = tileExtractionFor(state, sourceTile.gx, sourceTile.gy);
      const matSpec = ISLAND_MATERIALS[draw.material];
      if (matSpec && matSpec.yieldPerTile) {
        // Extract proportional to building size and depletion
        const extractAmount = Math.round(matSpec.yieldPerTile * draw.depletionFraction * 0.3);
        ext[draw.material] = (ext[draw.material] || 0) + extractAmount;
      }
    }
  }

  return {
    id,
    name,
    group: buildingResult.group,
    isoImage: buildingResult.isoImage,
    stats: buildingResult.stats,
    offset,
    rotation,
    floors,
    height,
    primaryMaterial,
    category,
    typology
  };
}

/**
 * Finalize a tile with all its buildings
 */
function finalizeTileBuildings(state, tile, tileBuildings) {
  tile.built = true;
  tile.buildId = tileBuildings[0].result.id;

  // Collect all walk meshes with their positions
  const walkMeshes = tileBuildings.map(b => ({
    group: b.result.group,
    offset: b.offset,
    rotation: b.rotation,
    stats: b.result.stats
  }));

  const primaryBuilding = tileBuildings[0].result;
  const totalFloors = Math.max(...tileBuildings.map(b => b.result.floors));
  const totalHeight = Math.max(...tileBuildings.map(b => b.result.height));

  // Render combined ISO image of all buildings on this tile
  const buildingsForIso = tileBuildings.map(b => ({
    group: b.result.group,
    offset: b.offset,
    rotation: b.rotation
  }));
  let combinedIsoImage = FormGenerator.renderMultipleBuildingsToIsoImage(buildingsForIso, 300, 400);

  // Fallback: if combined rendering failed, use the first building's individual ISO image
  if (!combinedIsoImage && tileBuildings.length > 0 && tileBuildings[0].result.isoImage) {
    combinedIsoImage = tileBuildings[0].result.isoImage;
    console.log('[PREPOPULATE] Using fallback ISO image for tile', tile.gx, tile.gy);
  }

  // Debug: log if we still don't have an ISO image
  if (!combinedIsoImage) {
    console.warn('[PREPOPULATE] No ISO image for tile', tile.gx, tile.gy, 'buildings:', tileBuildings.length);
  }

  // Calculate combined footprint dimensions for fallback rendering
  const maxWidth = Math.max(...tileBuildings.map(b => b.width || 50));
  const maxDepth = Math.max(...tileBuildings.map(b => b.depth || 40));

  tile.populated = {
    kind: 'ai',
    name: tileBuildings.length > 1
      ? `${primaryBuilding.name} (+${tileBuildings.length - 1} more)`
      : primaryBuilding.name,
    floors: totalFloors,
    height: totalHeight,
    condition: 0.85,
    progressFraction: 1.0,
    visibleFloors: totalFloors,
    spec: {
      floors: totalFloors,
      floor_height_ft: 12,
      primary_material: primaryBuilding.primaryMaterial,
      // Add footprint dimensions for fallback ISO rendering
      footprint_w: maxWidth / 8,  // Convert feet to grid units (8ft per unit)
      footprint_d: maxDepth / 8
    },
    walkMeshes,
    isoImage: combinedIsoImage,
    offset: { x: 0, z: 0 },
    buildingCount: tileBuildings.length,
    buildings: tileBuildings.map(b => ({
      id: b.result.id,
      name: b.result.name,
      category: b.result.category,
      typology: b.result.typology,
      offset: b.offset,
      rotation: b.rotation,
      width: b.width,
      depth: b.depth
    }))
  };
}

/**
 * Create supply chain draws for sourcing with processing facility references
 */
function createSupplyChainDraws(state, buildTile, typology, floors, grossArea) {
  const draws = [];
  const tiles = state.island.tiles;
  const builds = state.island.builds;
  const depletionFraction = floors >= 6 ? 1.0 : 0.5;

  // Materials needed by typology - includes both raw and processed
  const materialsByTypology = {
    commercial: [
      { material: 'concrete', amount: Math.round(grossArea * 0.1) },
      { material: 'glass', amount: Math.round(grossArea * 0.03) }
    ],
    masonry: [
      { material: 'brick', amount: Math.round(grossArea * 0.06) },
      { material: 'stone', amount: Math.round(grossArea * 0.04) }
    ],
    sculptural: [
      { material: 'concrete', amount: Math.round(grossArea * 0.12) }
    ],
    timber: [
      { material: 'timber', amount: Math.round(grossArea * 0.1) },
      { material: 'stone', amount: Math.round(grossArea * 0.02) }
    ],
    brutalist: [
      { material: 'concrete', amount: Math.round(grossArea * 0.15) }
    ],
    industrial: [
      { material: 'concrete', amount: Math.round(grossArea * 0.08) },
      { material: 'stone', amount: Math.round(grossArea * 0.05) }
    ]
  };

  const materialsNeeded = materialsByTypology[typology] || [
    { material: 'stone', amount: Math.round(grossArea * 0.05) }
  ];

  for (const { material, amount } of materialsNeeded) {
    const facilityType = MATERIAL_TO_FACILITY[material];

    if (facilityType) {
      // Processed material - find processing facility
      const facility = findNearestProcessingFacility(state, buildTile, facilityType);
      const facilityInfo = PROCESSING_FACILITIES[facilityType];

      // Get raw material info
      const rawMaterials = Object.keys(facilityInfo.consumes);
      const primaryRaw = rawMaterials[0];
      const rawBiome = MATERIAL_BIOMES[primaryRaw];
      const rawTile = findNearestBiomeTile(tiles, facility?.tile || buildTile, rawBiome);

      // Calculate raw amount needed
      const rawRatio = facilityInfo.consumes[primaryRaw] || 1;
      const rawAmount = Math.ceil(amount * rawRatio);

      // Processing labor
      const processingLabor = Math.round(amount * facilityInfo.laborPerUnit);

      draws.push({
        material,
        amount,
        // Source chain
        rawSourceTile: rawTile ? { gx: rawTile.gx, gy: rawTile.gy, biome: rawTile.biome } : null,
        rawMaterial: primaryRaw,
        rawAmount,
        // Processing
        processingBuilding: facility ? {
          id: facility.id,
          name: facility.name,
          tile: facility.primaryTile,
          subtype: facilityType
        } : null,
        processingLabor,
        // Delivery
        toTile: { gx: buildTile.gx, gy: buildTile.gy },
        depletionFraction
      });
    } else {
      // Raw material - direct sourcing (no processing needed)
      const biome = MATERIAL_BIOMES[material];
      if (!biome) continue;

      const sourceTile = findNearestBiomeTile(tiles, buildTile, biome);

      if (sourceTile) {
        draws.push({
          material,
          amount,
          rawSourceTile: { gx: sourceTile.gx, gy: sourceTile.gy, biome: sourceTile.biome },
          rawMaterial: material,
          rawAmount: amount,
          processingBuilding: null,
          processingLabor: 0,
          toTile: { gx: buildTile.gx, gy: buildTile.gy },
          depletionFraction
        });
      }
    }
  }

  return draws;
}

/**
 * Find nearest processing facility of a given type
 */
function findNearestProcessingFacility(state, fromTile, facilityType) {
  const builds = state.island.builds || [];
  const facilities = builds.filter(b =>
    b.stats?.subtype === facilityType
  );

  if (facilities.length === 0) return null;

  return facilities.sort((a, b) => {
    const distA = distance(a.primaryTile, fromTile);
    const distB = distance(b.primaryTile, fromTile);
    return distA - distB;
  })[0];
}

/**
 * Find nearest tile of a specific biome
 */
function findNearestBiomeTile(tiles, fromTile, biome) {
  return tiles
    .filter(t => t.biome === biome)
    .sort((a, b) => distance(a, fromTile) - distance(b, fromTile))[0] || null;
}

/**
 * Create simplified draws for sourcing (legacy compatibility)
 */
function createSimplifiedDraws(state, buildTile, typology, floors) {
  const draws = [];
  const tiles = state.island.tiles;
  const depletionFraction = floors >= 6 ? 1.0 : 0.5;

  const materialsByTypology = {
    commercial: ['stone', 'sand'],
    masonry: ['clay', 'stone'],
    sculptural: ['stone', 'sand'],
    timber: ['timber', 'stone'],
    brutalist: ['stone', 'sand'],
    industrial: ['stone', 'sand']
  };

  const materialsNeeded = materialsByTypology[typology] || ['stone', 'timber'];

  for (const material of materialsNeeded) {
    const biome = MATERIAL_BIOMES[material];
    if (!biome) continue;

    const sourceTile = tiles
      .filter(t => t.biome === biome)
      .sort((a, b) => distance(a, buildTile) - distance(b, buildTile))[0];

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

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════

function tileKey(t) {
  return `${t.gx}:${t.gy}`;
}

function distance(t1, t2) {
  return Math.abs(t1.gx - t2.gx) + Math.abs(t1.gy - t2.gy);
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Get list of all agent names for UI display
 */
export function getAgentNames() {
  return Object.keys(AGENTS);
}

/**
 * Get agent info by name
 */
export function getAgentInfo(name) {
  return AGENTS[name] || null;
}

/**
 * Get builds by agent name
 */
export function getBuildsByAgent(state, agentName) {
  return state.island.builds.filter(b => b.author === agentName);
}
