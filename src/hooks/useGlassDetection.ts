import { useRef, useEffect, useState, useCallback } from 'react';
import { analyseGlass } from '../utils/glassDetector';
import type { GlassBounds, DetectionResult } from '../utils/glassDetector';

export interface GuideBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Guide box where the user should position their glass.
 * Narrower than before (36% wide) to better match a pint glass aspect ratio
 * and reduce false positives from background content.
 */
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

export function useGlassDetection(
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasW: number,
  canvasH: number,
  active: boolean
): UseGlassDetectionReturn {
  const offscreenRef    = useRef<HTMLCanvasElement | null>(null);
  const rafRef          = useRef<number>(0);
  const frameCountRef   = useRef(0);
  const splitConsecRef  = useRef(0);

  const [result, setResult]                   = useState<DetectionResult | null>(null);
  const [guideBox, setGuideBox]               = useState<GuideBox | null>(null);
  const [frameCount, setFrameCount]           = useState(0);
  const [splitConsecutive, setSplitConsecutive] = useState(0);

  useEffect(() => {
    if (canvasW === 0 || canvasH === 0) return;

    // Offscreen canvas at 50% resolution for faster pixel reads
    const pw = Math.round(canvasW / 2);
    const ph = Math.round(canvasH / 2);
    const oc = document.createElement('canvas');
    oc.width  = pw;
    oc.height = ph;
    offscreenRef.current = oc;

    // BUG FIX: guideBox must be in FULL canvas coords for the overlay to draw correctly
    setGuideBox(computeGuideBox(canvasW, canvasH));
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

      // Guide box at PROCESSING resolution (50%)
      const gb = computeGuideBox(oc.width, oc.height);
      const imageData = ctx.getImageData(gb.x, gb.y, gb.width, gb.height);

      // analyseGlass works in local imageData coords (origin = top-left of guide box)
      const localBounds: GlassBounds = { x: 0, y: 0, width: gb.width, height: gb.height };
      const detection = analyseGlass(imageData, localBounds);

      // Scale factor from processing resolution → display resolution
      const scaleX  = canvasW / oc.width;   // = 2
      const scaleY  = canvasH / oc.height;  // = 2
      // Offset: guide box top-left in DISPLAY canvas coords
      const offsetX = gb.x * scaleX;
      const offsetY = gb.y * scaleY;

      // Translate all local coords back to full canvas space
      const translated: DetectionResult = {
        ...detection,
        // BUG FIX: use detection.glassBounds (detected glass region), not guide box dims
        glassBounds: detection.glassBounds !== null ? {
          x:      detection.glassBounds.x      * scaleX + offsetX,
          y:      detection.glassBounds.y      * scaleY + offsetY,
          width:  detection.glassBounds.width  * scaleX,
          height: detection.glassBounds.height * scaleY,
        } : null,
        liquidLevelY: detection.liquidLevelY !== null
          ? detection.liquidLevelY * scaleY + offsetY : null,
        headTopY: detection.headTopY !== null
          ? detection.headTopY * scaleY + offsetY : null,
        headBottomY: detection.headBottomY !== null
          ? detection.headBottomY * scaleY + offsetY : null,
        gPositionY: detection.gPositionY !== null
          ? detection.gPositionY * scaleY + offsetY : null,
      };

      if (detection.splitStatus === 'perfect') splitConsecRef.current += 1;
      else                                     splitConsecRef.current  = 0;

      setResult(translated);
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
