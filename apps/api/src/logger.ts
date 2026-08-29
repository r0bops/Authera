import { pino, type Logger } from 'pino';
import type { LogLevel } from './config.js';

export type { Logger };

export interface CreateLoggerOptions {
  level: LogLevel;
  /** Human-readable output for local development; JSON otherwise. */
  pretty?: boolean;
}

/**
 * Pino JSON logger with redaction for secrets (CLAUDE_IMPLEMENTATION_SPEC.md §17).
 * Redaction paths are widened in later phases as new sensitive fields appear.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  return pino({
    level: options.level,
    base: { service: 'agentcerta-api' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["set-cookie"]',
        'req.headers.signature',
        'req.headers["signature-input"]',
        '*.authorization',
        '*.cookie',
        '*.password',
        '*.secret',
        '*.token',
        '*.privateJwk',
        '*.privateKey',
        '*.apiKey',
        '*.webhookSecret',
        '*.sessionSecret',
        '*.databaseUrl',
      ],
      censor: '[REDACTED]',
    },
    ...(options.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss' },
          },
        }
      : {}),
  });
}
