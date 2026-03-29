import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../utils/api';

interface LoginPayload {
  email: string;
  password: string;
}

export function useLogin() {
  return useMutation({
    mutationFn: async (data: LoginPayload) => {
      return apiClient<void>('/accounts/login', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    mutationKey: ['login'],
  });
}
