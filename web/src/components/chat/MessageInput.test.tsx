import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageInput } from './MessageInput'

describe('MessageInput', () => {
  it('envia mensagem ao pressionar Enter', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} />)

    const input = screen.getByPlaceholderText(/mensagem/i)
    await userEvent.type(input, 'oi pessoal{enter}')

    expect(onSend).toHaveBeenCalledWith('oi pessoal')
  })

  it('nao envia mensagem vazia', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} />)

    const input = screen.getByPlaceholderText(/mensagem/i)
    await userEvent.type(input, '{enter}')

    expect(onSend).not.toHaveBeenCalled()
  })

  it('limpa input apos envio', async () => {
    const onSend = vi.fn()
    render(<MessageInput onSend={onSend} />)

    const input = screen.getByPlaceholderText(/mensagem/i)
    await userEvent.type(input, 'hello{enter}')

    expect(input).toHaveValue('')
  })
})
