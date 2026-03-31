import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoiceParticipant } from './VoiceParticipant';
import type { Participant, WebRTCStats } from '@/hooks/useWebRTC';

const participant: Participant = { id: 'p1', name: 'Ana Souza' };

const goodStats: WebRTCStats = {
  latency: 50,
  outbound: { bitrate: 500 },
  inbound: { bitrate: 400, jitter: 2, packetsLost: 0 },
};

const mediumStats: WebRTCStats = {
  latency: 150,
  outbound: { bitrate: 300 },
  inbound: { bitrate: 200, jitter: 10, packetsLost: 2 },
};

const badStats: WebRTCStats = {
  latency: 400,
  outbound: { bitrate: 100 },
  inbound: { bitrate: 50, jitter: 50, packetsLost: 10 },
};

describe('VoiceParticipant', () => {
  it('exibe as iniciais do participante', () => {
    render(<VoiceParticipant participant={participant} isLocal={false} />);
    expect(screen.getByText('AN')).toBeInTheDocument();
  });

  it('exibe o nome completo do participante', () => {
    render(<VoiceParticipant participant={participant} isLocal={false} />);
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
  });

  it('exibe "(Você)" quando isLocal=true', () => {
    render(<VoiceParticipant participant={participant} isLocal />);
    expect(screen.getByText('(Você)')).toBeInTheDocument();
  });

  it('não exibe "(Você)" quando isLocal=false', () => {
    render(<VoiceParticipant participant={participant} isLocal={false} />);
    expect(screen.queryByText('(Você)')).not.toBeInTheDocument();
  });

  it('exibe ícone de mudo quando isMuted=true', () => {
    render(<VoiceParticipant participant={participant} isLocal={false} isMuted />);
    expect(screen.getByTitle('Mudo')).toBeInTheDocument();
  });

  it('não exibe ícone de mudo quando isMuted=false', () => {
    render(<VoiceParticipant participant={participant} isLocal={false} isMuted={false} />);
    expect(screen.queryByTitle('Mudo')).not.toBeInTheDocument();
  });

  it('aplica ring verde ao avatar quando isSpeaking=true', () => {
    const { container } = render(
      <VoiceParticipant participant={participant} isLocal isSpeaking />
    );
    const avatar = container.querySelector('.ring-success');
    expect(avatar).toBeInTheDocument();
  });

  it('não aplica ring verde ao avatar quando isSpeaking=false', () => {
    const { container } = render(
      <VoiceParticipant participant={participant} isLocal isSpeaking={false} />
    );
    const avatar = container.querySelector('.ring-success');
    expect(avatar).not.toBeInTheDocument();
  });

  it('exibe QualityDot verde para boa qualidade (RTT<100, loss=0)', () => {
    const { container } = render(
      <VoiceParticipant participant={participant} isLocal stats={goodStats} />
    );
    const dot = container.querySelector('.bg-success');
    expect(dot).toBeInTheDocument();
  });

  it('exibe QualityDot amarelo para qualidade média (RTT>100)', () => {
    const { container } = render(
      <VoiceParticipant participant={participant} isLocal stats={mediumStats} />
    );
    const dot = container.querySelector('.bg-warning');
    expect(dot).toBeInTheDocument();
  });

  it('exibe QualityDot vermelho para qualidade ruim (RTT>300)', () => {
    const { container } = render(
      <VoiceParticipant participant={participant} isLocal stats={badStats} />
    );
    const dot = container.querySelector('.bg-error');
    expect(dot).toBeInTheDocument();
  });

  it('não exibe QualityDot quando stats é null', () => {
    render(<VoiceParticipant participant={participant} isLocal stats={null} />);
    // sem dot de qualidade — não deve lançar erro e não deve ter title com "qualidade"
    expect(screen.queryByTitle(/qualidade/i)).not.toBeInTheDocument();
  });

  it('não exibe QualityDot para peer remoto (isLocal=false)', () => {
    const { container } = render(
      <VoiceParticipant participant={participant} isLocal={false} stats={goodStats} />
    );
    // QualityDot só é renderizado para peer local
    const dot = container.querySelector('.bg-success');
    expect(dot).not.toBeInTheDocument();
  });
});
