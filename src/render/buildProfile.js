// ════════════════════════════════════════════════════════════════════
// BUILD PROFILE — Engineering Drawing / Report Card Style
//
// A single-screen building report with material origins, labor stats,
// environmental impact, and social metrics. SSENSE-inspired aesthetic
// with engineering drawing title block layout.
// ════════════════════════════════════════════════════════════════════

import { ISLAND_MATERIALS, DEATH_PLANS } from '../state/materials.js';

// ── COLORS ────────────────────────────────────────────────────────

const COLORS = {
  bg: '#FAFAFA',
  ink: '#1A1A18',
  ink2: '#4A4A48',
  ink3: '#8A8A88',
  accent: '#FFE135',  // Yellow highlight
  line: '#1A1A18',
  lineLight: 'rgba(26, 26, 24, 0.2)',
  gradeA: '#2A7A2A',
  gradeB: '#1A5A9A',
  gradeC: '#8A6A20',
  gradeD: '#9A3A20',
  // Materials
  timber: '#4A7A4A',
  stone: '#6A7A8A',
  brick: '#A87050',
  concrete: '#8A9AA8',
  glass: '#70B8D8',
  clay: '#B8A860',
  sand: '#C8B880'
};

// ── STATE ──────────────────────────────────────────────────────────

let currentState = null;
let currentBuild = null;

// ── CLUSTER NAMING ─────────────────────────────────────────────────

const CLUSTER_SUFFIXES = ['Village', 'Commons', 'Square', 'Yard', 'Quarters', 'Grove', 'Row', 'Court'];

function generateClusterName(builds, author) {
  // Try to derive a thematic name from the buildings
  const names = builds.map(b => b.name || b.stats?.name || '').filter(n => n);

  // Find common words or themes
  const allWords = names.flatMap(n => n.toLowerCase().split(/\s+/));
  const themes = ['pub', 'cafe', 'shop', 'house', 'cabin', 'lodge', 'mill', 'barn', 'hall', 'inn', 'tavern', 'market'];
  const foundTheme = themes.find(t => allWords.some(w => w.includes(t)));

  // Pick a suffix based on building count or author
  const suffix = CLUSTER_SUFFIXES[Math.abs(hashString(author || 'default')) % CLUSTER_SUFFIXES.length];

  if (foundTheme) {
    // Capitalize theme
    return `${foundTheme.charAt(0).toUpperCase() + foundTheme.slice(1)} ${suffix}`;
  }

  // Fall back to author-based name
  if (author && author !== 'unknown') {
    const shortAuthor = author.replace(/_/g, ' ').split(' ')[0];
    return `${shortAuthor.charAt(0).toUpperCase() + shortAuthor.slice(1)} ${suffix}`;
  }

  return `Building ${suffix}`;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// ── MAIN RENDER ────────────────────────────────────────────────────

export function renderBuildProfile(state, build, container) {
  if (!container || !build) return;

  currentState = state;
  currentBuild = build;

  container.innerHTML = '';
  container.className = 'bp-report bp-clean';

  // Handle multi-building tiles
  const builds = build.builds || [build];

  // Look up the actual tile to get the populated data (including isoImage)
  const tile = state?.island?.tiles?.find(t =>
    t.gx === build.primaryTile?.gx && t.gy === build.primaryTile?.gy
  );
  const populated = build.populated || tile?.populated || build.tile?.populated;
  const buildingCount = populated?.buildingCount || builds.length;

  // Aggregate draws from all builds on the tile
  let allDraws = [];
  for (const b of builds) {
    if (b.draws) allDraws = allDraws.concat(b.draws);
  }
  const draws = allDraws.length > 0 ? allDraws : (build.draws || []);

  // Calculate all metrics
  const grade = calculateBuildGrade(build, draws);
  const laborStats = calculateLaborStats(build, builds);
  const materialStats = calculateMaterialStats(build, draws);
  const environmentStats = calculateEnvironmentStats(build, draws, builds);
  const socialStats = calculateSocialStats(build, state, buildingCount);

  // Clean two-column layout: Diagram left, Info right
  const layout = document.createElement('div');
  layout.className = 'bp-clean-layout';

  // ── LEFT: Full-height Diagram ──
  const diagramPanel = document.createElement('div');
  diagramPanel.className = 'bp-clean-diagram';
  diagramPanel.appendChild(createBuildingDiagram(build, draws, environmentStats, laborStats));
  layout.appendChild(diagramPanel);

  // ── RIGHT: Info Panel ──
  const infoPanel = document.createElement('div');
  infoPanel.className = 'bp-clean-info';

  // Grade + Name Header
  const header = document.createElement('div');
  header.className = 'bp-clean-header';

  const gradeColor = grade.letter === 'A' ? COLORS.gradeA :
                     grade.letter === 'B' ? COLORS.gradeB :
                     grade.letter === 'C' ? COLORS.gradeC : COLORS.gradeD;

  // Generate display name - for multi-building tiles, create a cluster name
  const displayName = buildingCount > 1
    ? generateClusterName(builds, build.author)
    : (build.name || 'Untitled');

  const author = build.author || build.stats?.archetypeId || 'unknown';
  const primaryMaterial = materialStats.sources[0]?.material || 'mixed';

  header.innerHTML = `
    <div class="bp-clean-grade" style="border-color: ${gradeColor}">
      <span class="bp-clean-grade-letter" style="color: ${gradeColor}">${grade.letter}</span>
      <span class="bp-clean-grade-score">${grade.score.toFixed(1)}</span>
    </div>
    <div class="bp-clean-title">
      <h1 class="bp-clean-name">${displayName.toUpperCase()}</h1>
      <p class="bp-clean-author">by ${author}</p>
    </div>
  `;
  infoPanel.appendChild(header);

  // Quick Stats Row
  const statsRow = document.createElement('div');
  statsRow.className = 'bp-clean-stats';
  statsRow.innerHTML = `
    <div class="bp-clean-stat">
      <span class="bp-stat-value">${build.stats?.floors || populated?.floors || '—'}</span>
      <span class="bp-stat-label">FLOORS</span>
    </div>
    <div class="bp-clean-stat">
      <span class="bp-stat-value">${formatNumber(build.stats?.grossArea || 0)} SF</span>
      <span class="bp-stat-label">AREA</span>
    </div>
    <div class="bp-clean-stat">
      <span class="bp-stat-value">${primaryMaterial.toUpperCase()}</span>
      <span class="bp-stat-label">TYPOLOGY</span>
    </div>
    <div class="bp-clean-stat">
      <span class="bp-stat-value">${(socialStats.condition * 100).toFixed(0)}%</span>
      <span class="bp-stat-label">CONDITION</span>
    </div>
  `;
  infoPanel.appendChild(statsRow);

  // Constitution (flowing prose)
  const constitution = document.createElement('div');
  constitution.className = 'bp-clean-constitution';
  constitution.innerHTML = `
    <h3 class="bp-constitution-title">RETROACTIVE CONSTITUTION</h3>
    <div class="bp-constitution-prose">
      ${generateCleanConstitution(build, builds, grade, materialStats, laborStats, environmentStats, socialStats, buildingCount)}
    </div>
  `;
  infoPanel.appendChild(constitution);

  layout.appendChild(infoPanel);
  container.appendChild(layout);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'bp-close-btn';
  closeBtn.innerHTML = '×';
  closeBtn.onclick = closeBuildProfile;
  container.appendChild(closeBtn);
}

// Generate clean flowing constitution text (like first screenshot)
function generateCleanConstitution(build, builds, grade, materialStats, laborStats, environmentStats, socialStats, buildingCount) {
  const name = build.name || 'This structure';
  const materials = materialStats.sources.map(s => s.material.toUpperCase()).filter((v, i, a) => a.indexOf(v) === i);
  const waste = environmentStats.waste || 0;
  const carbon = environmentStats.carbon || 0;
  const plan = DEATH_PLANS[build.deathPlan] || DEATH_PLANS['demolish-salvage'];
  const occupants = socialStats?.occupants || 0;
  const totalHours = laborStats?.totalHours || 0;

  // For multi-building tiles, list all buildings
  let buildingListHtml = '';
  if (builds.length > 1) {
    const buildingNames = builds.map(b => b.name || b.stats?.name || 'Unnamed').filter(n => n);
    buildingListHtml = `
      <p class="bp-building-list">This cluster comprises: <strong>${buildingNames.join('</strong>, <strong>')}</strong>.</p>
    `;
  }

  const structureDesc = builds.length > 1 ? 'These structures' : 'This structure';
  const introDesc = builds.length > 1
    ? `This cluster of ${builds.length} buildings stands as evidence of the following extractions and transformations:`
    : `This structure, known as <em>${name}</em>, stands as evidence of the following extractions and transformations:`;

  return `
    <p>${introDesc}</p>

    ${buildingListHtml}

    <p>${structureDesc === 'These structures' ? 'They' : 'It'} consumed <strong>${materials.join(', ')}</strong> drawn from the island's finite reserves.</p>

    <p>${structureDesc === 'These structures' ? 'Their' : 'Its'} construction required <strong>${formatNumber(totalHours)} person-hours</strong> of labor and generated <strong>${formatNumber(waste)} cubic feet</strong> of waste.</p>

    <p>${structureDesc === 'These structures' ? 'Their' : 'Its'} construction released <strong>${carbon.toFixed(2)} tons of CO<sub>2</sub></strong> into the atmosphere, where it will remain for generations.</p>

    <p>${structureDesc === 'These structures' ? 'These structures' : 'This structure'} will house approximately <strong>${occupants} occupants</strong>, representing ${structureDesc === 'These structures' ? 'their' : 'its'} ongoing societal impact on the island's population density and resource consumption.</p>

    <p>Upon ${structureDesc === 'These structures' ? 'their' : 'its'} end, ${structureDesc === 'These structures' ? 'these structures are' : 'this structure is'} designated for <strong>${plan.label.toUpperCase()}</strong>: ${getPlanDescription(plan)}</p>
  `;
}

function getPlanDescription(plan) {
  const descriptions = {
    'demolish-salvage': 'Recoverable materials returned to inventory; ~20% loss as debris.',
    'adaptive-reuse': 'Structure repurposed for new program; minimal material loss.',
    'decay-in-place': 'Natural decomposition; materials return to earth over decades.',
    'disassembly': 'Careful deconstruction; ~90% materials recoverable.'
  };
  return descriptions[plan.id] || 'Materials processed according to island protocols.';
}

// ── TITLE BLOCK ────────────────────────────────────────────────────

function createTitleBlock(build, grade, buildingCount = 1) {
  const block = document.createElement('div');
  block.className = 'bp-title-block';

  const gradeColor = grade.letter === 'A' ? COLORS.gradeA :
                     grade.letter === 'B' ? COLORS.gradeB :
                     grade.letter === 'C' ? COLORS.gradeC : COLORS.gradeD;

  // For multi-building tiles, show count and aggregated name
  const displayName = buildingCount > 1
    ? `${buildingCount} BUILDINGS`
    : (build.name || 'UNTITLED').toUpperCase();

  const typologyText = buildingCount > 1
    ? 'MIXED USE'
    : (build.stats?.typology || 'STRUCTURE').toUpperCase();

  block.innerHTML = `
    <div class="bp-tb-left">
      <div class="bp-tb-cell bp-tb-id">
        <span class="bp-tb-label">${buildingCount > 1 ? 'TILE' : 'BUILD NO.'}</span>
        <span class="bp-tb-value">${buildingCount > 1 ? `(${build.tile?.gx || build.primaryTile?.gx || 0}, ${build.tile?.gy || build.primaryTile?.gy || 0})` : String(build.id || 0).padStart(5, '0')}</span>
      </div>
      <div class="bp-tb-cell bp-tb-date">
        <span class="bp-tb-label">${buildingCount > 1 ? 'BUILDINGS' : 'COMMITTED'}</span>
        <span class="bp-tb-value">${buildingCount > 1 ? buildingCount : `DAY ${build.committedDay || '—'}`}</span>
      </div>
    </div>
    <div class="bp-tb-center">
      <div class="bp-tb-name">${displayName}</div>
      <div class="bp-tb-author">DESIGNED BY: ${(build.author || 'VARIOUS').toUpperCase()}</div>
      <div class="bp-tb-typology">${typologyText}</div>
    </div>
    <div class="bp-tb-right">
      <div class="bp-tb-grade" style="background: ${gradeColor}">
        <span class="bp-tb-grade-letter">${grade.letter}</span>
        <span class="bp-tb-grade-label">GRADE</span>
      </div>
      <div class="bp-tb-score">
        <span class="bp-tb-label">SCORE</span>
        <span class="bp-tb-value">${grade.score.toFixed(1)}/10</span>
      </div>
    </div>
  `;

  return block;
}

// ── BUILDING DIAGRAM — Radial Material Flow ────────────────────────

function createBuildingDiagram(build, draws, environmentStats, laborStats) {
  const wrapper = document.createElement('div');
  wrapper.className = 'bp-diagram-wrapper';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 600 540');
  svg.setAttribute('class', 'bp-diagram-svg');
  // No background - let it blend with page

  // Center position for building (shifted down for better vertical centering)
  const cx = 300, cy = 280;

  // Collect material sources
  const materialSources = analyzeMaterialSources(draws);

  // Calculate radial positions for materials (spread around top only, avoiding sides where CO2/HOURS go)
  const materialPositions = calculateRadialPositions(materialSources.length, cx, cy, 160);

  // Draw connecting lines first (so they're behind everything)
  materialSources.forEach((source, i) => {
    const pos = materialPositions[i];
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cx);
    line.setAttribute('y1', cy);
    line.setAttribute('x2', pos.x);
    line.setAttribute('y2', pos.y);
    line.setAttribute('stroke', '#707880');
    line.setAttribute('stroke-width', '0.5');
    svg.appendChild(line);
  });

  // CO₂ output line (to the lower-left)
  const co2X = 100, co2Y = 400;
  const co2Line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  co2Line.setAttribute('x1', cx - 40);
  co2Line.setAttribute('y1', cy + 80);
  co2Line.setAttribute('x2', co2X + 30);
  co2Line.setAttribute('y2', co2Y - 20);
  co2Line.setAttribute('stroke', '#707880');
  co2Line.setAttribute('stroke-width', '0.5');
  co2Line.setAttribute('stroke-dasharray', '4 2');
  svg.appendChild(co2Line);

  // WASTE output line (to the bottom center)
  const soilX = 300, soilY = 460;
  const soilLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  soilLine.setAttribute('x1', cx);
  soilLine.setAttribute('y1', cy + 80);
  soilLine.setAttribute('x2', soilX);
  soilLine.setAttribute('y2', soilY - 30);
  soilLine.setAttribute('stroke', '#707880');
  soilLine.setAttribute('stroke-width', '0.5');
  soilLine.setAttribute('stroke-dasharray', '4 2');
  svg.appendChild(soilLine);

  // Draw building ISO image in center
  // Look up the actual tile to get the populated data (including isoImage)
  const tile = currentState?.island?.tiles?.find(t =>
    t.gx === build.primaryTile?.gx && t.gy === build.primaryTile?.gy
  );
  const populated = build.populated || tile?.populated || build.tile?.populated;
  if (populated?.isoImage?.dataURL) {
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    // Scale based on aspect ratio - constrain to fit in available space
    const aspectRatio = populated.isoImage.width / populated.isoImage.height;
    const maxHeight = 220; // Leave room for materials above and outputs below
    const maxWidth = 280;
    let imgWidth, imgHeight;
    if (aspectRatio > 1) {
      // Wider than tall
      imgWidth = Math.min(maxWidth, populated.isoImage.width * 0.8);
      imgHeight = imgWidth / aspectRatio;
    } else {
      // Taller than wide
      imgHeight = Math.min(maxHeight, populated.isoImage.height * 0.8);
      imgWidth = imgHeight * aspectRatio;
    }
    // Ensure it doesn't exceed max dimensions
    if (imgHeight > maxHeight) {
      imgHeight = maxHeight;
      imgWidth = imgHeight * aspectRatio;
    }
    img.setAttribute('href', populated.isoImage.dataURL);
    // Position so bottom of building is above the output circles (cy + some offset)
    // and top has room for material icons
    const imgY = cy - imgHeight * 0.4; // Center vertically around cy
    const minY = 120; // Don't go above this (leave room for material icons + labels)
    img.setAttribute('x', cx - imgWidth / 2);
    img.setAttribute('y', Math.max(minY, imgY));
    img.setAttribute('width', imgWidth);
    img.setAttribute('height', imgHeight);
    img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.appendChild(img);
  } else {
    // Fallback: draw simple isometric building
    const floors = build.stats?.floors || populated?.floors || 3;
    const building = createSimpleIsoBuilding(cx, cy, 80, floors * 25, floors);
    svg.appendChild(building);
  }

  // Draw material icons at radial positions
  materialSources.forEach((source, i) => {
    const pos = materialPositions[i];

    // Small ISO image for material source (if available, otherwise simple icon)
    const matIcon = createMaterialIcon(source, pos.x, pos.y);
    svg.appendChild(matIcon);

    // Material label below
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', pos.x);
    label.setAttribute('y', pos.y + 45);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-family', 'Spline Sans Mono, monospace');
    label.setAttribute('font-size', '10');
    label.setAttribute('fill', '#606068');
    label.textContent = source.material.toUpperCase();
    svg.appendChild(label);
  });

  // CO₂ circle (dashed)
  const co2Circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  co2Circle.setAttribute('cx', co2X);
  co2Circle.setAttribute('cy', co2Y);
  co2Circle.setAttribute('r', '35');
  co2Circle.setAttribute('fill', 'none');
  co2Circle.setAttribute('stroke', '#707880');
  co2Circle.setAttribute('stroke-width', '0.5');
  co2Circle.setAttribute('stroke-dasharray', '3 2');
  svg.appendChild(co2Circle);

  // CO₂ value
  const carbon = environmentStats?.carbon || build.embodiedCarbon || 0;
  const co2Value = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  co2Value.setAttribute('x', co2X);
  co2Value.setAttribute('y', co2Y + 4);
  co2Value.setAttribute('text-anchor', 'middle');
  co2Value.setAttribute('font-family', 'Spline Sans Mono, monospace');
  co2Value.setAttribute('font-size', '14');
  co2Value.setAttribute('fill', '#606068');
  co2Value.textContent = `${carbon.toFixed(1)}T`;
  svg.appendChild(co2Value);

  // CO₂ label
  const co2Label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  co2Label.setAttribute('x', co2X);
  co2Label.setAttribute('y', co2Y + 50);
  co2Label.setAttribute('text-anchor', 'middle');
  co2Label.setAttribute('font-family', 'Spline Sans Mono, monospace');
  co2Label.setAttribute('font-size', '10');
  co2Label.setAttribute('fill', '#808088');
  co2Label.innerHTML = 'CO<tspan baseline-shift="sub" font-size="7">2</tspan>';
  svg.appendChild(co2Label);

  // SOIL circle (dashed)
  const soilCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  soilCircle.setAttribute('cx', soilX);
  soilCircle.setAttribute('cy', soilY);
  soilCircle.setAttribute('r', '30');
  soilCircle.setAttribute('fill', 'none');
  soilCircle.setAttribute('stroke', '#707880');
  soilCircle.setAttribute('stroke-width', '0.5');
  soilCircle.setAttribute('stroke-dasharray', '3 2');
  svg.appendChild(soilCircle);

  // SOIL value
  const waste = environmentStats?.waste || build.wasteReq?.soil || 0;
  const soilValue = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  soilValue.setAttribute('x', soilX);
  soilValue.setAttribute('y', soilY + 4);
  soilValue.setAttribute('text-anchor', 'middle');
  soilValue.setAttribute('font-family', 'Spline Sans Mono, monospace');
  soilValue.setAttribute('font-size', '14');
  soilValue.setAttribute('fill', '#606068');
  soilValue.textContent = formatNumber(waste);
  svg.appendChild(soilValue);

  // SOIL label
  const soilLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  soilLabel.setAttribute('x', soilX);
  soilLabel.setAttribute('y', soilY + 48);
  soilLabel.setAttribute('text-anchor', 'middle');
  soilLabel.setAttribute('font-family', 'Spline Sans Mono, monospace');
  soilLabel.setAttribute('font-size', '10');
  soilLabel.setAttribute('fill', '#808088');
  soilLabel.textContent = 'WASTE';
  svg.appendChild(soilLabel);

  // HOURS circle (to the lower-right, symmetric to CO2)
  const hoursX = 500, hoursY = 400;
  const hoursLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  hoursLine.setAttribute('x1', cx + 40);
  hoursLine.setAttribute('y1', cy + 80);
  hoursLine.setAttribute('x2', hoursX - 30);
  hoursLine.setAttribute('y2', hoursY - 20);
  hoursLine.setAttribute('stroke', '#707880');
  hoursLine.setAttribute('stroke-width', '0.5');
  hoursLine.setAttribute('stroke-dasharray', '4 2');
  svg.appendChild(hoursLine);

  const hoursCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  hoursCircle.setAttribute('cx', hoursX);
  hoursCircle.setAttribute('cy', hoursY);
  hoursCircle.setAttribute('r', '35');
  hoursCircle.setAttribute('fill', 'none');
  hoursCircle.setAttribute('stroke', '#707880');
  hoursCircle.setAttribute('stroke-width', '0.5');
  hoursCircle.setAttribute('stroke-dasharray', '3 2');
  svg.appendChild(hoursCircle);

  // HOURS value
  const totalHours = laborStats?.totalHours || build.totalLaborHours || build.laborReq || 500;
  const hoursValue = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  hoursValue.setAttribute('x', hoursX);
  hoursValue.setAttribute('y', hoursY + 4);
  hoursValue.setAttribute('text-anchor', 'middle');
  hoursValue.setAttribute('font-family', 'Spline Sans Mono, monospace');
  hoursValue.setAttribute('font-size', '14');
  hoursValue.setAttribute('fill', '#606068');
  hoursValue.textContent = formatNumber(totalHours);
  svg.appendChild(hoursValue);

  // HOURS label
  const hoursLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  hoursLabel.setAttribute('x', hoursX);
  hoursLabel.setAttribute('y', hoursY + 50);
  hoursLabel.setAttribute('text-anchor', 'middle');
  hoursLabel.setAttribute('font-family', 'Spline Sans Mono, monospace');
  hoursLabel.setAttribute('font-size', '10');
  hoursLabel.setAttribute('fill', '#808088');
  hoursLabel.textContent = 'HOURS';
  svg.appendChild(hoursLabel);

  wrapper.appendChild(svg);
  return wrapper;
}

function calculateRadialPositions(count, cx, cy, radius) {
  const positions = [];
  if (count === 0) return positions;

  // Spread materials across top arc only (avoiding sides and bottom where outputs go)
  const startAngle = -Math.PI * 0.75; // Start from upper left
  const endAngle = -Math.PI * 0.25;   // End at upper right
  const angleSpan = endAngle - startAngle;

  for (let i = 0; i < count; i++) {
    const angle = count === 1
      ? -Math.PI / 2  // Single material: straight up
      : startAngle + (angleSpan * i / (count - 1));

    positions.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      angle
    });
  }

  return positions;
}

function createMaterialIcon(source, x, y) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  // Simple isometric block representation for each material
  const colors = {
    timber: { top: '#E8D090', front: '#C9A868', side: '#A88848' },
    stone: { top: '#C8C4BE', front: '#9A9590', side: '#7A7570' },
    brick: { top: '#D88878', front: '#B8685A', side: '#984838' },
    concrete: { top: '#D0D0D0', front: '#B0B0B0', side: '#909090' },
    glass: { top: '#B8D8E8', front: '#8AB8D0', side: '#6A98B0' },
    clay: { top: '#D8C090', front: '#C8A870', side: '#A88850' },
    sand: { top: '#E8D8B0', front: '#D8C890', side: '#C8B870' }
  };

  const c = colors[source.material] || { top: '#D0D0D0', front: '#B0B0B0', side: '#909090' };

  // Always show a pile of 12 cubes for visual impact
  const cubeCount = 12;

  const w = 12, h = 9, d = 7; // Smaller cubes to fit more

  // Draw cubes in a pyramid/pile pattern
  // Layer 0 (bottom): 6 cubes in 2 rows of 3
  // Layer 1: 4 cubes in 2x2
  // Layer 2 (top): 2 cubes
  const cubePositions = [
    // Bottom layer (6 cubes)
    { ox: -w * 0.7, oy: 0 },
    { ox: 0, oy: 0 },
    { ox: w * 0.7, oy: 0 },
    { ox: -w * 0.35, oy: -d * 0.5 },
    { ox: w * 0.35, oy: -d * 0.5 },
    { ox: 0, oy: -d },
    // Middle layer (4 cubes)
    { ox: -w * 0.35, oy: h * 0.8 },
    { ox: w * 0.35, oy: h * 0.8 },
    { ox: 0, oy: h * 0.8 - d * 0.5 },
    { ox: 0, oy: h * 0.8 + d * 0.3 },
    // Top layer (2 cubes)
    { ox: -w * 0.2, oy: h * 1.6 },
    { ox: w * 0.2, oy: h * 1.6 - d * 0.3 },
  ];

  for (let i = 0; i < cubeCount; i++) {
    const pos = cubePositions[i] || { ox: 0, oy: 0 };
    const cx = x + pos.ox;
    const cy = y - pos.oy;

    // Top face
    const topPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    topPath.setAttribute('d', `M${cx},${cy - h} L${cx + w/2},${cy - h - d/2} L${cx},${cy - h - d} L${cx - w/2},${cy - h - d/2} Z`);
    topPath.setAttribute('fill', c.top);
    topPath.setAttribute('stroke', '#505058');
    topPath.setAttribute('stroke-width', '0.3');
    g.appendChild(topPath);

    // Front face
    const frontPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    frontPath.setAttribute('d', `M${cx - w/2},${cy - h - d/2} L${cx},${cy - h} L${cx},${cy} L${cx - w/2},${cy - d/2} Z`);
    frontPath.setAttribute('fill', c.front);
    frontPath.setAttribute('stroke', '#505058');
    frontPath.setAttribute('stroke-width', '0.3');
    g.appendChild(frontPath);

    // Side face
    const sidePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    sidePath.setAttribute('d', `M${cx},${cy - h} L${cx + w/2},${cy - h - d/2} L${cx + w/2},${cy - d/2} L${cx},${cy} Z`);
    sidePath.setAttribute('fill', c.side);
    sidePath.setAttribute('stroke', '#505058');
    sidePath.setAttribute('stroke-width', '0.3');
    g.appendChild(sidePath);
  }

  return g;
}

function createSimpleIsoBuilding(cx, cy, w, h, floors) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const d = w * 0.6;

  // Shadow
  const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  shadow.setAttribute('cx', cx);
  shadow.setAttribute('cy', cy + 10);
  shadow.setAttribute('rx', w * 0.5);
  shadow.setAttribute('ry', w * 0.15);
  shadow.setAttribute('fill', 'rgba(0,0,0,0.1)');
  g.appendChild(shadow);

  // Front face
  const frontPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  frontPath.setAttribute('d', `M${cx - w/2},${cy - d/2} L${cx},${cy} L${cx},${cy - h} L${cx - w/2},${cy - h - d/2} Z`);
  frontPath.setAttribute('fill', '#D8D4D0');
  frontPath.setAttribute('stroke', '#505058');
  frontPath.setAttribute('stroke-width', '0.3');
  g.appendChild(frontPath);

  // Side face
  const sidePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  sidePath.setAttribute('d', `M${cx},${cy} L${cx + w/2},${cy - d/2} L${cx + w/2},${cy - h - d/2} L${cx},${cy - h} Z`);
  sidePath.setAttribute('fill', '#E8E4E0');
  sidePath.setAttribute('stroke', '#505058');
  sidePath.setAttribute('stroke-width', '0.3');
  g.appendChild(sidePath);

  // Top face
  const topPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  topPath.setAttribute('d', `M${cx},${cy - h} L${cx + w/2},${cy - h - d/2} L${cx},${cy - h - d} L${cx - w/2},${cy - h - d/2} Z`);
  topPath.setAttribute('fill', '#F0ECE8');
  topPath.setAttribute('stroke', '#505058');
  topPath.setAttribute('stroke-width', '0.3');
  g.appendChild(topPath);

  // Windows
  const floorH = h / floors;
  for (let f = 0; f < floors; f++) {
    const winY = cy - (f + 0.5) * floorH;
    // Front windows
    for (let wx = 0; wx < 3; wx++) {
      const winX = cx - w/4 + wx * (w/4) - w/2;
      const win = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      win.setAttribute('x', winX);
      win.setAttribute('y', winY - 8);
      win.setAttribute('width', 6);
      win.setAttribute('height', 10);
      win.setAttribute('fill', '#4A5A6A');
      win.setAttribute('stroke', '#303038');
      win.setAttribute('stroke-width', '0.2');
      g.appendChild(win);
    }
  }

  return g;
}

function analyzeMaterialSources(draws) {
  const sources = [];
  const seen = new Set();

  for (const d of draws) {
    const material = d.material || d.rawMaterial || 'material';
    if (seen.has(material)) continue;
    seen.add(material);

    const biome = d.tile?.biome || d.rawSourceTile?.biome || 'unknown';
    const processed = ['brick', 'concrete', 'glass'].includes(material);
    const imported = ['steel', 'glass'].includes(material);

    sources.push({
      material,
      biome,
      amount: d.amount || 0,
      processed,
      imported,
      processor: processed ? getProcessorForMaterial(material) : null
    });
  }

  return sources;
}

function getProcessorForMaterial(material) {
  const processors = {
    brick: 'kiln',
    concrete: 'plant',
    glass: 'furnace'
  };
  return processors[material] || 'factory';
}

// ── DATA TABLE ─────────────────────────────────────────────────────

function createDataTable(title, rows, type) {
  const table = document.createElement('div');
  table.className = `bp-data-table bp-table-${type}`;

  let html = `<div class="bp-table-title">${title}</div>`;
  html += '<table>';

  rows.forEach((row, i) => {
    const isHeader = i === 0;
    html += `<tr class="${isHeader ? 'bp-table-header' : ''}">`;
    row.forEach(cell => {
      html += isHeader ? `<th>${cell}</th>` : `<td>${cell}</td>`;
    });
    html += '</tr>';
  });

  html += '</table>';
  table.innerHTML = html;
  return table;
}

// ── METRIC CELL ────────────────────────────────────────────────────

function createMetricCell(label, value) {
  const cell = document.createElement('div');
  cell.className = 'bp-metric-cell';
  cell.innerHTML = `
    <span class="bp-metric-value">${value}</span>
    <span class="bp-metric-label">${label}</span>
  `;
  return cell;
}

// ── IMPACT SECTION ─────────────────────────────────────────────────

function createImpactSection(title, items) {
  const section = document.createElement('div');
  section.className = 'bp-impact-section';

  let html = `<div class="bp-impact-title">${title}</div>`;
  html += '<div class="bp-impact-items">';

  items.forEach(item => {
    html += `
      <div class="bp-impact-item">
        <div class="bp-impact-row-top">
          <span class="bp-impact-label">${item.label}</span>
          <span class="bp-impact-value">${item.value}</span>
        </div>
        <div class="bp-impact-bar-bg">
          <div class="bp-impact-bar" style="width: ${item.bar * 100}%"></div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  section.innerHTML = html;
  return section;
}

// ── CALCULATIONS ───────────────────────────────────────────────────

function calculateLaborStats(build, builds = []) {
  // Aggregate labor from all builds
  let totalHours = 0;
  let totalSqft = 0;

  if (builds.length > 1) {
    for (const b of builds) {
      totalHours += b.totalLaborHours || b.laborReq || 500;
      totalSqft += b.stats?.grossArea || 2000;
    }
  } else {
    totalHours = build.totalLaborHours || build.laborReq || 500;
    totalSqft = build.stats?.grossArea || 2000;
  }

  return {
    totalHours,
    workers: Math.max(2, Math.ceil(totalHours / 200)),
    days: Math.ceil(totalHours / 40),
    hoursPerSqFt: totalSqft > 0 ? totalHours / totalSqft : 0
  };
}

function calculateMaterialStats(build, draws) {
  const sources = draws.map(d => ({
    biome: d.tile?.biome || d.rawSourceTile?.biome || 'unknown',
    material: d.material || d.rawMaterial || 'material',
    amount: d.amount || 0,
    distance: d.distanceFt || d.distance || 0
  }));

  const avgDistance = sources.length > 0
    ? sources.reduce((s, d) => s + d.distance, 0) / sources.length
    : 0;

  const localityScore = Math.max(0, 100 - avgDistance / 5);
  const depletionAvg = 0.3; // Placeholder

  return { sources, avgDistance, localityScore, depletionAvg };
}

function calculateEnvironmentStats(build, draws, builds = []) {
  // Aggregate carbon and waste from all builds
  let carbon = 0;
  let waste = 0;

  if (builds.length > 1) {
    for (const b of builds) {
      carbon += b.embodiedCarbon || 0;
      waste += b.wasteReq?.soil || b.excavationNeeded || 0;
    }
  } else {
    carbon = build.embodiedCarbon || 0;
    waste = build.wasteReq?.soil || build.excavationNeeded || 0;
  }

  let transportCarbon = 0;
  for (const d of draws) {
    const dist = d.distanceFt || d.distance || 0;
    transportCarbon += (d.amount || 0) * 0.0000005 * dist;
  }

  return { carbon, waste, transportCarbon };
}

function calculateSocialStats(build, state, buildingCount = 1) {
  // For multi-building tiles, use populated data
  const populated = build.populated || build.tile?.populated;

  let floors, sqft;
  if (buildingCount > 1 && populated) {
    floors = populated.floors || 2;
    sqft = populated.buildings?.reduce((sum, b) => sum + (b.width || 40) * (b.depth || 40), 0) || 2000;
  } else {
    floors = build.stats?.floors || 2;
    sqft = build.stats?.grossArea || 2000;
  }

  const occupants = Math.floor(sqft / 200) * floors;
  const condition = populated?.condition ?? build.condition ?? 1.0;

  const sentimentScore = condition > 0.8 ? 0.9 : condition > 0.5 ? 0.6 : 0.3;
  const sentiment = sentimentScore > 0.7 ? 'POSITIVE' : sentimentScore > 0.4 ? 'NEUTRAL' : 'DECLINING';

  return { occupants, condition, sentiment, sentimentScore };
}

export function calculateBuildGrade(build, draws) {
  // Material sustainability score
  const renewables = ['timber'];
  const buildDraws = draws || build.draws || [];
  const renewableCount = buildDraws.filter(d => renewables.includes(d.material || d.rawMaterial)).length;
  const materialScore = buildDraws.length > 0 ? (renewableCount / buildDraws.length) * 10 : 5;

  // Carbon score
  const totalCarbon = (build.embodiedCarbon || 0) + 0.1;
  const carbonScore = Math.max(0, 10 - totalCarbon * 2);

  // Locality score
  let avgDistance = 0;
  if (buildDraws.length > 0) {
    avgDistance = buildDraws.reduce((s, d) => s + (d.distanceFt || d.distance || 0), 0) / buildDraws.length;
  }
  const localScore = Math.max(0, 10 - avgDistance / 200);

  // Death plan score
  const plan = DEATH_PLANS[build.deathPlan] || DEATH_PLANS['demolish-salvage'];
  const deathScore = (plan.salvageRate || 0) * 10;

  const total = (materialScore + carbonScore + localScore + deathScore) / 4;

  // Stricter grading: A requires 9+, B requires 8+, C requires 7+
  let letter = 'D';
  if (total >= 9.0) letter = 'A';
  else if (total >= 8.0) letter = 'B';
  else if (total >= 7.0) letter = 'C';

  return { letter, score: total };
}

function generateConstitutionText(build, grade, materialStats, laborStats, environmentStats, buildingCount = 1) {
  const materials = materialStats.sources.map(s => s.material.toLowerCase()).filter((v, i, a) => a.indexOf(v) === i);
  const biomes = materialStats.sources.map(s => s.biome.toLowerCase()).filter((v, i, a) => a.indexOf(v) === i);

  // For multi-building tiles, describe as ensemble
  const typology = buildingCount > 1 ? 'ensemble' : (build.stats?.typology || 'structure');

  // Design intent (what the building claims to be)
  const intentStatements = {
    residential: 'shelter and domestic comfort',
    commercial: 'economic exchange and commerce',
    industrial: 'production and manufacturing',
    civic: 'community gathering and public service',
    cultural: 'artistic expression and cultural memory',
    mixed: 'diverse urban activity',
    ensemble: 'collective inhabitation and shared program'
  };
  const intent = intentStatements[typology] || 'human occupation';

  // Assess actual value system based on material choices
  const hasRenewables = materials.includes('timber');
  const hasProcessed = materials.some(m => ['brick', 'concrete', 'glass'].includes(m));
  const isLocal = materialStats.localityScore > 70;

  let valueAssessment;
  if (hasRenewables && isLocal && !hasProcessed) {
    valueAssessment = 'a genuine commitment to ecological reciprocity';
  } else if (hasRenewables && isLocal) {
    valueAssessment = 'a partial acknowledgment of material limits, tempered by industrial convenience';
  } else if (isLocal) {
    valueAssessment = 'territorial awareness, though extraction patterns remain conventional';
  } else {
    valueAssessment = 'expedience over ecological accountability';
  }

  return `
    <p><strong>DESIGN INTENT:</strong> This ${typology} was designed for ${intent}.</p>
    <p><strong>MATERIAL REALITY:</strong> It consumed <strong>${materials.join(', ').toUpperCase()}</strong>
    drawn from the island's ${biomes.join(' and ')} regions. These extractions represent
    ${valueAssessment}.</p>
    <p><strong>LABOR ACCOUNT:</strong> ${laborStats.workers} workers contributed ${formatNumber(laborStats.totalHours)} hours
    over ${laborStats.days} days—time exchanged for material transformation.</p>
    <p><strong>CONSEQUENCES:</strong> Construction released ${environmentStats.carbon.toFixed(2)} tons of CO₂
    and displaced ${formatNumber(environmentStats.waste)} cubic feet of soil.
    These debts are now inscribed in the atmosphere and landscape.</p>
    <p>The gap between stated purpose and actual impact earns this structure grade <strong>${grade.letter}</strong>.</p>
  `;
}

// ── HELPERS ────────────────────────────────────────────────────────

function formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}

function getBiomeColor(biome) {
  const colors = {
    forest: COLORS.timber,
    mountain: COLORS.stone,
    lowlands: COLORS.clay,
    beach: COLORS.sand,
    desert: COLORS.brick,
    water: COLORS.glass
  };
  return colors[biome] || '#AAA';
}

// ── OPEN/CLOSE ─────────────────────────────────────────────────────

export function openBuildProfile(build, state) {
  const panel = document.getElementById('build-profile-panel');
  const container = document.getElementById('build-profile-container');

  if (!panel || !container || !build) {
    console.warn('[BUILD PROFILE] Missing panel, container, or build', { panel, container, build });
    return;
  }

  console.log('[BUILD PROFILE] Opening profile for:', build.name, build);

  panel.classList.add('visible');
  document.body.classList.add('profile-open');

  requestAnimationFrame(() => {
    renderBuildProfile(state, build, container);
  });
}

export function closeBuildProfile() {
  const panel = document.getElementById('build-profile-panel');
  if (panel) {
    panel.classList.remove('visible');
    document.body.classList.remove('profile-open');
  }
  currentState = null;
  currentBuild = null;
}

// Close on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('profile-open')) {
    closeBuildProfile();
  }
});
