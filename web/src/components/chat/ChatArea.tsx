import type { ChatMessage } from '@/hooks/useChatSocket'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'

interface ChatAreaProps {
  channelName: string
  messages: ChatMessage[]
  onSendMessage: (content: string) => void
}

export function ChatArea({ channelName, messages, onSendMessage }: ChatAreaProps) {
  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="px-4 py-3 border-b border-base-300 font-semibold">
        # {channelName}
      </div>
      <MessageList messages={messages} />
      <MessageInput onSend={onSendMessage} />
    </div>
  )
}
