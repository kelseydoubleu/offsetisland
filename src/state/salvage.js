// ════════════════════════════════════════════════════════════════════
// SALVAGE INVENTORY
// Tracks materials recovered from demolished builds. Salvage can be
// reused in new builds with zero transport carbon and zero land impact.
// This is the thesis reward for planning endings well.
// ════════════════════════════════════════════════════════════════════

// Ensure an author has an inventory entry
export function ensureSalvageInventory(state, author) {
  if (!state.island.salvageInventory[author]) {
    state.island.salvageInventory[author] = { timber: 0, stone: 0, brick: 0 };
  }
  return state.island.salvageInventory[author];
}

// Add salvaged material to an author's inventory
export function addSalvage(state, author, material, amount) {
  const inv = ensureSalvageInventory(state, author);
  inv[material] = (inv[material] || 0) + amount;
}

// Total salvage available (across all authors) for a given material
export function getSalvageTotal(state, material) {
  const inv = state.island.salvageInventory || {};
  let total = 0;
  for (const author in inv) {
    total += inv[author][material] || 0;
  }
  return total;
}

// Subtract salvage from inventory (proportionally across authors)
// Returns the amount actually consumed
export function consumeSalvage(state, material, amount) {
  const inv = state.island.salvageInventory || {};
  let remaining = amount;

  for (const author in inv) {
    const have = inv[author][material] || 0;
    const take = Math.min(have, remaining);
    inv[author][material] = have - take;
    remaining -= take;
    if (remaining <= 0) break;
  }

  return amount - remaining;  // amount actually consumed
}
