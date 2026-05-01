// ════════════════════════════════════════════════════════════════════
// RHINO EXPORT — .3dm File Generation
// ════════════════════════════════════════════════════════════════════
// Exports the island as a Rhino .3dm file using rhino3dm.js.
// Converts Three.js scene to Rhino meshes organized by layer.

import * as THREE from 'three';
import { WALK, buildThreeScene } from '../walk/index.js';

// Lazy-loaded rhino3dm module
let RHINO_MODULE = null;

// Load rhino3dm.js from CDN
async function ensureRhino3dm() {
  if (RHINO_MODULE) return RHINO_MODULE;

  // Load the script dynamically
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.4.0/rhino3dm.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load rhino3dm'));
    document.head.appendChild(s);
  });

  // Initialize WASM module
  if (typeof rhino3dm === 'function') {
    RHINO_MODULE = await rhino3dm();
    console.log('rhino3dm loaded:', RHINO_MODULE.version);
  } else {
    throw new Error('rhino3dm not available after script load');
  }

  return RHINO_MODULE;
}

// Export Three.js scene to .3dm
export async function exportToRhino(state) {
  const btn = document.getElementById('export-3dm-btn');
  if (btn) btn.classList.add('busy');

  try {
    const rhino = await ensureRhino3dm();

    // Get or build the Three.js scene
    let scene;
    if (WALK.scene && WALK.group) {
      scene = WALK.group;
    } else {
      // Build scene from state
      const mood = WALK.mood || {
        lightTint: 0xFFFFFF,
        lightBrightness: 1.0,
        fogColor: 0xE8E0D0,
        oceanColor: 0x4A7090
      };
      scene = buildThreeScene(state, mood);
    }

    if (!scene) throw new Error('Scene build failed');

    const file = new rhino.File3dm();

    // Add layers
    const layerIds = {};
    const addLayer = (name, colorRGB) => {
      const lyr = new rhino.Layer();
      lyr.name = name;
      lyr.color = { r: colorRGB[0], g: colorRGB[1], b: colorRGB[2], a: 255 };
      const idx = file.layers().add(lyr);
      layerIds[name] = idx;
      lyr.delete();
      return idx;
    };

    addLayer('terrain', [180, 175, 160]);
    addLayer('water', [70, 130, 170]);
    addLayer('buildings', [220, 220, 218]);
    addLayer('nature', [140, 180, 140]);

    // Sublayer per building kind we encounter
    const ensureKindLayer = (kind) => {
      const name = 'buildings/' + kind;
      if (layerIds[name] != null) return layerIds[name];
      return addLayer(name, [200, 200, 198]);
    };

    let exported = 0;

    // Export a Three.js mesh to Rhino
    const exportMesh = (mesh, layerName) => {
      mesh.updateMatrixWorld(true);
      const geo = mesh.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) return;

      const pos = geo.attributes.position;
      const idx = geo.index;
      const rmesh = new rhino.Mesh();
      const v = new THREE.Vector3();

      // Add vertices (transform to world coords)
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        v.applyMatrix4(mesh.matrixWorld);
        // Convert Three.js Y-up to Rhino Z-up: (x, y, z) → (x, -z, y)
        rmesh.vertices().add(v.x, -v.z, v.y);
      }

      // Add faces
      if (idx) {
        for (let i = 0; i < idx.count; i += 3) {
          rmesh.faces().addTriFace(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
        }
      } else {
        for (let i = 0; i < pos.count; i += 3) {
          rmesh.faces().addTriFace(i, i + 1, i + 2);
        }
      }

      rmesh.computeVertexNormals();

      const attrs = new rhino.ObjectAttributes();
      attrs.layerIndex = layerIds[layerName] != null ? layerIds[layerName] : layerIds['buildings'];
      file.objects().add(rmesh, attrs);

      attrs.delete();
      rmesh.delete();
      exported++;
    };

    // Walk the scene and export meshes
    scene.traverse((obj) => {
      if (!obj.isMesh) return;

      const role = obj.userData?.role;
      const kind = obj.userData?.kind;
      const parentName = obj.parent?.name || '';

      // Determine layer based on role/kind/parent
      if (role === 'water' || role === 'pond' || role === 'world_ocean' || parentName === 'water') {
        exportMesh(obj, 'water');
      } else if (role === 'terrain' || kind === 'terrain' || parentName === 'terrain') {
        exportMesh(obj, 'terrain');
      } else if (role === 'tree' || role === 'rock' || role === 'grass' || role === 'palm') {
        exportMesh(obj, 'nature');
      } else if (role === 'building') {
        // Find building kind sublayer
        let p = obj.parent;
        while (p && !(p.name && p.name.startsWith('buildings/'))) p = p.parent;
        if (p?.name) {
          const k = p.name.replace('buildings/', '');
          ensureKindLayer(k);
          exportMesh(obj, p.name);
        } else {
          exportMesh(obj, 'buildings');
        }
      } else {
        // Default to buildings
        exportMesh(obj, 'buildings');
      }
    });

    // Generate file buffer
    const buf = file.toByteArray();
    file.delete();

    // Download
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'offcut-world-' + new Date().toISOString().slice(0, 10) + '.3dm';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('Exported', exported, 'meshes to .3dm');
    return { success: true, meshCount: exported };

  } catch (err) {
    console.error('Export failed:', err);
    throw err;
  } finally {
    if (btn) btn.classList.remove('busy');
  }
}
