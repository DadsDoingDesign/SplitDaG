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
  const colSpan  = colRight - colLeft + 1;
  const stepX    = Math.max(1, Math.round(colSpan / 10));
  const minFrac  = 0.20;
  const minCount = Math.max(1, Math.round((colSpan / stepX) * minFrac));

  // Scan TOP-DOWN and stop as soon as the dark content ends.
  // This prevents the dark bar/table surface below the glass from
  // being counted as the glass bottom.
  // Allow up to MAX_GAP consecutive non-dark rows (glass base is clear,
  // reflections can cause brief gaps).
  const MAX_GAP = 6;
  let lastDarkRow:    number | null = null;
  let consecutiveGap = 0;

  for (let row = searchFrom; row < searchTo; row++) {
    let count = 0;
    for (let col = colLeft; col <= colRight; col += stepX) {
      const i = (row * imgWidth + col) * 4;
      if (isGuinnessLiquid(data[i], data[i + 1], data[i + 2])) count++;
    }
    if (count >= minCount) {
      lastDarkRow    = row;
      consecutiveGap = 0;
    } else {
      consecutiveGap++;
      // Once dark content ends for more than MAX_GAP rows we've left the glass
      if (lastDarkRow !== null && consecutiveGap > MAX_GAP) break;
    }
  }

  return lastDarkRow;
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

  // Glass base = bottom of dark liquid (reliable proxy)
  const glassBottom = liquidBottom ?? headBottomY;

  // ── G position: anchored to glass WIDTH, not liquid height ────────────────
  //
  // The Guinness G logo is a fixed physical feature of the glass.
  // On a standard pint glass the G sits ~0.87 × glass-width above the base.
  // Using glass width as the scale reference means the G line stays stable
  // whether the glass is full, half-drunk, or the foam is thick or thin.
  //
  // Guinness pint geometry (approx):
  //   glass width at widest (≈ where foam is): ~80 mm
  //   G height from base:                      ~70 mm
  //   ratio = 70 / 80 ≈ 0.87
  const glassWidth  = colRight - colLeft;
  const G_RATIO     = 0.87; // tuned for a standard Guinness pint glass

  // 3. Edge-energy G detection, then fall back to width-based estimate
  const { y: gPositionY, detected } = detectGLogo(
    data, width, colLeft, colRight,
    headTopY,   // scan starts at foam top
    glassBottom
  );

  // If the edge detector didn't fire, use the width-based geometric estimate
  const gY = detected
    ? gPositionY
    : glassBottom - glassWidth * G_RATIO;

  // ── Split-the-G check ─────────────────────────────────────────────────────
  //
  // Liquid level = TOP OF THE DARK BODY (headBottomY), i.e. below the foam.
  // "Splitting the G" means the dark Guinness surface is level with the G —
  // not the foam top, which changes as the head settles.
  const darkBodyTop = headBottomY; // foam bottom = dark liquid surface
  const refHeight   = glassWidth * G_RATIO; // same scale as G estimate
  const tolerance   = refHeight * 0.06;    // ±6% of G-height

  const diff = darkBodyTop - gY; // positive → dark surface is BELOW G (too low)
  let splitStatus: DetectionResult['splitStatus'];
  if (Math.abs(diff) <= tolerance) splitStatus = 'perfect';
  else if (diff < -tolerance)      splitStatus = 'too_high'; // dark body above G
  else                             splitStatus = 'too_low';  // dark body below G

  const confidence = liquidBottom !== null
    ? (detected ? 0.85 : 0.65)
    : 0.45;

  return {
    glassBounds: {
      x:      colLeft,
      y:      headTopY,
      width:  glassWidth,
      height: Math.max(1, glassBottom - headTopY),
    },
    // liquidLevelY = dark body top (used for the split-line display)
    liquidLevelY: darkBodyTop,
    headTopY,
    headBottomY,
    gPositionY: gY,
    splitStatus,
    confidence,
  };
}
