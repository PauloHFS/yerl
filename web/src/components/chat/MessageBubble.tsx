import type { ChatMessage } from '@/hooks/useChatSocket'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const time = new Date(message.createdAt).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="flex gap-3 px-4 py-1 hover:bg-base-200">
      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-1">
        {message.senderName.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">{message.senderName}</span>
          <span className="text-xs opacity-50">{time}</span>
        </div>
        <p className="text-sm break-words">{message.content}</p>
      </div>
    </div>
  )
}
