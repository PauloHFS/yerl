import { useEffect, useRef } from 'react';
import type { Participant } from '@/hooks/useWebRTC';

interface VideoTileProps {
  stream: MediaStream | null;
  participant: Participant;
  isLocal?: boolean;
  isMuted?: boolean;
}

export function VideoTile({ stream, participant, isLocal, isMuted }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const initials = participant.name.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative bg-base-300 rounded-lg overflow-hidden aspect-video flex items-center justify-center">
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-2xl font-bold text-white">
          {initials}
        </div>
      )}

      <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/50 rounded px-2 py-0.5 text-xs text-white">
        <span>{participant.name}</span>
        {isLocal && <span className="opacity-60">(Você)</span>}
        {isMuted && <span>🔇</span>}
      </div>
    </div>
  );
}
