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
  const where = {
    name_version_configHash: {
      name,
      version: PIPELINE_VERSION,
      configHash,
    },
  };

  await prisma.pipelineConfig.createMany({
    data: [
      {
        name,
        version: PIPELINE_VERSION,
        config: config ?? {},
        configHash,
        codeSha: CODE_SHA,
      },
    ],
    skipDuplicates: true,
  });

  return prisma.pipelineConfig.findUniqueOrThrow({
    where,
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
  const pc = await getOrCreatePipelineConfig(
    args.pipelineName,
    args.pipelineConfig,
  );

  return prisma.captureEvent.upsert({
    where: { storedFileId: args.storedFileId },
    update: {
      // Keep the “latest” capture metadata for this storedFile
      pipelineConfigId: pc.id,
      captureType: args.captureType as any,
      documentRevisionId: args.documentRevisionId,
      urlId: args.urlId ?? null,
      sourceUrl: args.sourceUrl ?? null,
      actorId: args.actorId ?? null,
      actorName: args.actorName ?? null,
      requestId: args.requestId ?? null,
    },
    create: {
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
