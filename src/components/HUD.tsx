import React from 'react';
import type { DetectionResult } from '../utils/glassDetector';

interface HUDProps {
  result: DetectionResult | null;
  splitConsecutive: number;
  torchSupported: boolean;
  torchOn: boolean;
  onToggleTorch: () => void;
  onReset: () => void;
}

const SPLIT_FRAMES_REQUIRED = 12;

const statusConfig = {
  perfect:    { emoji: '🎯', label: 'Split the G!',    color: '#44FF88', bg: 'rgba(20,80,40,0.85)' },
  too_high:   { emoji: '⬆️', label: 'Too high — keep drinking', color: '#FF6666', bg: 'rgba(80,20,20,0.85)' },
  too_low:    { emoji: '⬇️', label: 'Not there yet',  color: '#66AAFF', bg: 'rgba(20,40,80,0.85)' },
  no_liquid:  { emoji: '🍺', label: 'No Guinness detected — fill it up!', color: '#F0A500', bg: 'rgba(60,40,0,0.85)' },
  unknown:    { emoji: '🔍', label: 'Point camera at a Guinness glass', color: '#aaaaaa', bg: 'rgba(20,20,20,0.75)' },
};

export const HUD: React.FC<HUDProps> = ({
  result,
  splitConsecutive,
  torchSupported,
  torchOn,
  onToggleTorch,
  onReset,
}) => {
  const status = result?.splitStatus ?? 'unknown';
  const cfg = statusConfig[status];
  const confirmed = splitConsecutive >= SPLIT_FRAMES_REQUIRED;

  return (
    <>
      {/* Top-right controls */}
      <div style={{
        position: 'absolute',
        top: 16, right: 16,
        display: 'flex', gap: 10,
        zIndex: 20,
      }}>
        {torchSupported && (
          <button
            onClick={onToggleTorch}
            aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'}
            style={iconBtn}
          >
            {torchOn ? '🔦' : '💡'}
          </button>
        )}
        <button onClick={onReset} aria-label="Reset" style={iconBtn}>
          ↺
        </button>
      </div>

      {/* Top-left title */}
      <div style={{
        position: 'absolute',
        top: 18, left: 18,
        zIndex: 20,
        fontWeight: 700,
        fontSize: 20,
        color: '#F0A500',
        textShadow: '0 1px 6px rgba(0,0,0,0.7)',
        letterSpacing: '0.04em',
      }}>
        SplitDaG
      </div>

      {/* Bottom status bar */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        zIndex: 20,
        background: cfg.bg,
        backdropFilter: 'blur(10px)',
        padding: '16px 20px 28px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        transition: 'background 0.4s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 26 }}>{cfg.emoji}</span>
          <span style={{
            color: cfg.color,
            fontWeight: 700,
            fontSize: confirmed ? 22 : 16,
            textShadow: '0 1px 4px rgba(0,0,0,0.6)',
            transition: 'font-size 0.2s',
          }}>
            {confirmed ? '🎉 SPLIT THE G! 🎉' : cfg.label}
          </span>
        </div>

        {result && status !== 'unknown' && status !== 'no_liquid' && (
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
            Confidence: {Math.round(result.confidence * 100)}%
            {status === 'too_high' || status === 'too_low' ? (
              (() => {
                const gY   = result.gPositionY;
                const lvlY = result.liquidLevelY; // dark body top (below foam)
                const h    = result.glassBounds?.height ?? 1;
                if (gY !== null && lvlY !== null) {
                  const pct = Math.abs(Math.round(((lvlY - gY) / h) * 100));
                  return <span style={{ marginLeft: 8 }}>· {pct}% {status === 'too_high' ? 'above' : 'below'} G</span>;
                }
                return null;
              })()
            ) : null}
          </div>
        )}

        {/* G detection note */}
        {result && result.confidence < 0.65 && status !== 'unknown' && status !== 'no_liquid' && (
          <div style={{ color: 'rgba(255,200,100,0.75)', fontSize: 12, textAlign: 'center' }}>
            G position estimated — works best with the G logo facing camera
          </div>
        )}
      </div>
    </>
  );
};

const iconBtn: React.CSSProperties = {
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(6px)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 10,
  color: '#fff',
  fontSize: 20,
  width: 44,
  height: 44,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
};
