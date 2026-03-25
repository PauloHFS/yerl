import type { Participant } from '@/hooks/useWebRTC';

interface VoiceParticipantProps {
  participant: Participant;
  isLocal: boolean;
  isMuted?: boolean;
  isSpeaking?: boolean;
}

export function VoiceParticipant({ participant, isLocal, isMuted, isSpeaking }: VoiceParticipantProps) {
  const initials = participant.name.slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={[
          'w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white transition-all',
          'bg-primary',
          isSpeaking ? 'ring-4 ring-success ring-offset-2 ring-offset-base-200' : '',
        ].join(' ')}
      >
        {initials}
      </div>
      <div className="flex items-center gap-1 text-xs">
        <span className="opacity-80">{participant.name}</span>
        {isLocal && <span className="opacity-50">(Você)</span>}
        {isMuted && <span title="Mudo">🔇</span>}
      </div>
    </div>
  );
}
