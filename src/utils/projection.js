// ════════════════════════════════════════════════════════════════════
// PROJECTION + COORDINATE SYSTEMS
// Converts between the three coordinate systems used in Offcut World:
//   1. Tile coords (gx, gy) — integer grid addresses
//   2. Screen coords (sx, sy) — pixel positions in SVG/canvas
//   3. Walk coords — Three.js world units (meters)
//
// The isometric projection is what gives the game its architectural
// drawing register — diamond tiles laid out at a 2:1 aspect ratio.
// ════════════════════════════════════════════════════════════════════

// ── ISO TILE CONSTANTS ──────────────────────────────────────────────
export const TILE_W = 38;         // horizontal radius of diamond (pixels)
export const TILE_H = 19;         // vertical radius of diamond (pixels)
export const GRID_RADIUS = 23;    // half-extent → 47×47 bounding grid
export const ELEV_UNIT = 5;       // pixels per elevation step
export const MAX_ELEV = 14;       // tallest peak in units

// ── ISLAND SHAPE CONSTANTS ──────────────────────────────────────────
export const BASE_RADIUS = 17;    // base island radius (under coastline noise)
export const COAST_VAR = 8;       // coastline wobble amplitude

// ── PLAN VIEW CONSTANTS ─────────────────────────────────────────────
export const PLAN_TILE = 18;      // half-width of square cell in plan view

// ── GRID TO SCREEN ──────────────────────────────────────────────────

/**
 * Convert tile coordinates to screen coordinates.
 * @param {number} gx - Grid x coordinate
 * @param {number} gy - Grid y coordinate
 * @param {string} viewMode - 'atlas', 'plan', 'figure', 'figureplan', etc.
 * @returns {{ sx: number, sy: number }} Screen coordinates
 */
export function gridToScreen(gx, gy, viewMode = 'atlas') {
  // In plan mode, render as actual squares aligned to screen axes
  if (viewMode === 'plan' || viewMode === 'figureplan') {
    return {
      sx: gx * PLAN_TILE * 2,
      sy: gy * PLAN_TILE * 2
    };
  }
  // Isometric diamond projection
  return {
    sx: (gx - gy) * TILE_W,
    sy: (gx + gy) * TILE_H
  };
}

/**
 * Convert screen coordinates to tile coordinates (inverse of gridToScreen).
 * Returns floating-point values — caller should round as needed.
 * @param {number} sx - Screen x coordinate
 * @param {number} sy - Screen y coordinate
 * @param {string} viewMode - Current view mode
 * @returns {{ gx: number, gy: number }} Grid coordinates (float)
 */
export function screenToGrid(sx, sy, viewMode = 'atlas') {
  if (viewMode === 'plan' || viewMode === 'figureplan') {
    return {
      gx: sx / (PLAN_TILE * 2),
      gy: sy / (PLAN_TILE * 2)
    };
  }
  // Inverse of isometric: solve the system
  //   sx = (gx - gy) * TILE_W
  //   sy = (gx + gy) * TILE_H
  // =>
  //   gx = (sx/TILE_W + sy/TILE_H) / 2
  //   gy = (sy/TILE_H - sx/TILE_W) / 2
  return {
    gx: (sx / TILE_W + sy / TILE_H) / 2,
    gy: (sy / TILE_H - sx / TILE_W) / 2
  };
}

// ── ISO DRAWING HELPERS ─────────────────────────────────────────────

/**
 * Isometric coordinate helper for SVG drawing.
 * Converts (u, v, w) in "iso units" to screen coordinates.
 * u = left-right on the diamond face
 * v = up-down on the diamond face
 * w = vertical (height) offset
 * @param {number} u - Horizontal position in iso units
 * @param {number} v - Depth position in iso units
 * @param {number} w - Height in iso units (pixels)
 * @returns {{ x: number, y: number }} SVG coordinates
 */
export function iso(u, v, w = 0) {
  return {
    x: (u - v) * (TILE_W / 12),
    y: (u + v) * (TILE_H / 12) - w
  };
}

/**
 * Generate SVG path for a diamond tile at screen position.
 * @param {number} sx - Screen x (center of diamond)
 * @param {number} sy - Screen y (center of diamond)
 * @returns {string} SVG path d attribute
 */
export function tileDiamondPath(sx, sy) {
  return `M${sx},${sy - TILE_H} L${sx + TILE_W},${sy} L${sx},${sy + TILE_H} L${sx - TILE_W},${sy} Z`;
}

/**
 * Generate SVG path for a square tile in plan view.
 * @param {number} sx - Screen x (center of square)
 * @param {number} sy - Screen y (center of square)
 * @returns {string} SVG path d attribute
 */
export function tileSquarePath(sx, sy) {
  return `M${sx - PLAN_TILE},${sy - PLAN_TILE} L${sx + PLAN_TILE},${sy - PLAN_TILE} L${sx + PLAN_TILE},${sy + PLAN_TILE} L${sx - PLAN_TILE},${sy + PLAN_TILE} Z`;
}

// ── WALK VIEW CONSTANTS ─────────────────────────────────────────────
// For Three.js walk view — each tile is 40 meters across
export const METERS_PER_TILE = 40;
export const METERS_PER_UNIT = 3.33;  // 12 iso units per tile

/**
 * Convert tile coordinates to walk-view world coordinates.
 * @param {number} gx - Grid x coordinate
 * @param {number} gy - Grid y coordinate
 * @returns {{ x: number, z: number }} Three.js world position (xz plane)
 */
export function tileToWalk(gx, gy) {
  return {
    x: gx * METERS_PER_TILE,
    z: gy * METERS_PER_TILE
  };
}

/**
 * Convert elevation units to walk-view Y coordinate.
 * Non-linear scaling makes peaks punch up dramatically.
 * @param {number} elev - Elevation in units (0-14)
 * @returns {number} Y coordinate in meters
 */
export function elevToWalkY(elev) {
  // Each elevation unit is ~3 meters, with power curve for drama
  return Math.pow(elev, 1.1) * 3;
}
