// ════════════════════════════════════════════════════════════════════
// GAME LOOP MODULE — Construction + Deterioration + Death
// ════════════════════════════════════════════════════════════════════
// Drives the thesis game loop: buildings construct floor-by-floor,
// deteriorate based on material properties, and eventually trigger
// death plans when condition reaches zero.

import { DETERIORATION_PER_DAY, DEATH_PLANS } from '../state/materials.js';
import { addSalvage } from '../state/salvage.js';
import { getBuildLaborAllocation, deallocateLabor } from '../state/labor.js';

// ─── CONSTANTS ──────────────────────────────────────────────────────
// Visual cycle: 5 real minutes = 1 visual day (atmosphere, steel imports, decay)
export const VISUAL_CYCLE_SECONDS = 300; // 5 minutes per visual day

// Construction timelapse: 1 real second = 1 construction day (fast building)
export const CONSTRUCTION_SECONDS_PER_DAY = 1.0;

// Legacy alias for compatibility
export const REAL_SECONDS_PER_GAME_DAY = CONSTRUCTION_SECONDS_PER_DAY;

// Steel import settings
export const STEEL_WEEKLY_IMPORT = 200; // units per visual week
export const STEEL_MAX_STOCKPILE = 500; // max storage

// ─── GAME STATE ─────────────────────────────────────────────────────
export const GAME = {
  tickFrame: null,
  lastTime: 0,
  renderCallback: null,  // Called when iso view needs refresh
  walkDirty: false,      // Set true when walk view needs rebuild

  // Visual cycle state
  visualStartTime: null,  // When the visual cycle started
  visualDay: 1,           // Current visual day
  visualWeek: 1,          // Current visual week
  lastSteelWeek: 0,       // Last week steel was delivered

  // Atmosphere callbacks
  atmosphereCallback: null // Called when time-of-day changes
};

// ─── VISUAL TIME HELPERS ─────────────────────────────────────────────
export function initVisualCycle() {
  GAME.visualStartTime = performance.now();
  GAME.visualDay = 1;
  GAME.visualWeek = 1;
  GAME.lastSteelWeek = 0;
}

// Get current visual time info
export function getVisualTime() {
  if (!GAME.visualStartTime) initVisualCycle();

  const elapsed = (performance.now() - GAME.visualStartTime) / 1000; // seconds
  const totalVisualDays = elapsed / VISUAL_CYCLE_SECONDS;
  const currentDay = Math.floor(totalVisualDays) + 1;
  const currentWeek = Math.floor((currentDay - 1) / 7) + 1;

  // Progress through current day (0-1)
  const dayProgress = totalVisualDays % 1;

  // Calculate time-of-day phase
  let phase, hour;
  if (dayProgress < 0.1) {
    phase = 'night';
    hour = 2 + (dayProgress / 0.1) * 3; // 2-5 AM
  } else if (dayProgress < 0.2) {
    phase = 'predawn';
    hour = 5 + ((dayProgress - 0.1) / 0.1) * 1.5; // 5-6:30 AM
  } else if (dayProgress < 0.3) {
    phase = 'dawn';
    hour = 6.5 + ((dayProgress - 0.2) / 0.1) * 1.5; // 6:30-8 AM
  } else if (dayProgress < 0.7) {
    phase = 'day';
    hour = 8 + ((dayProgress - 0.3) / 0.4) * 9; // 8 AM - 5 PM
  } else if (dayProgress < 0.8) {
    phase = 'dusk';
    hour = 17 + ((dayProgress - 0.7) / 0.1) * 1.5; // 5-6:30 PM
  } else if (dayProgress < 0.9) {
    phase = 'evening';
    hour = 18.5 + ((dayProgress - 0.8) / 0.1) * 1.5; // 6:30-8 PM
  } else {
    phase = 'night';
    hour = 20 + ((dayProgress - 0.9) / 0.1) * 6; // 8 PM - 2 AM
  }

  return {
    day: currentDay,
    week: currentWeek,
    dayProgress,
    phase,
    hour,
    elapsed
  };
}

// Get atmosphere colors for current time
export function getAtmosphereColors() {
  const { phase, dayProgress } = getVisualTime();

  const phaseColors = {
    night:   { sky: '#0A1530', horizon: '#1A2845', ground: '#2A3858', fog: '#1A2845' },
    predawn: { sky: '#1A2B4A', horizon: '#4A4868', ground: '#C58A88', fog: '#3A3858' },
    dawn:    { sky: '#6896C8', horizon: '#E8B898', ground: '#FFD590', fog: '#D8C8A0' },
    day:     { sky: '#B8D5E8', horizon: '#E8E0D0', ground: '#F8E8C0', fog: '#E8E4D8' },
    dusk:    { sky: '#4A6890', horizon: '#C88858', ground: '#E8703A', fog: '#8A7868' },
    evening: { sky: '#2A3858', horizon: '#6A5878', ground: '#A88068', fog: '#4A4858' }
  };

  return phaseColors[phase] || phaseColors.day;
}

// Set atmosphere callback
export function setAtmosphereCallback(callback) {
  GAME.atmosphereCallback = callback;
}

// ─── START CONSTRUCTION ─────────────────────────────────────────────
export function startConstruction(build) {
  if (!build) return;

  build.constructionStarted = performance.now();
  // Labor-based construction: totalLaborHours set during commit
  // Keep legacy duration for fallback
  build.constructionDurationMs = (build.constructionDays || 30) * REAL_SECONDS_PER_GAME_DAY * 1000;
  build.progressFraction = 0;
  build.status = 'constructing';
  build.lastFloorRevealed = 0;

  // Initialize labor tracking if not already set
  if (!build.accumulatedLaborHours) build.accumulatedLaborHours = 0;

  ensureGameTick();
}

// ─── ENSURE GAME TICK RUNNING ───────────────────────────────────────
function ensureGameTick() {
  if (GAME.tickFrame) return;
  GAME.lastTime = performance.now();
  tickGame();
}

// ─── MAIN GAME TICK ─────────────────────────────────────────────────
function tickGame() {
  const state = window.__OFFCUT_STATE__;
  if (!state) {
    GAME.tickFrame = null;
    return;
  }

  const now = performance.now();
  const deltaMs = now - (GAME.lastTime || now);
  GAME.lastTime = now;

  const builds = state.island?.builds || [];
  let anyActive = false;
  let needsIsoRerender = false;
  let needsWalkRebuild = false;

  // Convert real ms to game days
  const deltaDays = (deltaMs / 1000) / REAL_SECONDS_PER_GAME_DAY;

  // Advance global game-day counter
  state.island.gameDay = (state.island.gameDay || 1) + deltaDays;

  for (const b of builds) {
    if (b.status === 'constructing') {
      anyActive = true;

      // Labor-based progress: accumulate labor hours each tick
      const totalHours = b.totalLaborHours || 0;
      let frac;

      if (totalHours > 0) {
        // Use labor hours system
        const allocation = getBuildLaborAllocation(state, b.id) || b.laborAllocation || 0;
        if (allocation > 0) {
          b.accumulatedLaborHours = (b.accumulatedLaborHours || 0) + (allocation * deltaDays);
        }
        frac = Math.min(1, b.accumulatedLaborHours / totalHours);
      } else {
        // Fallback to legacy time-based progress
        const elapsed = now - b.constructionStarted;
        frac = Math.min(1, elapsed / b.constructionDurationMs);
      }

      const oldFrac = b.progressFraction || 0;
      b.progressFraction = frac;

      // Track floors for visual reveal
      const totalFloors = b.stories || 1;
      const curFloors = Math.max(1, Math.floor(frac * totalFloors));

      // Update tile state
      const tile = state.island.tiles.find(t =>
        b.primaryTile && t.gx === b.primaryTile.gx && t.gy === b.primaryTile.gy
      );
      if (tile && tile.populated) {
        tile.populated.progressFraction = frac;
        tile.populated.visibleFloors = curFloors;
      }

      // Check if new floor revealed
      if (Math.floor(oldFrac * totalFloors) !== Math.floor(frac * totalFloors)) {
        needsIsoRerender = true;
        needsWalkRebuild = true;
        b.lastFloorRevealed = curFloors;
      } else if (frac - (b._lastIsoRefreshFrac || 0) > 0.04) {
        // Subtle progress refresh every 4%
        needsIsoRerender = true;
        b._lastIsoRefreshFrac = frac;
      }

      // Construction complete
      if (frac >= 1) {
        b.status = 'complete';
        b.progressFraction = 1;
        b.condition = 1.0;  // Brand new
        b.lastMaintainedDay = state.island.gameDay;
        if (b.totalLaborHours) {
          b.accumulatedLaborHours = b.totalLaborHours;
        }

        // Deallocate labor from pool
        deallocateLabor(state, b.id);

        if (tile && tile.populated) {
          tile.populated.progressFraction = 1;
          tile.populated.visibleFloors = totalFloors;
          tile.populated.condition = 1.0;
        }

        needsIsoRerender = true;
        needsWalkRebuild = true;

        console.log(`Build complete: ${b.name || b.id}`);
      }
    } else if (b.status === 'complete' || b.status === 'committed') {
      // ── DETERIORATION ──
      const primaryMat = b.materials?.primary || 'timber';
      const secondaryMat = b.materials?.secondary;

      const primaryRate = DETERIORATION_PER_DAY[primaryMat] || 0.005;
      const secondaryRate = (secondaryMat && secondaryMat !== 'none')
        ? (DETERIORATION_PER_DAY[secondaryMat] || 0.005) * 0.3
        : 0;

      const totalRate = primaryRate + secondaryRate;
      const oldCondition = b.condition != null ? b.condition : 1.0;
      const newCondition = Math.max(0, oldCondition - totalRate * deltaDays);
      b.condition = newCondition;

      // Update tile state
      const tile = state.island.tiles.find(t =>
        b.primaryTile && t.gx === b.primaryTile.gx && t.gy === b.primaryTile.gy
      );
      if (tile && tile.populated) {
        tile.populated.condition = newCondition;
      }

      // Refresh on 10% threshold crossings
      if (Math.floor(oldCondition * 10) !== Math.floor(newCondition * 10)) {
        needsIsoRerender = true;
      }

      // ── DEATH TRIGGER ──
      if (newCondition <= 0 && oldCondition > 0) {
        triggerDeath(state, b);
        needsIsoRerender = true;
        needsWalkRebuild = true;
      }

      anyActive = true;  // Committed builds always degrade
    }
    // Status 'ruined' or 'dismantled' — no updates needed
  }

  // Trigger rerenders
  if (needsIsoRerender && GAME.renderCallback) {
    GAME.renderCallback();
  }
  if (needsWalkRebuild) {
    GAME.walkDirty = true;
  }

  // Continue ticking if any builds are active
  if (anyActive) {
    GAME.tickFrame = requestAnimationFrame(tickGame);
  } else {
    GAME.tickFrame = null;
  }
}

// ─── TRIGGER DEATH ──────────────────────────────────────────────────
function triggerDeath(state, build) {
  if (!build) return;

  const plan = build.deathPlan || 'demolish-salvage';
  const planConfig = DEATH_PLANS[plan] || DEATH_PLANS['demolish-salvage'];
  const recovery = planConfig.salvageRate || 0;
  const newStatus = (plan === 'abandon') ? 'ruined' : 'dismantled';

  console.log(`Death triggered: ${build.name || build.id} (${plan})`);

  // Recover materials to author's salvage inventory
  if (recovery > 0 && build.materialReq) {
    const author = build.author || 'anon';
    const materials = ['timber', 'stone', 'brick'];

    materials.forEach(mat => {
      const amount = Math.round((build.materialReq[mat] || 0) * recovery);
      if (amount > 0) {
        addSalvage(state, author, mat, amount);
      }
    });
  }

  // Update tile state
  const tile = state.island.tiles.find(t =>
    build.primaryTile && t.gx === build.primaryTile.gx && t.gy === build.primaryTile.gy
  );

  if (tile) {
    if (newStatus === 'ruined') {
      // Tile becomes a permanent ruin
      tile.populated = {
        kind: 'ruin',
        originalBuildId: build.id,
        progressFraction: 1,
        condition: 0
      };
      tile.built = true;
    } else {
      // Tile cleared — buildable again
      tile.populated = null;
      tile.built = false;
    }
  }

  build.status = newStatus;
  build.deathDate = state.island.gameDay;
}

// ─── MAINTENANCE ────────────────────────────────────────────────────
export function maintainBuild(state, build) {
  if (!build || (build.status !== 'complete' && build.status !== 'committed')) return false;

  // Check if user has enough salvage materials
  const author = build.author || state.user?.name;
  if (!author) return false;

  // Maintenance cost is proportional to damage
  const damage = 1 - (build.condition || 0);
  const baseCost = build.materialReq || {};
  const maintenanceCost = {};

  Object.entries(baseCost).forEach(([mat, amount]) => {
    maintenanceCost[mat] = Math.ceil(amount * damage * 0.1);  // 10% of damage
  });

  // For now, just restore condition (in production would consume salvage)
  build.condition = 1.0;
  build.lastMaintainedDay = state.island.gameDay;

  const tile = state.island.tiles.find(t =>
    build.primaryTile && t.gx === build.primaryTile.gx && t.gy === build.primaryTile.gy
  );
  if (tile && tile.populated) {
    tile.populated.condition = 1.0;
  }

  console.log(`Maintained: ${build.name || build.id}`);
  return true;
}

// ─── SET RENDER CALLBACK ────────────────────────────────────────────
export function setRenderCallback(callback) {
  GAME.renderCallback = callback;
}

// ─── EXPOSE STATE ───────────────────────────────────────────────────
// The game loop needs access to global state
export function setGlobalState(state) {
  window.__OFFCUT_STATE__ = state;
}

// ─── STOP GAME LOOP ─────────────────────────────────────────────────
export function stopGameLoop() {
  if (GAME.tickFrame) {
    cancelAnimationFrame(GAME.tickFrame);
    GAME.tickFrame = null;
  }
}
