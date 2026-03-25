interface ControlBarProps {
  username: string;
  isMuted: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;
}

export function ControlBar({
  username,
  isMuted,
  isCameraOn,
  isScreenSharing,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onLeave,
}: ControlBarProps) {
  const initials = username.slice(0, 2).toUpperCase();

  return (
    <div className="bg-base-300 px-3 py-2 flex flex-col gap-2 rounded-b-lg">
      {/* Perfil do usuário */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{username}</div>
          <div className="text-xs opacity-50">Conectado</div>
        </div>
      </div>

      {/* Botões de controle */}
      <div className="flex gap-1 justify-center">
        <button
          type="button"
          onClick={onToggleMute}
          className={`btn btn-sm btn-square ${isMuted ? 'btn-error' : 'btn-ghost'}`}
          title={isMuted ? 'Desmutar' : 'Mutar microfone'}
        >
          {isMuted ? '🔇' : '🎤'}
        </button>

        <button
          type="button"
          onClick={onToggleCamera}
          className={`btn btn-sm btn-square ${isCameraOn ? 'btn-active' : 'btn-ghost'}`}
          title={isCameraOn ? 'Desligar câmera' : 'Ligar câmera'}
        >
          {isCameraOn ? '📷' : '📸'}
        </button>

        <button
          type="button"
          onClick={onToggleScreenShare}
          className={`btn btn-sm btn-square ${isScreenSharing ? 'btn-active' : 'btn-ghost'}`}
          title={isScreenSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
        >
          🖥️
        </button>

        <button
          type="button"
          onClick={onLeave}
          className="btn btn-sm btn-square btn-error"
          title="Sair da chamada"
        >
          📞
        </button>
      </div>
    </div>
  );
}
