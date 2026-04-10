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

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setVideoWidth(videoRef.current.videoWidth);
        setVideoHeight(videoRef.current.videoHeight);
      }

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
