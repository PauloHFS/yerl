import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenShareView } from './ScreenShareView';

beforeEach(() => {
  Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', {
    set: vi.fn(),
    get: vi.fn(),
    configurable: true,
  });

  HTMLVideoElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
});

describe('ScreenShareView', () => {
  it('renderiza elemento <video>', () => {
    const stream = new MediaStream();
    const { container } = render(<ScreenShareView stream={stream} sharerName="Pedro" />);
    expect(container.querySelector('video')).toBeInTheDocument();
  });

  it('exibe o nome de quem está compartilhando', () => {
    const stream = new MediaStream();
    render(<ScreenShareView stream={stream} sharerName="Pedro" />);
    expect(screen.getByText(/Pedro está compartilhando/)).toBeInTheDocument();
  });

  it('chama requestFullscreen ao dar duplo clique no vídeo', async () => {
    const stream = new MediaStream();
    const { container } = render(<ScreenShareView stream={stream} sharerName="Pedro" />);
    const video = container.querySelector('video')!;

    await userEvent.dblClick(video);

    expect(HTMLVideoElement.prototype.requestFullscreen).toHaveBeenCalledOnce();
  });
});
