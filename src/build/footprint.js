// ════════════════════════════════════════════════════════════════════
// FOOTPRINT POLYGON COMPUTATION
// Computes building footprint polygon from selected tiles
// ════════════════════════════════════════════════════════════════════

const TILE_SIZE = 130; // feet per tile

/**
 * Compute the union polygon from selected tiles with inset.
 * @param {Array<{gx: number, gy: number}>} tiles - Selected tiles
 * @param {number} insetFeet - Inset from tile edges (default 4 feet)
 * @returns {FootprintPolygon} - The computed footprint polygon
 */
export function computeTileUnionPolygon(tiles, insetFeet = 4) {
  if (!tiles || tiles.length === 0) {
    return null;
  }

  const tileSet = new Set(tiles.map(t => `${t.gx},${t.gy}`));
  const segments = [];

  // Collect boundary edges (not shared with other selected tiles)
  for (const tile of tiles) {
    const x0 = tile.gx * TILE_SIZE;
    const y0 = tile.gy * TILE_SIZE;
    const x1 = x0 + TILE_SIZE;
    const y1 = y0 + TILE_SIZE;

    // Top edge (y = y0)
    if (!tileSet.has(`${tile.gx},${tile.gy - 1}`)) {
      segments.push({ p1: { x: x0, y: y0 }, p2: { x: x1, y: y0 }, dir: 'top' });
    }
    // Right edge (x = x1)
    if (!tileSet.has(`${tile.gx + 1},${tile.gy}`)) {
      segments.push({ p1: { x: x1, y: y0 }, p2: { x: x1, y: y1 }, dir: 'right' });
    }
    // Bottom edge (y = y1)
    if (!tileSet.has(`${tile.gx},${tile.gy + 1}`)) {
      segments.push({ p1: { x: x1, y: y1 }, p2: { x: x0, y: y1 }, dir: 'bottom' });
    }
    // Left edge (x = x0)
    if (!tileSet.has(`${tile.gx - 1},${tile.gy}`)) {
      segments.push({ p1: { x: x0, y: y1 }, p2: { x: x0, y: y0 }, dir: 'left' });
    }
  }

  // Stitch segments into ordered polygon (counter-clockwise)
  const polygon = stitchSegments(segments);
  if (!polygon || polygon.length < 3) {
    return null;
  }

  // Apply inset
  const insetPolygon = insetFeet > 0 ? insetPolygonVertices(polygon, insetFeet) : polygon;

  // Compute properties
  const bounds = computeBounds(insetPolygon);
  const centroid = computeCentroid(insetPolygon);
  const area = computeArea(insetPolygon);
  const shapeType = classifyShape(tiles);
  const longestEdge = findLongestEdge(insetPolygon);

  return {
    vertices: insetPolygon,
    bounds,
    centroid,
    area,
    shapeType,
    longestEdge,
    tiles: tiles.map(t => ({ gx: t.gx, gy: t.gy })),
    tileCount: tiles.length
  };
}

/**
 * Stitch boundary segments into an ordered polygon.
 * Walks the boundary counter-clockwise.
 */
function stitchSegments(segments) {
  if (segments.length === 0) return [];

  // Build adjacency map: point -> outgoing segment
  const pointKey = p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const outgoing = new Map();

  for (const seg of segments) {
    const key = pointKey(seg.p1);
    if (!outgoing.has(key)) {
      outgoing.set(key, []);
    }
    outgoing.get(key).push(seg);
  }

  // Start from topmost-leftmost point
  let startSeg = segments[0];
  for (const seg of segments) {
    if (seg.p1.y < startSeg.p1.y ||
        (seg.p1.y === startSeg.p1.y && seg.p1.x < startSeg.p1.x)) {
      startSeg = seg;
    }
  }

  const polygon = [];
  const visited = new Set();
  let currentSeg = startSeg;

  // Walk the boundary
  while (currentSeg && !visited.has(currentSeg)) {
    visited.add(currentSeg);
    polygon.push({ x: currentSeg.p1.x, y: currentSeg.p1.y });

    // Find next segment starting from current segment's end
    const nextKey = pointKey(currentSeg.p2);
    const candidates = outgoing.get(nextKey) || [];
    currentSeg = candidates.find(s => !visited.has(s));
  }

  return polygon;
}

/**
 * Inset polygon vertices by a distance.
 * Uses simplified parallel offset for rectilinear polygons.
 */
function insetPolygonVertices(vertices, distance) {
  if (vertices.length < 3) return vertices;

  const inset = [];
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    // Compute inward direction at this vertex
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    // Normals pointing inward (for counter-clockwise polygon)
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;

    const n1x = -dy1 / len1;
    const n1y = dx1 / len1;
    const n2x = -dy2 / len2;
    const n2y = dx2 / len2;

    // Average normal
    let nx = (n1x + n2x) / 2;
    let ny = (n1y + n2y) / 2;
    const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= nlen;
    ny /= nlen;

    // For convex corners (90 degrees), scale by sqrt(2) to maintain distance
    const dot = n1x * n2x + n1y * n2y;
    const scale = Math.abs(dot) < 0.9 ? Math.sqrt(2) : 1;

    inset.push({
      x: curr.x + nx * distance * scale,
      y: curr.y + ny * distance * scale
    });
  }

  return inset;
}

/**
 * Compute bounding box of polygon.
 */
function computeBounds(vertices) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }

  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Compute centroid of polygon.
 */
function computeCentroid(vertices) {
  let cx = 0, cy = 0;
  for (const v of vertices) {
    cx += v.x;
    cy += v.y;
  }
  return { x: cx / vertices.length, y: cy / vertices.length };
}

/**
 * Compute area of polygon using shoelace formula.
 */
function computeArea(vertices) {
  let area = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area / 2);
}

/**
 * Classify the shape type based on tile arrangement.
 */
function classifyShape(tiles) {
  if (tiles.length === 1) return 'square';

  // Get bounds
  let minGx = Infinity, maxGx = -Infinity;
  let minGy = Infinity, maxGy = -Infinity;
  for (const t of tiles) {
    minGx = Math.min(minGx, t.gx);
    maxGx = Math.max(maxGx, t.gx);
    minGy = Math.min(minGy, t.gy);
    maxGy = Math.max(maxGy, t.gy);
  }

  const spanX = maxGx - minGx + 1;
  const spanY = maxGy - minGy + 1;

  // Check if it fills the bounding box (rectangular)
  if (tiles.length === spanX * spanY) {
    if (spanX === spanY) return 'square';
    if (spanX === 1 || spanY === 1) return 'linear';
    return 'rect';
  }

  // Not filling bounding box - could be L, T, or irregular
  if (tiles.length === 3) {
    // Could be L-shape or linear
    const tileSet = new Set(tiles.map(t => `${t.gx},${t.gy}`));
    // L-shape test: one tile has two neighbors at 90 degrees
    for (const t of tiles) {
      const neighbors = [
        tileSet.has(`${t.gx + 1},${t.gy}`),
        tileSet.has(`${t.gx - 1},${t.gy}`),
        tileSet.has(`${t.gx},${t.gy + 1}`),
        tileSet.has(`${t.gx},${t.gy - 1}`)
      ];
      // Check for corner configuration
      if ((neighbors[0] && neighbors[2]) || (neighbors[0] && neighbors[3]) ||
          (neighbors[1] && neighbors[2]) || (neighbors[1] && neighbors[3])) {
        return 'L';
      }
    }
    return 'linear';
  }

  if (tiles.length === 4) {
    // Could be square, L, T, or linear
    if (spanX === 2 && spanY === 2 && tiles.length === 4) return 'square';

    const tileSet = new Set(tiles.map(t => `${t.gx},${t.gy}`));
    // Check for L-shape (missing one corner from 2x2)
    if (spanX === 2 && spanY === 2 && tiles.length === 3) return 'L';

    // Linear (1x4 or 4x1)
    if (spanX === 1 || spanY === 1) return 'linear';

    // L-shape if 4 tiles not filling 2x2
    return 'L';
  }

  return 'irregular';
}

/**
 * Find the longest edge and its orientation.
 */
function findLongestEdge(vertices) {
  let longest = { length: 0, axis: 'x', startIdx: 0 };
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = vertices[j].x - vertices[i].x;
    const dy = vertices[j].y - vertices[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len > longest.length) {
      // Determine axis - primarily horizontal or vertical
      const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      longest = {
        length: len,
        axis,
        startIdx: i,
        start: { x: vertices[i].x, y: vertices[i].y },
        end: { x: vertices[j].x, y: vertices[j].y }
      };
    }
  }

  return longest;
}

/**
 * Get the edges of the polygon for window placement.
 */
export function getPolygonEdges(polygon) {
  const edges = [];
  const n = polygon.vertices.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const start = polygon.vertices[i];
    const end = polygon.vertices[j];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    // Determine facing direction (outward normal)
    const nx = dy / length;
    const ny = -dx / length;

    // Classify edge direction
    let facing;
    if (Math.abs(nx) > Math.abs(ny)) {
      facing = nx > 0 ? 'east' : 'west';
    } else {
      facing = ny > 0 ? 'south' : 'north';
    }

    edges.push({
      start,
      end,
      length,
      midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      normal: { x: nx, y: ny },
      facing,
      index: i
    });
  }

  return edges;
}

/**
 * Convert footprint polygon to local coordinates centered at origin.
 * This is useful for 3D generation where (0,0) should be building center.
 */
export function centerPolygon(polygon) {
  const cx = polygon.centroid.x;
  const cy = polygon.centroid.y;

  return {
    ...polygon,
    vertices: polygon.vertices.map(v => ({
      x: v.x - cx,
      y: v.y - cy
    })),
    centroid: { x: 0, y: 0 },
    bounds: {
      minX: polygon.bounds.minX - cx,
      maxX: polygon.bounds.maxX - cx,
      minY: polygon.bounds.minY - cy,
      maxY: polygon.bounds.maxY - cy,
      width: polygon.bounds.width,
      height: polygon.bounds.height
    },
    longestEdge: polygon.longestEdge ? {
      ...polygon.longestEdge,
      start: polygon.longestEdge.start ? {
        x: polygon.longestEdge.start.x - cx,
        y: polygon.longestEdge.start.y - cy
      } : undefined,
      end: polygon.longestEdge.end ? {
        x: polygon.longestEdge.end.x - cx,
        y: polygon.longestEdge.end.y - cy
      } : undefined
    } : undefined,
    worldOffset: { x: cx, y: cy }
  };
}

/**
 * Create a THREE.js Shape from polygon vertices.
 * Note: In THREE.js, we use X and Z for the ground plane.
 */
export function polygonToThreeShape(polygon) {
  // Import THREE dynamically or assume it's available
  if (typeof THREE === 'undefined') {
    // Return vertex data for manual shape creation
    return {
      type: 'shape',
      vertices: polygon.vertices.map(v => ({ x: v.x, z: v.y }))
    };
  }

  const shape = new THREE.Shape();
  const verts = polygon.vertices;

  if (verts.length > 0) {
    shape.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      shape.lineTo(verts[i].x, verts[i].y);
    }
    shape.closePath();
  }

  return shape;
}

/**
 * Compute the "front" direction for a building based on tile positions.
 * Front is typically toward the road/lower elevation or longest edge.
 */
export function computeFrontDirection(polygon, tiles) {
  // Default: use longest edge direction
  if (polygon.longestEdge) {
    const edge = polygon.longestEdge;
    // Front faces perpendicular to longest edge, toward "outside"
    // For linear buildings, front is along the length
    if (polygon.shapeType === 'linear') {
      return edge.axis === 'x' ? 'south' : 'east';
    }
  }

  // For L-shapes, front is at the outer corner
  if (polygon.shapeType === 'L') {
    // Find the corner with most exposure (outer corner of L)
    const bounds = polygon.bounds;
    const cx = polygon.centroid.x;
    const cy = polygon.centroid.y;

    // The front is typically the direction away from the "inside" of the L
    // Heuristic: check which quadrant has the most area
    return 'south'; // Default for now
  }

  // Default front direction
  return 'south';
}
