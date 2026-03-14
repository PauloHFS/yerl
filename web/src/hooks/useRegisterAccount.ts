import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../utils/api';

interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export function useRegisterAccount() {
  return useMutation({
    mutationFn: async (data: RegisterPayload) => {
      return apiClient<void>('/accounts/register', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    // Chave de mutação vital para a observabilidade (Wide Events) capturar o que aconteceu
    mutationKey: ['register_account'],
  });
}
