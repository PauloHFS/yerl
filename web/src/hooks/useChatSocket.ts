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

interface WsError {
  message: string
}

export function useChatSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const subscribedRef = useRef<Set<string>>(new Set())
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let isMounted = true

    function connect() {
      if (!isMounted) return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/chat`)
      wsRef.current = ws

      ws.onopen = () => {
        if (!isMounted) return
        reconnectAttemptsRef.current = 0
        setConnected(true)
        for (const channelId of subscribedRef.current) {
          ws.send(JSON.stringify({ type: 'subscribe', payload: { channelId } }))
        }
      }

      ws.onclose = () => {
        if (!isMounted) return
        setConnected(false)

        const attempts = reconnectAttemptsRef.current
        const delay = Math.min(1000 * Math.pow(2, attempts), 30000)
        reconnectAttemptsRef.current = attempts + 1

        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMounted) connect()
        }, delay)
      }

      ws.onerror = () => {
        if (!isMounted) return
        setError('Erro na conexão com o chat')
      }

      ws.onmessage = (event: MessageEvent) => {
        if (!isMounted) return

        let data: WsMessage
        try {
          data = JSON.parse(event.data as string) as WsMessage
        } catch (err) {
          console.error('chat ws: falha ao parsear mensagem do servidor', err)
          return
        }

        switch (data.type) {
          case 'new-message': {
            const msg = data.payload as ChatMessage
            setMessages((prev) => {
              const next = new Map(prev)
              const existing = next.get(msg.channelId) ?? []
              next.set(msg.channelId, [...existing, msg])
              return next
            })
            break
          }
          case 'history': {
            const payload = data.payload as HistoryPayload
            setMessages((prev) => {
              const next = new Map(prev)
              // History comes DESC from server, reverse to show oldest first
              next.set(payload.channelId, [...payload.messages].reverse())
              return next
            })
            break
          }
          case 'error': {
            const errPayload = data.payload as WsError
            setError(errPayload.message)
            console.error('chat ws: erro do servidor', errPayload.message)
            break
          }
        }
      }
    }

    connect()

    return () => {
      isMounted = false
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      wsRef.current?.close()
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

  const clearError = useCallback(() => setError(null), [])

  return {
    connected,
    error,
    clearError,
    subscribe,
    unsubscribe,
    sendMessage,
    getMessages,
  }
}
