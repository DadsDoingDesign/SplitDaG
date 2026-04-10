import { useRef, useEffect, useState, useCallback } from 'react';
import { analyseGlass } from '../utils/glassDetector';
import type { GlassBounds, DetectionResult } from '../utils/glassDetector';

export interface GuideBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeGuideBox(canvasW: number, canvasH: number): GuideBox {
  const w = Math.round(canvasW * 0.36);
  const h = Math.round(canvasH * 0.78);
  const x = Math.round((canvasW - w) / 2);
  const y = Math.round(canvasH * 0.07);
  return { x, y, width: w, height: h };
}

export interface UseGlassDetectionReturn {
  result: DetectionResult | null;
  guideBox: GuideBox | null;
  frameCount: number;
  splitConsecutive: number;
}

// ── EMA helpers ───────────────────────────────────────────────────────────

function ema(prev: number | null, next: number | null, alpha: number): number | null {
  if (next === null) return prev;          // keep last known value if detection drops out
  if (prev === null) return next;          // cold start — accept first value immediately
  return prev * (1 - alpha) + next * alpha;
}

function emaBounds(
  prev: GlassBounds | null,
  next: GlassBounds | null,
  alpha: number
): GlassBounds | null {
  if (next === null) return prev;
  if (prev === null) return next;
  return {
    x:      prev.x      * (1 - alpha) + next.x      * alpha,
    y:      prev.y      * (1 - alpha) + next.y      * alpha,
    width:  prev.width  * (1 - alpha) + next.width  * alpha,
    height: prev.height * (1 - alpha) + next.height * alpha,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────

export function useGlassDetection(
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasW: number,
  canvasH: number,
  active: boolean
): UseGlassDetectionReturn {
  const offscreenRef   = useRef<HTMLCanvasElement | null>(null);
  const rafRef         = useRef<number>(0);
  const frameCountRef  = useRef(0);
  const splitConsecRef = useRef(0);

  // ── Smoothed display-space values ──────────────────────────────────────
  // These persist across frames and are updated via EMA so the overlay is stable.
  const smoothed = useRef<{
    glassBounds:  GlassBounds | null;
    gPositionY:   number | null;
    liquidLevelY: number | null;
    headTopY:     number | null;
    headBottomY:  number | null;
  }>({
    glassBounds:  null,
    gPositionY:   null,
    liquidLevelY: null,
    headTopY:     null,
    headBottomY:  null,
  });

  const [result, setResult]                     = useState<DetectionResult | null>(null);
  const [guideBox, setGuideBox]                 = useState<GuideBox | null>(null);
  const [frameCount, setFrameCount]             = useState(0);
  const [splitConsecutive, setSplitConsecutive] = useState(0);

  useEffect(() => {
    if (canvasW === 0 || canvasH === 0) return;
    const pw = Math.round(canvasW / 2);
    const ph = Math.round(canvasH / 2);
    const oc = document.createElement('canvas');
    oc.width = pw; oc.height = ph;
    offscreenRef.current = oc;
    setGuideBox(computeGuideBox(canvasW, canvasH));
    // Reset smoothing on resize
    smoothed.current = { glassBounds: null, gPositionY: null,
      liquidLevelY: null, headTopY: null, headBottomY: null };
  }, [canvasW, canvasH]);

  const runFrame = useCallback(() => {
    const video = videoRef.current;
    const oc    = offscreenRef.current;
    if (!video || !oc || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runFrame);
      return;
    }

    const ctx = oc.getContext('2d', { willReadFrequently: true });
    if (!ctx) { rafRef.current = requestAnimationFrame(runFrame); return; }

    frameCountRef.current += 1;
    if (frameCountRef.current % 3 === 0) {
      ctx.drawImage(video, 0, 0, oc.width, oc.height);

      const gb        = computeGuideBox(oc.width, oc.height);
      const imageData = ctx.getImageData(gb.x, gb.y, gb.width, gb.height);
      const localBounds: GlassBounds = { x: 0, y: 0, width: gb.width, height: gb.height };
      const detection = analyseGlass(imageData, localBounds);

      // ── Translate local → display-canvas coords ─────────────────────────
      const scaleX  = canvasW / oc.width;
      const scaleY  = canvasH / oc.height;
      const offsetX = gb.x * scaleX;
      const offsetY = gb.y * scaleY;

      const rawBounds = detection.glassBounds !== null ? {
        x:      detection.glassBounds.x      * scaleX + offsetX,
        y:      detection.glassBounds.y      * scaleY + offsetY,
        width:  detection.glassBounds.width  * scaleX,
        height: detection.glassBounds.height * scaleY,
      } : null;

      const rawG       = detection.gPositionY   !== null ? detection.gPositionY   * scaleY + offsetY : null;
      const rawLiquid  = detection.liquidLevelY !== null ? detection.liquidLevelY * scaleY + offsetY : null;
      const rawHeadTop = detection.headTopY     !== null ? detection.headTopY     * scaleY + offsetY : null;
      const rawHeadBot = detection.headBottomY  !== null ? detection.headBottomY  * scaleY + offsetY : null;

      // ── Apply EMA smoothing ──────────────────────────────────────────────
      //
      // G position: very slow alpha (0.12) — the G is physically fixed on the
      // glass and should barely move once detected.
      //
      // Liquid level: faster alpha (0.35) — the user is actively drinking, so
      // the level should respond quickly.
      //
      // Glass bounds: moderate alpha (0.20) — prevents outline jitter.
      //
      // When no glass is detected (null raw values), we keep the last known
      // smoothed value so the overlay doesn't vanish on brief detection drops.

      const noGlass = detection.splitStatus === 'no_liquid' && rawBounds === null;
      if (noGlass) {
        // Glass lost — decay smoothing so stale values fade out after ~2s
        // (roughly 20 detection cycles at 10fps). We do this by nudging toward
        // null: just reset immediately for simplicity.
        smoothed.current = { glassBounds: null, gPositionY: null,
          liquidLevelY: null, headTopY: null, headBottomY: null };
      } else {
        smoothed.current.glassBounds  = emaBounds(smoothed.current.glassBounds,  rawBounds,  0.20);
        smoothed.current.gPositionY   = ema(smoothed.current.gPositionY,  rawG,       0.12);
        smoothed.current.liquidLevelY = ema(smoothed.current.liquidLevelY, rawLiquid,  0.35);
        smoothed.current.headTopY     = ema(smoothed.current.headTopY,     rawHeadTop, 0.35);
        smoothed.current.headBottomY  = ema(smoothed.current.headBottomY,  rawHeadBot, 0.35);
      }

      // ── Build smoothed result for the overlay ────────────────────────────
      const s = smoothed.current;
      const smoothedResult: DetectionResult = {
        ...detection,
        glassBounds:  s.glassBounds,
        gPositionY:   s.gPositionY,
        liquidLevelY: s.liquidLevelY,
        headTopY:     s.headTopY,
        headBottomY:  s.headBottomY,
      };

      if (detection.splitStatus === 'perfect') splitConsecRef.current += 1;
      else                                     splitConsecRef.current  = 0;

      setResult(smoothedResult);
      setFrameCount(frameCountRef.current);
      setSplitConsecutive(splitConsecRef.current);
    }

    rafRef.current = requestAnimationFrame(runFrame);
  }, [videoRef, canvasW, canvasH]);

  useEffect(() => {
    if (!active || canvasW === 0) return;
    rafRef.current = requestAnimationFrame(runFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, canvasW, runFrame]);

  return { result, guideBox, frameCount, splitConsecutive };
}
