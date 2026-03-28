type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  msg: string;
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

function formatLog(entry: LogEntry): string {
  const { level, msg, ...rest } = entry;
  const timestamp = new Date().toISOString();
  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  return `[${timestamp}] ${level.toUpperCase()} ${msg}${extra}`;
}

export function createLogger(requestId?: string) {
  function log(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
    const entry: LogEntry = { level, msg, requestId, ...extra };
    const formatted = formatLog(entry);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      default:
        console.info(formatted);
    }
  }

  return {
    info: (msg: string, extra?: Record<string, unknown>) => log('info', msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => log('warn', msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => log('error', msg, extra),
    requestId,
  };
}

export type Logger = ReturnType<typeof createLogger>;
