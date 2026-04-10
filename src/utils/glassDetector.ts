/**
 * glassDetector.ts
 *
 * Detection strategy — cream-head anchored:
 *
 * 1. Find the Guinness cream head (most reliable, unique colour signature).
 * 2. Derive the glass column range from where the cream head lives.
 * 3. Scan DOWNWARD in those columns for the last dark-liquid row → glass bottom.
 * 4. Estimate G position from glass bottom (35% up).
 * 5. Detect liquid level (top of cream head = what the user drinks to).
 *
 * This avoids dark-background false positives because:
 *  - We never rely on dark pixels to locate the glass horizontally.
 *  - All measurements are anchored to the cream head's column range.
 */

export interface GlassBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionResult {
  glassBounds: GlassBounds | null;
  liquidLevelY: number | null;
  headTopY: number | null;
  headBottomY: number | null;
  gPositionY: number | null;
  splitStatus: 'perfect' | 'too_high' | 'too_low' | 'no_liquid' | 'unknown';
  confidence: number;
}

// ── Colour classifiers ────────────────────────────────────────────────────

function isGuinnessLiquid(r: number, g: number, b: number): boolean {
  // Very dark, slightly warm brown
  return (
    r < 70 && g < 65 && b < 65 &&
    Math.max(r, g, b) < 80 &&
    r >= b  // warm, not blue-tinted shadow
  );
}

function isCreamHead(r: number, g: number, b: number): boolean {
  // Off-white / warm tan — highly specific to Guinness head
  return (
    r > 145 && r < 255 &&
    g > 120 && g < 240 &&
    b > 75  && b < 215 &&
    r > b + 15 &&          // warmer than blue
    r - g < 80             // not overly yellow
  );
}

// ── Step 1: Locate cream head ─────────────────────────────────────────────

interface HeadResult {
  headTopY:    number;
  headBottomY: number;
  colLeft:     number;
  colRight:    number;
}

/**
 * Scan the search region for the Guinness cream head.
 * Returns the row/column extents of the head, or null if not found.
 */
function findCreamHead(
  data: Uint8ClampedArray,
  imgWidth: number,
  bounds: GlassBounds
): HeadResult | null {
  const { x, y, width: bw, height: bh } = bounds;
  const COL_THRESHOLD = 0.08;  // 8% of column pixels must be cream
  const ROW_THRESHOLD = 0.12;  // 12% of row pixels must be cream (for row scan)

  // ── Column pass: find glass column range via cream ──────────────────────
  let firstCol = -1, lastCol = -1;

  for (let col = x; col < x + bw; col++) {
    let count = 0;
    for (let row = y; row < y + bh; row += 3) {
      const i = (row * imgWidth + col) * 4;
      if (isCreamHead(data[i], data[i + 1], data[i + 2])) count++;
    }
    const density = (count * 3) / bh;
    if (density > COL_THRESHOLD) {
      if (firstCol === -1) firstCol = col;
      lastCol = col;
    }
  }

  if (firstCol === -1) return null;

  // Require minimum column span (avoids single stray pixels)
  if (lastCol - firstCol < bw * 0.06) return null;

  // Pad the column range slightly
  const colPad  = Math.max(4, Math.round((lastCol - firstCol) * 0.08));
  const colLeft  = Math.max(x, firstCol - colPad);
  const colRight = Math.min(x + bw - 1, lastCol + colPad);
  const colSpan  = colRight - colLeft;

  // ── Row pass: find head top and bottom within the detected columns ───────
  let headTopY    = -1;
  let headBottomY = -1;

  for (let row = y; row < y + bh; row++) {
    let count = 0;
    for (let col = colLeft; col <= colRight; col += 2) {
      const i = (row * imgWidth + col) * 4;
      if (isCreamHead(data[i], data[i + 1], data[i + 2])) count++;
    }
    const density = (count * 2) / colSpan;
    if (density > ROW_THRESHOLD) {
      if (headTopY === -1) headTopY = row;
      headBottomY = row;
    }
  }

  if (headTopY === -1) return null;

  return { headTopY, headBottomY, colLeft, colRight };
}

// ── Step 2: Find bottom of dark liquid (glass bottom proxy) ───────────────

function findLiquidBottom(
  data: Uint8ClampedArray,
  imgWidth: number,
  colLeft: number,
  colRight: number,
  searchFrom: number,
  searchTo: number
): number | null {
  const colSpan   = colRight - colLeft + 1;
  const stepX     = Math.max(1, Math.round(colSpan / 10));
  const minFrac   = 0.20;
  const minCount  = Math.max(1, Math.round((colSpan / stepX) * minFrac));

  for (let row = searchTo - 1; row >= searchFrom; row--) {
    let count = 0;
    for (let col = colLeft; col <= colRight; col += stepX) {
      const i = (row * imgWidth + col) * 4;
      if (isGuinnessLiquid(data[i], data[i + 1], data[i + 2])) count++;
    }
    if (count >= minCount) return row;
  }
  return null;
}

// ── Step 3: G logo edge-energy detection ──────────────────────────────────

function detectGLogo(
  data: Uint8ClampedArray,
  imgWidth: number,
  colLeft: number,
  colRight: number,
  glassTopY: number,
  glassBottomY: number
): { y: number; detected: boolean } {
  const glassH  = glassBottomY - glassTopY;
  // G lives in the lower 35–65% of the glass
  const scanTop = Math.round(glassTopY   + glassH * 0.35);
  const scanBot = Math.round(glassBottomY - glassH * 0.10);

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

  if (maxE > meanE * 2.5) {
    return { y: scanTop + maxIdx, detected: true };
  }
  // Geometric fallback: G is 35% up from glass bottom
  return { y: glassBottomY - glassH * 0.35, detected: false };
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * imageData is already cropped to the guide box region.
 * searchBounds is typically { x:0, y:0, width, height } (local coords).
 */
export function analyseGlass(
  imageData: ImageData,
  searchBounds: GlassBounds
): DetectionResult {
  const { data, width } = imageData;

  // 1. Find cream head — primary anchor
  const head = findCreamHead(data, width, searchBounds);

  if (!head) {
    // No cream head found → can't reliably locate the glass
    return {
      glassBounds: null,
      liquidLevelY: null, headTopY: null, headBottomY: null,
      gPositionY: null,
      splitStatus: 'no_liquid',
      confidence: 0,
    };
  }

  const { headTopY, headBottomY, colLeft, colRight } = head;

  // 2. Find bottom of dark liquid in the glass columns
  //    Search from just below the head to the bottom of the search region
  const liquidBottom = findLiquidBottom(
    data, width,
    colLeft, colRight,
    headBottomY,
    searchBounds.y + searchBounds.height
  );

  // Glass top ≈ cream head top, glass bottom ≈ last dark pixel row
  const glassTop    = headTopY;
  const glassBottom = liquidBottom ?? headBottomY;
  const glassHeight = Math.max(1, glassBottom - glassTop);

  // 3. Detect / estimate G position within detected glass
  const { y: gPositionY, detected } = detectGLogo(
    data, width, colLeft, colRight, glassTop, glassBottom
  );

  // 4. Split-the-G check — liquid level = top of cream head
  const tolerance = glassHeight * 0.05;
  const liquidY   = headTopY; // user drinks to the top of the head

  const diff = liquidY - gPositionY; // positive → liquid is BELOW G (too low)
  let splitStatus: DetectionResult['splitStatus'];
  if (Math.abs(diff) <= tolerance)  splitStatus = 'perfect';
  else if (diff < -tolerance)       splitStatus = 'too_high'; // head above G
  else                              splitStatus = 'too_low';  // head below G

  const confidence = liquidBottom !== null
    ? (detected ? 0.85 : 0.65)
    : 0.45;

  return {
    glassBounds: {
      x:      colLeft,
      y:      glassTop,
      width:  colRight - colLeft,
      height: glassHeight,
    },
    liquidLevelY: liquidBottom ?? headBottomY,
    headTopY,
    headBottomY,
    gPositionY,
    splitStatus,
    confidence,
  };
}
