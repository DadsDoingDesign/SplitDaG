import React from 'react';

interface PermissionScreenProps {
  state: 'idle' | 'requesting' | 'error';
  errorMessage: string | null;
  onStart: () => void;
}

export const PermissionScreen: React.FC<PermissionScreenProps> = ({
  state,
  errorMessage,
  onStart,
}) => {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'linear-gradient(160deg, #0d0900 0%, #1a0e00 50%, #0d0000 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 28,
      padding: 32,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#fff',
    }}>
      {/* Logo */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 80,
          lineHeight: 1,
          marginBottom: 8,
        }}>
          🍺
        </div>
        <div style={{
          fontSize: 38,
          fontWeight: 900,
          color: '#F0A500',
          letterSpacing: '0.05em',
          textShadow: '0 2px 20px rgba(240,165,0,0.4)',
        }}>
          SplitDaG
        </div>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
          Guinness Glass AR Checker
        </div>
      </div>

      {/* Instructions */}
      <div style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16,
        padding: '20px 24px',
        maxWidth: 340,
        fontSize: 14,
        color: 'rgba(255,255,255,0.75)',
        lineHeight: 1.7,
        textAlign: 'center',
      }}>
        <p style={{ margin: 0 }}>
          Point your camera at a <strong style={{ color: '#F0A500' }}>Guinness glass</strong>.
          Position it in the guide frame and see if your pour splits the&nbsp;G.
        </p>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 24,
          marginTop: 16,
          fontSize: 13,
        }}>
          {['Cream head', 'Dark body', 'G on glass'].map((label, i) => (
            <div key={i} style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>
                {['☁️', '⬛', '🍀'][i]}
              </div>
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Error message */}
      {errorMessage && (
        <div style={{
          background: 'rgba(255,50,50,0.15)',
          border: '1px solid rgba(255,50,50,0.4)',
          borderRadius: 10,
          padding: '12px 18px',
          fontSize: 14,
          color: '#FF9999',
          maxWidth: 320,
          textAlign: 'center',
        }}>
          {errorMessage}
        </div>
      )}

      {/* CTA button */}
      <button
        onClick={onStart}
        disabled={state === 'requesting'}
        style={{
          background: state === 'requesting'
            ? 'rgba(240,165,0,0.3)'
            : 'linear-gradient(135deg, #F0A500, #c97f00)',
          color: state === 'requesting' ? 'rgba(255,255,255,0.5)' : '#1a0900',
          border: 'none',
          borderRadius: 14,
          padding: '16px 40px',
          fontSize: 18,
          fontWeight: 700,
          cursor: state === 'requesting' ? 'not-allowed' : 'pointer',
          letterSpacing: '0.03em',
          boxShadow: state === 'requesting' ? 'none' : '0 4px 24px rgba(240,165,0,0.35)',
          transition: 'all 0.2s',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {state === 'requesting' ? 'Starting camera…' : '📷 Start Scanning'}
      </button>

      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
        Camera stays on your device. Nothing is uploaded.
      </div>
    </div>
  );
};
