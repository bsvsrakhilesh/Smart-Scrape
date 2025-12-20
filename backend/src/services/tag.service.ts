// backend/src/services/tag.service.ts
import { PrismaClient } from "@prisma/client";
import { runAiTagForFile, scheduleAiTagForFile } from "./aiTagAuto.service";
import { runAiTagForUrl, scheduleAiTagForUrl } from "./aiTagUrlAuto.service";

const prisma = new PrismaClient();

export async function tagUrlRecord(id: number, _url: string) {
  const out = await runAiTagForUrl(id, { force: true });
  if (out.skipped) {
    const rec = await prisma.url.findUnique({ where: { id } });
    return rec?.tags ?? [];
  }
  return out.tags;
}

export async function tagFileRecord(id: string, _filePath: string, _mimeType: string) {
  const out = await runAiTagForFile(String(id), { force: true });
  if (out.skipped) {
    const rec = await prisma.storedFile.findUnique({ where: { id: String(id) } });
    return rec?.tags ?? [];
  }
  return out.tags;
}

export async function scheduleFileAutoTag(_prisma: PrismaClient, fileId: string) {
  scheduleAiTagForFile(String(fileId));
}

// Optional helper (not required, but keeps symmetry if you ever need it)
export async function scheduleUrlAutoTag(urlId: number) {
  scheduleAiTagForUrl(urlId);
}
