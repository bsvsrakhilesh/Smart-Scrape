// backend/src/utils/logger.ts
import type { Request } from 'express';
type LogLevel = 'info' | 'warn' | 'error';

function serialize(obj: any) {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{"error":"<unserializable>"}';
  }
}

export function requestMeta(req?: Request) {
  return req ? { requestId: (req as any)?.requestId } : {};
}

function base(event: string, level: LogLevel, extra?: Record<string, any>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(extra || {}),
  };
  // single-line JSON for log aggregators
  // eslint-disable-next-line no-console
  console.log(serialize(payload));
}

export const log = {
  info: (event: string, extra?: Record<string, any>) => base(event, 'info', extra),
  warn: (event: string, extra?: Record<string, any>) => base(event, 'warn', extra),
  error: (event: string, extra?: Record<string, any>) => base(event, 'error', extra),
};

// Utility to mask sensitive IDs/keys (keeps first/last 3)
export function mask(value?: string | null) {
  if (!value) return '';
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}
