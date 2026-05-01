// ════════════════════════════════════════════════════════════════════
// ARCHETYPE GRAMMAR SYSTEM
// Each archetype defines materials, massing rules, structure, openings,
// roof, ground relationship, and details. User never chooses materials -
// archetype determines everything.
// ════════════════════════════════════════════════════════════════════

export const ARCHETYPES = {

  // ─────────────────────────────────────────────────────────────────
  // PARAMETRIC (MVRDV, OMA, BIG)
  // Stacked programmatic boxes, pixelated urbanism, playful shifts
  // ─────────────────────────────────────────────────────────────────
  parametric: {
    id: 'parametric',
    name: 'Parametric',
    references: ['MVRDV', 'OMA', 'BIG', 'Snøhetta'],
    description: 'Stacked volumes with dramatic shifts, cantilevers, and carved voids',

    materials: {
      primary: 'white_render',
      secondary: 'glass',
      accent: 'colored_panel',  // bright accents
      structure: 'concrete'
    },

    massing: {
      strategy: 'stack_and_shift',
      footprintCoverage: [0.6, 0.9],
      floors: { min: 2, max: 6, typical: 3 },
      floorHeight: { min: 10, max: 14, typical: 12 },

      rules: {
        baseVolume: {
          coverage: [0.6, 0.8],
          floors: [1, 2]
        },
        stackedVolumes: {
          count: [1, 3],
          shiftX: [-0.3, 0.3],
          shiftZ: [-0.3, 0.3],
          rotation: [0, 15, -15],
          scale: [0.7, 1.2]
        },
        cantilever: {
          probability: 0.5,
          maxExtension: 0.4,
          requiresSupport: true,
          supportTypes: ['tapered_beam', 'diagonal_brace', 'V_column']
        },
        voids: {
          probability: 0.4,
          minSize: 0.15,
          maxSize: 0.4,
          locations: ['corner', 'center', 'through']
        }
      }
    },

    structure: {
      expression: 'selective',
      columnGrid: [20, 30],
      columnsVisible: false,
      cantileverSupport: {
        visible: true,
        forms: ['tapered_slab', 'V_column', 'diagonal']
      }
    },

    openings: {
      windows: {
        type: 'irregular_punch',
        sizes: ['small', 'medium', 'large', 'full_height'],
        distribution: 'clustered',
        frameless: true,
        density: [0.3, 0.5]
      },
      balconies: {
        probability: 0.3,
        type: 'carved_terrace',
        balustrade: 'glass'
      }
    },

    roof: {
      type: 'flat',
      parapet: false,
      edge: 'sharp',
      features: ['terrace', 'planting'],
      equipmentVisible: false
    },

    ground: {
      options: ['at_grade', 'pilotis', 'partial_pilotis'],
      pilotisProbability: 0.4,
      pilotisHeight: [8, 12],
      entryType: 'compressed',
      landscapeIntegration: true
    },

    colors: {
      primary: 0xFFFFFF,
      accent: [0xFFCC00, 0xFF6600, 0x0066FF, 0x00CC66],
      glass: 0x88BBDD
    }
  },

  // ─────────────────────────────────────────────────────────────────
  // BRUTALIST (Ando, Kahn, Zumthor)
  // Monolithic mass, carved light, material honesty
  // ─────────────────────────────────────────────────────────────────
  brutalist: {
    id: 'brutalist',
    name: 'Brutalist',
    references: ['Tadao Ando', 'Louis Kahn', 'Peter Zumthor'],
    description: 'Monolithic concrete forms with carved voids and dramatic light',

    materials: {
      primary: 'board_formed_concrete',
      secondary: 'raw_concrete',
      accent: 'corten',
      structure: 'exposed_concrete'
    },

    massing: {
      strategy: 'carved_monolith',
      footprintCoverage: [0.8, 1.0],
      floors: { min: 1, max: 4, typical: 2 },
      floorHeight: { min: 12, max: 18, typical: 14 },

      rules: {
        monolith: {
          startSolid: true,
          wallThickness: [12, 24]
        },
        courtyardVoid: {
          probability: 0.5,
          size: [0.15, 0.35],
          positions: ['center', 'offset'],
          openToSky: true
        },
        lightSlot: {
          probability: 0.7,
          width: [2, 6],
          orientation: 'vertical',
          penetration: 'partial'
        },
        cantilever: {
          probability: 0.3,
          maxExtension: 0.25,
          form: 'solid_slab',
          undersideTexture: 'board_formed'
        }
      }
    },

    structure: {
      expression: 'monolithic',
      wallType: 'load_bearing',
      wallThickness: [12, 24],
      openingsRequireLintel: true
    },

    openings: {
      windows: {
        type: 'carved',
        proportion: 'vertical',
        reveal: [12, 24],
        frameType: 'recessed_dark',
        density: [0.15, 0.25]
      },
      entries: {
        type: 'compressed_monumental',
        sequence: ['compression', 'expansion']
      }
    },

    roof: {
      type: 'hidden_flat',
      parapetHeight: [24, 48],
      parapetProfile: 'tapered',
      drainageInternal: true
    },

    ground: {
      relationship: 'rooted',
      plinthHeight: [18, 36],
      plinthMaterial: 'same_as_walls',
      entrySteps: [3, 7],
      landscape: 'minimal'
    },

    colors: {
      primary: 0x888888,
      secondary: 0x666666,
      accent: 0x8B4513
    }
  },

  // ─────────────────────────────────────────────────────────────────
  // ORGANIC (Bo Bardi, Niemeyer, Hadid)
  // Flowing forms, curves, integration with landscape
  // ─────────────────────────────────────────────────────────────────
  organic: {
    id: 'organic',
    name: 'Organic',
    references: ['Lina Bo Bardi', 'Oscar Niemeyer', 'Zaha Hadid'],
    description: 'Flowing curved forms, dramatic cantilevers, landscape integration',

    materials: {
      primary: 'white_concrete',
      secondary: 'timber',
      accent: 'copper',
      structure: 'white_steel'
    },

    massing: {
      strategy: 'flowing_shell',
      footprintCoverage: [0.4, 0.8],
      floors: { min: 1, max: 3, typical: 2 },
      floorHeight: { min: 12, max: 20, typical: 14 },

      rules: {
        shell: {
          probability: 0.6,
          curvature: ['single', 'double'],
          span: [40, 120],
          edgeThickness: 'thin'
        },
        pilotis: {
          probability: 0.7,
          height: [8, 20],
          columnForm: ['round', 'V', 'tree', 'Y'],
          density: 'minimal'
        },
        curvedWalls: {
          probability: 0.8,
          radius: [20, 100]
        },
        ramps: {
          probability: 0.5,
          slope: [0.05, 0.08],
          form: 'curved'
        },
        cantilever: {
          probability: 0.6,
          maxExtension: 0.5,
          supportHidden: true
        }
      }
    },

    structure: {
      expression: 'minimal',
      shellThickness: [3, 6],
      columnType: 'sculptural',
      columnForms: ['tree', 'V', 'Y', 'thin_round'],
      taper: true
    },

    openings: {
      windows: {
        type: 'ribbon',
        height: 'floor_to_ceiling',
        frameType: 'minimal_white',
        curved: true,
        density: [0.4, 0.6]
      },
      glassWalls: {
        probability: 0.6
      }
    },

    roof: {
      type: 'shell',
      forms: ['dome', 'vault', 'hyperbolic', 'free_form'],
      edge: 'thin_or_upturned',
      color: 'white',
      greenRoofProbability: 0.3
    },

    ground: {
      relationship: 'floating',
      pilotis: true,
      landscapeContinuesUnder: true,
      ramps: true,
      waterFeatureProbability: 0.4
    },

    colors: {
      primary: 0xFAFAFA,
      secondary: 0xDEB887,
      accent: 0xB87333
    }
  },

  // ─────────────────────────────────────────────────────────────────
  // VERNACULAR (Traditional, Regional)
  // Local materials, pitched roofs, additive growth
  // ─────────────────────────────────────────────────────────────────
  vernacular: {
    id: 'vernacular',
    name: 'Vernacular',
    references: ['Traditional', 'Regional', 'Rural'],
    description: 'Traditional forms with pitched roofs, local materials, additive rooms',

    materials: {
      primary: 'stone',
      secondary: 'timber',
      accent: 'brick',
      roof: 'slate',
      trim: 'painted_wood'
    },

    massing: {
      strategy: 'additive_rooms',
      footprintCoverage: [0.5, 0.8],
      floors: { min: 1, max: 3, typical: 2 },
      floorHeight: { min: 9, max: 12, typical: 10 },

      rules: {
        mainVolume: {
          proportion: 'elongated',
          roofPitch: [35, 50]
        },
        additions: {
          probability: 0.7,
          connection: 'perpendicular',
          scale: [0.5, 0.8],
          count: [1, 2]
        },
        dormers: {
          probability: 0.6,
          count: [1, 4],
          forms: ['gabled', 'shed', 'eyebrow']
        },
        chimney: {
          probability: 0.8,
          locations: ['gable_end', 'ridge', 'exterior'],
          material: 'brick'
        },
        porch: {
          probability: 0.7,
          depth: [6, 12],
          columnType: 'timber_or_stone',
          roofType: 'shed'
        }
      }
    },

    structure: {
      expression: 'honest',
      wallType: 'load_bearing',
      timberVisible: true,
      timberType: ['post_and_beam', 'king_post_truss']
    },

    openings: {
      windows: {
        type: 'traditional_punch',
        proportion: 'vertical',
        dividedLights: true,
        pattern: ['6_over_6', '4_over_4'],
        shutterProbability: 0.5,
        density: [0.2, 0.35]
      },
      doors: {
        type: 'paneled',
        transomProbability: 0.4
      }
    },

    roof: {
      type: 'pitched',
      pitch: [35, 50],
      forms: ['gable', 'hip', 'gambrel'],
      overhang: [18, 36],
      material: 'slate'
    },

    ground: {
      relationship: 'settled',
      plinthHeight: [12, 36],
      plinthMaterial: 'stone',
      entrySteps: [2, 5],
      landscape: 'traditional'
    },

    colors: {
      primary: 0x8B8B7A,
      secondary: 0xA0522D,
      accent: 0x8B4513,
      trim: 0xFFFFF0
    }
  },

  // ─────────────────────────────────────────────────────────────────
  // INDUSTRIAL (Eames, Prouve, High-Tech)
  // Exposed structure, prefabrication, machine aesthetic
  // ─────────────────────────────────────────────────────────────────
  industrial: {
    id: 'industrial',
    name: 'Industrial',
    references: ['Eames', 'Jean Prouvé', 'Renzo Piano', 'Richard Rogers'],
    description: 'Exposed steel structure, infill panels, industrial materials',

    materials: {
      primary: 'steel',
      secondary: 'glass',
      accent: 'corrugated_metal',
      panel: 'cement_board',
      structure: 'painted_steel'
    },

    massing: {
      strategy: 'frame_and_infill',
      footprintCoverage: [0.7, 1.0],
      floors: { min: 1, max: 3, typical: 1 },
      floorHeight: { min: 12, max: 20, typical: 16 },

      rules: {
        frame: {
          grid: [20, 30],
          expression: 'exterior',
          material: 'steel'
        },
        infill: {
          types: ['glass', 'metal_panel', 'cement_board'],
          pattern: 'varied',
          operablePanels: 0.3
        },
        clearSpan: {
          probability: 0.6,
          span: [40, 80],
          structure: ['truss', 'space_frame', 'portal_frame']
        },
        modularAddition: {
          basedOnGrid: true
        }
      }
    },

    structure: {
      expression: 'celebrated',
      frameType: 'moment_frame',
      connectionsVisible: true,
      bracingTypes: ['X_brace', 'chevron', 'K_brace'],
      bracingVisible: true,
      roofStructure: ['bar_joist', 'truss', 'space_frame']
    },

    openings: {
      windows: {
        type: 'curtain_wall',
        gridModule: 'structural',
        frameType: 'aluminum_or_steel',
        operableTypes: ['awning', 'pivot', 'sliding'],
        density: [0.4, 0.7]
      },
      skylights: {
        probability: 0.6,
        types: ['sawtooth', 'monitor', 'strip']
      }
    },

    roof: {
      type: 'industrial',
      forms: ['flat', 'shed', 'sawtooth', 'barrel'],
      material: 'standing_seam_metal',
      drainageExposed: true,
      equipmentVisible: true
    },

    ground: {
      relationship: 'utilitarian',
      floorType: 'concrete_slab',
      floorFinish: 'polished',
      entryDirect: true,
      loadingDockProbability: 0.3,
      landscape: 'minimal'
    },

    colors: {
      primary: 0x333333,
      secondary: 0x666666,
      accent: 0xFF4444,
      frame: 0x222222
    }
  },

  // ─────────────────────────────────────────────────────────────────
  // MINIMALIST (Pawson, Campo Baeza)
  // Essential forms, precise details, serenity
  // ─────────────────────────────────────────────────────────────────
  minimalist: {
    id: 'minimalist',
    name: 'Minimalist',
    references: ['John Pawson', 'Alberto Campo Baeza', 'Claudio Silvestrin'],
    description: 'Pure volumes, hidden details, precise proportions, serene spaces',

    materials: {
      primary: 'white_plaster',
      secondary: 'natural_stone',
      accent: 'natural_wood',
      glass: 'frameless',
      metal: 'bronze'
    },

    massing: {
      strategy: 'pure_volumes',
      footprintCoverage: [0.5, 0.8],
      floors: { min: 1, max: 3, typical: 2 },
      floorHeight: { min: 10, max: 14, typical: 12 },

      rules: {
        pureBox: {
          proportion: 'golden_ratio',
          cornersSharp: true
        },
        courtyard: {
          probability: 0.6,
          size: [0.2, 0.4],
          waterFeatureProbability: 0.5
        },
        slot: {
          probability: 0.4,
          width: [3, 6],
          orientationToLight: true
        },
        nothingExtra: true
      }
    },

    structure: {
      expression: 'hidden',
      wallType: 'load_bearing',
      finishSeamless: true,
      reveals: 'shadow_gap',
      tolerances: 'precise'
    },

    openings: {
      windows: {
        type: 'carefully_placed',
        frameHidden: true,
        height: 'floor_to_ceiling',
        proportion: 'golden_ratio',
        countMinimal: true,
        density: [0.15, 0.3]
      },
      doors: {
        type: 'flush_pivot',
        handleIntegrated: true,
        thresholdFlush: true
      }
    },

    roof: {
      type: 'flat_invisible',
      edge: 'knife',
      drainageInternal: true,
      parapetNone: true,
      equipmentHidden: true
    },

    ground: {
      relationship: 'precise',
      floorMaterial: 'stone',
      floorContinuesOutside: true,
      entrySubtle: true,
      landscape: 'minimal_geometric',
      waterFeatureProbability: 0.4,
      wallsExtendToLandscape: true
    },

    colors: {
      primary: 0xFFFFF8,
      secondary: 0xE8E4DE,
      accent: 0xC9A868,
      stone: 0xD4C4B0
    }
  }
};

// ── HELPER FUNCTIONS ─────────────────────────────────────────────────

/**
 * Get random value within range
 */
export function randomInRange(min, max, rng = Math.random) {
  return min + rng() * (max - min);
}

/**
 * Get random element from array
 */
export function randomChoice(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Check probability
 */
export function checkProbability(prob, rng = Math.random) {
  return rng() < prob;
}

/**
 * Get archetype by ID
 */
export function getArchetype(id) {
  return ARCHETYPES[id] || ARCHETYPES.parametric;
}

/**
 * List all archetype IDs
 */
export function getArchetypeIds() {
  return Object.keys(ARCHETYPES);
}

/**
 * Get material color for archetype
 */
export function getArchetypeMaterialColor(archetype, materialType) {
  const arch = typeof archetype === 'string' ? getArchetype(archetype) : archetype;

  switch (materialType) {
    case 'primary':
      return arch.colors.primary;
    case 'secondary':
      return arch.colors.secondary || arch.colors.primary;
    case 'accent':
      if (Array.isArray(arch.colors.accent)) {
        return randomChoice(arch.colors.accent);
      }
      return arch.colors.accent || arch.colors.primary;
    case 'structure':
      return arch.colors.frame || arch.colors.secondary || 0x888888;
    case 'glass':
      return arch.colors.glass || 0x88BBDD;
    default:
      return arch.colors.primary;
  }
}

/**
 * Compute building parameters from archetype and polygon
 */
export function computeArchetypeParams(archetype, polygon, rng = Math.random) {
  const arch = typeof archetype === 'string' ? getArchetype(archetype) : archetype;
  const area = polygon.area || 5000;

  // Determine floor count based on area and archetype
  const { min, max, typical } = arch.massing.floors;
  let floors;
  if (area < 2000) {
    floors = Math.max(min, typical - 1);
  } else if (area > 8000) {
    floors = Math.min(max, typical + 1);
  } else {
    floors = typical;
  }

  // Floor height
  const floorHeight = randomInRange(
    arch.massing.floorHeight.min,
    arch.massing.floorHeight.max,
    rng
  );

  // Footprint coverage
  const coverage = randomInRange(
    arch.massing.footprintCoverage[0],
    arch.massing.footprintCoverage[1],
    rng
  );

  // Ground condition
  let groundCondition = 'at_grade';
  if (arch.ground.pilotisProbability && checkProbability(arch.ground.pilotisProbability, rng)) {
    groundCondition = 'pilotis';
  }

  return {
    floors,
    floorHeight,
    coverage,
    groundCondition,
    totalHeight: floors * floorHeight,
    archetype: arch
  };
}
