// ════════════════════════════════════════════════════════════════════
// LABOR POOL — Island workforce management
// ════════════════════════════════════════════════════════════════════
// Tracks available labor hours based on population and housing.
// Buildings require labor allocation to progress.

// Labor hours added per building type
const LABOR_FROM_BUILDING = {
  house: 20,        // Small dwelling: +20 hrs/day
  tower: 80,        // Housing tower: +80 hrs/day
  // Other buildings don't add labor
};

// ── TOTAL AVAILABLE LABOR ────────────────────────────────────────────

/**
 * Calculate total labor hours available per day.
 * Base (founding settlers) + housing contributions.
 */
export function getTotalLaborPerDay(state) {
  const pool = state.island.laborPool;
  if (!pool) return 100; // Default fallback

  // Recalculate fromBuildings based on completed housing
  let fromBuildings = 0;
  for (const build of (state.island.builds || [])) {
    if (build.status === 'complete') {
      const add = LABOR_FROM_BUILDING[build.buildingType] || 0;
      fromBuildings += add;
    }
  }

  // Update cached value
  pool.fromBuildings = fromBuildings;

  return pool.base + fromBuildings;
}

/**
 * Get labor already allocated to active builds.
 */
export function getAllocatedLabor(state) {
  const pool = state.island.laborPool;
  if (!pool || !pool.allocated) return 0;

  let total = 0;
  for (const buildId in pool.allocated) {
    total += pool.allocated[buildId] || 0;
  }
  return total;
}

/**
 * Get available (unallocated) labor hours per day.
 */
export function getAvailableLabor(state) {
  return Math.max(0, getTotalLaborPerDay(state) - getAllocatedLabor(state));
}

/**
 * Get idle labor (unallocated) as a percentage.
 */
export function getIdleLaborPercent(state) {
  const total = getTotalLaborPerDay(state);
  if (total === 0) return 0;
  return Math.round((getAvailableLabor(state) / total) * 100);
}

// ── LABOR ALLOCATION ─────────────────────────────────────────────────

/**
 * Allocate labor hours per day to a build.
 * Returns actual amount allocated (may be less if not enough available).
 */
export function allocateLabor(state, buildId, hoursPerDay) {
  const pool = state.island.laborPool;
  if (!pool) return 0;

  if (!pool.allocated) pool.allocated = {};

  // Get current allocation for this build
  const currentAllocation = pool.allocated[buildId] || 0;

  // Calculate how much more we're trying to allocate
  const delta = hoursPerDay - currentAllocation;

  // Check available labor
  const available = getAvailableLabor(state);

  if (delta > available) {
    // Can't allocate that much, allocate what we can
    pool.allocated[buildId] = currentAllocation + available;
    return pool.allocated[buildId];
  }

  pool.allocated[buildId] = hoursPerDay;
  return hoursPerDay;
}

/**
 * Remove labor allocation for a build (when complete or cancelled).
 */
export function deallocateLabor(state, buildId) {
  const pool = state.island.laborPool;
  if (!pool || !pool.allocated) return;

  delete pool.allocated[buildId];
}

/**
 * Get labor allocation for a specific build.
 */
export function getBuildLaborAllocation(state, buildId) {
  const pool = state.island.laborPool;
  if (!pool || !pool.allocated) return 0;
  return pool.allocated[buildId] || 0;
}

// ── BUILD PROGRESS ───────────────────────────────────────────────────

/**
 * Calculate build progress based on accumulated labor hours.
 * Returns { progress: 0-1, hoursRemaining, daysRemaining }
 */
export function getBuildProgress(build) {
  if (!build) return { progress: 0, hoursRemaining: 0, daysRemaining: Infinity };

  const totalHours = build.totalLaborHours || 0;
  const accumulated = build.accumulatedLaborHours || 0;
  const allocation = build.laborAllocation || 0;

  const progress = totalHours > 0 ? Math.min(1, accumulated / totalHours) : 0;
  const hoursRemaining = Math.max(0, totalHours - accumulated);
  const daysRemaining = allocation > 0 ? Math.ceil(hoursRemaining / allocation) : Infinity;

  return { progress, hoursRemaining, daysRemaining };
}

/**
 * Advance a build by one day's worth of allocated labor.
 * Returns true if build completed this tick.
 */
export function advanceBuildByDay(state, build) {
  if (!build || build.status !== 'constructing') return false;

  const allocation = getBuildLaborAllocation(state, build.id);
  if (allocation <= 0) return false;

  // Add allocated hours to accumulated
  build.accumulatedLaborHours = (build.accumulatedLaborHours || 0) + allocation;

  // Check if complete
  const totalHours = build.totalLaborHours || 0;
  if (build.accumulatedLaborHours >= totalHours) {
    build.status = 'complete';
    build.accumulatedLaborHours = totalHours;

    // Remove labor allocation
    deallocateLabor(state, build.id);

    return true;
  }

  return false;
}
