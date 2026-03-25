import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ControlBar } from './ControlBar';

const defaultProps = {
  username: 'João Silva',
  isMuted: false,
  isCameraOn: false,
  isScreenSharing: false,
  onToggleMute: vi.fn(),
  onToggleCamera: vi.fn(),
  onToggleScreenShare: vi.fn(),
  onLeave: vi.fn(),
};

describe('ControlBar', () => {
  it('exibe as iniciais do usuário', () => {
    render(<ControlBar {...defaultProps} />);
    expect(screen.getByText('JO')).toBeInTheDocument();
  });

  it('exibe o nome completo do usuário', () => {
    render(<ControlBar {...defaultProps} />);
    expect(screen.getByText('João Silva')).toBeInTheDocument();
  });

  it('renderiza os 4 botões de controle', () => {
    render(<ControlBar {...defaultProps} />);
    expect(screen.getByTitle('Mutar microfone')).toBeInTheDocument();
    expect(screen.getByTitle('Ligar câmera')).toBeInTheDocument();
    expect(screen.getByTitle('Compartilhar tela')).toBeInTheDocument();
    expect(screen.getByTitle('Sair da chamada')).toBeInTheDocument();
  });

  it('chama onToggleMute ao clicar no botão de microfone', async () => {
    const onToggleMute = vi.fn();
    render(<ControlBar {...defaultProps} onToggleMute={onToggleMute} />);

    await userEvent.click(screen.getByTitle('Mutar microfone'));
    expect(onToggleMute).toHaveBeenCalledOnce();
  });

  it('chama onToggleCamera ao clicar no botão de câmera', async () => {
    const onToggleCamera = vi.fn();
    render(<ControlBar {...defaultProps} onToggleCamera={onToggleCamera} />);

    await userEvent.click(screen.getByTitle('Ligar câmera'));
    expect(onToggleCamera).toHaveBeenCalledOnce();
  });

  it('chama onToggleScreenShare ao clicar no botão de compartilhamento', async () => {
    const onToggleScreenShare = vi.fn();
    render(<ControlBar {...defaultProps} onToggleScreenShare={onToggleScreenShare} />);

    await userEvent.click(screen.getByTitle('Compartilhar tela'));
    expect(onToggleScreenShare).toHaveBeenCalledOnce();
  });

  it('chama onLeave ao clicar no botão de sair', async () => {
    const onLeave = vi.fn();
    render(<ControlBar {...defaultProps} onLeave={onLeave} />);

    await userEvent.click(screen.getByTitle('Sair da chamada'));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('botão de microfone exibe estado mutado', () => {
    render(<ControlBar {...defaultProps} isMuted title="Desmutar" />);
    // Quando mutado, o title do botão muda para "Desmutar"
    expect(screen.getByTitle('Desmutar')).toBeInTheDocument();
  });

  it('botão de câmera exibe título correto quando câmera ligada', () => {
    render(<ControlBar {...defaultProps} isCameraOn />);
    expect(screen.getByTitle('Desligar câmera')).toBeInTheDocument();
  });

  it('botão de screen share exibe título correto quando compartilhando', () => {
    render(<ControlBar {...defaultProps} isScreenSharing />);
    expect(screen.getByTitle('Parar compartilhamento')).toBeInTheDocument();
  });
});
