import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { useChannels } from '@/hooks/useChannels'
import { useChatSocket } from '@/hooks/useChatSocket'
import { ChannelSidebar } from '@/components/chat/ChannelSidebar'
import { ChatArea } from '@/components/chat/ChatArea'

export const Route = createFileRoute('/app')({
  component: AppPage,
})

function AppPage() {
  const navigate = useNavigate()
  const { textChannels, voiceChannels, isLoading } = useChannels()
  const { connected, subscribe, unsubscribe, sendMessage, getMessages } = useChatSocket()
  const [activeChannelId, setActiveChannelId] = useState('')

  // Auto-select first text channel
  useEffect(() => {
    if (!activeChannelId && textChannels.length > 0) {
      setActiveChannelId(textChannels[0].ID)
    }
  }, [textChannels, activeChannelId])

  // Subscribe/unsubscribe when active channel changes
  useEffect(() => {
    if (!activeChannelId || !connected) return
    subscribe(activeChannelId)
    return () => {
      unsubscribe(activeChannelId)
    }
  }, [activeChannelId, connected, subscribe, unsubscribe])

  const activeChannel = textChannels.find((c) => c.ID === activeChannelId)
  const messages = getMessages(activeChannelId)

  const handleSelectChannel = (id: string) => {
    setActiveChannelId(id)
  }

  const handleJoinVoice = (id: string) => {
    void navigate({ to: '/canal', search: { name: id } })
  }

  const handleSendMessage = (content: string) => {
    sendMessage(activeChannelId, content)
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      <ChannelSidebar
        textChannels={textChannels}
        voiceChannels={voiceChannels}
        activeChannelId={activeChannelId}
        onSelectChannel={handleSelectChannel}
        onJoinVoice={handleJoinVoice}
      />
      {activeChannel ? (
        <ChatArea
          channelName={activeChannel.Name}
          messages={messages}
          onSendMessage={handleSendMessage}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-base-content/50">
          Selecione um canal
        </div>
      )}
    </div>
  )
}
