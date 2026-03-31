import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoiceChannel } from './VoiceChannel';
import type { Participant } from '@/hooks/useWebRTC';

// Mock de useSpeakingDetection para evitar dependência de AudioContext
vi.mock('@/hooks/useSpeakingDetection', () => ({
  useSpeakingDetection: () => false,
}));

// Mock de srcObject para HTMLVideoElement
beforeEach(() => {
  Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', {
    set: vi.fn(),
    get: vi.fn(),
    configurable: true,
  });
  Object.defineProperty(HTMLAudioElement.prototype, 'srcObject', {
    set: vi.fn(),
    get: vi.fn(),
    configurable: true,
  });
});

const participants: Participant[] = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bruno' },
];

const baseProps = {
  roomName: 'sala-de-jogos',
  participants,
  myPeerID: 'p1',
  remoteStreams: [] as MediaStream[],
  localStream: null,
  isCameraOn: false,
  isScreenSharing: false,
  isMuted: false,
};

describe('VoiceChannel', () => {
  describe('layout de voz (sem vídeo e sem screen share)', () => {
    it('exibe o nome da sala', () => {
      render(<VoiceChannel {...baseProps} />);
      expect(screen.getByText(/sala-de-jogos/)).toBeInTheDocument();
    });

    it('exibe a contagem de participantes', () => {
      render(<VoiceChannel {...baseProps} />);
      expect(screen.getByText(/2 conectado/)).toBeInTheDocument();
    });

    it('renderiza avatares de todos os participantes', () => {
      render(<VoiceChannel {...baseProps} />);
      // Iniciais dos participantes
      expect(screen.getByText('AL')).toBeInTheDocument();
      expect(screen.getByText('BR')).toBeInTheDocument();
    });

    it('exibe nome de cada participante', () => {
      render(<VoiceChannel {...baseProps} />);
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bruno')).toBeInTheDocument();
    });
  });

  describe('layout de vídeo', () => {
    it('renderiza VideoTile quando câmera local está ligada', () => {
      const localStream = new MediaStream();
      const { container } = render(
        <VoiceChannel {...baseProps} localStream={localStream} isCameraOn />
      );
      // Deve exibir um elemento <video> para o stream local
      expect(container.querySelector('video')).toBeInTheDocument();
    });
  });

  describe('layout de screen share', () => {
    it('renderiza ScreenShareView quando isScreenSharing=true com localStream', () => {
      const screenStream = new MediaStream();
      // Simula um track de screen share
      const videoTrack = new MediaStreamTrack();
      Object.defineProperty(videoTrack, 'kind', { value: 'video' });
      Object.defineProperty(videoTrack, 'label', { value: 'screen:0:0' });

      render(
        <VoiceChannel
          {...baseProps}
          localStream={screenStream}
          isScreenSharing
        />
      );

      // Quando isScreenSharing=true, o layout screenshare é ativado
      // e exibe a sidebar de participantes
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bruno')).toBeInTheDocument();
    });
  });

  describe('áudio remoto', () => {
    it('não renderiza <audio> quando não há streams remotos de áudio', () => {
      const { container } = render(<VoiceChannel {...baseProps} />);
      expect(container.querySelector('audio')).not.toBeInTheDocument();
    });

    it('renderiza <audio> oculto para streams remotos de áudio (sem tracks de vídeo)', () => {
      // Um MediaStream sem video tracks é tratado como áudio
      const audioStream = new MediaStream();
      const { container } = render(
        <VoiceChannel {...baseProps} remoteStreams={[audioStream]} />
      );
      expect(container.querySelector('audio[hidden]')).toBeInTheDocument();
    });
  });
});
