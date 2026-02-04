// backend/src/services/provenance.service.ts
import crypto from "crypto";
import prisma from "../config/database";

// Prefer environment-provided versions for reproducibility in Docker
const PIPELINE_VERSION = process.env.APP_VERSION || "dev";
const CODE_SHA = process.env.CODE_SHA || process.env.GIT_SHA || null;

function stableStringify(value: any): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",")}}`;
}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function getOrCreatePipelineConfig(name: string, config: any) {
  const normalized = stableStringify(config ?? {});
  const configHash = sha256(normalized);

  return prisma.pipelineConfig.upsert({
    where: {
      name_version_configHash: {
        name,
        version: PIPELINE_VERSION,
        configHash,
      },
    },
    update: {},
    create: {
      name,
      version: PIPELINE_VERSION,
      config: config ?? {},
      configHash,
      codeSha: CODE_SHA,
    },
    select: { id: true, name: true, version: true, configHash: true },
  });
}

export async function recordCaptureEvent(args: {
  pipelineName: string;
  pipelineConfig: any;
  captureType: "UPLOAD" | "URL_TEXT" | "URL_PDF";
  storedFileId: string;
  documentRevisionId: string;
  urlId?: number | null;
  sourceUrl?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  requestId?: string | null;
}) {
  const pc = await getOrCreatePipelineConfig(args.pipelineName, args.pipelineConfig);

  return prisma.captureEvent.create({
    data: {
      pipelineConfigId: pc.id,
      captureType: args.captureType as any,
      storedFileId: args.storedFileId,
      documentRevisionId: args.documentRevisionId,
      urlId: args.urlId ?? null,
      sourceUrl: args.sourceUrl ?? null,
      actorId: args.actorId ?? null,
      actorName: args.actorName ?? null,
      requestId: args.requestId ?? null,
    },
    select: { id: true },
  });
}
