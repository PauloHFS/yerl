import { useState, useEffect, useRef, useCallback } from 'react'

export interface ChatMessage {
  id: string
  channelId: string
  senderId: string
  senderName: string
  content: string
  createdAt: string
}

interface WsMessage {
  type: string
  payload: unknown
}

interface HistoryPayload {
  channelId: string
  messages: ChatMessage[]
}

export function useChatSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map())
  const subscribedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/chat`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      // Re-subscribe to channels that were subscribed before reconnect
      for (const channelId of subscribedRef.current) {
        ws.send(JSON.stringify({ type: 'subscribe', payload: { channelId } }))
      }
    }

    ws.onclose = () => {
      setConnected(false)
    }

    ws.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data as string) as WsMessage

      if (data.type === 'new-message') {
        const msg = data.payload as ChatMessage
        setMessages((prev) => {
          const next = new Map(prev)
          const existing = next.get(msg.channelId) ?? []
          next.set(msg.channelId, [...existing, msg])
          return next
        })
      }

      if (data.type === 'history') {
        const payload = data.payload as HistoryPayload
        setMessages((prev) => {
          const next = new Map(prev)
          // History comes DESC from server, reverse to show oldest first
          next.set(payload.channelId, [...payload.messages].reverse())
          return next
        })
      }
    }

    return () => {
      ws.close()
    }
  }, [])

  const subscribe = useCallback((channelId: string) => {
    subscribedRef.current.add(channelId)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', payload: { channelId } }))
    }
  }, [])

  const unsubscribe = useCallback((channelId: string) => {
    subscribedRef.current.delete(channelId)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', payload: { channelId } }))
    }
  }, [])

  const sendMessage = useCallback((channelId: string, content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'send-message',
        payload: { channelId, content },
      }))
    }
  }, [])

  const getMessages = useCallback((channelId: string): ChatMessage[] => {
    return messages.get(channelId) ?? []
  }, [messages])

  return {
    connected,
    subscribe,
    unsubscribe,
    sendMessage,
    getMessages,
  }
}
