/**
 * glassDetector.ts
 * Computer vision utilities for detecting:
 * - Glass boundaries
 * - Guinness liquid level (dark stout + cream head)
 * - G logo position
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
  liquidLevelY: number | null;   // Y coord of top of dark liquid (below cream head)
  headTopY: number | null;       // Y coord of top of cream head
  headBottomY: number | null;    // Y coord where head meets dark liquid
  gPositionY: number | null;     // Y coord of estimated G logo position
  splitStatus: 'perfect' | 'too_high' | 'too_low' | 'no_liquid' | 'unknown';
  confidence: number;            // 0-1
}

// Pixel color helpers
function isGuinnessLiquid(r: number, g: number, b: number): boolean {
  // Very dark brown/black — classic Guinness colour
  return r < 60 && g < 55 && b < 55 && Math.max(r, g, b) < 70;
}

function isCreamHead(r: number, g: number, b: number): boolean {
  // Off-white / tan / beige — Guinness head is a distinctive creamy tan
  return (
    r > 155 && r < 250 &&
    g > 130 && g < 230 &&
    b > 85  && b < 200 &&
    r > b + 20 &&          // distinctly warmer than blue
    r - g < 70             // not too yellow
  );
}

/**
 * Analyse a column of pixels to find the topmost dark-liquid row and the
 * topmost cream-head row within the glass bounding box.
 */
function analyseColumn(
  data: Uint8ClampedArray,
  imgWidth: number,
  col: number,
  bounds: GlassBounds
): { headTop: number | null; liquidTop: number | null } {
  let headTop: number | null = null;
  let liquidTop: number | null = null;

  for (let row = bounds.y; row < bounds.y + bounds.height; row++) {
    const idx = (row * imgWidth + col) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    if (headTop === null && isCreamHead(r, g, b)) {
      headTop = row;
    }
    if (liquidTop === null && isGuinnessLiquid(r, g, b)) {
      liquidTop = row;
    }
    if (headTop !== null && liquidTop !== null) break;
  }

  return { headTop, liquidTop };
}

/**
 * Detect Guinness liquid level within a given glass bounding box.
 * Returns median estimates across multiple columns for robustness.
 */
export function detectLiquidLevel(
  imageData: ImageData,
  glassBounds: GlassBounds
): { headTopY: number | null; liquidTopY: number | null } {
  const { data, width } = imageData;
  const headTops: number[] = [];
  const liquidTops: number[] = [];

  // Sample every 4 pixels across the inner 60% of the glass width
  const startX = Math.floor(glassBounds.x + glassBounds.width * 0.2);
  const endX   = Math.floor(glassBounds.x + glassBounds.width * 0.8);

  for (let col = startX; col < endX; col += 4) {
    const { headTop, liquidTop } = analyseColumn(data, width, col, glassBounds);
    if (headTop !== null) headTops.push(headTop);
    if (liquidTop !== null) liquidTops.push(liquidTop);
  }

  const median = (arr: number[]) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  return {
    headTopY: median(headTops),
    liquidTopY: median(liquidTops),
  };
}

/**
 * Estimate the G logo Y position.
 * On a real Guinness glass the G sits at roughly 30–40% up from the bottom
 * of the interior — we use 35% as a good average across pint & tulip glasses.
 */
export function estimateGPosition(glassBounds: GlassBounds): number {
  const glassBottom = glassBounds.y + glassBounds.height;
  const glassTop    = glassBounds.y;
  const height      = glassBottom - glassTop;
  // 35% from the bottom = 65% from the top
  return glassTop + height * 0.65;
}

/**
 * Attempt to detect the G logo using edge/brightness analysis.
 * Looks for a cluster of high-contrast pixels in the lower third of the glass.
 * Returns refined Y if found, or falls back to geometric estimate.
 */
export function detectGLogo(
  imageData: ImageData,
  glassBounds: GlassBounds
): { y: number; detected: boolean } {
  const { data, width } = imageData;
  const fallbackY = estimateGPosition(glassBounds);

  // Only scan lower 55% of glass (G is never near the top)
  const scanStartY = Math.floor(glassBounds.y + glassBounds.height * 0.45);
  const scanEndY   = Math.floor(glassBounds.y + glassBounds.height * 0.80);
  const scanStartX = Math.floor(glassBounds.x + glassBounds.width * 0.25);
  const scanEndX   = Math.floor(glassBounds.x + glassBounds.width * 0.75);

  // Build a simple horizontal edge-energy map
  const rowEnergy: number[] = new Array(scanEndY - scanStartY).fill(0);

  for (let row = scanStartY; row < scanEndY; row++) {
    let energy = 0;
    for (let col = scanStartX + 1; col < scanEndX - 1; col++) {
      const leftIdx  = (row * width + (col - 1)) * 4;
      const rightIdx = (row * width + (col + 1)) * 4;

      const lBright = (data[leftIdx]  + data[leftIdx + 1]  + data[leftIdx + 2])  / 3;
      const rBright = (data[rightIdx] + data[rightIdx + 1] + data[rightIdx + 2]) / 3;
      energy += Math.abs(lBright - rBright);
    }
    rowEnergy[row - scanStartY] = energy;
  }

  // Find peak energy row — this often corresponds to printed text/logo edges
  let maxEnergy = 0;
  let maxRow = 0;
  for (let i = 0; i < rowEnergy.length; i++) {
    if (rowEnergy[i] > maxEnergy) {
      maxEnergy = rowEnergy[i];
      maxRow = i;
    }
  }

  // Only trust detection if it's significantly above average (3× mean)
  const meanEnergy = rowEnergy.reduce((a, b) => a + b, 0) / rowEnergy.length;
  if (maxEnergy > meanEnergy * 3) {
    return { y: scanStartY + maxRow, detected: true };
  }

  return { y: fallbackY, detected: false };
}

/**
 * Main detection function — given an ImageData and a glass bounding box,
 * returns a complete DetectionResult.
 */
export function analyseGlass(
  imageData: ImageData,
  glassBounds: GlassBounds
): DetectionResult {
  const { headTopY, liquidTopY } = detectLiquidLevel(imageData, glassBounds);
  const { y: gPositionY, detected } = detectGLogo(imageData, glassBounds);

  // Split-the-G tolerance: liquid top must be within ±6% of glass height from G
  const tolerance = glassBounds.height * 0.06;

  let splitStatus: DetectionResult['splitStatus'] = 'unknown';
  if (liquidTopY === null && headTopY === null) {
    splitStatus = 'no_liquid';
  } else if (gPositionY !== null) {
    const liquidY = headTopY ?? liquidTopY!;
    const diff = liquidY - gPositionY;          // positive = liquid top is BELOW G
    if (Math.abs(diff) <= tolerance) {
      splitStatus = 'perfect';
    } else if (diff < -tolerance) {
      splitStatus = 'too_high';                 // liquid above G
    } else {
      splitStatus = 'too_low';                  // liquid below G
    }
  }

  const confidence = detected ? 0.75 : 0.4;

  return {
    glassBounds,
    liquidLevelY: liquidTopY,
    headTopY,
    headBottomY: liquidTopY,
    gPositionY,
    splitStatus,
    confidence,
  };
}
