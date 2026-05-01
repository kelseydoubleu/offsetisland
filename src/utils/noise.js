// ════════════════════════════════════════════════════════════════════
// NOISE FUNCTIONS
// Procedural noise for terrain generation. These create the continuous
// elevation field that makes mountains, valleys, and coastlines emerge
// naturally rather than being imposed.
// ════════════════════════════════════════════════════════════════════

// Hash-based pseudo-random in [0,1)
export function hash2(x, y, seed = 0) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

// Smooth 2D value noise
export function smoothNoise(x, y, seed = 1) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const v00 = hash2(x0,     y0,     seed);
  const v10 = hash2(x0 + 1, y0,     seed);
  const v01 = hash2(x0,     y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  // Smoothstep interpolation
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = v00 * (1 - sx) + v10 * sx;
  const bot = v01 * (1 - sx) + v11 * sx;
  return top * (1 - sy) + bot * sy;
}

// Fractal Brownian Motion (fBm) — natural hilly shapes
export function fbm(x, y, octaves = 4, seed = 1) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(x * freq, y * freq, seed + i * 13.17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Ridge noise — creates sharp ridges and valleys (real mountain topology)
export function ridgeNoise(x, y, octaves = 4, seed = 1) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = smoothNoise(x * freq, y * freq, seed + i * 13.17);
    n = 1 - Math.abs(2 * n - 1);  // ridge operator
    n = n * n;                     // sharpen
    sum += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
