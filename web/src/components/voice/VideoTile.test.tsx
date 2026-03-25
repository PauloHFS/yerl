import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VideoTile } from './VideoTile';
import type { Participant } from '@/hooks/useWebRTC';

const participant: Participant = { id: 'p1', name: 'Carlos Lima' };

// jsdom não implementa srcObject — mockar para evitar erros
beforeEach(() => {
  Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', {
    set: vi.fn(),
    get: vi.fn(),
    configurable: true,
  });
});

describe('VideoTile', () => {
  it('exibe as iniciais quando stream é null (avatar fallback)', () => {
    render(<VideoTile stream={null} participant={participant} />);
    expect(screen.getByText('CA')).toBeInTheDocument();
  });

  it('não exibe avatar quando stream está presente', () => {
    const stream = new MediaStream();
    render(<VideoTile stream={stream} participant={participant} />);
    expect(screen.queryByText('CA')).not.toBeInTheDocument();
  });

  it('renderiza elemento <video> quando stream está presente', () => {
    const stream = new MediaStream();
    const { container } = render(<VideoTile stream={stream} participant={participant} />);
    expect(container.querySelector('video')).toBeInTheDocument();
  });

  it('não renderiza <video> quando stream é null', () => {
    const { container } = render(<VideoTile stream={null} participant={participant} />);
    expect(container.querySelector('video')).not.toBeInTheDocument();
  });

  it('exibe o nome do participante', () => {
    render(<VideoTile stream={null} participant={participant} />);
    expect(screen.getByText('Carlos Lima')).toBeInTheDocument();
  });

  it('exibe "(Você)" quando isLocal=true', () => {
    render(<VideoTile stream={null} participant={participant} isLocal />);
    expect(screen.getByText('(Você)')).toBeInTheDocument();
  });

  it('não exibe "(Você)" quando isLocal=false', () => {
    render(<VideoTile stream={null} participant={participant} isLocal={false} />);
    expect(screen.queryByText('(Você)')).not.toBeInTheDocument();
  });

  it('exibe ícone de mudo quando isMuted=true', () => {
    render(<VideoTile stream={null} participant={participant} isMuted />);
    // O emoji 🔇 está no documento
    expect(screen.getByText('🔇')).toBeInTheDocument();
  });

  it('vídeo local tem propriedade muted=true', () => {
    const stream = new MediaStream();
    const { container } = render(<VideoTile stream={stream} participant={participant} isLocal />);
    const video = container.querySelector('video') as HTMLVideoElement;
    // React define `muted` como propriedade JS, não atributo HTML — verificar via .muted
    expect(video.muted).toBe(true);
  });
});
