// ════════════════════════════════════════════════════════════════════
// ISO BUILDING RENDERER — Detailed isometric buildings
// ════════════════════════════════════════════════════════════════════
// Renders AI-generated buildings as detailed isometric SVG elements
// on the map view, showing material colors, construction progress,
// and architectural character.

import { gridToScreen, TILE_W, TILE_H, ELEV_UNIT } from '../utils/projection.js';

// Material colors for ISO rendering (expanded palette)
const MATERIAL_COLORS = {
  timber: { top: '#E8D090', front: '#C9A868', side: '#A88848' },
  stone: { top: '#C8C4BE', front: '#9A9590', side: '#7A7570' },
  brick: { top: '#D88878', front: '#B8685A', side: '#984838' },
  concrete: { top: '#D0D0D0', front: '#B0B0B0', side: '#909090' },
  glass: { top: '#B8D8E8', front: '#8AB8D0', side: '#6A98B0' },
  steel: { top: '#A8A8B8', front: '#808898', side: '#606878' },
  copper: { top: '#C89870', front: '#B07850', side: '#906030' },
  slate: { top: '#707080', front: '#505060', side: '#404050' }
};

const DEFAULT_COLORS = { top: '#E8E4DE', front: '#C8C4BE', side: '#A8A4A0' };

// Isometric projection helpers (centered at tile)
function isoProject(x, y, z, scale = 1) {
  // x = left-right, y = up, z = front-back
  const isoX = (x - z) * 0.866 * scale;
  const isoY = -y * scale + (x + z) * 0.5 * scale;
  return { x: isoX, y: isoY };
}

// Render a single building on a tile
export function renderIsoBuilding(state, tile, mode) {
  // Handle both populated tiles and legacy buildKind tiles
  let populated = tile.populated;

  // Create synthetic populated object for legacy tiles with buildKind
  if (!populated && tile.built && tile.buildKind) {
    populated = {
      kind: tile.buildKind,
      spec: {
        floors: tile.stories || 2,
        floor_height_ft: 10,
        footprint_w: 4,
        footprint_d: 4
      }
    };
  }

  if (!populated) {
    return '';
  }

  // Check what data we have
  const hasIsoImage = populated.isoImage && populated.isoImage.dataURL;
  const hasGeo = !!populated.geo;
  const hasSpec = !!populated.spec;
  const hasPolygon = !!populated.polygon;

  // Get screen position first for debug marker
  const pos = gridToScreen(tile.gx, tile.gy, mode);
  const isPlan = mode === 'plan' || mode === 'figureplan';
  const elev = isPlan ? 0 : tile.elev * ELEV_UNIT;
  const cx = pos.sx;
  const cy = pos.sy - elev;

  if (!hasGeo && !hasSpec && !hasPolygon && !hasIsoImage) {
    // Fallback: simple visible marker for buildings without data
    // This helps debug if tiles are being processed but have no render data
    return `<circle cx="${cx}" cy="${cy}" r="4" fill="#FF0000" opacity="0.5"/>`;
  }

  // PRIORITY: If we have a rendered ISO image, use that instead of drawing shapes
  if (populated.isoImage && populated.isoImage.dataURL) {
    const imgData = populated.isoImage;

    // Building dimensions
    const buildingHeight = populated.height || 60; // Height in feet
    const FEET_PER_TILE = 130;
    const buildingCount = populated.buildingCount || 1;

    // Scale: convert feet to screen pixels
    const pixelsPerFoot = TILE_W / FEET_PER_TILE;
    const heightScale = pixelsPerFoot * 1.5;

    // Base display size on building height
    let displayHeight = buildingHeight * heightScale;

    // For tiles with multiple small buildings, use a larger minimum display size
    // The combined ISO image captures buildings spread across the tile
    const minDisplayHeight = buildingCount > 1 ? TILE_W * 1.2 : TILE_W * 0.8;
    displayHeight = Math.max(displayHeight, minDisplayHeight);

    // Also apply a reasonable minimum for any building
    displayHeight = Math.max(displayHeight, 20);

    const displayWidth = displayHeight * (imgData.width / imgData.height);

    // Position: center on tile, bottom at ground level
    // Add tile height offset to align with isometric tile center
    const imgX = cx - displayWidth / 2;
    const imgY = cy - displayHeight + TILE_H;

    return `<image
      href="${imgData.dataURL}"
      x="${imgX}"
      y="${imgY}"
      width="${displayWidth}"
      height="${displayHeight}"
      preserveAspectRatio="xMidYMax meet"
    />`;
  }

  // Get geometry - support new polygon-based system
  const geo = populated.geo;
  const spec = populated.spec;
  const polygon = populated.polygon;
  const genes = populated.genes;

  if (!geo && !spec && !polygon) return '';

  // Dimensions in feet - support polygon bounds
  let wFt, dFt, hFt;
  if (polygon?.bounds) {
    wFt = polygon.bounds.width || 40;
    dFt = polygon.bounds.height || 40;
    hFt = (genes?.floors?.preferred || spec?.floors || 3) * (genes?.floorHeight || spec?.floor_height_ft || 10);
  } else {
    wFt = geo?.dimensions?.w || (spec?.footprint_w || 4) * 8;
    dFt = geo?.dimensions?.d || (spec?.footprint_d || 4) * 8;
    hFt = geo?.dimensions?.h || (spec?.floors || 1) * (spec?.floor_height_ft || 10);
  }

  // Construction progress
  const progress = populated.progressFraction ?? 1;
  const visibleH = hFt * progress;

  // Scale: 1 foot = 0.5 SVG units for buildings (makes them visible on tiles)
  const scale = 0.45;

  // Primary material colors - support genes materialPalette
  const primaryMat = genes?.materialPalette?.primary || geo?.primaryMaterial || spec?.primary_material || 'timber';
  const colors = MATERIAL_COLORS[primaryMat] || DEFAULT_COLORS;

  // Get roof type from genes or spec
  const roofType = genes?.roofForm || spec?.roof_type || 'flat';

  // Scaled dimensions
  const w = wFt * scale;
  const d = dFt * scale;
  const h = visibleH * scale;

  // Build SVG for main box
  let svg = '';

  // Ground shadow
  const shadowPts = [
    isoProject(-w/2, 0, -d/2, 1),
    isoProject(w/2, 0, -d/2, 1),
    isoProject(w/2, 0, d/2, 1),
    isoProject(-w/2, 0, d/2, 1)
  ];
  svg += `<polygon points="${shadowPts.map(p => `${cx + p.x},${cy + p.y + 3}`).join(' ')}"
           fill="rgba(0,0,0,0.15)" />`;

  if (h > 0) {
    // Top face
    const topPts = [
      isoProject(-w/2, h, -d/2, 1),
      isoProject(w/2, h, -d/2, 1),
      isoProject(w/2, h, d/2, 1),
      isoProject(-w/2, h, d/2, 1)
    ];
    svg += `<polygon points="${topPts.map(p => `${cx + p.x},${cy + p.y}`).join(' ')}"
             fill="${colors.top}" stroke="#1A1A18" stroke-width="0.5"/>`;

    // Front face (left in iso)
    const frontPts = [
      isoProject(-w/2, 0, d/2, 1),
      isoProject(w/2, 0, d/2, 1),
      isoProject(w/2, h, d/2, 1),
      isoProject(-w/2, h, d/2, 1)
    ];
    svg += `<polygon points="${frontPts.map(p => `${cx + p.x},${cy + p.y}`).join(' ')}"
             fill="${colors.front}" stroke="#1A1A18" stroke-width="0.5"/>`;

    // Side face (right in iso)
    const sidePts = [
      isoProject(w/2, 0, -d/2, 1),
      isoProject(w/2, 0, d/2, 1),
      isoProject(w/2, h, d/2, 1),
      isoProject(w/2, h, -d/2, 1)
    ];
    svg += `<polygon points="${sidePts.map(p => `${cx + p.x},${cy + p.y}`).join(' ')}"
             fill="${colors.side}" stroke="#1A1A18" stroke-width="0.5"/>`;

    // Add roof if construction is complete
    if (progress >= 1) {
      const roofExtra = (roofType === 'pitched' || roofType === 'gabled')
        ? Math.max(3, hFt * 0.2) * scale
        : (roofType === 'shed' ? hFt * 0.12 * scale : 0);

      if (roofType === 'pitched' || roofType === 'gabled') {
        // Ridge runs along the depth (z) axis
        const ridgeH = h + roofExtra;
        const roofPts1 = [
          isoProject(-w/2, h, -d/2, 1),
          isoProject(0, ridgeH, -d/2, 1),
          isoProject(0, ridgeH, d/2, 1),
          isoProject(-w/2, h, d/2, 1)
        ];
        svg += `<polygon points="${roofPts1.map(p => `${cx + p.x},${cy + p.y}`).join(' ')}"
                 fill="${colors.top}" stroke="#1A1A18" stroke-width="0.5"/>`;

        const roofPts2 = [
          isoProject(w/2, h, -d/2, 1),
          isoProject(0, ridgeH, -d/2, 1),
          isoProject(0, ridgeH, d/2, 1),
          isoProject(w/2, h, d/2, 1)
        ];
        svg += `<polygon points="${roofPts2.map(p => `${cx + p.x},${cy + p.y}`).join(' ')}"
                 fill="${colors.side}" stroke="#1A1A18" stroke-width="0.5"/>`;
      } else if (roofType === 'shed') {
        const ridgeH = h + roofExtra;
        const roofPts = [
          isoProject(-w/2, ridgeH, -d/2, 1),
          isoProject(w/2, ridgeH, -d/2, 1),
          isoProject(w/2, h, d/2, 1),
          isoProject(-w/2, h, d/2, 1)
        ];
        svg += `<polygon points="${roofPts.map(p => `${cx + p.x},${cy + p.y}`).join(' ')}"
                 fill="${colors.top}" stroke="#1A1A18" stroke-width="0.5"/>`;
      }
    }

    // Add windows/details based on floors
    const floors = spec?.floors || 1;
    const floorH = (visibleH / floors) * scale;
    for (let f = 0; f < Math.min(floors, Math.floor(progress * floors) + 1); f++) {
      const windowY = (f + 0.5) * floorH;
      if (windowY < h) {
        // Front windows
        for (let wx = 0; wx < Math.min(3, Math.floor(wFt / 12)); wx++) {
          const winX = (-w/2 + w * 0.2) + wx * (w * 0.3);
          const winPt = isoProject(winX, windowY, d/2 + 0.1, 1);
          svg += `<rect x="${cx + winPt.x - 1.5}" y="${cy + winPt.y - 2}"
                   width="3" height="4" fill="#2A3A4A" stroke="#1A1A18" stroke-width="0.3"/>`;
        }
        // Side windows
        for (let wz = 0; wz < Math.min(2, Math.floor(dFt / 16)); wz++) {
          const winZ = (-d/2 + d * 0.3) + wz * (d * 0.4);
          const winPt = isoProject(w/2 + 0.1, windowY, winZ, 1);
          svg += `<rect x="${cx + winPt.x - 1}" y="${cy + winPt.y - 2}"
                   width="2" height="4" fill="#2A3A4A" stroke="#1A1A18" stroke-width="0.3"/>`;
        }
      }
    }

    // Door on front face
    if (progress >= 0.3) {
      const doorPt = isoProject(0, 0, d/2 + 0.1, 1);
      svg += `<rect x="${cx + doorPt.x - 2}" y="${cy + doorPt.y - 6}"
               width="4" height="6" fill="#3A2A20" stroke="#1A1A18" stroke-width="0.3"/>`;
    }
  }

  // Construction scaffolding if in progress
  if (progress < 1 && progress > 0) {
    const scaffoldColor = '#A89070';
    // Simple scaffold lines
    const sH = h * 1.1;
    svg += `<line x1="${cx - w/2 - 3}" y1="${cy}" x2="${cx - w/2 - 3}" y2="${cy - sH}"
             stroke="${scaffoldColor}" stroke-width="1"/>`;
    svg += `<line x1="${cx + w/2 + 3}" y1="${cy}" x2="${cx + w/2 + 3}" y2="${cy - sH}"
             stroke="${scaffoldColor}" stroke-width="1"/>`;
    svg += `<line x1="${cx - w/2 - 5}" y1="${cy - sH}" x2="${cx + w/2 + 5}" y2="${cy - sH}"
             stroke="${scaffoldColor}" stroke-width="1"/>`;
  }

  return svg;
}

// Render all buildings on the map
export function renderAllIsoBuildings(state, mode) {
  const buildingsGroup = document.getElementById('buildings-layer');
  if (!buildingsGroup) {
    console.warn('[ISO Buildings] buildings-layer element not found');
    return;
  }

  buildingsGroup.innerHTML = '';

  const isPlan = mode === 'plan' || mode === 'figureplan';

  // Sort tiles by draw order (back to front)
  // Match walk view filtering: show buildings if populated OR (built && buildKind)
  const builtTiles = state.island.tiles.filter(t => {
    if (t.biome === 'water') return false;
    return t.populated || (t.built && t.buildKind);
  });

  // Performance: removed console.log

  const sortedTiles = [...builtTiles].sort((a, b) => {
    if (isPlan) return 0;
    return (a.gx + a.gy) - (b.gx + b.gy);
  });

  // Use DocumentFragment for batch DOM operations
  const fragment = document.createDocumentFragment();

  for (const tile of sortedTiles) {
    const buildingSvg = renderIsoBuilding(state, tile, mode);
    if (buildingSvg) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'building');
      g.setAttribute('data-tile', tile.id);
      g.innerHTML = buildingSvg;
      fragment.appendChild(g);
    }
  }

  buildingsGroup.appendChild(fragment);
}
