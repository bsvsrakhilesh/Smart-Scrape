import prisma from "../config/database";
import { CaptureType } from "../generated/prisma/client";

export async function resolveCollectorPurposeEvidenceScope(
  ownerId: string,
  purposeId: string,
) {
  const purpose = await prisma.collectorPurpose.findFirst({
    where: { id: purposeId, ownerId },
    select: { id: true, title: true },
  });
  if (!purpose) {
    throw Object.assign(new Error("Collector purpose not found."), {
      status: 404,
    });
  }

  const links = await prisma.collectorPurposeUrl.findMany({
    where: { purposeId },
    select: { urlId: true },
  });
  const files = links.length
    ? await prisma.storedFile.findMany({
        where: {
          deletedAt: null,
          urlId: { in: links.map((link) => link.urlId) },
          captureType: { in: [CaptureType.URL_TEXT, CaptureType.URL_PDF] },
        },
        select: {
          id: true,
          documentRevision: { select: { documentId: true } },
        },
      })
    : [];
  const allowedDocumentIds = Array.from(
    new Set(
      files
        .map((file) => file.documentRevision?.documentId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  return {
    purpose,
    allowedDocumentIds,
    summary: {
      savedUrlCount: links.length,
      capturedEvidenceCount: files.length,
      governanceReadyDocumentCount: allowedDocumentIds.length,
    },
  };
}
