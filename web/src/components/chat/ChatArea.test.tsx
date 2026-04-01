import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatArea } from './ChatArea'
import type { ChatMessage } from '@/hooks/useChatSocket'

const mockMessages: ChatMessage[] = [
  { id: 'msg-1', channelId: 'ch-geral', senderId: 'u1', senderName: 'Paulo', content: 'oi!', createdAt: '2026-03-30T10:00:00Z' },
  { id: 'msg-2', channelId: 'ch-geral', senderId: 'u2', senderName: 'Joao', content: 'e ai', createdAt: '2026-03-30T10:01:00Z' },
]

describe('ChatArea', () => {
  it('renderiza nome do canal e mensagens', () => {
    render(<ChatArea channelName="geral" messages={mockMessages} onSendMessage={vi.fn()} />)

    expect(screen.getByText(/# geral/)).toBeInTheDocument()
    expect(screen.getByText('oi!')).toBeInTheDocument()
    expect(screen.getByText('e ai')).toBeInTheDocument()
  })

  it('envia mensagem pelo input', async () => {
    const onSend = vi.fn()
    render(<ChatArea channelName="geral" messages={[]} onSendMessage={onSend} />)

    const input = screen.getByPlaceholderText(/mensagem/i)
    await userEvent.type(input, 'nova msg{enter}')

    expect(onSend).toHaveBeenCalledWith('nova msg')
  })
})
