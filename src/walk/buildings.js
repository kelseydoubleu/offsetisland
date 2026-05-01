// ════════════════════════════════════════════════════════════════════
// BUILDINGS — 3D Building Rendering for Walk View
// ════════════════════════════════════════════════════════════════════
// Renders buildings on tiles using procedural box/roof/extras geometry.
// Supports standard building types and AI-generated/imported buildings.

import * as THREE from 'three';
import { hash2 } from '../utils/noise.js';

const METERS_PER_UNIT = 3.3;

// ─── PERFORMANCE CACHES ───────────────────────────────────────────────
// Material cache to avoid creating duplicate materials
const materialCache = new Map();

// Geometry cache for common box sizes (rounded to 0.5m)
const geometryCache = new Map();

// Get or create a cached material
function getCachedMaterial(colorHex, options = {}) {
  const key = `${colorHex}-${options.polygonOffset ? 'po' : 'np'}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshBasicMaterial({
      color: colorHex,
      polygonOffset: options.polygonOffset ?? true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    }));
  }
  return materialCache.get(key);
}

// Get or create cached box geometry (rounded dimensions for better reuse)
function getCachedBoxGeometry(w, h, d) {
  // Round to nearest 0.5 for better cache hits
  const rw = Math.round(w * 2) / 2;
  const rh = Math.round(h * 2) / 2;
  const rd = Math.round(d * 2) / 2;
  const key = `${rw}-${rh}-${rd}`;
  if (!geometryCache.has(key)) {
    geometryCache.set(key, new THREE.BoxGeometry(rw, rh, rd));
  }
  return geometryCache.get(key);
}

// Clear caches (call when changing moods/scenes)
export function clearBuildingCaches() {
  materialCache.forEach(m => m.dispose());
  materialCache.clear();
  geometryCache.forEach(g => g.dispose());
  geometryCache.clear();
}

// ─── BUILDING GEOMETRY DESCRIPTIONS ────────────────────────────────
// Returns { boxes, roofs, extras } describing the building geometry.
export function buildingGeometry(kind, params = {}) {
  const stories = params.stories || 4;
  const desc = { boxes: [], roofs: [], extras: [] };

  switch (kind) {
    case 'skyscraper': {
      const towers = 1 + Math.floor((params.hashA || 0.4) * 2);
      for (let i = 0; i < towers; i++) {
        const span = 4 + (params.hashB || 0.5) * 1.5;
        const offU = (i - (towers-1)/2) * 4;
        const offV = ((params.hashC || 0.5) - 0.5) * 2.5;
        const wH = 22 + stories * 1.6;
        desc.boxes.push({
          u0: offU - span, v0: offV - span,
          u1: offU + span, v1: offV + span,
          w: wH, role: 'wall'
        });
        desc.boxes.push({
          u0: offU - span*0.4, v0: offV - span*0.4,
          u1: offU + span*0.4, v1: offV + span*0.4,
          w: wH + 3, w0: wH, role: 'rooftop_unit'
        });
      }
      break;
    }
    case 'midrise': {
      const span = 5;
      const wH = 10 + stories * 3;
      desc.boxes.push({ u0: -span, v0: -span*0.7, u1: span, v1: span*0.7, w: wH, role: 'wall' });
      desc.boxes.push({ u0: -span-0.3, v0: -span*0.7-0.3, u1: span+0.3, v1: span*0.7+0.3, w: wH+0.8, w0: wH-0.5, role: 'cornice' });
      break;
    }
    case 'house': {
      const wallH = 5;
      const ridgeH = wallH + 3;
      desc.boxes.push({ u0: -3.5, v0: -2.5, u1: 3.5, v1: 2.5, w: wallH, role: 'wall' });
      desc.roofs.push({ u0: -3.5, v0: -2.5, u1: 3.5, v1: 2.5, baseW: wallH, ridgeV: 0, ridgeW: ridgeH });
      desc.boxes.push({ u0: 2.3, v0: -0.4, u1: 3.3, v1: 0.4, w: ridgeH + 1.5, w0: ridgeH, role: 'chimney' });
      break;
    }
    case 'house_small': {
      const wallH = 3;
      const ridgeH = wallH + 2;
      desc.boxes.push({ u0: -2.2, v0: -1.7, u1: 2.2, v1: 1.7, w: wallH, role: 'wall' });
      desc.roofs.push({ u0: -2.2, v0: -1.7, u1: 2.2, v1: 1.7, baseW: wallH, ridgeV: 0, ridgeW: ridgeH });
      break;
    }
    case 'school': {
      const wallH = 7;
      desc.boxes.push({ u0: -7, v0: -2.8, u1: 7, v1: 2.8, w: wallH, role: 'wall' });
      desc.boxes.push({ u0: -3, v0: 2.6, u1: 3, v1: 2.8, w: wallH + 2.5, w0: wallH, role: 'pediment' });
      for (let c = 0; c < 4; c++) {
        const uP = -3 + 0.6 + c * (6 - 1.2)/3;
        desc.boxes.push({ u0: uP, v0: 2.7, u1: uP + 0.6, v1: 2.9, w: wallH, role: 'column' });
      }
      break;
    }
    case 'library': {
      const wallH = 10;
      desc.boxes.push({ u0: -5, v0: -3, u1: 5, v1: 3, w: wallH, role: 'wall' });
      desc.boxes.push({ u0: -1.2, v0: -1.2, u1: 1.2, v1: 1.2, w: wallH + 4, w0: wallH, role: 'cupola' });
      desc.boxes.push({ u0: -4, v0: 2.8, u1: 4, v1: 3, w: wallH + 3, w0: wallH, role: 'pediment' });
      for (let c = 0; c < 5; c++) {
        const uP = -4 + 0.5 + c * (8 - 1)/4;
        desc.boxes.push({ u0: uP, v0: 2.9, u1: uP + 0.5, v1: 3.1, w: wallH, role: 'column' });
      }
      break;
    }
    case 'farm': {
      desc.boxes.push({ u0: 3.5, v0: -3, u1: 7.5, v1: 0, w: 4, role: 'barn' });
      desc.roofs.push({ u0: 3.5, v0: -3, u1: 7.5, v1: 0, baseW: 4, ridgeV: -1.5, ridgeW: 6 });
      desc.extras.push({ type: 'cylinder', cu: 2.5, cv: -2, r: 1.2, w0: 0, w1: 7, role: 'silo' });
      break;
    }
    case 'solar': {
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const u0 = -7 + col * 4.5;
          const v0 = -3.5 + row * 2.5;
          desc.extras.push({
            type: 'tilted_panel',
            u0, v0, u1: u0 + 3.5, v1: v0 + 1.2,
            wLow: 0, wHigh: 1.2,
            role: 'panel'
          });
          desc.boxes.push({ u0: u0 + 1.6, v0: v0 + 0.05, u1: u0 + 1.9, v1: v0 + 0.25, w: 1.2, role: 'panel_post' });
        }
      }
      break;
    }
    case 'pier': {
      desc.boxes.push({ u0: -2, v0: -1.2, u1: 9, v1: 1.2, w: 0.5, role: 'deck' });
      for (let i = 0; i < 4; i++) {
        const u = -2 + 1 + i * (11 - 2)/3;
        desc.boxes.push({ u0: u - 0.2, v0: -0.2, u1: u + 0.2, v1: 0.2, w: 0, w0: -3.5, role: 'piling' });
      }
      desc.boxes.push({ u0: 10.5, v0: -1, u1: 13.5, v1: 1, w: 1.2, role: 'boat' });
      break;
    }
    case 'quarry': {
      desc.boxes.push({ u0: 3, v0: -2, u1: 5, v1: 0, w: 2, role: 'machinery' });
      break;
    }
    case 'wasp_nest': {
      desc.extras.push({ type: 'wasp_nest', cu: 0, cv: 0, w0: 4, w1: 8, role: 'nest' });
      break;
    }
    case 'fungal_mat': {
      desc.extras.push({ type: 'mat', u0: -4, v0: -2.5, u1: 4, v1: 2.5, w: 0.3, role: 'fungal' });
      break;
    }
    case 'coral': {
      desc.extras.push({ type: 'coral', cu: 0, cv: 0, w: 2, role: 'coral' });
      break;
    }
    case 'ruin': {
      // Ruined building — partial walls
      desc.boxes.push({ u0: -3, v0: -2, u1: -1.5, v1: 2, w: 2.5, role: 'wall' });
      desc.boxes.push({ u0: 2, v0: -2, u1: 3, v1: 1, w: 1.8, role: 'wall' });
      break;
    }
    default:
      break;
  }
  return desc;
}

// ─── AI GEOMETRY CONVERTER ─────────────────────────────────────────
// Converts AI-generated geometry to the standard desc format.
export function aiGeoToDescUnits(aiGeo) {
  const FT_PER_UNIT = METERS_PER_UNIT / 0.3048;
  const f2u = (ft) => ft / FT_PER_UNIT;
  const desc = { boxes: [], roofs: [], extras: [], isAi: true };

  for (const b of (aiGeo.boxes || [])) {
    desc.boxes.push({
      u0: f2u(b.u0), v0: f2u(b.v0),
      u1: f2u(b.u1), v1: f2u(b.v1),
      w: f2u(b.w),
      w0: b.w0 ? f2u(b.w0) : 0,
      role: b.role,
      material: b.material
    });
  }

  for (const r of (aiGeo.roofs || [])) {
    if (r.type === 'pitched' || r.type === 'gabled' || r.type === 'hipped') {
      desc.roofs.push({
        u0: f2u(r.u0), v0: f2u(r.v0),
        u1: f2u(r.u1), v1: f2u(r.v1),
        baseW: f2u(r.eaveW),
        ridgeV: 0,
        ridgeW: f2u(r.ridgeW),
        material: r.material
      });
    } else if (r.type === 'shed') {
      desc.roofs.push({
        u0: f2u(r.u0), v0: f2u(r.v0),
        u1: f2u(r.u1), v1: f2u(r.v1),
        baseW: f2u(r.eaveW),
        ridgeV: f2u((r.v0 + r.v1) / 2 - (r.v1 - r.v0) / 4),
        ridgeW: f2u(r.ridgeW),
        material: r.material
      });
    } else if (r.type === 'flat') {
      desc.boxes.push({
        u0: f2u(r.u0 - 0.2), v0: f2u(r.v0 - 0.2),
        u1: f2u(r.u1 + 0.2), v1: f2u(r.v1 + 0.2),
        w: f2u(r.ridgeW),
        w0: f2u(r.eaveW),
        role: 'cornice',
        material: r.material
      });
    } else if (r.type === 'vault') {
      desc.boxes.push({
        u0: f2u(r.u0), v0: f2u(r.v0),
        u1: f2u(r.u1), v1: f2u(r.v1),
        w: f2u(r.crownW),
        w0: f2u(r.eaveW),
        role: 'rooftop_unit',
        material: r.material
      });
    }
  }

  return desc;
}

// ─── BUILD MESHES FROM DESCRIPTION ─────────────────────────────────
// Creates Three.js meshes for a building description.
export function buildBuildingMeshes(group, desc, kind, mood, figureGround) {
  if (!mood) mood = { lightTint: 0xFFFFFF, lightBrightness: 1.0 };

  const tintR = ((mood.lightTint >> 16) & 0xff) / 255;
  const tintG = ((mood.lightTint >> 8) & 0xff) / 255;
  const tintB = (mood.lightTint & 0xff) / 255;
  const lightB = mood.lightBrightness;
  const M = METERS_PER_UNIT;

  const wallColor = figureGround ? 0xF0EEE8 : 0xECECE8;
  const wallShadow = figureGround ? 0xCFCDC6 : 0xC2C5CA;
  const roofColor = figureGround ? 0xCFCDC6 : 0xC2BEB2;
  const detailColor = figureGround ? 0x4A4A48 : 0x3A3A38;
  const accentColor = figureGround ? 0x6A6862 : 0xE84B7A;

  const colorByRole = (role) => {
    switch (role) {
      case 'wall': return wallColor;
      case 'rooftop_unit':
      case 'chimney':
      case 'machinery':
      case 'piling':
      case 'boat':
      case 'panel_post': return detailColor;
      case 'cornice':
      case 'pediment':
      case 'cupola': return wallColor;
      case 'column': return detailColor;
      case 'deck': return roofColor;
      case 'barn': return figureGround ? 0x9C988E : 0xA85535;
      case 'panel': return figureGround ? 0x55524A : 0x2A4A8A;
      case 'fungal': return figureGround ? 0x88857B : 0xC97AB5;
      case 'coral': return accentColor;
      case 'silo': return wallColor;
      case 'foundation': return figureGround ? 0xA09E97 : 0x7A8694;
      default: return wallColor;
    }
  };

  const colorByMaterial = (material) => {
    if (figureGround) return wallColor;
    if (material === 'timber') return 0xC9A576;
    if (material === 'stone') return 0xA8B3BD;
    if (material === 'brick') return 0xC76A5C;
    return wallColor;
  };

  const buildingEdgeMat = new THREE.LineBasicMaterial({
    color: 0x1A1A18,
    linewidth: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });

  const tintColor = (hex, factor) => {
    const c = new THREE.Color(hex);
    c.r = Math.min(1, c.r * factor * tintR * lightB);
    c.g = Math.min(1, c.g * factor * tintG * lightB);
    c.b = Math.min(1, c.b * factor * tintB * lightB);
    return c.getHex();
  };

  const applyMood = (hex) => tintColor(hex, 1.0);

  // Use cached materials for better performance
  const buildingFaceMats = (hex) => [
    getCachedMaterial(tintColor(hex, 0.80)),
    getCachedMaterial(tintColor(hex, 0.80)),
    getCachedMaterial(tintColor(hex, 1.00)),
    getCachedMaterial(tintColor(hex, 0.55)),
    getCachedMaterial(tintColor(hex, 0.65)),
    getCachedMaterial(tintColor(hex, 0.86))
  ];

  // Boxes - use cached geometry and skip edge outlines for performance
  for (const b of desc.boxes) {
    const w0 = b.w0 != null ? b.w0 : 0;
    const h = (b.w - w0) * M;
    if (h <= 0) continue;

    const sx = (b.u1 - b.u0) * M;
    const sz = (b.v1 - b.v0) * M;
    const cx = ((b.u0 + b.u1) / 2) * M;
    const cz = ((b.v0 + b.v1) / 2) * M;
    const cy = (w0 * M) + h / 2;

    // Use cached geometry for common sizes
    const geo = getCachedBoxGeometry(sx, h, sz);
    const baseColor = (desc.isAi && b.material) ? colorByMaterial(b.material) : colorByRole(b.role);
    const mesh = new THREE.Mesh(geo, buildingFaceMats(baseColor));
    mesh.position.set(cx, cy, cz);
    mesh.userData = { role: b.role || 'wall', material: b.material };
    mesh.frustumCulled = true; // Ensure frustum culling is enabled
    group.add(mesh);

    // Only add edge outlines in figure-ground mode (skip in normal view for performance)
    if (figureGround) {
      const edges = new THREE.EdgesGeometry(geo, 1);
      const outline = new THREE.LineSegments(edges, buildingEdgeMat);
      outline.position.set(cx, cy, cz);
      outline.userData = { role: 'edge' };
      group.add(outline);
    }
  }

  // Pitched roofs
  for (const r of desc.roofs) {
    const ridgeY = r.ridgeW * M;
    const baseY = r.baseW * M;
    const u0 = r.u0 * M, u1 = r.u1 * M;
    const v0 = r.v0 * M, v1 = r.v1 * M;
    const ridgeV = r.ridgeV * M;

    const verts = new Float32Array([
      u0, baseY, v0,
      u1, baseY, v0,
      u1, baseY, v1,
      u0, baseY, v1,
      u0, ridgeY, ridgeV,
      u1, ridgeY, ridgeV
    ]);

    const idx = new Uint16Array([
      0, 1, 5, 0, 5, 4,
      3, 4, 5, 3, 5, 2,
      0, 4, 3,
      1, 2, 5
    ]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const roofMatColor = (desc.isAi && r.material) ? colorByMaterial(r.material) : roofColor;
    const mat = new THREE.MeshBasicMaterial({ color: applyMood(roofMatColor), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { role: 'roof' };
    group.add(mesh);

    const edges = new THREE.EdgesGeometry(geo, 1);
    const outline = new THREE.LineSegments(edges, buildingEdgeMat);
    outline.userData = { role: 'edge' };
    group.add(outline);
  }

  // Extras
  for (const e of desc.extras) {
    if (e.type === 'cylinder') {
      const radius = e.r * M;
      const h = (e.w1 - e.w0) * M;
      const geo = new THREE.CylinderGeometry(radius, radius, h, 16);
      const mat = new THREE.MeshBasicMaterial({ color: applyMood(colorByRole(e.role)) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(e.cu * M, (e.w0 * M) + h / 2, e.cv * M);
      mesh.userData = { role: e.role };
      group.add(mesh);
    } else if (e.type === 'tilted_panel') {
      const u0 = e.u0 * M, u1 = e.u1 * M;
      const v0 = e.v0 * M, v1 = e.v1 * M;
      const wLow = e.wLow * M;
      const wHigh = e.wHigh * M;

      const verts = new Float32Array([
        u0, wHigh, v0,
        u1, wHigh, v0,
        u1, wLow, v1,
        u0, wLow, v1
      ]);
      const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();

      const mat = new THREE.MeshBasicMaterial({ color: applyMood(colorByRole(e.role)), side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { role: e.role };
      group.add(mesh);
    } else if (e.type === 'wasp_nest') {
      const geo = new THREE.SphereGeometry(2 * M, 8, 6);
      geo.scale(0.6, 1, 0.6);
      const mat = new THREE.MeshBasicMaterial({ color: applyMood(0xC9941A) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(e.cu * M, ((e.w0 + e.w1) / 2) * M, e.cv * M);
      mesh.userData = { role: 'wasp_nest' };
      group.add(mesh);
    } else if (e.type === 'mat') {
      const sx = (e.u1 - e.u0) * M;
      const sz = (e.v1 - e.v0) * M;
      const geo = new THREE.BoxGeometry(sx, e.w * M, sz);
      const mat = new THREE.MeshBasicMaterial({ color: applyMood(colorByRole(e.role)) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(((e.u0 + e.u1) / 2) * M, (e.w * M) / 2, ((e.v0 + e.v1) / 2) * M);
      mesh.userData = { role: e.role };
      group.add(mesh);
    } else if (e.type === 'coral') {
      const geo = new THREE.SphereGeometry(2 * M, 8, 6);
      const mat = new THREE.MeshBasicMaterial({ color: applyMood(colorByRole(e.role)) });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(e.cu * M, e.w * M, e.cv * M);
      mesh.userData = { role: e.role };
      group.add(mesh);
    }
  }
}

// ─── CREATE BUILDINGS ──────────────────────────────────────────────
// Main function to iterate tiles and create all building meshes.
export function createBuildings(state, root, tileSize, elevToWalkY, mood, figureGround) {
  const buildingsRoot = new THREE.Group();
  buildingsRoot.name = 'buildings';
  const buildingGroups = {};

  // Conversion factor: FormGenerator uses feet, walk uses meters
  // tileSize is METERS_PER_TILE (40m), tiles are 130ft
  // So 1 foot = 40/130 meters = 0.3077m
  const FEET_TO_METERS = tileSize / 130;

  for (const t of state.island.tiles) {
    if (t.biome === 'water') continue;

    const built = t.populated || (t.built && t.buildKind ? { kind: t.buildKind } : null);
    if (!built) continue;

    const x = t.gx * tileSize;
    const z = t.gy * tileSize;
    const elev = elevToWalkY(t.elev);

    // Get or create sublayer group
    if (!buildingGroups[built.kind]) {
      const g = new THREE.Group();
      g.name = 'buildings/' + built.kind;
      buildingGroups[built.kind] = g;
      buildingsRoot.add(g);
    }

    // PRIORITY 1: Use stored THREE.js meshes directly (from FormGenerator preview)
    if (built.kind === 'ai' && built.walkMeshes && built.walkMeshes.length > 0) {
      for (const meshData of built.walkMeshes) {
        if (meshData.group) {
          // Clone the group to avoid issues with shared references
          const clonedGroup = meshData.group.clone(true);
          clonedGroup.name = 'ai-preview@' + t.id;
          clonedGroup.userData = { kind: 'ai', tile: t.id, role: 'building' };

          // Scale from feet to walk units (meters)
          clonedGroup.scale.set(FEET_TO_METERS, FEET_TO_METERS, FEET_TO_METERS);

          // Apply offset (convert from feet to meters)
          const offsetX = (meshData.offset?.x || 0) * FEET_TO_METERS;
          const offsetZ = (meshData.offset?.z || 0) * FEET_TO_METERS;

          // Position at tile center + offset
          clonedGroup.position.set(x + offsetX, elev, z + offsetZ);

          // Apply rotation
          if (meshData.rotation) {
            clonedGroup.rotation.y = meshData.rotation;
          }

          buildingGroups[built.kind].add(clonedGroup);
        }
      }
      continue; // Skip the old geometry path
    }

    // FALLBACK: Use old geometry generation for legacy buildings
    let desc;
    if (built.kind === 'ai' && built.geo) {
      desc = aiGeoToDescUnits(built.geo);
      // Construction progress — clip walls
      const progress = (built.progressFraction != null) ? built.progressFraction : 1;
      if (progress < 1) {
        for (const b of desc.boxes) {
          if (b.role === 'wall') {
            const w0 = b.w0 || 0;
            b.w = w0 + (b.w - w0) * progress;
          }
        }
        desc.roofs = [];
      }
    } else if (built.kind === 'ai' && built.polygon) {
      // Fallback for AI buildings with polygon but no meshes
      desc = polygonToTowerDesc(built);
    } else if (built.kind === 'import' && built.importedGeometry) {
      // Skip imported geometry for now
      continue;
    } else {
      desc = buildingGeometry(built.kind, {
        stories: built.stories,
        hashA: hash2(t.gx, t.gy, 41),
        hashB: hash2(t.gx, t.gy, 51),
        hashC: hash2(t.gx, t.gy, 52)
      });
    }

    const buildingGroup = new THREE.Group();
    buildingGroup.name = built.kind + '@' + t.id;
    buildingGroup.userData = { kind: built.kind, tile: t.id, role: 'building' };

    buildBuildingMeshes(buildingGroup, desc, built.kind, mood, figureGround);
    buildingGroup.position.set(x, elev, z);

    buildingGroups[built.kind].add(buildingGroup);
  }

  root.add(buildingsRoot);
}

// Convert preview buildings from FormGenerator to walk geometry desc
function previewBuildingsToDesc(built) {
  const desc = { boxes: [], roofs: [], extras: [], isAi: true };
  const FT_PER_UNIT = METERS_PER_UNIT / 0.3048;
  const f2u = (ft) => ft / FT_PER_UNIT;

  for (const pb of (built.previewBuildings || [])) {
    const stats = pb.stats || {};
    const offset = pb.offset || { x: 0, z: 0 };
    const rotation = pb.rotation || 0;

    // Get dimensions from stats
    const width = stats.polygon?.bounds?.width || 40;
    const depth = stats.polygon?.bounds?.height || 40;
    const height = stats.height || 60;
    const floors = stats.floors || 4;

    // Convert to walk units (centered on tile)
    const hw = f2u(width / 2);
    const hd = f2u(depth / 2);
    const h = f2u(height);

    // Create main building box
    desc.boxes.push({
      u0: f2u(offset.x) - hw,
      v0: f2u(offset.z) - hd,
      u1: f2u(offset.x) + hw,
      v1: f2u(offset.z) + hd,
      w: h,
      w0: 0,
      role: 'wall',
      material: stats.typology || 'concrete'
    });

    // Add rooftop detail
    const roofH = f2u(4);
    desc.boxes.push({
      u0: f2u(offset.x) - hw * 0.6,
      v0: f2u(offset.z) - hd * 0.6,
      u1: f2u(offset.x) + hw * 0.6,
      v1: f2u(offset.z) + hd * 0.6,
      w: h + roofH,
      w0: h,
      role: 'rooftop_unit',
      material: 'concrete'
    });
  }

  return desc;
}

// Convert polygon-based AI building to simple tower geometry
function polygonToTowerDesc(built) {
  const desc = { boxes: [], roofs: [], extras: [], isAi: true };
  const FT_PER_UNIT = METERS_PER_UNIT / 0.3048;
  const f2u = (ft) => ft / FT_PER_UNIT;

  const polygon = built.polygon;
  const width = polygon?.bounds?.width || 40;
  const depth = polygon?.bounds?.height || 40;
  const height = built.height || (built.floors || 4) * 12;

  const hw = f2u(width / 2);
  const hd = f2u(depth / 2);
  const h = f2u(height);

  // Main building
  desc.boxes.push({
    u0: -hw, v0: -hd,
    u1: hw, v1: hd,
    w: h,
    w0: 0,
    role: 'wall',
    material: built.spec?.primary_material || 'concrete'
  });

  // Rooftop
  desc.boxes.push({
    u0: -hw * 0.5, v0: -hd * 0.5,
    u1: hw * 0.5, v1: hd * 0.5,
    w: h + f2u(3),
    w0: h,
    role: 'rooftop_unit',
    material: 'concrete'
  });

  return desc;
}
