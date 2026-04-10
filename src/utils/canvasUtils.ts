/**
 * canvasUtils.ts
 * AR overlay drawing utilities.
 * All coordinates are in canvas pixels (matching video dimensions).
 */

export interface DrawGLineOptions {
  y: number;
  left: number;
  right: number;
  detected: boolean;
  animOffset: number; // increments each frame to animate dashes
}

export interface DrawLiquidLineOptions {
  y: number;
  left: number;
  right: number;
  status: 'perfect' | 'too_high' | 'too_low' | 'no_liquid' | 'unknown';
}

export interface DrawGuideBoxOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  hasGlass: boolean;
  pulse: number; // 0-1, animates the guide when scanning
}

const COLOURS = {
  gold: '#F0A500',
  green: '#44FF88',
  red: '#FF4444',
  blue: '#66AAFF',
  white: 'rgba(255,255,255,0.9)',
  glassOutline: 'rgba(100, 200, 255, 0.6)',
  guideActive: 'rgba(100, 200, 255, 0.8)',
  guideIdle: 'rgba(255, 255, 255, 0.35)',
};

/** Draw the G-position dashed line with a gold "G" badge. */
export function drawGLine(ctx: CanvasRenderingContext2D, opts: DrawGLineOptions) {
  const { y, left, right, detected, animOffset } = opts;

  ctx.save();
  ctx.strokeStyle = COLOURS.gold;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([12, 6]);
  ctx.lineDashOffset = -animOffset;
  ctx.globalAlpha = detected ? 1 : 0.6;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.stroke();

  // Badge on right side
  const badgeX = right + 8;
  const badgeR = 14;
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = COLOURS.gold;
  ctx.beginPath();
  ctx.arc(badgeX + badgeR, y, badgeR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#1a0a00';
  ctx.font = `bold ${badgeR * 1.3}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('G', badgeX + badgeR, y + 1);

  if (!detected) {
    ctx.fillStyle = 'rgba(240,165,0,0.7)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('est.', badgeX + badgeR * 2 + 4, y + 1);
  }

  ctx.restore();
}

/** Draw the liquid-level line with colour-coded status. */
export function drawLiquidLine(ctx: CanvasRenderingContext2D, opts: DrawLiquidLineOptions) {
  const { y, left, right, status } = opts;

  const color =
    status === 'perfect' ? COLOURS.green :
    status === 'too_high' ? COLOURS.red :
    status === 'too_low'  ? COLOURS.blue :
    'rgba(255,255,255,0.5)';

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.stroke();

  // Droplet on left side
  const dropX = left - 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(dropX, y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Draw the connecting arrow between G line and liquid line. */
export function drawDeltaArrow(
  ctx: CanvasRenderingContext2D,
  gY: number,
  liquidY: number,
  x: number,
  glassHeight: number
) {
  const diff = Math.abs(gY - liquidY);
  const pct = Math.round((diff / glassHeight) * 100);
  const top = Math.min(gY, liquidY);
  const bot = Math.max(gY, liquidY);
  const midX = x;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);

  ctx.beginPath();
  ctx.moveTo(midX, top);
  ctx.lineTo(midX, bot);
  ctx.stroke();

  // Arrow heads
  ctx.setLineDash([]);
  const ah = 7;
  ctx.beginPath();
  ctx.moveTo(midX - ah / 2, top + ah);
  ctx.lineTo(midX, top);
  ctx.lineTo(midX + ah / 2, top + ah);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(midX - ah / 2, bot - ah);
  ctx.lineTo(midX, bot);
  ctx.lineTo(midX + ah / 2, bot - ah);
  ctx.stroke();

  // Percentage label
  if (diff > 20) {
    const labelY = (top + bot) / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.roundRect(midX + 6, labelY - 10, 44, 20, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${pct}%`, midX + 10, labelY);
  }

  ctx.restore();
}

/** Draw the glass outline (two vertical lines + optional top arc). */
export function drawGlassOutline(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  alpha = 0.55
) {
  ctx.save();
  ctx.strokeStyle = COLOURS.glassOutline;
  ctx.lineWidth = 2;
  ctx.globalAlpha = alpha;
  ctx.setLineDash([6, 4]);

  // Left edge
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();

  // Right edge
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.stroke();

  ctx.restore();
}

/** Draw the positioning guide (corner brackets) used when glass isn't locked. */
export function drawGuideBox(ctx: CanvasRenderingContext2D, opts: DrawGuideBoxOptions) {
  const { x, y, width, height, hasGlass, pulse } = opts;
  const cornerLen = 28;
  const r = 6;
  const color = hasGlass ? COLOURS.guideActive : COLOURS.guideIdle;
  const alpha = hasGlass ? 0.9 : 0.45 + 0.2 * pulse;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = alpha;
  ctx.setLineDash([]);
  ctx.lineCap = 'round';

  const corners: [number, number, number, number, number, number, number, number][] = [
    // top-left
    [x + r, y, x + cornerLen, y, x, y, x, y + cornerLen],
    // top-right
    [x + width - cornerLen, y, x + width - r, y, x + width, y, x + width, y + cornerLen],
    // bottom-left
    [x, y + height - cornerLen, x, y + height - r, x, y + height, x + cornerLen, y + height],
    // bottom-right
    [x + width - cornerLen, y + height, x + width - r, y + height, x + width, y + height, x + width, y + height - cornerLen],
  ];

  for (const [hx1, hy1, hx2, hy2, cx, cy, vx2, vy2] of corners) {
    ctx.beginPath();
    ctx.moveTo(hx1, hy1);
    ctx.lineTo(hx2, hy2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(vx2, vy2);
    ctx.stroke();
  }

  ctx.restore();
}

/** Draw a celebration flash when split is achieved. */
export function drawSplitFlash(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLOURS.green;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Draw tiny confetti particles for split celebration. */
export interface ConfettiParticle {
  x: number; y: number; vx: number; vy: number;
  color: string; size: number; rotation: number; rotV: number;
}

export function updateConfetti(particles: ConfettiParticle[], w: number, h: number): ConfettiParticle[] {
  return particles
    .map(p => ({
      ...p,
      x: p.x + p.vx,
      y: p.y + p.vy,
      vy: p.vy + 0.12,
      rotation: p.rotation + p.rotV,
    }))
    .filter(p => p.y < h + 20 && p.x > -20 && p.x < w + 20);
}

export function spawnConfetti(cx: number, cy: number, count = 60): ConfettiParticle[] {
  const colors = [COLOURS.gold, COLOURS.green, '#fff', '#FF8800', '#44AAFF'];
  return Array.from({ length: count }, () => ({
    x: cx + (Math.random() - 0.5) * 40,
    y: cy + (Math.random() - 0.5) * 20,
    vx: (Math.random() - 0.5) * 7,
    vy: (Math.random() - 0.5) * 7 - 3,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: 4 + Math.random() * 6,
    rotation: Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.3,
  }));
}

export function drawConfetti(ctx: CanvasRenderingContext2D, particles: ConfettiParticle[]) {
  for (const p of particles) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    ctx.restore();
  }
}
