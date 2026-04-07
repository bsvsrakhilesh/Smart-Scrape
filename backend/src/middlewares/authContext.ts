import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

export type AppRole = "viewer" | "analyst" | "editor" | "admin";

export type AuthContext = {
  isAuthenticated: boolean;
  source: "headers" | "dev-default" | "anonymous";
  userId: string | null;
  userName: string | null;
  email: string | null;
  roles: AppRole[];
  primaryRole: AppRole | null;
};

const roleRank: Record<AppRole, number> = {
  viewer: 1,
  analyst: 2,
  editor: 3,
  admin: 4,
};

function normalizeRole(value: unknown): AppRole | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!raw) return null;
  if (["viewer", "read", "reader"].includes(raw)) return "viewer";
  if (["analyst", "researcher"].includes(raw)) return "analyst";
  if (["editor", "writer"].includes(raw)) return "editor";
  if (["admin", "administrator"].includes(raw)) return "admin";
  return null;
}

function uniqRoles(values: unknown[]): AppRole[] {
  const out: AppRole[] = [];
  const seen = new Set<AppRole>();

  for (const value of values) {
    const role = normalizeRole(value);
    if (!role || seen.has(role)) continue;
    seen.add(role);
    out.push(role);
  }

  return out.sort((a, b) => roleRank[b] - roleRank[a]);
}

function pickHeader(req: Request, name: string): string | null {
  const value = req.header(name);
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function getHeaderRoles(req: Request): AppRole[] {
  const compound = pickHeader(req, "x-user-roles");
  const single = pickHeader(req, "x-user-role");
  const raw = [
    ...(compound ? compound.split(/[;,]/g) : []),
    ...(single ? [single] : []),
  ];

  return uniqRoles(raw);
}

function buildAnonymous(): AuthContext {
  return {
    isAuthenticated: false,
    source: "anonymous",
    userId: null,
    userName: null,
    email: null,
    roles: ["viewer"],
    primaryRole: "viewer",
  };
}

function buildDevDefault(): AuthContext {
  const roles = uniqRoles([
    ...(env.DEV_AUTH_ROLES ? env.DEV_AUTH_ROLES.split(/[;,]/g) : []),
    env.DEV_AUTH_ROLE,
  ]);

  const safeRoles = roles.length ? roles : (["admin"] as AppRole[]);

  return {
    isAuthenticated: true,
    source: "dev-default",
    userId: env.DEV_AUTH_USER_ID || "dev-user",
    userName: env.DEV_AUTH_USER_NAME || "Development User",
    email: env.DEV_AUTH_EMAIL || null,
    roles: safeRoles,
    primaryRole: safeRoles[0] ?? null,
  };
}

function shouldUseDevDefaultAuth(): boolean {
  if (env.DEV_AUTH_ENABLED) return true;

  const nodeEnv = String(env.NODE_ENV || process.env.NODE_ENV || "development")
    .trim()
    .toLowerCase();

  // Safe fallback: local/dev should work out of the box.
  // Production remains locked unless real auth headers are provided.
  return nodeEnv === "development";
}

export function resolveAuthContext(req: Request): AuthContext {
  const headerUserId = pickHeader(req, "x-user-id");
  const headerRoles = getHeaderRoles(req);

  if (headerUserId) {
    const roles = headerRoles.length ? headerRoles : (["viewer"] as AppRole[]);
    return {
      isAuthenticated: true,
      source: "headers",
      userId: headerUserId,
      userName: pickHeader(req, "x-user-name"),
      email: pickHeader(req, "x-user-email"),
      roles,
      primaryRole: roles[0] ?? null,
    };
  }

  if (shouldUseDevDefaultAuth()) return buildDevDefault();
  return buildAnonymous();
}

export function authContext(req: Request, _res: Response, next: NextFunction) {
  req.auth = resolveAuthContext(req);
  next();
}

export function hasRole(
  auth: Pick<AuthContext, "roles"> | null | undefined,
  required: AppRole | AppRole[],
): boolean {
  const have = new Set(auth?.roles ?? []);
  const needed = Array.isArray(required) ? required : [required];
  return needed.some((role) => have.has(role));
}

export function requireRole(required: AppRole | AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth ?? buildAnonymous();

    if (!auth.isAuthenticated) {
      return res.status(401).json({
        code: "AUTH_REQUIRED",
        message: "Authentication is required for this action.",
      });
    }

    if (!hasRole(auth, required)) {
      return res.status(403).json({
        code: "ROLE_FORBIDDEN",
        message: "You do not have the required role for this action.",
        required: Array.isArray(required) ? required : [required],
        current: auth.roles,
      });
    }

    next();
  };
}
