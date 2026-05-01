// ════════════════════════════════════════════════════════════════════
// SPECIES — PLAYER ARCHETYPES
// Each species enacts a different value system. Human is the default;
// others (Wasp, Reservoir, H100) will be playable archetypes that
// constrain the player to embody that specimen's relationship to
// waste, labor, and death.
// ════════════════════════════════════════════════════════════════════

export const SPECIES = {
  human: {
    label: 'Human',
    catalog: ['cabin', 'tower', 'warehouse', 'plaza'],   // not yet enforced
    valueSystemPriors: {
      // What humans typically over-extract / under-account-for
      hidesEmbodiedCarbon: true,
      prefersFreshExtraction: true,
      undervaluesSalvage: true
    }
  }
  // wasp, reservoir, h100 — to come
};
