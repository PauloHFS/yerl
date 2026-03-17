import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebRTC } from '../hooks/useWebRTC';

export const Route = createFileRoute('/canal')({
  component: CanalPage,
  validateSearch: (search: Record<string, unknown>): { name?: string } => {
    return {
      name: typeof search.name === 'string' ? search.name : undefined,
    };
  },
});

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && stream) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  return <audio ref={audioRef} autoPlay hidden />;
}

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
    isMuted, 
    toggleMute, 
    stats, 
    participants 
  } = useWebRTC(name ?? '', username);

  // Efeito centralizado para lidar com a conexão baseada no estado hasJoined
  useEffect(() => {
    if (name && hasJoined && !connected) {
       void connect();
    }
  }, [name, hasJoined, connected, connect]);

  const handleJoin = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!roomInput.trim() || !username.trim()) return;

    localStorage.setItem('yerl_username', username);
    
    // 1. Atualiza a URL se necessário (isso causará um re-render via TanStack Router)
    if (name !== roomInput) {
      void navigate({ search: { name: roomInput } });
    }
    
    // 2. Define hasJoined como true (o useEffect acima cuidará da conexão)
    setHasJoined(true);
  }, [roomInput, username, name, navigate]);

  const handleLeave = useCallback(() => {
    disconnect();
    setHasJoined(false);
    void navigate({ search: {} });
  }, [disconnect, navigate]);

  if (hasJoined) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-base-200 p-4">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body items-center text-center">
            <h2 className="card-title text-2xl mb-2">Canal de Voz</h2>
            <p className="text-sm opacity-70">Sala: <span className="font-bold text-primary">{name}</span></p>
            <p className="text-sm opacity-70 mb-6">Usuário: <span className="font-bold">{username}</span></p>

            <div className="flex items-center gap-4 mb-8">
              <div className={`w-4 h-4 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-warning'}`}></div>
              <span className="font-semibold">{connected ? 'Conectado e Transmitindo' : 'Conectando...'}</span>
            </div>

            <div className="flex gap-4">
              <button 
                type="button"
                onClick={toggleMute} 
                className={`btn ${isMuted ? 'btn-error' : 'btn-active'}`}
              >
                {isMuted ? 'Desmutar' : 'Mutar Microfone'}
              </button>
              <button type="button" onClick={handleLeave} className="btn btn-outline btn-error">
                Sair da Sala
              </button>
            </div>
            
            <div className="mt-8 opacity-50 text-sm">
              Ouvindo {remoteStreams.length} participante(s)
            </div>

            <div className="mt-4 w-full">
              <h3 className="text-sm font-bold text-left mb-2 opacity-70">Participantes:</h3>
              <div className="flex flex-wrap gap-2">
                {participants.map((p) => (
                  <div key={p.id} className="badge badge-outline badge-md">
                    {p.name} {p.id === localStorage.getItem('yerl_peer_id') ? '(Você)' : (p.name === username ? '(Você*)' : '')}
                  </div>
                ))}
              </div>
            </div>

            <button 
              type="button"
              onClick={() => setShowDebug(!showDebug)} 
              className="btn btn-xs btn-ghost mt-4"
            >
              {showDebug ? 'Esconder Debug' : 'Mostrar Debug'}
            </button>

            {showDebug && stats && (
              <div className="mt-4 p-4 bg-base-300 rounded-lg text-left text-xs font-mono w-full">
                <p className="font-bold text-primary mb-2">WebRTC Stats:</p>
                <p>RTT (Latência): {stats.latency}ms</p>
                <div className="divider my-1"></div>
                <p className="font-semibold">Upload:</p>
                <p>Bitrate: {stats.outbound.bitrate} kbps</p>
                <p>Pacotes: {stats.outbound.packetsSent}</p>
                <div className="divider my-1"></div>
                <p className="font-semibold">Download:</p>
                <p>Bitrate: {stats.inbound.bitrate} kbps</p>
                <p>Jitter: {stats.inbound.jitter}ms</p>
                <p>Perda: {stats.inbound.packetsLost} pacotes</p>
              </div>
            )}

            {remoteStreams.map((stream) => (
              <RemoteAudio key={stream.id} stream={stream} />
            ))}
          </div>
        </div>
      </div>
    );
  }

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
