import type { Participant, WebRTCStats } from '@/hooks/useWebRTC';

interface VoiceParticipantProps {
  participant: Participant;
  isLocal: boolean;
  isMuted?: boolean;
  isSpeaking?: boolean;
  stats?: WebRTCStats | null;
}

function QualityDot({ stats }: { stats: WebRTCStats | null | undefined }) {
  if (!stats) return null;

  const rtt = stats.latency;
  const loss = stats.inbound.packetsLost;

  let color = 'bg-success';
  let title = 'Boa qualidade';

  if (rtt > 300 || loss > 5) {
    color = 'bg-error';
    title = `Qualidade ruim (RTT ${rtt}ms, perda ${loss} pkts)`;
  } else if (rtt > 100 || loss > 1) {
    color = 'bg-warning';
    title = `Qualidade média (RTT ${rtt}ms, perda ${loss} pkts)`;
  }

  return <span className={`w-2 h-2 rounded-full inline-block ${color}`} title={title} />;
}

export function VoiceParticipant({ participant, isLocal, isMuted, isSpeaking, stats }: VoiceParticipantProps) {
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
        {isLocal && <QualityDot stats={stats} />}
      </div>
    </div>
  );
}
