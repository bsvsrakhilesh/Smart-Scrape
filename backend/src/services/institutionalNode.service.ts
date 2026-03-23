import axios from "axios";
import { env } from "../config/env";

export type InstitutionalLoginProvider =
  | "openathens"
  | "proquest"
  | "nexis"
  | "pressreader"
  | "custom";

type UpstreamHealth = {
  ok?: boolean;
  nodeName?: string | null;
  headlessDefault?: boolean | null;
  browserReady?: boolean | null;
  lastLaunchAt?: string | null;
  lastCaptureAt?: string | null;
  lastLoginOpenedAt?: string | null;
  browserChannel?: string | null;
  message?: string | null;
};

type UpstreamSessionStatus = {
  ok?: boolean;
  nodeName?: string | null;
  pages?: number | null;
  cookieCount?: number | null;
  headless?: boolean | null;
  lastLaunchAt?: string | null;
  lastCaptureAt?: string | null;
  lastLoginOpenedAt?: string | null;
  providerHints?: string[] | null;
  message?: string | null;
};

export type InstitutionalNodeHealth = {
  ok: true;
  enabled: boolean;
  reachable: boolean;
  nodeName: string | null;
  browserReady: boolean;
  headlessDefault: boolean | null;
  lastLaunchAt: string | null;
  lastCaptureAt: string | null;
  lastLoginOpenedAt: string | null;
  browserChannel: string | null;
  message: string | null;
};

export type InstitutionalSessionStatus = {
  ok: true;
  enabled: boolean;
  reachable: boolean;
  authenticated: boolean;
  nodeName: string | null;
  pages: number;
  cookieCount: number;
  headless: boolean | null;
  providerHints: string[];
  lastLaunchAt: string | null;
  lastCaptureAt: string | null;
  lastLoginOpenedAt: string | null;
  message: string | null;
};

function icnBaseUrl(): string {
  return String(env.ICN_BASE_URL || "http://host.docker.internal:7081").replace(
    /\/+$/,
    "",
  );
}

function icnHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (env.ICN_SHARED_SECRET) {
    headers["x-icn-shared-secret"] = env.ICN_SHARED_SECRET;
  }
  return headers;
}

function upstreamErrorMessage(error: any, fallback: string): string {
  return error?.response?.data?.message || error?.message || fallback;
}

export async function getInstitutionalNodeHealthProxy(): Promise<InstitutionalNodeHealth> {
  if (!env.ICN_ENABLED) {
    return {
      ok: true,
      enabled: false,
      reachable: false,
      nodeName: null,
      browserReady: false,
      headlessDefault: null,
      lastLaunchAt: null,
      lastCaptureAt: null,
      lastLoginOpenedAt: null,
      browserChannel: null,
      message: "Institutional capture is disabled on the backend.",
    };
  }

  try {
    const res = await axios.get<UpstreamHealth>(`${icnBaseUrl()}/health`, {
      timeout: env.ICN_TIMEOUT_MS,
      headers: icnHeaders(),
    });

    const data = res.data || {};

    return {
      ok: true,
      enabled: true,
      reachable: true,
      nodeName: data.nodeName ?? null,
      browserReady: Boolean(data.browserReady),
      headlessDefault:
        typeof data.headlessDefault === "boolean" ? data.headlessDefault : null,
      lastLaunchAt: data.lastLaunchAt ?? null,
      lastCaptureAt: data.lastCaptureAt ?? null,
      lastLoginOpenedAt: data.lastLoginOpenedAt ?? null,
      browserChannel: data.browserChannel ?? null,
      message: data.message ?? null,
    };
  } catch (error: any) {
    return {
      ok: true,
      enabled: true,
      reachable: false,
      nodeName: null,
      browserReady: false,
      headlessDefault: null,
      lastLaunchAt: null,
      lastCaptureAt: null,
      lastLoginOpenedAt: null,
      browserChannel: null,
      message: upstreamErrorMessage(
        error,
        "Could not reach the institutional capture node.",
      ),
    };
  }
}

export async function getInstitutionalSessionStatusProxy(): Promise<InstitutionalSessionStatus> {
  if (!env.ICN_ENABLED) {
    return {
      ok: true,
      enabled: false,
      reachable: false,
      authenticated: false,
      nodeName: null,
      pages: 0,
      cookieCount: 0,
      headless: null,
      providerHints: [],
      lastLaunchAt: null,
      lastCaptureAt: null,
      lastLoginOpenedAt: null,
      message: "Institutional capture is disabled on the backend.",
    };
  }

  try {
    const res = await axios.get<UpstreamSessionStatus>(
      `${icnBaseUrl()}/session/status`,
      {
        timeout: env.ICN_TIMEOUT_MS,
        headers: icnHeaders(),
      },
    );

    const data = res.data || {};
    const cookieCount =
      typeof data.cookieCount === "number" ? data.cookieCount : 0;

    return {
      ok: true,
      enabled: true,
      reachable: true,
      authenticated: cookieCount > 0,
      nodeName: data.nodeName ?? null,
      pages: typeof data.pages === "number" ? data.pages : 0,
      cookieCount,
      headless: typeof data.headless === "boolean" ? data.headless : null,
      providerHints: Array.isArray(data.providerHints)
        ? data.providerHints.filter(Boolean)
        : [],
      lastLaunchAt: data.lastLaunchAt ?? null,
      lastCaptureAt: data.lastCaptureAt ?? null,
      lastLoginOpenedAt: data.lastLoginOpenedAt ?? null,
      message: data.message ?? null,
    };
  } catch (error: any) {
    return {
      ok: true,
      enabled: true,
      reachable: false,
      authenticated: false,
      nodeName: null,
      pages: 0,
      cookieCount: 0,
      headless: null,
      providerHints: [],
      lastLaunchAt: null,
      lastCaptureAt: null,
      lastLoginOpenedAt: null,
      message: upstreamErrorMessage(
        error,
        "Could not read the institutional session state.",
      ),
    };
  }
}

export async function openInstitutionalLoginProxy(input: {
  provider?: InstitutionalLoginProvider;
  url?: string | null;
}) {
  if (!env.ICN_ENABLED) {
    const err: any = new Error(
      "Institutional capture is disabled on the backend.",
    );
    err.status = 503;
    throw err;
  }

  try {
    const res = await axios.post(
      `${icnBaseUrl()}/session/open-login`,
      {
        provider: input.provider ?? undefined,
        url: input.url ?? null,
      },
      {
        timeout: env.ICN_TIMEOUT_MS,
        headers: {
          ...icnHeaders(),
          "Content-Type": "application/json",
        },
      },
    );

    return res.data;
  } catch (error: any) {
    const err: any = new Error(
      upstreamErrorMessage(
        error,
        "Could not open the institutional login window.",
      ),
    );
    err.status = error?.response?.status || 502;
    throw err;
  }
}
