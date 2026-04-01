import type { Channel } from '@/hooks/useChannels'

interface ChannelSidebarProps {
  textChannels: Channel[]
  voiceChannels: Channel[]
  activeChannelId: string
  onSelectChannel: (id: string) => void
  onJoinVoice: (id: string) => void
}

export function ChannelSidebar({
  textChannels,
  voiceChannels,
  activeChannelId,
  onSelectChannel,
  onJoinVoice,
}: ChannelSidebarProps) {
  return (
    <div className="w-64 bg-base-300 flex flex-col h-full">
      <div className="p-4 font-bold text-lg border-b border-base-content/10">
        Yerl
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {textChannels.length > 0 && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase text-base-content/50 px-2 mb-1">
              Canais de texto
            </h3>
            {textChannels.map((ch) => (
              <button
                key={ch.ID}
                type="button"
                onClick={() => onSelectChannel(ch.ID)}
                className={`w-full text-left px-2 py-1 rounded text-sm hover:bg-base-200 ${
                  activeChannelId === ch.ID ? 'bg-base-200 font-semibold' : ''
                }`}
              >
                # {ch.Name}
              </button>
            ))}
          </div>
        )}

        {voiceChannels.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase text-base-content/50 px-2 mb-1">
              Canais de voz
            </h3>
            {voiceChannels.map((ch) => (
              <button
                key={ch.ID}
                type="button"
                onClick={() => onJoinVoice(ch.ID)}
                className="w-full text-left px-2 py-1 rounded text-sm hover:bg-base-200"
              >
                {ch.Name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
