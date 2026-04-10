/**
 * glassDetector.ts
 * Computer vision utilities for detecting:
 * - Glass content boundaries (column + row extent of actual liquid)
 * - Guinness liquid level (dark stout + cream head)
 * - G logo position (anchored to detected glass extent, not guide box)
 * - Split the G status
 */

export interface GlassBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionResult {
  glassBounds: GlassBounds | null;
  liquidLevelY: number | null;   // Y coord of top of cream head (what user drinks to)
  headTopY: number | null;       // Y coord of top of cream head
  headBottomY: number | null;    // Y coord where head meets dark body
  gPositionY: number | null;     // Y coord of estimated G logo position
  splitStatus: 'perfect' | 'too_high' | 'too_low' | 'no_liquid' | 'unknown';
  confidence: number;            // 0-1
}

// ── Colour helpers ──────────────────────────────────────────────────────────

function isGuinnessLiquid(r: number, g: number, b: number): boolean {
  // Very dark brown/black — classic Guinness body
  return r < 65 && g < 60 && b < 60 && Math.max(r, g, b) < 75;
}

function isCreamHead(r: number, g: number, b: number): boolean {
  // Off-white / tan / beige — Guinness cream head
  return (
    r > 150 && r < 255 &&
    g > 125 && g < 235 &&
    b > 80  && b < 210 &&
    r > b + 18 &&        // warmer than blue
    r - g < 75           // not too yellow-green
  );
}

function isGlassContent(r: number, g: number, b: number): boolean {
  return isGuinnessLiquid(r, g, b) || isCreamHead(r, g, b);
}

// ── Step 1: Find which columns contain glass content ──────────────────────

/**
 * Scan columns within searchBounds to find the left/right extent of
 * pixels that look like Guinness liquid or cream head.
 * Returns null if nothing is found (glass not in frame / empty).
 */
function findGlassColumns(
  data: Uint8ClampedArray,
  imgWidth: number,
  bounds: GlassBounds
): { left: number; right: number } | null {
  const { x, y, width: bw, height: bh } = bounds;
  const DENSITY_THRESHOLD = 0.04; // 4% of column pixels must be glass content

  let firstGlassCol = -1;
  let lastGlassCol  = -1;

  for (let col = x; col < x + bw; col++) {
    let count = 0;
    // Sample every 3rd row for speed
    for (let row = y; row < y + bh; row += 3) {
      const idx = (row * imgWidth + col) * 4;
      if (isGlassContent(data[idx], data[idx + 1], data[idx + 2])) count++;
    }
    const density = (count * 3) / bh; // approximate; sample step was 3
    if (density > DENSITY_THRESHOLD) {
      if (firstGlassCol === -1) firstGlassCol = col;
      lastGlassCol = col;
    }
  }

  if (firstGlassCol === -1) return null;

  // Pad the detected column range slightly so we don't clip the glass edges
  const spread  = lastGlassCol - firstGlassCol;
  const padding = Math.max(6, Math.round(spread * 0.12));
  return {
    left:  Math.max(x,          firstGlassCol - padding),
    right: Math.min(x + bw - 1, lastGlassCol  + padding),
  };
}

// ── Step 2: Find vertical extent (glass top and bottom) ───────────────────

interface VerticalExtent {
  topRow: number | null;    // first row with any glass content (head or liquid)
  bottomRow: number | null; // last row with DARK liquid (= bottom of stout body)
}

function findGlassRows(
  data: Uint8ClampedArray,
  imgWidth: number,
  colLeft: number,
  colRight: number,
  searchTop: number,
  searchBottom: number
): VerticalExtent {
  const colCount  = colRight - colLeft + 1;
  const stepX     = Math.max(1, Math.round(colCount / 10)); // ~10 sample columns
  const minFrac   = 0.20;                                   // 20% of columns must fire
  const minCount  = Math.max(1, Math.round((colCount / stepX) * minFrac));

  let topRow: number | null    = null;
  let bottomRow: number | null = null;

  // Scan top→bottom for first row with any glass content
  for (let row = searchTop; row < searchBottom && topRow === null; row++) {
    let count = 0;
    for (let col = colLeft; col <= colRight; col += stepX) {
      const idx = (row * imgWidth + col) * 4;
      if (isGlassContent(data[idx], data[idx + 1], data[idx + 2])) count++;
    }
    if (count >= minCount) topRow = row;
  }

  // Scan bottom→top for last row with DARK liquid (ignore cream — cream can appear on walls)
  for (let row = searchBottom - 1; row >= searchTop && bottomRow === null; row--) {
    let count = 0;
    for (let col = colLeft; col <= colRight; col += stepX) {
      const idx = (row * imgWidth + col) * 4;
      if (isGuinnessLiquid(data[idx], data[idx + 1], data[idx + 2])) count++;
    }
    if (count >= minCount) bottomRow = row;
  }

  return { topRow, bottomRow };
}

// ── Step 3: Liquid level detection within the glass column range ───────────

/**
 * Scan multiple columns to find the median topmost cream-head row and
 * topmost dark-liquid row. Uses only the detected glass column range so
 * dark background pixels above the glass don't fire.
 */
function detectLiquidLevel(
  data: Uint8ClampedArray,
  imgWidth: number,
  colLeft: number,
  colRight: number,
  rowTop: number,
  rowBottom: number
): { headTopY: number | null; liquidTopY: number | null } {
  const headTops: number[]    = [];
  const liquidTops: number[]  = [];
  const stepX = Math.max(2, Math.round((colRight - colLeft) / 12));

  for (let col = colLeft; col <= colRight; col += stepX) {
    let headTop: number | null    = null;
    let liquidTop: number | null  = null;

    for (let row = rowTop; row <= rowBottom; row++) {
      const idx = (row * imgWidth + col) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (headTop === null   && isCreamHead(r, g, b))       headTop   = row;
      if (liquidTop === null && isGuinnessLiquid(r, g, b))  liquidTop = row;
      if (headTop !== null   && liquidTop !== null)          break;
    }
    if (headTop   !== null) headTops.push(headTop);
    if (liquidTop !== null) liquidTops.push(liquidTop);
  }

  const median = (arr: number[]) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  return { headTopY: median(headTops), liquidTopY: median(liquidTops) };
}

// ── Step 4: G logo edge-energy detection ──────────────────────────────────

/**
 * Look for a row of unusually high horizontal edge energy within the lower
 * portion of the detected glass — this often corresponds to the printed G.
 */
function detectGLogo(
  data: Uint8ClampedArray,
  imgWidth: number,
  colLeft: number,
  colRight: number,
  glassTopY: number,
  glassBottomY: number
): { y: number; detected: boolean } {
  const glassH   = glassBottomY - glassTopY;
  // G lives in the lower ~30-65% of the glass
  const scanTop  = Math.round(glassTopY  + glassH * 0.35);
  const scanBot  = Math.round(glassTopY  + glassH * 0.65);

  if (scanBot <= scanTop) {
    return { y: glassBottomY - glassH * 0.35, detected: false };
  }

  const rowEnergy = new Array(scanBot - scanTop).fill(0);

  for (let row = scanTop; row < scanBot; row++) {
    let energy = 0;
    for (let col = colLeft + 1; col < colRight - 1; col++) {
      const li = (row * imgWidth + (col - 1)) * 4;
      const ri = (row * imgWidth + (col + 1)) * 4;
      const lB = (data[li] + data[li + 1] + data[li + 2]) / 3;
      const rB = (data[ri] + data[ri + 1] + data[ri + 2]) / 3;
      energy += Math.abs(lB - rB);
    }
    rowEnergy[row - scanTop] = energy;
  }

  let maxE = 0, maxIdx = 0;
  for (let i = 0; i < rowEnergy.length; i++) {
    if (rowEnergy[i] > maxE) { maxE = rowEnergy[i]; maxIdx = i; }
  }

  const meanE = rowEnergy.reduce((a, b) => a + b, 0) / rowEnergy.length;
  if (maxE > meanE * 2.8) {
    return { y: scanTop + maxIdx, detected: true };
  }

  // Geometric fallback: G is 35% up from glass bottom
  return { y: glassBottomY - glassH * 0.35, detected: false };
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Full pipeline. imageData is already cropped to the guide box region,
 * so searchBounds is typically { x:0, y:0, width, height }.
 */
export function analyseGlass(
  imageData: ImageData,
  searchBounds: GlassBounds
): DetectionResult {
  const { data, width } = imageData;

  // 1. Find which columns actually contain glass content
  const cols = findGlassColumns(data, width, searchBounds);

  if (!cols) {
    // No liquid detected — show guide G position based on full search bounds
    const fallbackG = searchBounds.y + searchBounds.height * 0.65;
    return {
      glassBounds: null,
      liquidLevelY: null, headTopY: null, headBottomY: null,
      gPositionY: fallbackG,
      splitStatus: 'no_liquid',
      confidence: 0,
    };
  }

  // 2. Find vertical extent of actual glass content
  const { topRow, bottomRow } = findGlassRows(
    data, width,
    cols.left, cols.right,
    searchBounds.y, searchBounds.y + searchBounds.height
  );

  const glassTop    = topRow    ?? searchBounds.y;
  const glassBottom = bottomRow ?? (searchBounds.y + searchBounds.height);
  const glassHeight = Math.max(1, glassBottom - glassTop);

  // 3. Detect liquid level within detected glass columns only
  const { headTopY, liquidTopY } = detectLiquidLevel(
    data, width,
    cols.left, cols.right,
    glassTop, glassBottom
  );

  // 4. Detect / estimate G position
  const { y: gPositionY, detected } = detectGLogo(
    data, width,
    cols.left, cols.right,
    glassTop, glassBottom
  );

  // 5. Split-the-G check
  // Tolerance = ±5% of detected glass height
  const tolerance = glassHeight * 0.05;
  const liquidY    = headTopY ?? liquidTopY;

  let splitStatus: DetectionResult['splitStatus'] = 'unknown';
  if (liquidY === null) {
    splitStatus = 'no_liquid';
  } else {
    const diff = liquidY - gPositionY; // positive → liquid top is BELOW G (too low)
    if (Math.abs(diff) <= tolerance)   splitStatus = 'perfect';
    else if (diff < -tolerance)        splitStatus = 'too_high'; // above G
    else                               splitStatus = 'too_low';  // below G
  }

  const confidence = (topRow !== null && bottomRow !== null)
    ? (detected ? 0.85 : 0.65)
    : 0.4;

  return {
    glassBounds: {
      x: cols.left,
      y: glassTop,
      width: cols.right - cols.left,
      height: glassHeight,
    },
    liquidLevelY: liquidTopY,
    headTopY,
    headBottomY: liquidTopY,
    gPositionY,
    splitStatus,
    confidence,
  };
}
