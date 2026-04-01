import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChannelSidebar } from './ChannelSidebar'
import type { Channel } from '@/hooks/useChannels'

const mockChannels: Channel[] = [
  { ID: 'ch-geral', Name: 'geral', Type: 'text', UserLimit: 0, Bitrate: 0, CreatedAt: '' },
  { ID: 'ch-dev', Name: 'dev', Type: 'text', UserLimit: 0, Bitrate: 0, CreatedAt: '' },
  { ID: 'ch-voz', Name: 'Voz Geral', Type: 'voice', UserLimit: 10, Bitrate: 64000, CreatedAt: '' },
]

describe('ChannelSidebar', () => {
  it('renderiza canais de texto e voz separados', () => {
    render(
      <ChannelSidebar
        textChannels={mockChannels.filter((c) => c.Type === 'text')}
        voiceChannels={mockChannels.filter((c) => c.Type === 'voice')}
        activeChannelId="ch-geral"
        onSelectChannel={vi.fn()}
        onJoinVoice={vi.fn()}
      />
    )

    expect(screen.getByText(/geral/)).toBeInTheDocument()
    expect(screen.getByText(/dev/)).toBeInTheDocument()
    expect(screen.getByText('Voz Geral')).toBeInTheDocument()
  })

  it('chama onSelectChannel ao clicar em canal de texto', async () => {
    const onSelect = vi.fn()
    render(
      <ChannelSidebar
        textChannels={mockChannels.filter((c) => c.Type === 'text')}
        voiceChannels={[]}
        activeChannelId="ch-geral"
        onSelectChannel={onSelect}
        onJoinVoice={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText(/dev/))
    expect(onSelect).toHaveBeenCalledWith('ch-dev')
  })

  it('chama onJoinVoice ao clicar em canal de voz', async () => {
    const onJoinVoice = vi.fn()
    render(
      <ChannelSidebar
        textChannels={[]}
        voiceChannels={mockChannels.filter((c) => c.Type === 'voice')}
        activeChannelId=""
        onSelectChannel={vi.fn()}
        onJoinVoice={onJoinVoice}
      />
    )

    await userEvent.click(screen.getByText('Voz Geral'))
    expect(onJoinVoice).toHaveBeenCalledWith('ch-voz')
  })
})
