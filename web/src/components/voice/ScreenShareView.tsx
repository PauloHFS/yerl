import { useEffect, useRef } from 'react';

interface ScreenShareViewProps {
  stream: MediaStream;
  sharerName: string;
}

export function ScreenShareView({ stream, sharerName }: ScreenShareViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative bg-black rounded-lg overflow-hidden flex flex-col">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-contain"
        onDoubleClick={(e) => {
          void (e.currentTarget as HTMLVideoElement).requestFullscreen();
        }}
      />
      <div className="absolute top-2 left-2 bg-black/60 rounded px-2 py-0.5 text-xs text-white">
        🖥️ {sharerName} está compartilhando
      </div>
    </div>
  );
}
