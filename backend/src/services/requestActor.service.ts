import type { Request } from "express";

export type RequestActorSnapshot = {
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRoles: string[];
  authSource: "headers" | "dev-default" | "anonymous" | null;
  isAuthenticated: boolean;
};

export function getRequestActor(req: Request): RequestActorSnapshot {
  const auth = req.auth;

  if (!auth?.isAuthenticated) {
    return {
      actorId: null,
      actorName: null,
      actorEmail: null,
      actorRoles: auth?.roles ?? ["viewer"],
      authSource: auth?.source ?? null,
      isAuthenticated: false,
    };
  }

  return {
    actorId: auth.userId ?? null,
    actorName: auth.userName ?? auth.email ?? null,
    actorEmail: auth.email ?? null,
    actorRoles: [...(auth.roles ?? [])],
    authSource: auth.source ?? null,
    isAuthenticated: true,
  };
}

export function buildAuditActorFields(req: Request) {
  const actor = getRequestActor(req);

  return {
    actorId: actor.actorId,
    actorName: actor.actorName,
  };
}

export function buildActorAuditMetadata(req: Request) {
  const actor = getRequestActor(req);

  return {
    actorEmail: actor.actorEmail,
    actorRoles: actor.actorRoles,
    authSource: actor.authSource,
    isAuthenticated: actor.isAuthenticated,
  };
}
