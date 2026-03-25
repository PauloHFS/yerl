import { useEffect, useRef } from 'react';
import type { Participant } from '@/hooks/useWebRTC';
import { useSpeakingDetection } from '@/hooks/useSpeakingDetection';
import { VoiceParticipant } from './VoiceParticipant';
import { VideoTile } from './VideoTile';
import { ScreenShareView } from './ScreenShareView';

interface VoiceChannelProps {
  roomName: string;
  participants: Participant[];
  myPeerID: string;
  remoteStreams: MediaStream[];
  localStream: MediaStream | null;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isMuted: boolean;
}

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
  }, [stream]);
  return <audio ref={audioRef} autoPlay hidden />;
}

function isVideoStream(stream: MediaStream): boolean {
  return stream.getVideoTracks().length > 0;
}

function isScreenShareStream(stream: MediaStream): boolean {
  // Heurística: stream com vídeo e sem label de câmera, ou com label "screen"
  return stream.getVideoTracks().some(t =>
    t.label.toLowerCase().includes('screen') ||
    t.label.toLowerCase().includes('display') ||
    t.label.toLowerCase().includes('window') ||
    t.label.toLowerCase().includes('monitor')
  );
}

function LocalSpeakingWrapper({ participant, isLocal, isMuted, localStream }: {
  participant: Participant;
  isLocal: boolean;
  isMuted: boolean;
  localStream: MediaStream | null;
}) {
  const isSpeaking = useSpeakingDetection(isMuted ? null : localStream);
  return <VoiceParticipant participant={participant} isLocal={isLocal} isMuted={isMuted} isSpeaking={isSpeaking} />;
}

export function VoiceChannel({
  roomName,
  participants,
  myPeerID,
  remoteStreams,
  localStream,
  isCameraOn,
  isScreenSharing,
  isMuted,
}: VoiceChannelProps) {
  const screenStreams = remoteStreams.filter(isScreenShareStream);
  const videoStreams = remoteStreams.filter(s => isVideoStream(s) && !isScreenShareStream(s));
  const hasVideo = isCameraOn || videoStreams.length > 0;
  const hasScreenShare = isScreenSharing || screenStreams.length > 0;

  const myParticipant: Participant = {
    id: myPeerID,
    name: participants.find(p => p.id === myPeerID)?.name ?? 'Você',
  };

  // Determina layout: screen-share → focus+sidebar | vídeo → grid | só voz → avatares
  const layout: 'voice' | 'video' | 'screenshare' = hasScreenShare
    ? 'screenshare'
    : hasVideo
    ? 'video'
    : 'voice';

  return (
    <div className="flex flex-col h-full">
      <div className="text-xs opacity-50 px-2 pt-1 pb-2">
        🔊 {roomName} — {participants.length} conectado(s)
      </div>

      {/* Layout Voice-Only: avatares circulares */}
      {layout === 'voice' && (
        <div className="flex-1 flex flex-wrap items-center justify-center gap-4 p-4">
          {participants.map(p =>
            p.id === myPeerID ? (
              <LocalSpeakingWrapper
                key={p.id}
                participant={p}
                isLocal
                isMuted={isMuted}
                localStream={localStream}
              />
            ) : (
              <VoiceParticipant key={p.id} participant={p} isLocal={false} />
            )
          )}
        </div>
      )}

      {/* Layout Video: grid de VideoTiles */}
      {layout === 'video' && (
        <div className="flex-1 grid grid-cols-2 gap-2 p-2 auto-rows-fr">
          {isCameraOn && localStream && (
            <VideoTile
              stream={localStream}
              participant={myParticipant}
              isLocal
              isMuted={isMuted}
            />
          )}
          {videoStreams.map(stream => {
            const streamParticipant = participants.find(p =>
              stream.id.includes(p.id)
            ) ?? { id: stream.id, name: 'Participante' };
            return (
              <VideoTile
                key={stream.id}
                stream={stream}
                participant={streamParticipant}
              />
            );
          })}
          {/* Peers sem vídeo aparecem como avatar */}
          {participants
            .filter(p => p.id !== myPeerID && !videoStreams.some(s => s.id.includes(p.id)))
            .map(p => (
              <VideoTile key={p.id} stream={null} participant={p} />
            ))}
        </div>
      )}

      {/* Layout Screen Share: tela principal + sidebar */}
      {layout === 'screenshare' && (
        <div className="flex-1 flex gap-2 p-2 min-h-0">
          {/* Área principal: primeira tela compartilhada (75%) */}
          <div className="flex-[3] min-h-0">
            {screenStreams[0] ? (
              <ScreenShareView
                stream={screenStreams[0]}
                sharerName={participants.find(p =>
                  screenStreams[0].id.includes(p.id)
                )?.name ?? 'Participante'}
              />
            ) : (
              localStream && isScreenSharing && (
                <ScreenShareView stream={localStream} sharerName="Você" />
              )
            )}
          </div>

          {/* Sidebar: participantes (25%) */}
          <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
            {participants.map(p => (
              <div key={p.id} className="flex items-center gap-2 p-1 rounded bg-base-200 text-xs">
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {p.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="truncate">{p.name}</span>
                {p.id === myPeerID && <span className="opacity-40">(Você)</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Áudio remoto oculto */}
      {remoteStreams
        .filter(s => !isVideoStream(s))
        .map(stream => (
          <RemoteAudio key={stream.id} stream={stream} />
        ))}
    </div>
  );
}
