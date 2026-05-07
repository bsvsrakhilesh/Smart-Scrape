import type { Request } from "express";

export function ownerIdForRequest(req: Pick<Request, "auth">): string {
  return req.auth?.userId || "local";
}
