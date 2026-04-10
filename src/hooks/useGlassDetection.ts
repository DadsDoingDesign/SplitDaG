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
 * Computes the guide box (where the user should position their glass)
 * relative to the canvas dimensions.
 */
export function computeGuideBox(canvasW: number, canvasH: number): GuideBox {
  // Portrait-optimised: 55% width, 72% height, centred slightly above mid
  const w = Math.round(canvasW * 0.55);
  const h = Math.round(canvasH * 0.72);
  const x = Math.round((canvasW - w) / 2);
  const y = Math.round(canvasH * 0.09);
  return { x, y, width: w, height: h };
}

export interface UseGlassDetectionReturn {
  result: DetectionResult | null;
  guideBox: GuideBox | null;
  frameCount: number;
  splitConsecutive: number;
}

/**
 * Runs the glass CV pipeline on each animation frame.
 * Reads pixels from the video element into an offscreen canvas,
 * then calls analyseGlass() with the guide box as the bounding box.
 */
export function useGlassDetection(
  videoRef: React.RefObject<HTMLVideoElement>,
  canvasW: number,
  canvasH: number,
  active: boolean
): UseGlassDetectionReturn {
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const frameCountRef = useRef(0);
  const splitConsecRef = useRef(0);

  const [result, setResult] = useState<DetectionResult | null>(null);
  const [guideBox, setGuideBox] = useState<GuideBox | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [splitConsecutive, setSplitConsecutive] = useState(0);

  // Build/rebuild offscreen canvas whenever dimensions change
  useEffect(() => {
    if (canvasW === 0 || canvasH === 0) return;

    // Process at 50% resolution for performance
    const pw = Math.round(canvasW / 2);
    const ph = Math.round(canvasH / 2);

    const oc = document.createElement('canvas');
    oc.width = pw;
    oc.height = ph;
    offscreenRef.current = oc;

    setGuideBox(computeGuideBox(pw, ph));
  }, [canvasW, canvasH]);

  const runFrame = useCallback(() => {
    const video = videoRef.current;
    const oc = offscreenRef.current;
    if (!video || !oc || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runFrame);
      return;
    }

    const ctx = oc.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(runFrame);
      return;
    }

    frameCountRef.current += 1;
    // Run full detection every 3 frames (~10fps on 30fps stream) to stay smooth
    if (frameCountRef.current % 3 === 0) {
      ctx.drawImage(video, 0, 0, oc.width, oc.height);

      const gb = computeGuideBox(oc.width, oc.height);
      const imageData = ctx.getImageData(gb.x, gb.y, gb.width, gb.height);

      // analyseGlass expects coords relative to imageData, so pass offset-adjusted bounds
      const localBounds: GlassBounds = {
        x: 0, y: 0,
        width: gb.width,
        height: gb.height,
      };

      const detection = analyseGlass(imageData, localBounds);

      // Translate detection Y coordinates back to full canvas space
      const scaleX = canvasW / oc.width;
      const scaleY = canvasH / oc.height;
      const offsetX = gb.x * scaleX;
      const offsetY = gb.y * scaleY;

      const translated: DetectionResult = {
        ...detection,
        glassBounds: {
          x: offsetX,
          y: offsetY,
          width: gb.width * scaleX,
          height: gb.height * scaleY,
        },
        liquidLevelY: detection.liquidLevelY !== null
          ? detection.liquidLevelY * scaleY + offsetY : null,
        headTopY: detection.headTopY !== null
          ? detection.headTopY * scaleY + offsetY : null,
        headBottomY: detection.headBottomY !== null
          ? detection.headBottomY * scaleY + offsetY : null,
        gPositionY: detection.gPositionY !== null
          ? detection.gPositionY * scaleY + offsetY : null,
      };

      // Track consecutive split frames
      if (detection.splitStatus === 'perfect') {
        splitConsecRef.current += 1;
      } else {
        splitConsecRef.current = 0;
      }

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
