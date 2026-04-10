import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { DetectionResult } from '../utils/glassDetector';
import type { GuideBox } from '../hooks/useGlassDetection';
import {
  drawGLine,
  drawLiquidLine,
  drawDeltaArrow,
  drawGuideBox,
  drawSplitFlash,
  drawConfetti,
  updateConfetti,
  spawnConfetti,
} from '../utils/canvasUtils';
import type { ConfettiParticle } from '../utils/canvasUtils';

interface AROverlayProps {
  width: number;
  height: number;
  result: DetectionResult | null;
  guideBox: GuideBox | null;
  splitConsecutive: number;
  /** Fires once when the split is first confirmed */
  onSplit?: () => void;
}

const SPLIT_FRAMES_REQUIRED = 12;

export const AROverlay: React.FC<AROverlayProps> = ({
  width, height, result, guideBox, splitConsecutive, onSplit,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const dashOffsetRef = useRef(0);
  const pulseRef = useRef(0);
  const splitFlashRef = useRef(0);          // 0-1 flash alpha, decays each frame
  const confettiRef = useRef<ConfettiParticle[]>([]);
  const splitFiredRef = useRef(false);
  const [_splitConfirmed, setSplitConfirmed] = useState(false);

  // Stable refs for latest props (avoid re-creating rAF callback)
  const resultRef = useRef(result);
  const guideBoxRef = useRef(guideBox);
  const splitConsecRef = useRef(splitConsecutive);
  const onSplitRef = useRef(onSplit);

  useEffect(() => { resultRef.current = result; }, [result]);
  useEffect(() => { guideBoxRef.current = guideBox; }, [guideBox]);
  useEffect(() => { splitConsecRef.current = splitConsecutive; }, [splitConsecutive]);
  useEffect(() => { onSplitRef.current = onSplit; }, [onSplit]);

  // Trigger confetti / flash when split is confirmed
  useEffect(() => {
    if (splitConsecutive >= SPLIT_FRAMES_REQUIRED && !splitFiredRef.current) {
      splitFiredRef.current = true;
      setSplitConfirmed(true);
      splitFlashRef.current = 0.35;
      const cx = resultRef.current?.glassBounds
        ? resultRef.current.glassBounds.x + resultRef.current.glassBounds.width / 2
        : width / 2;
      const cy = resultRef.current?.gPositionY ?? height / 2;
      confettiRef.current = spawnConfetti(cx, cy, 80);
      onSplitRef.current?.();
    }
    if (splitConsecutive === 0) {
      splitFiredRef.current = false;
      setSplitConfirmed(false);
    }
  }, [splitConsecutive, width, height]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const r = resultRef.current;
    const gb = guideBoxRef.current;
    const sc = splitConsecRef.current;

    // Animate counters
    dashOffsetRef.current += 0.6;
    pulseRef.current = (Math.sin(Date.now() / 600) + 1) / 2;

    // ── Bracket / hitbox — tracks detected glass, falls back to fixed guide ────
    //
    // When a glass is detected, the corner brackets snap to the detected glass
    // bounds (with a small padding), so they follow zoom and movement.
    // When no glass is found, show the fixed guide so the user knows where to aim.
    const hasGlass = r !== null && r.glassBounds !== null;
    const BRACKET_PAD = 12; // px gap between glass edge and bracket corner

    if (hasGlass && r!.glassBounds) {
      const b = r!.glassBounds;
      drawGuideBox(ctx, {
        x:      b.x      - BRACKET_PAD,
        y:      b.y      - BRACKET_PAD,
        width:  b.width  + BRACKET_PAD * 2,
        height: b.height + BRACKET_PAD * 2,
        hasGlass: true,
        pulse:    pulseRef.current,
      });
    } else if (gb) {
      drawGuideBox(ctx, {
        x: gb.x, y: gb.y,
        width: gb.width, height: gb.height,
        hasGlass: false,
        pulse: pulseRef.current,
      });
    }

    if (r && r.glassBounds) {
      const { glassBounds: bounds, gPositionY, liquidLevelY, headTopY, headBottomY, splitStatus } = r;
      const left  = bounds.x;
      const right = bounds.x + bounds.width;

      // ── Foam zone indicator ──────────────────────────────────────────────────
      if (headTopY !== null && headBottomY !== null && headBottomY > headTopY) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 220, 100, 0.10)';
        ctx.fillRect(left, headTopY, bounds.width, headBottomY - headTopY);
        ctx.restore();
      }

      // ── G-position line ──────────────────────────────────────────────────────
      if (gPositionY !== null) {
        drawGLine(ctx, {
          y: gPositionY,
          left, right,
          detected: r.confidence > 0.65,
          animOffset: dashOffsetRef.current,
        });
      }

      // ── Liquid level line (dark body top — below foam) ───────────────────────
      const lvlY = liquidLevelY;
      if (lvlY !== null && splitStatus !== 'no_liquid') {
        drawLiquidLine(ctx, { y: lvlY, left, right, status: splitStatus });
      }

      // ── Delta arrow ──────────────────────────────────────────────────────────
      if (gPositionY !== null && lvlY !== null &&
          splitStatus !== 'no_liquid' && splitStatus !== 'unknown') {
        drawDeltaArrow(ctx, gPositionY, lvlY, left - 20, bounds.height);
      }
    } else if (r && r.gPositionY !== null && r.splitStatus === 'no_liquid' && gb) {
      drawGLine(ctx, {
        y: r.gPositionY,
        left: gb.x, right: gb.x + gb.width,
        detected: false,
        animOffset: dashOffsetRef.current,
      });
    }

    // ── Split celebration ─────────────────────────────────────────────────────
    if (splitFlashRef.current > 0) {
      drawSplitFlash(ctx, canvas.width, canvas.height, splitFlashRef.current);
      splitFlashRef.current = Math.max(0, splitFlashRef.current - 0.012);
    }

    if (confettiRef.current.length > 0) {
      drawConfetti(ctx, confettiRef.current);
      confettiRef.current = updateConfetti(confettiRef.current, canvas.width, canvas.height);
    }

    // ── "SPLIT THE G!" text ───────────────────────────────────────────────────
    if (sc >= SPLIT_FRAMES_REQUIRED) {
      const scale = 1 + 0.06 * Math.sin(Date.now() / 200);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height * 0.22);
      ctx.scale(scale, scale);
      ctx.font = 'bold 42px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#44FF88';
      ctx.fillText('SPLIT THE G!', 0, 0);
      ctx.restore();
    }

    animRef.current = requestAnimationFrame(draw);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        top: 0, left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
};
