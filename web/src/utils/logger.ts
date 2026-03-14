interface LogEvent {
  event: string;
  level: 'info' | 'error';
  timestamp: string;
  [key: string]: unknown;
}

const isDev = import.meta.env.DEV;

const emit = (level: 'info' | 'error', eventName: string, data: Record<string, unknown> = {}) => {
  const wideEvent: LogEvent = {
    event: eventName,
    level,
    timestamp: new Date().toISOString(),
    service: 'yerl-web',
    env: isDev ? 'development' : 'production',
    url: window.location.href,
    user_agent: navigator.userAgent,
    ...data,
  };

  // Em produção, isso poderia ser enviado para um endpoint de coleta (/api/logs)
  // ou para uma ferramenta como Sentry/Datadog.
  if (level === 'error') {
    console.error(JSON.stringify(wideEvent));
  } else {
    console.info(JSON.stringify(wideEvent));
  }
};

export const logger = {
  info: (event: string, data?: Record<string, unknown>) => emit('info', event, data),
  error: (event: string, data?: Record<string, unknown>) => emit('error', event, data),
};
