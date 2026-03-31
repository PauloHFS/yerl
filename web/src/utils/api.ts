export interface APIErrorResponse {
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export class APIError extends Error {
  public status: number;
  public data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Cliente HTTP padronizado para requisições com o backend.
 * Ele automaticamente insere o prefixo '/api' caso não esteja presente,
 * avalia a resposta e trata rejeições baseadas em non-2xx status codes.
 */
export async function apiClient<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = endpoint.startsWith('/api') 
    ? endpoint 
    : `/api${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const config: RequestInit = {
    ...options,
    credentials: "include",
    headers: {
      ...defaultHeaders,
      ...options?.headers,
    },
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      const errorText = await response.text();
      let errorData: APIErrorResponse | undefined;

      try {
        errorData = JSON.parse(errorText) as APIErrorResponse;
      } catch {
        errorData = { message: errorText };
      }

      const errorMessage = errorData?.message ?? errorData?.error ?? errorText ?? `Erro na API com status ${response.status}`;

      throw new APIError(errorMessage, response.status, errorData);
    }

    // Algumas requisições (como DELETE ou certas respostas 200/201) 
    // podem retornar um body vazio, devemos evitar falhar no parse de JSON.
    if (response.status === 204) {
      return {} as T;
    }
    
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;

  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    // Erros de rede, CORS (embora estejamos num mesmo host/proxy) ou aborts
    throw new Error(`Network Error: ${(error as Error).message}`);
  }
}
