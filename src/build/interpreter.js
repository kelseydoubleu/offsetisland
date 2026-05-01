// ════════════════════════════════════════════════════════════════════
// GENE INTERPRETER
// Translates architectural genes into shape grammar operations
// ════════════════════════════════════════════════════════════════════

/**
 * GeneInterpreter: Converts AI-generated architectural genes into
 * concrete shape grammar operations that can be rendered in 3D.
 */
export class GeneInterpreter {
  constructor(genes, polygon) {
    this.genes = genes;
    this.polygon = polygon;
    this.operations = [];
    this.rngSeed = this.computeSeed();
  }

  /**
   * Compute a deterministic seed from genes and polygon for reproducibility.
   */
  computeSeed() {
    let seed = 0;
    if (this.polygon?.tiles) {
      for (const t of this.polygon.tiles) {
        seed += t.gx * 1000 + t.gy * 100;
      }
    }
    seed += (this.genes.name || '').length * 17;
    seed += Date.now() % 10000;
    return seed;
  }

  /**
   * Simple seeded RNG.
   */
  rng() {
    this.rngSeed = (this.rngSeed * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (this.rngSeed >>> 0) / 0xFFFFFFFF;
  }

  rr(min, max) {
    return min + this.rng() * (max - min);
  }

  ri(min, max) {
    return Math.floor(this.rr(min, max + 1));
  }

  pick(arr) {
    return arr[this.ri(0, arr.length - 1)];
  }

  /**
   * Main interpretation method. Generates all shape grammar operations.
   */
  interpret() {
    this.operations = [];

    // 1. Interpret base/ground condition
    this.interpretBaseCondition();

    // 2. Interpret mass strategy (main building form)
    this.interpretMassStrategy();

    // 3. Interpret vertical profile (setbacks, cantilevers)
    this.interpretVerticalProfile();

    // 4. Interpret features (bay windows, voids, towers, etc.)
    this.interpretFeatures();

    // 5. Interpret roof form
    this.interpretRoof();

    // 6. Apply mutations for uniqueness
    this.applyMutations();

    // 7. Add fenestration
    this.interpretFenestration();

    return this.operations;
  }

  /**
   * Interpret base/ground condition.
   */
  interpretBaseCondition() {
    const { baseCondition } = this.genes;
    const floorH = this.genes.floorHeight || 12;

    switch (baseCondition) {
      case 'pilotis':
        this.operations.push({
          type: 'pilotis',
          height: floorH,
          columnRadius: 0.8,
          columnSpacing: 15,
          material: 'concrete'
        });
        break;

      case 'raised':
        this.operations.push({
          type: 'plinth',
          height: 4,
          material: this.genes.materialPalette?.primary || 'stone'
        });
        break;

      case 'at-grade':
      default:
        // No special base operation
        break;
    }
  }

  /**
   * Interpret mass strategy - the primary building form.
   */
  interpretMassStrategy() {
    const { massStrategy, floors, floorHeight = 12 } = this.genes;
    const { shapeType, bounds, area } = this.polygon;
    const totalFloors = floors?.preferred || floors?.max || 3;
    const baseHeight = baseCondition === 'pilotis' ? floorHeight : 0;

    switch (massStrategy) {
      case 'extrude':
        // Simple extrusion of the footprint polygon
        this.operations.push({
          type: 'extrude',
          polygon: this.polygon.vertices,
          height: totalFloors * floorHeight,
          baseY: baseHeight,
          material: this.genes.materialPalette?.primary || 'brick'
        });
        break;

      case 'stack':
        // Stacked volumes with slight variations
        for (let f = 0; f < totalFloors; f++) {
          const scale = 1 - f * 0.02; // Slight taper
          this.operations.push({
            type: 'extrude',
            polygon: this.scalePolygon(this.polygon.vertices, scale),
            height: floorHeight,
            baseY: baseHeight + f * floorHeight,
            material: this.genes.materialPalette?.primary || 'brick',
            floor: f
          });
        }
        break;

      case 'carve':
        // Start with full mass, then carve out voids
        this.operations.push({
          type: 'extrude',
          polygon: this.polygon.vertices,
          height: totalFloors * floorHeight,
          baseY: baseHeight,
          material: this.genes.materialPalette?.primary || 'brick'
        });
        // Add carve operations based on shape
        if (shapeType !== 'square' && area > 5000) {
          this.operations.push({
            type: 'carve',
            shape: 'courtyard',
            depth: totalFloors * floorHeight * 0.6,
            inset: Math.min(bounds.width, bounds.height) * 0.2
          });
        }
        break;

      case 'additive':
        // Multiple discrete volumes
        const volumes = this.generateAdditiveVolumes(totalFloors, floorHeight, baseHeight);
        for (const vol of volumes) {
          this.operations.push(vol);
        }
        break;

      case 'courtyard':
        // Building with central void
        this.operations.push({
          type: 'extrude',
          polygon: this.polygon.vertices,
          height: totalFloors * floorHeight,
          baseY: baseHeight,
          material: this.genes.materialPalette?.primary || 'brick'
        });
        // Carve courtyard
        const inset = Math.min(this.polygon.bounds.width, this.polygon.bounds.height) * 0.25;
        this.operations.push({
          type: 'courtyard',
          inset: inset,
          height: totalFloors * floorHeight,
          baseY: baseHeight
        });
        break;

      default:
        // Default to simple extrusion
        this.operations.push({
          type: 'extrude',
          polygon: this.polygon.vertices,
          height: totalFloors * floorHeight,
          baseY: baseHeight,
          material: this.genes.materialPalette?.primary || 'brick'
        });
    }
  }

  /**
   * Interpret vertical profile modifications.
   */
  interpretVerticalProfile() {
    const { verticalProfile, floors, floorHeight = 12 } = this.genes;
    const totalFloors = floors?.preferred || floors?.max || 3;
    const totalHeight = totalFloors * floorHeight;

    switch (verticalProfile) {
      case 'stepped':
        // Add setbacks at upper floors
        const setbackFloor = Math.ceil(totalFloors * 0.6);
        this.operations.push({
          type: 'setback',
          startFloor: setbackFloor,
          setbackDistance: 6,
          sides: ['all']
        });
        break;

      case 'tapered':
        // Gradual taper toward top
        this.operations.push({
          type: 'taper',
          startFloor: 1,
          endFloor: totalFloors,
          taperRatio: 0.85
        });
        break;

      case 'cantilevered':
        // Add cantilever at upper floors
        const cantileverFloor = Math.ceil(totalFloors * 0.4);
        const cantileverSide = this.pick(['north', 'south', 'east', 'west']);
        this.operations.push({
          type: 'cantilever',
          startFloor: cantileverFloor,
          endFloor: totalFloors,
          extension: this.rr(6, 12),
          side: cantileverSide
        });
        break;

      case 'uniform':
      default:
        // No vertical modifications
        break;
    }
  }

  /**
   * Interpret features (bay windows, voids, etc.).
   */
  interpretFeatures() {
    const { features = [] } = this.genes;
    const floorHeight = this.genes.floorHeight || 12;
    const totalFloors = this.genes.floors?.preferred || 3;

    for (const feature of features) {
      const intensity = feature.intensity || 0.5;

      switch (feature.type) {
        case 'bay_window':
          this.operations.push({
            type: 'bay_window',
            location: feature.location || 'center',
            width: 6 + intensity * 4,
            depth: 2 + intensity * 2,
            height: floorHeight * Math.min(totalFloors, 3),
            floors: [1, 2, 3].slice(0, Math.min(totalFloors, 3))
          });
          break;

        case 'void':
          this.operations.push({
            type: 'void',
            location: feature.location || 'center',
            width: this.polygon.bounds.width * (0.1 + intensity * 0.2),
            height: floorHeight * (1 + Math.floor(intensity * 2)),
            startFloor: Math.floor(totalFloors * 0.3)
          });
          break;

        case 'cantilever':
          this.operations.push({
            type: 'cantilever',
            startFloor: Math.ceil(totalFloors * 0.5),
            endFloor: totalFloors,
            extension: 4 + intensity * 8,
            side: feature.location === 'corner' ? this.pick(['ne', 'nw', 'se', 'sw']) : 'south'
          });
          break;

        case 'arcade':
          this.operations.push({
            type: 'arcade',
            location: feature.location || 'edge',
            depth: 8 + intensity * 4,
            height: floorHeight,
            columnSpacing: 10 - intensity * 3
          });
          break;

        case 'tower':
          this.operations.push({
            type: 'tower',
            location: feature.location || 'corner',
            width: 12 + intensity * 8,
            extraFloors: 2 + Math.floor(intensity * 3)
          });
          break;

        case 'corner_cut':
          this.operations.push({
            type: 'corner_cut',
            corners: feature.location === 'corner' ? [this.pick([0, 1, 2, 3])] : [0, 2],
            cutSize: 4 + intensity * 8,
            cutAngle: 45
          });
          break;
      }
    }
  }

  /**
   * Interpret roof form.
   */
  interpretRoof() {
    const { roofForm, floors, floorHeight = 12 } = this.genes;
    const totalFloors = floors?.preferred || floors?.max || 3;
    const roofBaseY = totalFloors * floorHeight;

    switch (roofForm) {
      case 'pitched':
        this.operations.push({
          type: 'roof_pitched',
          baseY: roofBaseY,
          pitch: 30 + this.rng() * 15, // 30-45 degrees
          ridgeDirection: this.polygon.longestEdge?.axis === 'x' ? 'z' : 'x',
          overhang: 1.5,
          material: this.genes.materialPalette?.secondary || 'slate'
        });
        break;

      case 'shed':
        this.operations.push({
          type: 'roof_shed',
          baseY: roofBaseY,
          pitch: 15 + this.rng() * 10,
          direction: this.pick(['north', 'south', 'east', 'west']),
          overhang: 2,
          material: this.genes.materialPalette?.secondary || 'metal'
        });
        break;

      case 'sawtooth':
        this.operations.push({
          type: 'roof_sawtooth',
          baseY: roofBaseY,
          toothCount: Math.max(2, Math.floor(this.polygon.bounds.width / 20)),
          toothHeight: 8,
          glazedSide: 'north',
          material: 'metal'
        });
        break;

      case 'green':
        this.operations.push({
          type: 'roof_flat',
          baseY: roofBaseY,
          parapetHeight: 3,
          material: 'green_roof'
        });
        break;

      case 'flat':
      default:
        this.operations.push({
          type: 'roof_flat',
          baseY: roofBaseY,
          parapetHeight: 2 + this.rng() * 2,
          material: this.genes.materialPalette?.primary || 'concrete'
        });
        break;
    }
  }

  /**
   * Apply mutations for uniqueness.
   */
  applyMutations() {
    const { mutations = {} } = this.genes;

    // Asymmetry mutation
    if (mutations.asymmetry > 0.3) {
      const asymmetryStrength = mutations.asymmetry;
      this.operations.push({
        type: 'mutation_asymmetry',
        strength: asymmetryStrength,
        axis: this.pick(['x', 'z']),
        shift: this.rr(-4, 4) * asymmetryStrength
      });
    }

    // Irregularity mutation
    if (mutations.irregularity > 0.3) {
      const irregularity = mutations.irregularity;
      this.operations.push({
        type: 'mutation_irregularity',
        strength: irregularity,
        vertexJitter: irregularity * 3,
        angleVariation: irregularity * 5
      });
    }

    // Articulation mutation
    if (mutations.articulation > 0.3) {
      const articulation = mutations.articulation;
      this.operations.push({
        type: 'mutation_articulation',
        strength: articulation,
        projections: Math.floor(articulation * 4),
        projectionDepth: 2 + articulation * 4
      });
    }
  }

  /**
   * Interpret fenestration (windows).
   */
  interpretFenestration() {
    const { mutations = {}, character } = this.genes;
    const density = mutations.fenestrationDensity || 0.4;

    // Map character to window style
    let windowStyle = 'regular';
    if (character === 'industrial') windowStyle = 'ribbon';
    else if (character === 'domestic') windowStyle = 'punched';
    else if (character === 'civic') windowStyle = 'tall';
    else if (character === 'vernacular') windowStyle = 'small';

    this.operations.push({
      type: 'fenestration',
      style: windowStyle,
      density: density,
      windowWidth: windowStyle === 'ribbon' ? 20 : (3 + density * 2),
      windowHeight: windowStyle === 'tall' ? 8 : (4 + density * 2),
      spacing: 8 - density * 3
    });
  }

  /**
   * Helper: Scale polygon vertices from centroid.
   */
  scalePolygon(vertices, scale) {
    const cx = vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length;
    const cy = vertices.reduce((sum, v) => sum + v.y, 0) / vertices.length;

    return vertices.map(v => ({
      x: cx + (v.x - cx) * scale,
      y: cy + (v.y - cy) * scale
    }));
  }

  /**
   * Helper: Generate additive volumes for "additive" mass strategy.
   */
  generateAdditiveVolumes(totalFloors, floorHeight, baseY) {
    const volumes = [];
    const { bounds, shapeType } = this.polygon;

    // For L-shapes, split into two overlapping bars
    if (shapeType === 'L') {
      // Determine L orientation and create two bars
      const w = bounds.width;
      const h = bounds.height;

      volumes.push({
        type: 'box',
        x: bounds.minX + w * 0.3,
        z: bounds.minY,
        width: w * 0.7,
        depth: h * 0.4,
        height: totalFloors * floorHeight,
        baseY: baseY,
        material: this.genes.materialPalette?.primary || 'brick'
      });

      volumes.push({
        type: 'box',
        x: bounds.minX,
        z: bounds.minY,
        width: w * 0.4,
        depth: h,
        height: (totalFloors - 1) * floorHeight,
        baseY: baseY,
        material: this.genes.materialPalette?.primary || 'brick'
      });
    } else {
      // Default: single primary volume with smaller additions
      volumes.push({
        type: 'extrude',
        polygon: this.polygon.vertices,
        height: totalFloors * floorHeight,
        baseY: baseY,
        material: this.genes.materialPalette?.primary || 'brick'
      });

      // Add smaller projecting volumes
      const numAdditions = this.ri(1, 3);
      for (let i = 0; i < numAdditions; i++) {
        const side = this.pick(['north', 'south', 'east', 'west']);
        volumes.push({
          type: 'projection',
          side: side,
          width: this.rr(8, 15),
          depth: this.rr(4, 8),
          height: (totalFloors - 1) * floorHeight,
          baseY: baseY
        });
      }
    }

    return volumes;
  }
}

/**
 * Factory function to interpret genes and return operations.
 */
export function interpretGenes(genes, polygon) {
  const interpreter = new GeneInterpreter(genes, polygon);
  return interpreter.interpret();
}

/**
 * Default genes for quick builds (non-AI).
 */
export function getDefaultGenes(program, tiles) {
  const tileCount = tiles?.length || 1;

  const defaults = {
    cottage: {
      name: 'Cottage',
      massStrategy: 'extrude',
      verticalProfile: 'uniform',
      roofForm: 'pitched',
      character: 'domestic',
      materialPalette: { primary: 'timber', secondary: 'slate' },
      features: [],
      mutations: { asymmetry: 0.1, irregularity: 0.1, articulation: 0.2, fenestrationDensity: 0.4 },
      floors: { min: 1, max: 2, preferred: 2 },
      floorHeight: 10,
      baseCondition: 'at-grade'
    },
    townhouse: {
      name: 'Townhouse',
      massStrategy: 'extrude',
      verticalProfile: 'uniform',
      roofForm: 'flat',
      character: 'domestic',
      materialPalette: { primary: 'brick', secondary: 'stone' },
      features: [{ type: 'bay_window', location: 'center', intensity: 0.5 }],
      mutations: { asymmetry: 0.05, irregularity: 0.05, articulation: 0.3, fenestrationDensity: 0.5 },
      floors: { min: 3, max: 4, preferred: 4 },
      floorHeight: 10,
      baseCondition: 'raised'
    },
    shop: {
      name: 'Shop',
      massStrategy: 'extrude',
      verticalProfile: 'uniform',
      roofForm: 'flat',
      character: 'vernacular',
      materialPalette: { primary: 'brick', secondary: 'metal' },
      features: [{ type: 'arcade', location: 'edge', intensity: 0.6 }],
      mutations: { asymmetry: 0.1, irregularity: 0.1, articulation: 0.4, fenestrationDensity: 0.7 },
      floors: { min: 1, max: 2, preferred: 2 },
      floorHeight: 12,
      baseCondition: 'at-grade'
    },
    chapel: {
      name: 'Chapel',
      massStrategy: 'extrude',
      verticalProfile: 'uniform',
      roofForm: 'pitched',
      character: 'civic',
      materialPalette: { primary: 'stone', secondary: 'copper' },
      features: [{ type: 'tower', location: 'corner', intensity: 0.7 }],
      mutations: { asymmetry: 0.2, irregularity: 0.1, articulation: 0.3, fenestrationDensity: 0.3 },
      floors: { min: 1, max: 2, preferred: 1 },
      floorHeight: 16,
      baseCondition: 'raised'
    },
    apartment: {
      name: 'Apartment Block',
      massStrategy: tileCount > 2 ? 'courtyard' : 'extrude',
      verticalProfile: tileCount > 2 ? 'stepped' : 'uniform',
      roofForm: 'flat',
      character: 'domestic',
      materialPalette: { primary: 'brick', secondary: 'concrete' },
      features: [],
      mutations: { asymmetry: 0.1, irregularity: 0.05, articulation: 0.4, fenestrationDensity: 0.6 },
      floors: { min: 4, max: 8, preferred: 6 },
      floorHeight: 10,
      baseCondition: 'at-grade'
    },
    library: {
      name: 'Library',
      massStrategy: 'additive',
      verticalProfile: 'uniform',
      roofForm: 'flat',
      character: 'civic',
      materialPalette: { primary: 'concrete', secondary: 'glass' },
      features: [{ type: 'void', location: 'center', intensity: 0.5 }],
      mutations: { asymmetry: 0.2, irregularity: 0.1, articulation: 0.5, fenestrationDensity: 0.6 },
      floors: { min: 2, max: 3, preferred: 3 },
      floorHeight: 14,
      baseCondition: 'raised'
    },
    hotel: {
      name: 'Hotel',
      massStrategy: 'stack',
      verticalProfile: 'stepped',
      roofForm: 'flat',
      character: 'civic',
      materialPalette: { primary: 'stone', secondary: 'glass' },
      features: [{ type: 'cantilever', location: 'edge', intensity: 0.4 }],
      mutations: { asymmetry: 0.15, irregularity: 0.05, articulation: 0.5, fenestrationDensity: 0.7 },
      floors: { min: 6, max: 12, preferred: 8 },
      floorHeight: 10,
      baseCondition: 'pilotis'
    },
    tower: {
      name: 'Tower',
      massStrategy: 'stack',
      verticalProfile: 'tapered',
      roofForm: 'flat',
      character: 'civic',
      materialPalette: { primary: 'glass', secondary: 'steel' },
      features: [],
      mutations: { asymmetry: 0.1, irregularity: 0.05, articulation: 0.3, fenestrationDensity: 0.8 },
      floors: { min: 10, max: 20, preferred: 15 },
      floorHeight: 12,
      baseCondition: 'pilotis'
    },
    museum: {
      name: 'Museum',
      massStrategy: 'additive',
      verticalProfile: 'cantilevered',
      roofForm: 'flat',
      character: 'civic',
      materialPalette: { primary: 'concrete', secondary: 'glass' },
      features: [
        { type: 'cantilever', location: 'edge', intensity: 0.7 },
        { type: 'void', location: 'center', intensity: 0.4 }
      ],
      mutations: { asymmetry: 0.3, irregularity: 0.2, articulation: 0.6, fenestrationDensity: 0.4 },
      floors: { min: 2, max: 4, preferred: 3 },
      floorHeight: 16,
      baseCondition: 'raised'
    }
  };

  return defaults[program] || defaults.cottage;
}
