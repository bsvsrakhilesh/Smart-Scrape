type TelemetryLevel = "info" | "warn" | "error";

type TelemetryPayload = Record<string, unknown>;

const SESSION_KEY = "client.telemetry.sessionId";

let installedGlobalHandlers = false;
let memorySessionId: string | null = null;

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function nowIso() {
  return new Date().toISOString();
}

export function getClientSessionId(): string {
  if (memorySessionId) return memorySessionId;

  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      memorySessionId = existing;
      return existing;
    }

    const next = `web_${Date.now().toString(36)}_${randomId()}`;
    sessionStorage.setItem(SESSION_KEY, next);
    memorySessionId = next;
    return next;
  } catch {
    const fallback = `mem_${Date.now().toString(36)}_${randomId()}`;
    memorySessionId = fallback;
    return fallback;
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null,
    };
  }

  if (typeof error === "string") {
    return {
      name: "Error",
      message: error,
      stack: null,
    };
  }

  try {
    return {
      name: "UnknownError",
      message: JSON.stringify(error),
      stack: null,
    };
  } catch {
    return {
      name: "UnknownError",
      message: "Unserializable error",
      stack: null,
    };
  }
}

function emitTelemetry(
  level: TelemetryLevel,
  type: string,
  payload: TelemetryPayload = {},
) {
  const entry = {
    ts: nowIso(),
    level,
    type,
    sessionId: getClientSessionId(),
    href: typeof window !== "undefined" ? window.location.href : null,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    payload,
  };

  const prefix = "[client-telemetry]";

  if (level === "error") {
    console.error(prefix, entry);
    return;
  }

  if (level === "warn") {
    console.warn(prefix, entry);
    return;
  }

  console.info(prefix, entry);
}

export function reportClientEvent(
  type: string,
  payload: TelemetryPayload = {},
  level: TelemetryLevel = "info",
) {
  emitTelemetry(level, type, payload);
}

export function reportClientError(
  source: string,
  error: unknown,
  meta: TelemetryPayload = {},
) {
  emitTelemetry("error", "client:error", {
    source,
    error: serializeError(error),
    ...meta,
  });
}

export function installGlobalClientErrorHandlers() {
  if (installedGlobalHandlers || typeof window === "undefined") return;

  const onError = (event: ErrorEvent) => {
    reportClientError(
      event.filename || "window.error",
      event.error || event.message,
      {
        kind: "window-error",
        message: event.message,
        lineno: event.lineno ?? null,
        colno: event.colno ?? null,
        filename: event.filename || null,
      },
    );
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportClientError("window.unhandledrejection", event.reason, {
      kind: "unhandled-rejection",
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  installedGlobalHandlers = true;
}
