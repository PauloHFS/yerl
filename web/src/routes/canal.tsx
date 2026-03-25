import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useCallback } from 'react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { VoiceChannel } from '@/components/voice/VoiceChannel';
import { ControlBar } from '@/components/voice/ControlBar';

export const Route = createFileRoute('/canal')({
  component: CanalPage,
  validateSearch: (search: Record<string, unknown>): { name?: string } => {
    return {
      name: typeof search.name === 'string' ? search.name : undefined,
    };
  },
});

function CanalPage() {
  const { name } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [roomInput, setRoomInput] = useState(name ?? '');
  const [username, setUsername] = useState(() => localStorage.getItem('yerl_username') ?? '');
  const [hasJoined, setHasJoined] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const {
    connect,
    disconnect,
    connected,
    remoteStreams,
    localStream,
    isMuted,
    isCameraOn,
    isScreenSharing,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
    stats,
    participants,
    myPeerID,
  } = useWebRTC(name ?? '', username);

  useEffect(() => {
    if (name && hasJoined && !connected) {
      void connect();
    }
  }, [name, hasJoined, connected, connect]);

  const handleJoin = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!roomInput.trim() || !username.trim()) return;

    localStorage.setItem('yerl_username', username);

    if (name !== roomInput) {
      void navigate({ search: { name: roomInput } });
    }

    setHasJoined(true);
  }, [roomInput, username, name, navigate]);

  const handleLeave = useCallback(() => {
    disconnect();
    setHasJoined(false);
    void navigate({ search: {} });
  }, [disconnect, navigate]);

  const handleToggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      await startScreenShare();
    }
  }, [isScreenSharing, startScreenShare, stopScreenShare]);

  if (hasJoined) {
    return (
      <div className="flex h-screen bg-base-200">
        {/* Sidebar estilo Discord */}
        <div className="w-60 bg-base-100 flex flex-col shadow-xl">
          {/* Header da sala */}
          <div className="px-3 py-2 border-b border-base-300">
            <h2 className="font-bold text-sm">🔊 {name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-success' : 'bg-warning'}`} />
              <span className="text-xs opacity-60">{connected ? 'Conectado' : 'Conectando...'}</span>
            </div>
          </div>

          {/* Canal de voz */}
          <div className="flex-1 overflow-y-auto">
            <VoiceChannel
              roomName={name ?? ''}
              participants={participants}
              myPeerID={myPeerID}
              remoteStreams={remoteStreams}
              localStream={localStream}
              isCameraOn={isCameraOn}
              isScreenSharing={isScreenSharing}
              isMuted={isMuted}
            />
          </div>

          {/* ControlBar no rodapé — Discord style */}
          <ControlBar
            username={username}
            isMuted={isMuted}
            isCameraOn={isCameraOn}
            isScreenSharing={isScreenSharing}
            onToggleMute={toggleMute}
            onToggleCamera={() => { void toggleCamera(); }}
            onToggleScreenShare={() => { void handleToggleScreenShare(); }}
            onLeave={handleLeave}
          />
        </div>

        {/* Área principal */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center opacity-40">
            <p className="text-4xl mb-4">💬</p>
            <p className="text-sm">Área de conteúdo</p>
          </div>

          {/* Debug stats */}
          <div className="absolute bottom-4 right-4">
            <button
              type="button"
              onClick={() => setShowDebug(!showDebug)}
              className="btn btn-xs btn-ghost opacity-40 hover:opacity-100"
            >
              {showDebug ? 'Fechar debug' : 'Debug'}
            </button>

            {showDebug && stats && (
              <div className="mt-2 p-3 bg-base-100 rounded-lg text-left text-xs font-mono shadow-lg">
                <p className="font-bold text-primary mb-1">WebRTC Stats</p>
                <p>RTT: {stats.latency}ms</p>
                <p>Upload: {stats.outbound.bitrate} kbps</p>
                <p>Download: {stats.inbound.bitrate} kbps</p>
                <p>Jitter: {stats.inbound.jitter}ms</p>
                <p>Perda: {stats.inbound.packetsLost} pkts</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Tela de entrada
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-base-200 p-4">
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title mb-4">Entrar em Canal de Voz</h2>
          <form onSubmit={handleJoin} className="flex flex-col gap-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text">Seu Nome</span>
              </label>
              <input
                type="text"
                placeholder="Ex: João Silva"
                className="input input-bordered"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text">Nome da Sala</span>
              </label>
              <input
                type="text"
                placeholder="Ex: sala-de-jogos"
                className="input input-bordered"
                value={roomInput}
                onChange={(e) => setRoomInput(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary mt-4">
              Entrar na Chamada
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
