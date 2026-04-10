import { useCallback, useEffect, useState } from 'react';
import { useCamera } from './hooks/useCamera';
import { useGlassDetection } from './hooks/useGlassDetection';
import { AROverlay } from './components/AROverlay';
import { HUD } from './components/HUD';
import { PermissionScreen } from './components/PermissionScreen';

export default function App() {
  const {
    videoRef,
    cameraState,
    errorMessage,
    torchSupported,
    torchOn,
    toggleTorch,
    startCamera,
  } = useCamera();

  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => setContainerSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const { result, guideBox, splitConsecutive } = useGlassDetection(
    videoRef,
    containerSize.w,
    containerSize.h,
    cameraState === 'active',
  );

  const handleSplit = useCallback(() => {
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100, 50, 200]);
  }, []);

  const handleReset = useCallback(() => {
    window.location.reload();
  }, []);

  const isActive = cameraState === 'active';

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#000',
      fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/*
        The <video> is ALWAYS rendered so that videoRef.current exists
        when startCamera() assigns srcObject to it. Hidden until active.
      */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%', objectFit: 'cover',
          display: isActive ? 'block' : 'none',
        }}
      />

      {isActive && (
        <>
          <AROverlay
            width={containerSize.w}
            height={containerSize.h}
            result={result}
            guideBox={guideBox}
            splitConsecutive={splitConsecutive}
            onSplit={handleSplit}
          />
          <HUD
            result={result}
            splitConsecutive={splitConsecutive}
            torchSupported={torchSupported}
            torchOn={torchOn}
            onToggleTorch={toggleTorch}
            onReset={handleReset}
          />
        </>
      )}

      {!isActive && (
        <PermissionScreen
          state={cameraState === 'requesting' ? 'requesting' : cameraState === 'error' ? 'error' : 'idle'}
          errorMessage={errorMessage}
          onStart={startCamera}
        />
      )}
    </div>
  );
}
