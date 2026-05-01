// ════════════════════════════════════════════════════════════════════
// AI BUILDING GENERATION — Claude-powered architectural design
// ════════════════════════════════════════════════════════════════════
// Generates building designs from natural language prompts using Claude.
//
// NEW FLOW:
// 1. User types description → AI selects archetype + parameters
// 2. Archetype determines materials (user never chooses)
// 3. Grammar system generates building within archetype rules
//
// Archetypes: parametric, brutalist, organic, vernacular, industrial, minimalist

import { ISLAND_MATERIALS } from '../state/index.js';
import { ARCHETYPES, getArchetype, computeArchetypeParams } from './archetypes.js';

// ─── ARCHETYPE SELECTION PROMPT ───────────────────────────────────────
const ARCHETYPE_SYSTEM_PROMPT = `You are an architectural design interpreter. Given a user's building description, select the most appropriate archetype and generate specific parameters.

ARCHETYPES:
1. PARAMETRIC - MVRDV, OMA, BIG style. Stacked boxes with shifts, cantilevers, carved voids. White render + glass + bright accents. Bold, playful, urban.
2. BRUTALIST - Ando, Kahn, Zumthor style. Monolithic concrete, carved light slots, heavy mass. Board-formed concrete, minimal openings. Contemplative, weighty.
3. ORGANIC - Bo Bardi, Niemeyer, Hadid style. Curves, shells, flowing forms, dramatic cantilevers. White concrete + timber. Sculptural, landscape-integrated.
4. VERNACULAR - Traditional regional style. Pitched roofs, local materials, additive rooms. Stone + timber + slate. Settled, crafted, familiar.
5. INDUSTRIAL - Eames, Prouvé style. Exposed steel frame, infill panels, sawtooth roofs. Steel + glass + corrugated metal. Honest, efficient, modular.
6. MINIMALIST - Pawson, Campo Baeza style. Pure volumes, hidden details, precise proportions. White plaster + stone + natural wood. Serene, essential, refined.

Return ONLY a JSON object (no markdown, no preamble):

{
  "archetype": "parametric" | "brutalist" | "organic" | "vernacular" | "industrial" | "minimalist",

  "name": string (simple 2-4 word building name, like "Glass Tower" or "Concrete Block A"),
  "description": string (one sentence, under 20 words),

  "parameters": {
    "floors": number 1-6,
    "floorHeight": number 10-18 (feet),
    "footprintCoverage": number 0.4-1.0 (how much of boundary to fill),
    "rotationDegrees": number -30 to 30 (rotation within boundary),
    "offsetX": number -0.3 to 0.3 (position shift as fraction of width),
    "offsetZ": number -0.3 to 0.3 (position shift as fraction of depth)
  },

  "features": {
    "cantilever": { "enabled": boolean, "direction": "north"|"south"|"east"|"west", "amount": 0.1-0.4 },
    "courtyard": { "enabled": boolean, "size": 0.1-0.4, "position": "center"|"corner" },
    "void": { "enabled": boolean, "floors": [1,2...], "position": "corner"|"center"|"edge" },
    "pilotis": { "enabled": boolean, "height": 8-16 },
    "tower": { "enabled": boolean, "position": "corner"|"center", "extraFloors": 1-3 }
  },

  "roof": {
    "type": "flat" | "pitched" | "shed" | "shell" | "sawtooth" | "green",
    "pitch": number 0-50 (degrees, for pitched/shed),
    "overhang": number 0-6 (feet)
  },

  "mutations": {
    "asymmetry": number 0-1 (0=symmetric, 1=highly asymmetric),
    "irregularity": number 0-1 (0=rectilinear, 1=warped/curved),
    "articulation": number 0-1 (0=monolithic, 1=highly articulated facade)
  },

  "designer_intent": string (one sentence, architect's confident pitch),
  "value_system_critique": string (one sentence, external auditor's sharp critique)
}

IMPORTANT GUIDELINES:
- Building does NOT have to fill the boundary - use footprintCoverage, offsetX, offsetZ
- Building can be rotated freely within the boundary
- Be bold with features - don't make everything a simple box
- Match archetype to the vibe of the prompt (workshop → industrial, meditation → minimalist, etc.)
- For L-shaped sites, consider asymmetric placement or courtyard features
- Higher floors need smaller footprintCoverage for structural logic
- Enable at most 2-3 features to avoid over-complication`;

// ─── GENE SYSTEM PROMPT ───────────────────────────────────────────────
const GENE_SYSTEM_PROMPT = `You are an architectural gene generator for a building simulation. Given a design prompt and site context, generate "architectural genes" that will be interpreted by a shape grammar system to create unique, organic building forms.

Return ONLY a JSON object (no preamble, no markdown fences) with these exact fields:

{
  "name": string (simple 2-4 word name, like "Tower Block 1" or "Steel Frame Building"),
  "description": string (one sentence, under 25 words),

  "massStrategy": one of "extrude" | "stack" | "carve" | "additive" | "courtyard"
    - extrude: simple footprint extrusion (default for simple forms)
    - stack: stacked volumes with variation (good for towers, terraced)
    - carve: start solid, carve voids (creates negative space)
    - additive: multiple discrete volumes assembled (complex compositions)
    - courtyard: building wraps around central void (for larger sites)

  "verticalProfile": one of "uniform" | "stepped" | "tapered" | "cantilevered"
    - uniform: same footprint all floors
    - stepped: upper floors set back
    - tapered: gradual narrowing toward top
    - cantilevered: floors project beyond base

  "roofForm": one of "flat" | "pitched" | "shed" | "sawtooth" | "green"

  "character": one of "domestic" | "civic" | "industrial" | "vernacular" | "experimental"

  "materialPalette": {
    "primary": one of "timber" | "stone" | "brick" | "concrete" | "glass" | "steel",
    "secondary": one of "timber" | "stone" | "brick" | "concrete" | "glass" | "steel" | "copper" | "slate",
    "accent": one of "bronze" | "copper" | "steel" | "glass" | "terracotta",
    "primaryRatio": number 0.5-0.9
  }

  "features": array of 0-3 objects, each:
    {
      "type": one of "bay_window" | "void" | "cantilever" | "arcade" | "tower" | "corner_cut",
      "location": one of "corner" | "center" | "edge",
      "intensity": number 0.3-1.0 (how pronounced the feature is)
    }

  "mutations": {
    "asymmetry": number 0-1 (0=perfectly symmetric, 1=highly asymmetric),
    "irregularity": number 0-1 (0=rectilinear, 1=irregular angles/curves),
    "articulation": number 0-1 (0=monolithic, 1=highly articulated facade),
    "fenestrationDensity": number 0.2-0.8 (window-to-wall ratio)
  }

  "floors": { "min": int 1-20, "max": int 1-20, "preferred": int 1-20 },
  "floorHeight": number 9-16 (feet per floor),
  "baseCondition": one of "at-grade" | "raised" | "pilotis"

  "designer_intent": string (one sentence, architect's pitch - confident, evocative),
  "value_system_critique": string (one sentence, external auditor's critique - what it ignores/externalizes)
}

IMPORTANT: Be creative and generate UNIQUE, INTERESTING architectural genes. Avoid generic boxes. Consider:
- L-shaped or linear sites suggest buildings that follow the shape, not fight it
- Larger sites (3-4 tiles) can support courtyard or additive strategies
- Use features sparingly but meaningfully (0-3 max)
- Higher asymmetry/irregularity creates more organic forms
- Match character to program (domestic buildings are different from civic)
- The shape grammar will interpret these genes - be bold with mutations for experimental prompts`;

// ─── LEGACY SYSTEM PROMPT (for backwards compatibility) ───────────────
const SYSTEM_PROMPT = `You are a building generator for an architectural value-system simulation. Given a design prompt, return ONLY a JSON object (no preamble, no markdown fences) with these exact fields:

{
  "name": simple 2-4 word name (like "Tower A" or "Concrete Block"),
  "description": one sentence describing the design (under 20 words),
  "footprint_w": integer 2-10 — width of footprint in 8-ft cells. Each cell is 8 ft × 8 ft. Tiles are 130 ft × 130 ft (~16 cells). Most buildings should be 4-7 cells wide so they have presence; small structures (cabins, sheds) can be 2-3.
  "footprint_d": integer 2-10 — depth in 8-ft cells. Same scale rules.
  "floors": integer 1-12,
  "floor_height_ft": number 8-14 (typical 9-10 for residential, 12-14 for industrial),
  "primary_material": one of "timber" | "stone" | "brick",
  "secondary_material": one of "timber" | "stone" | "brick" | "none",
  "material_pct_primary": number 0..1 — fraction of build's mass that's primary material,
  "material_pct_secondary": number 0..1 — fraction that's secondary; 0 if none.
  "roof_type": one of "flat" | "pitched" | "hipped" | "shed" | "vault",
  "openings": one of "narrow" | "moderate" | "wide" | "ribbon" | "none",
  "character": one of "domestic" | "civic" | "industrial" | "agricultural" | "monumental" | "vernacular",
  "estimated_lifespan_years": integer (timber 30-80, brick 80-150, stone 150-500),
  "death_plan_recommendation": one of "demolish-salvage" | "abandon" | "dismantle-return",
  "designer_intent": one sentence in the voice of the building's designer pitching it — what the design aspires to, what it's optimized for, what feeling or function it offers. Confident, proud, formally articulate. NO self-criticism. NO mention of what it ignores or fails to plan for.
  "value_system_critique": one sharp sentence in the voice of an external auditor reading this design's hidden value system — what it prioritizes, what it refuses to plan for, what it externalizes onto others or onto time. This is the critique that the designer would NOT speak. Be specific to this design, not generic.
}

Pick honest values. Default to substantial scale: a "small house" is 4×4 cells (32×32 ft). A warehouse is 6-8 cells. A tower can be 3-4 cells wide but tall. material_pct_primary + material_pct_secondary should equal 1 (if secondary is "none" then primary is 1.0). The designer_intent should sound like an architect's project description — confident, evocative, not ironic or self-undermining. The value_system_critique should sound like a sharp essay on architectural ethics — diagnostic, not preachy.`;

// ─── API CONFIGURATION ────────────────────────────────────────────────
// In production (Vercel): uses /api/claude proxy with server-side API key
// In development: uses localStorage key or prompts user
//
const USE_PROXY = !import.meta.env.DEV; // true in production
let API_KEY = null;

export function setApiKey(key) {
  API_KEY = key;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('anthropic_api_key', key);
  }
}

export function hasApiKey() {
  // In production, we always have access via proxy
  if (USE_PROXY) return true;
  // In dev, check localStorage or explicit key
  if (API_KEY) return true;
  if (typeof localStorage !== 'undefined' && localStorage.getItem('anthropic_api_key')) {
    API_KEY = localStorage.getItem('anthropic_api_key');
    return true;
  }
  return false;
}

// Helper to make API calls (uses proxy in production, direct in dev)
async function callClaude(model, max_tokens, system, messages) {
  if (USE_PROXY) {
    // Production: use serverless proxy
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens, system, messages })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error('API ' + response.status + ': ' + errText.slice(0, 200));
    }
    return response.json();
  } else {
    // Development: direct API call with local key
    if (!API_KEY) {
      throw new Error('API key not configured. Call setApiKey() first or set in localStorage.');
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model, max_tokens, system, messages })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error('API ' + response.status + ': ' + errText.slice(0, 200));
    }
    return response.json();
  }
}

// ─── GENERATE SPEC ────────────────────────────────────────────────────
export async function generateBuildingSpec(prompt, tile) {
  if (!hasApiKey()) {
    throw new Error('API key not configured. Call setApiKey() first.');
  }

  const userPrompt = `Tile: ${tile.biome} biome, elev ${tile.elev}, 130 ft × 130 ft (16×16 grid of 8-ft cells, 17,000 sq ft total). Design prompt: "${prompt}"`;

  const data = await callClaude(
    'claude-haiku-4-5',
    1000,
    SYSTEM_PROMPT,
    [{ role: 'user', content: userPrompt }]
  );
  const txt = data.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')
    .trim();

  // Clean up markdown fences if present
  const cleaned = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const spec = JSON.parse(cleaned);

  // Sanity defaults
  spec.footprint_w = Math.max(2, Math.min(10, spec.footprint_w || 4));
  spec.footprint_d = Math.max(2, Math.min(10, spec.footprint_d || 4));
  spec.floors = Math.max(1, Math.min(12, spec.floors || 1));
  spec.floor_height_ft = Math.max(8, Math.min(14, spec.floor_height_ft || 10));
  spec.material_pct_primary = Math.max(0, Math.min(1, spec.material_pct_primary || 1));
  spec.material_pct_secondary = Math.max(0, Math.min(1, spec.material_pct_secondary || 0));

  if (spec.secondary_material === 'none' || !spec.secondary_material) {
    spec.material_pct_primary = 1;
    spec.material_pct_secondary = 0;
  }

  return spec;
}

// ─── GENERATE ARCHITECTURAL GENES ─────────────────────────────────────
// NEW: Generates architectural genes for the hybrid AI + shape grammar system.
// These genes are interpreted by the GeneInterpreter to create unique building forms.
export async function generateArchitecturalGenes(prompt, footprintPolygon, tiles) {
  if (!hasApiKey()) {
    throw new Error('API key not configured. Call setApiKey() first.');
  }

  // Build context about the site from the polygon and tiles
  const tileCount = tiles?.length || 1;
  const biomes = [...new Set(tiles?.map(t => t.biome) || ['grassland'])];
  const avgElev = tiles?.reduce((sum, t) => sum + (t.elev || 0), 0) / tileCount || 0;

  // Get shape info from polygon
  const shapeType = footprintPolygon?.shapeType || 'rect';
  const area = footprintPolygon?.area || (tileCount * 130 * 130);
  const bounds = footprintPolygon?.bounds || { width: 130, height: 130 };

  const siteContext = `Site context:
- Shape: ${shapeType} (${tileCount} tile${tileCount > 1 ? 's' : ''})
- Footprint: ${Math.round(bounds.width)}′ × ${Math.round(bounds.height)}′ (~${Math.round(area).toLocaleString()} sq ft)
- Biome${biomes.length > 1 ? 's' : ''}: ${biomes.join(', ')}
- Elevation: ${Math.round(avgElev)}
- Longest edge: ${footprintPolygon?.longestEdge?.axis === 'x' ? 'east-west' : 'north-south'} (${Math.round(footprintPolygon?.longestEdge?.length || 130)}′)

The building footprint will follow the tile polygon shape. For ${shapeType} shapes:
${shapeType === 'L' ? '- L-shaped buildings can use additive massing or wrap around a courtyard corner' : ''}
${shapeType === 'linear' ? '- Linear buildings should have elongated forms, consider stepped or cantilevered profiles' : ''}
${shapeType === 'square' ? '- Square footprints work well with courtyard or carve strategies for larger sites' : ''}
${shapeType === 'rect' ? '- Rectangular footprints can use any massing strategy' : ''}`;

  const userPrompt = `${siteContext}

Design prompt: "${prompt}"

Generate architectural genes for this building. Be creative and bold - avoid generic solutions.`;

  const data = await callClaude(
    'claude-haiku-4-5',
    1500,
    GENE_SYSTEM_PROMPT,
    [{ role: 'user', content: userPrompt }]
  );
  const txt = data.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')
    .trim();

  // Clean up markdown fences if present
  const cleaned = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const genes = JSON.parse(cleaned);

  // Validate and apply defaults
  return validateGenes(genes, tileCount);
}

// ─── VALIDATE GENES ───────────────────────────────────────────────────
function validateGenes(genes, tileCount) {
  // Mass strategy
  const validMassStrategies = ['extrude', 'stack', 'carve', 'additive', 'courtyard'];
  if (!validMassStrategies.includes(genes.massStrategy)) {
    genes.massStrategy = 'extrude';
  }

  // Vertical profile
  const validProfiles = ['uniform', 'stepped', 'tapered', 'cantilevered'];
  if (!validProfiles.includes(genes.verticalProfile)) {
    genes.verticalProfile = 'uniform';
  }

  // Roof form
  const validRoofs = ['flat', 'pitched', 'shed', 'sawtooth', 'green'];
  if (!validRoofs.includes(genes.roofForm)) {
    genes.roofForm = 'flat';
  }

  // Character
  const validCharacters = ['domestic', 'civic', 'industrial', 'vernacular', 'experimental'];
  if (!validCharacters.includes(genes.character)) {
    genes.character = 'vernacular';
  }

  // Material palette defaults
  genes.materialPalette = genes.materialPalette || {};
  genes.materialPalette.primary = genes.materialPalette.primary || 'brick';
  genes.materialPalette.secondary = genes.materialPalette.secondary || 'concrete';
  genes.materialPalette.accent = genes.materialPalette.accent || 'steel';
  genes.materialPalette.primaryRatio = Math.max(0.5, Math.min(0.9, genes.materialPalette.primaryRatio || 0.7));

  // Features - validate and limit to 3
  genes.features = (genes.features || []).slice(0, 3).map(f => ({
    type: f.type || 'bay_window',
    location: f.location || 'center',
    intensity: Math.max(0.3, Math.min(1.0, f.intensity || 0.5))
  }));

  // Mutations - clamp values
  genes.mutations = genes.mutations || {};
  genes.mutations.asymmetry = Math.max(0, Math.min(1, genes.mutations.asymmetry || 0.2));
  genes.mutations.irregularity = Math.max(0, Math.min(1, genes.mutations.irregularity || 0.1));
  genes.mutations.articulation = Math.max(0, Math.min(1, genes.mutations.articulation || 0.3));
  genes.mutations.fenestrationDensity = Math.max(0.2, Math.min(0.8, genes.mutations.fenestrationDensity || 0.4));

  // Floors - scale with tile count
  const defaultFloors = { 1: 2, 2: 3, 3: 4, 4: 5 };
  genes.floors = genes.floors || {};
  genes.floors.min = Math.max(1, Math.min(20, genes.floors.min || 1));
  genes.floors.max = Math.max(genes.floors.min, Math.min(20, genes.floors.max || (defaultFloors[tileCount] || 3) + 2));
  genes.floors.preferred = Math.max(genes.floors.min, Math.min(genes.floors.max, genes.floors.preferred || defaultFloors[tileCount] || 3));

  // Floor height
  genes.floorHeight = Math.max(9, Math.min(16, genes.floorHeight || 10));

  // Base condition
  const validBases = ['at-grade', 'raised', 'pilotis'];
  if (!validBases.includes(genes.baseCondition)) {
    genes.baseCondition = 'at-grade';
  }

  return genes;
}

// ─── GENERATE FROM PROMPT (NEW ARCHETYPE SYSTEM) ──────────────────────
// Main entry point: user describes building, AI selects archetype + parameters
export async function generateFromPrompt(prompt, footprintPolygon, tiles) {
  if (!hasApiKey()) {
    throw new Error('API key not configured. Call setApiKey() first.');
  }

  // Build context about the site
  const tileCount = tiles?.length || 1;
  const biomes = [...new Set(tiles?.map(t => t.biome) || ['grassland'])];
  const avgElev = tiles?.reduce((sum, t) => sum + (t.elev || 0), 0) / tileCount || 0;

  // Get shape info from polygon
  const shapeType = footprintPolygon?.shapeType || 'rect';
  const area = footprintPolygon?.area || (tileCount * 130 * 130);
  const bounds = footprintPolygon?.bounds || { width: 130, height: 130 };

  const siteContext = `SITE:
- Shape: ${shapeType} (${tileCount} tile${tileCount > 1 ? 's' : ''})
- Boundary: ${Math.round(bounds.width)}′ × ${Math.round(bounds.height)}′ (~${Math.round(area).toLocaleString()} sq ft)
- Biome: ${biomes.join(', ')}
- Elevation: ${Math.round(avgElev)}

USER REQUEST: "${prompt}"`;

  const data = await callClaude(
    'claude-sonnet-4-5',
    2000,
    ARCHETYPE_SYSTEM_PROMPT,
    [{ role: 'user', content: siteContext }]
  );
  const txt = data.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')
    .trim();

  // Clean up markdown fences if present
  const cleaned = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const result = JSON.parse(cleaned);

  // Validate and apply defaults
  return validateArchetypeResult(result, tileCount, footprintPolygon);
}

// ─── VALIDATE ARCHETYPE RESULT ────────────────────────────────────────
function validateArchetypeResult(result, tileCount, polygon) {
  // Validate archetype
  const validArchetypes = ['parametric', 'brutalist', 'organic', 'vernacular', 'industrial', 'minimalist'];
  if (!validArchetypes.includes(result.archetype)) {
    result.archetype = 'parametric';
  }

  // Get archetype definition
  const archetype = getArchetype(result.archetype);

  // Validate parameters
  result.parameters = result.parameters || {};
  result.parameters.floors = Math.max(1, Math.min(6, result.parameters.floors || 2));
  result.parameters.floorHeight = Math.max(10, Math.min(18, result.parameters.floorHeight || 12));
  result.parameters.footprintCoverage = Math.max(0.4, Math.min(1.0, result.parameters.footprintCoverage || 0.8));
  result.parameters.rotationDegrees = Math.max(-30, Math.min(30, result.parameters.rotationDegrees || 0));
  result.parameters.offsetX = Math.max(-0.3, Math.min(0.3, result.parameters.offsetX || 0));
  result.parameters.offsetZ = Math.max(-0.3, Math.min(0.3, result.parameters.offsetZ || 0));

  // Validate features
  result.features = result.features || {};

  if (result.features.cantilever) {
    result.features.cantilever.enabled = !!result.features.cantilever.enabled;
    result.features.cantilever.amount = Math.max(0.1, Math.min(0.4, result.features.cantilever.amount || 0.2));
  }

  if (result.features.courtyard) {
    result.features.courtyard.enabled = !!result.features.courtyard.enabled;
    result.features.courtyard.size = Math.max(0.1, Math.min(0.4, result.features.courtyard.size || 0.2));
  }

  if (result.features.pilotis) {
    result.features.pilotis.enabled = !!result.features.pilotis.enabled;
    result.features.pilotis.height = Math.max(8, Math.min(16, result.features.pilotis.height || 10));
  }

  if (result.features.void) {
    result.features.void.enabled = !!result.features.void.enabled;
  }

  if (result.features.tower) {
    result.features.tower.enabled = !!result.features.tower.enabled;
    result.features.tower.extraFloors = Math.max(1, Math.min(3, result.features.tower.extraFloors || 1));
  }

  // Validate roof
  result.roof = result.roof || {};
  const validRoofs = ['flat', 'pitched', 'shed', 'shell', 'sawtooth', 'green'];
  if (!validRoofs.includes(result.roof.type)) {
    result.roof.type = archetype.roof?.type || 'flat';
  }
  result.roof.pitch = Math.max(0, Math.min(50, result.roof.pitch || 35));
  result.roof.overhang = Math.max(0, Math.min(6, result.roof.overhang || 2));

  // Validate mutations
  result.mutations = result.mutations || {};
  result.mutations.asymmetry = Math.max(0, Math.min(1, result.mutations.asymmetry || 0.2));
  result.mutations.irregularity = Math.max(0, Math.min(1, result.mutations.irregularity || 0.1));
  result.mutations.articulation = Math.max(0, Math.min(1, result.mutations.articulation || 0.3));

  // Add archetype reference
  result.archetypeDefinition = archetype;

  return result;
}

// ─── GENES TO LEGACY SPEC ─────────────────────────────────────────────
// Convert genes to legacy spec format for backwards compatibility
export function genesToSpec(genes, polygon) {
  const area = polygon?.area || 16900;
  const cellSize = 8;
  const footprintCells = Math.ceil(Math.sqrt(area) / cellSize);

  return {
    name: genes.name || 'Generated Building',
    description: genes.description || '',
    footprint_w: Math.min(10, Math.max(2, footprintCells)),
    footprint_d: Math.min(10, Math.max(2, footprintCells)),
    floors: genes.floors?.preferred || 3,
    floor_height_ft: genes.floorHeight || 10,
    primary_material: genes.materialPalette?.primary || 'brick',
    secondary_material: genes.materialPalette?.secondary || 'none',
    material_pct_primary: genes.materialPalette?.primaryRatio || 0.8,
    material_pct_secondary: 1 - (genes.materialPalette?.primaryRatio || 0.8),
    roof_type: genes.roofForm === 'green' ? 'flat' : genes.roofForm,
    openings: genes.mutations?.fenestrationDensity > 0.5 ? 'wide' : 'moderate',
    character: genes.character || 'vernacular',
    estimated_lifespan_years: estimateLifespan(genes.materialPalette?.primary),
    death_plan_recommendation: 'demolish-salvage',
    designer_intent: genes.designer_intent || 'A building designed for its context.',
    value_system_critique: genes.value_system_critique || 'Prioritizes immediate function over long-term adaptability.',
    genes: genes // Include full genes for reference
  };
}

function estimateLifespan(material) {
  const lifespans = {
    timber: 60,
    brick: 120,
    stone: 250,
    concrete: 100,
    steel: 80,
    glass: 50
  };
  return lifespans[material] || 80;
}

// ─── SPEC TO REQUIREMENTS ─────────────────────────────────────────────
// Convert AI spec into material/labor/waste requirements.
export function specToRequirements(spec) {
  const cellFt = 8;
  const wFt = spec.footprint_w * cellFt;
  const dFt = spec.footprint_d * cellFt;
  const hFt = spec.floors * spec.floor_height_ft;
  const volume = wFt * dFt * hFt;

  // Wall + structure mass: ~12% of volume is solid mass
  const solidMass = volume * 0.12;
  const primaryMass = solidMass * spec.material_pct_primary;
  const secondaryMass = solidMass * spec.material_pct_secondary;

  const matToCount = (mass, mat) => {
    if (mat === 'timber') return Math.round(mass * 2.5);  // bf per cu ft
    if (mat === 'stone') return Math.round(mass * 0.85);  // cu ft per cu ft
    if (mat === 'brick') return Math.round(mass * 15);    // bricks per cu ft
    return 0;
  };

  const materialReq = { timber: 0, stone: 0, brick: 0 };
  materialReq[spec.primary_material] += matToCount(primaryMass, spec.primary_material);
  if (spec.secondary_material && spec.secondary_material !== 'none') {
    materialReq[spec.secondary_material] += matToCount(secondaryMass, spec.secondary_material);
  }

  // Foundation soil excavation: 1.5% of volume
  const wasteSoil = Math.round(volume * 0.015);

  // Water for mortar/mixing: 0.05 gal per cu ft
  const waterReq = Math.round(volume * 0.05);

  // Embodied carbon
  let embodiedCarbon = 0;
  for (const mat of ['timber', 'stone', 'brick']) {
    embodiedCarbon += materialReq[mat] * (ISLAND_MATERIALS[mat]?.embodiedCarbonPer || 0);
  }

  // Labor: 1 person-day per ~80 cu ft
  const laborReq = Math.max(2, Math.round(volume / 80));

  // Construction time: assuming 4 workers
  const constructionDays = Math.max(1, Math.ceil(laborReq / 4));

  return {
    volume,
    wFt,
    dFt,
    hFt,
    materialReq,
    waterReq,
    wasteSoil,
    embodiedCarbon: +embodiedCarbon.toFixed(2),
    laborReq,
    constructionDays
  };
}

// ─── GENERATE 3D GEOMETRY ────────────────────────────────────────────
// Creates 3D geometry data for rendering in walk view and ISO view.
// Returns { boxes: [...], roofs: [...] } in feet coordinates.
export function generateBuildingGeometry(spec, reqs) {
  const w = reqs.wFt;
  const d = reqs.dFt;
  const h = reqs.hFt;
  const floorH = spec.floor_height_ft || 10;
  const floors = spec.floors || 1;

  const geo = {
    boxes: [],
    roofs: [],
    dimensions: { w, d, h },
    primaryMaterial: spec.primary_material,
    secondaryMaterial: spec.secondary_material
  };

  // Main building body
  geo.boxes.push({
    u0: -w/2, v0: -d/2, u1: w/2, v1: d/2,
    w: h, w0: 0,
    role: 'wall',
    material: spec.primary_material
  });

  // Add floor lines for visual detail
  for (let f = 1; f < floors; f++) {
    const floorY = f * floorH;
    geo.boxes.push({
      u0: -w/2 - 0.3, v0: -d/2 - 0.3, u1: w/2 + 0.3, v1: d/2 + 0.3,
      w: floorY + 0.8, w0: floorY,
      role: 'cornice',
      material: spec.primary_material
    });
  }

  // Roof based on type
  const roofType = spec.roof_type || 'flat';
  if (roofType === 'pitched' || roofType === 'gabled') {
    const ridgeH = h + Math.max(4, h * 0.2);
    geo.roofs.push({
      type: 'pitched',
      u0: -w/2, v0: -d/2, u1: w/2, v1: d/2,
      eaveW: h,
      ridgeW: ridgeH,
      material: spec.secondary_material || spec.primary_material
    });
  } else if (roofType === 'hipped') {
    const ridgeH = h + Math.max(3, h * 0.15);
    geo.roofs.push({
      type: 'hipped',
      u0: -w/2, v0: -d/2, u1: w/2, v1: d/2,
      eaveW: h,
      ridgeW: ridgeH,
      material: spec.secondary_material || spec.primary_material
    });
  } else if (roofType === 'shed') {
    geo.roofs.push({
      type: 'shed',
      u0: -w/2, v0: -d/2, u1: w/2, v1: d/2,
      eaveW: h,
      ridgeW: h + Math.max(2, h * 0.1),
      material: spec.secondary_material || spec.primary_material
    });
  } else {
    // Flat roof with parapet
    geo.boxes.push({
      u0: -w/2 - 0.5, v0: -d/2 - 0.5, u1: w/2 + 0.5, v1: d/2 + 0.5,
      w: h + 2, w0: h,
      role: 'cornice',
      material: spec.primary_material
    });
  }

  // Add chimney for pitched roofs
  if ((roofType === 'pitched' || roofType === 'gabled') && h < 40) {
    geo.boxes.push({
      u0: w/2 - 4, v0: -2, u1: w/2 - 1, v1: 2,
      w: h + h * 0.35, w0: h,
      role: 'chimney',
      material: spec.secondary_material === 'brick' ? 'brick' : (spec.secondary_material || spec.primary_material)
    });
  }

  return geo;
}

// ─── RENDER AI PREVIEW SVG ────────────────────────────────────────────
// Stylized isometric preview of the building
export function renderPreviewSvg(spec, reqs) {
  const W = 280, H = 220;
  const w = reqs.wFt, d = reqs.dFt, h = reqs.hFt;

  // Iso projection
  const isoX = (x, y, z) => x - z * 0.55;
  const isoY = (x, y, z) => -y + (x + z) * 0.30;

  // Roof extra height
  const roofExtra = (spec.roof_type === 'pitched' || spec.roof_type === 'hipped')
    ? Math.max(4, h * 0.18)
    : (spec.roof_type === 'shed' ? h * 0.15 : 0);

  // Get colors based on material
  const matColors = {
    timber: { fill: '#C9A868', stroke: '#8A7040', light: '#E0C890' },
    stone: { fill: '#9A9590', stroke: '#5A5550', light: '#B8B4AE' },
    brick: { fill: '#B8685A', stroke: '#8A4A3A', light: '#D88878' }
  };
  const primary = matColors[spec.primary_material] || matColors.timber;

  // Scale to fit
  const scale = Math.min(W / (w + d * 0.6 + 20), H / (h + roofExtra + (w + d) * 0.35 + 20)) * 0.75;
  const cx = W / 2, cy = H * 0.65;

  // Transform point
  const tx = (x, y, z) => cx + isoX(x - w/2, y, z - d/2) * scale;
  const ty = (x, y, z) => cy + isoY(x - w/2, y, z - d/2) * scale;

  // Build box vertices
  const p = (x, y, z) => `${tx(x, y, z).toFixed(1)},${ty(x, y, z).toFixed(1)}`;

  // Ground shadow
  const shadow = `<polygon points="${p(0,0,0)} ${p(w,0,0)} ${p(w,0,d)} ${p(0,0,d)}" fill="rgba(0,0,0,0.15)" />`;

  // Front face
  const front = `<polygon points="${p(w,0,0)} ${p(w,h,0)} ${p(0,h,0)} ${p(0,0,0)}" fill="${primary.fill}" stroke="${primary.stroke}" stroke-width="1"/>`;

  // Right face (darker)
  const right = `<polygon points="${p(w,0,0)} ${p(w,0,d)} ${p(w,h,d)} ${p(w,h,0)}" fill="${primary.stroke}" stroke="${primary.stroke}" stroke-width="1"/>`;

  // Top face
  let top;
  if (spec.roof_type === 'pitched') {
    const ridgeH = h + roofExtra;
    top = `<polygon points="${p(0,h,0)} ${p(w/2,ridgeH,0)} ${p(w/2,ridgeH,d)} ${p(0,h,d)}" fill="${primary.light}" stroke="${primary.stroke}" stroke-width="1"/>
           <polygon points="${p(w,h,0)} ${p(w/2,ridgeH,0)} ${p(w/2,ridgeH,d)} ${p(w,h,d)}" fill="${primary.fill}" stroke="${primary.stroke}" stroke-width="1"/>`;
  } else {
    top = `<polygon points="${p(0,h,0)} ${p(w,h,0)} ${p(w,h,d)} ${p(0,h,d)}" fill="${primary.light}" stroke="${primary.stroke}" stroke-width="1"/>`;
  }

  // Window openings
  let windows = '';
  if (spec.openings !== 'none') {
    const windowRows = Math.min(spec.floors, 4);
    const floorH = h / spec.floors;
    const windowW = w / 6;
    const windowH = floorH * 0.5;
    const cols = spec.openings === 'ribbon' ? 1 : Math.floor(w / (windowW * 2));

    for (let floor = 0; floor < windowRows; floor++) {
      const y0 = floor * floorH + floorH * 0.25;
      if (spec.openings === 'ribbon') {
        // Ribbon window - full width
        windows += `<rect x="${tx(w*0.1, y0 + windowH, 0)}" y="${ty(w*0.1, y0 + windowH, 0)}"
          width="${(w * 0.8 * scale * 0.7).toFixed(1)}" height="${(windowH * scale * 0.6).toFixed(1)}"
          fill="rgba(80,120,140,0.4)" stroke="${primary.stroke}" stroke-width="0.5"/>`;
      } else {
        for (let col = 0; col < cols; col++) {
          const x0 = windowW + col * (w - windowW * 2) / Math.max(1, cols - 1);
          windows += `<rect x="${tx(x0, y0 + windowH, 0)}" y="${ty(x0, y0 + windowH, 0)}"
            width="${(windowW * scale * 0.6).toFixed(1)}" height="${(windowH * scale * 0.6).toFixed(1)}"
            fill="rgba(80,120,140,0.4)" stroke="${primary.stroke}" stroke-width="0.5"/>`;
        }
      }
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;">
    <defs>
      <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#E8E4DC"/>
        <stop offset="100%" stop-color="#D8D4CC"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#skyGrad)"/>
    ${shadow}
    ${front}
    ${right}
    ${top}
    ${windows}
  </svg>`;
}

// ─── RENDER META TABLE HTML ───────────────────────────────────────────
export function renderMetaHtml(spec, reqs) {
  const matLabel = (m) => m === 'none' ? '—' : (ISLAND_MATERIALS[m]?.name || m);
  const matPct = (p) => Math.round(p * 100) + '%';
  const esc = (s) => String(s || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let html = `
    <div class="ai-meta-row"><span class="ai-meta-key">NAME</span><span class="ai-meta-val">${esc(spec.name)}</span></div>
    <div class="ai-meta-row"><span class="ai-meta-key">FOOTPRINT</span><span class="ai-meta-val">${reqs.wFt}′ × ${reqs.dFt}′ · ${spec.footprint_w * spec.footprint_d} cells</span></div>
    <div class="ai-meta-row"><span class="ai-meta-key">FLOORS</span><span class="ai-meta-val">${spec.floors} · ${reqs.hFt}′ tall</span></div>
    <div class="ai-meta-row"><span class="ai-meta-key">PRIMARY</span><span class="ai-meta-val">${matLabel(spec.primary_material)} (${matPct(spec.material_pct_primary)})</span></div>
  `;

  if (spec.secondary_material && spec.secondary_material !== 'none') {
    html += `<div class="ai-meta-row"><span class="ai-meta-key">SECONDARY</span><span class="ai-meta-val">${matLabel(spec.secondary_material)} (${matPct(spec.material_pct_secondary)})</span></div>`;
  }

  html += `
    <div class="ai-meta-row"><span class="ai-meta-key">CHARACTER</span><span class="ai-meta-val">${esc(spec.character)} · ${esc(spec.roof_type)} roof</span></div>
    <div class="ai-meta-row"><span class="ai-meta-key">LIFESPAN</span><span class="ai-meta-val">~${spec.estimated_lifespan_years} yr</span></div>
    <div class="ai-meta-row"><span class="ai-meta-key">DEATH PLAN</span><span class="ai-meta-val">${esc((spec.death_plan_recommendation || '').replace(/-/g, ' '))}</span></div>
    <div class="ai-meta-divider"></div>
    <div class="ai-meta-row"><span class="ai-meta-key">TIMBER</span><span class="ai-meta-val">${reqs.materialReq.timber.toLocaleString()} bf</span></div>
    <div class="ai-meta-row"><span class="ai-meta-key">STONE</span><span class="ai-meta-val">${reqs.materialReq.stone.toLocaleString()} cu ft</span></div>
    <div class="ai-meta-row"><span class="ai-meta-key">BRICK</span><span class="ai-meta-val">${reqs.materialReq.brick.toLocaleString()} units</span></div>
    <div class="ai-meta-divider"></div>
    <div class="ai-meta-row"><span class="ai-meta-key">EMBODIED CO₂</span><span class="ai-meta-val">${reqs.embodiedCarbon} t</span></div>
    <div class="ai-meta-row"><span class="ai-meta-key">EXCAVATION</span><span class="ai-meta-val">${reqs.wasteSoil.toLocaleString()} cu ft soil</span></div>
    <div class="ai-meta-row"><span class="ai-meta-key">LABOR</span><span class="ai-meta-val">${reqs.laborReq} person-days</span></div>
    <div class="ai-meta-row"><span class="ai-meta-key">BUILD TIME</span><span class="ai-meta-val">${reqs.constructionDays} days</span></div>
  `;

  return html;
}
