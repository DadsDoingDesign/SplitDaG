import { useEffect, useRef, useState, useCallback } from 'react';

export type CameraState = 'idle' | 'requesting' | 'active' | 'error';

export interface UseCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  cameraState: CameraState;
  errorMessage: string | null;
  videoWidth: number;
  videoHeight: number;
  torchSupported: boolean;
  torchOn: boolean;
  toggleTorch: () => Promise<void>;
  startCamera: () => Promise<void>;
}

export function useCamera(): UseCameraReturn {
  const videoRef = useRef<HTMLVideoElement>(null!);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const startCamera = useCallback(async () => {
    setCameraState('requesting');
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;

      // Check torch support
      const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
      setTorchSupported(!!caps.torch);

      // Mark active first so the <video> element renders and the ref becomes valid,
      // then attach the stream in the effect below via streamRef.
      setCameraState('active');
    } catch (err) {
      const msg = err instanceof Error
        ? (err.name === 'NotAllowedError' ? 'Camera permission denied. Please allow camera access and refresh.' : err.message)
        : 'Failed to start camera.';
      setErrorMessage(msg);
      setCameraState('error');
    }
  }, []);

  const toggleTorch = useCallback(async () => {
    if (!trackRef.current || !torchSupported) return;
    try {
      await trackRef.current.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet],
      });
      setTorchOn(prev => !prev);
    } catch {
      // Torch toggle failed silently
    }
  }, [torchOn, torchSupported]);

  // Once cameraState flips to 'active' the <video> element is in the DOM.
  // Attach the stream and start playback here, safely after the render.
  useEffect(() => {
    if (cameraState !== 'active') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    video.play().catch(() => {
      // Autoplay blocked — the muted+playsInline combo should prevent this,
      // but catch silently just in case.
    });
  }, [cameraState]);

  // Update dimensions when video metadata loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handler = () => {
      setVideoWidth(video.videoWidth);
      setVideoHeight(video.videoHeight);
    };
    video.addEventListener('loadedmetadata', handler);
    return () => video.removeEventListener('loadedmetadata', handler);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return {
    videoRef,
    cameraState,
    errorMessage,
    videoWidth,
    videoHeight,
    torchSupported,
    torchOn,
    toggleTorch,
    startCamera,
  };
}
