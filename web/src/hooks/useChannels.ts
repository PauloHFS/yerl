import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/utils/api'

export interface Channel {
  ID: string
  Name: string
  Type: 'text' | 'voice'
  UserLimit: number
  Bitrate: number
  CreatedAt: string
}

export function useChannels() {
  const query = useQuery({
    queryKey: ['channels'],
    queryFn: () => apiClient<Channel[]>('/channels'),
  })

  const textChannels = query.data?.filter((c) => c.Type === 'text') ?? []
  const voiceChannels = query.data?.filter((c) => c.Type === 'voice') ?? []

  return {
    ...query,
    textChannels,
    voiceChannels,
  }
}
