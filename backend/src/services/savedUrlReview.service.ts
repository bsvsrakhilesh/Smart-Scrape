import prisma from "../config/database";

export type ReviewableUrlRow = {
  id: number;
  updatedAt: Date;
};

function cleanUrlIds(urlIds: number[]) {
  return Array.from(
    new Set((urlIds || []).map(Number).filter((id) => Number.isFinite(id))),
  );
}

export async function getSavedUrlReviewMap(
  ownerId: string,
  urlIds: number[],
): Promise<Record<number, string>> {
  const ids = cleanUrlIds(urlIds);
  if (!ids.length) return {};

  const rows = await prisma.savedUrlReview.findMany({
    where: { ownerId, urlId: { in: ids } },
    select: { urlId: true, reviewedAt: true },
  });

  return Object.fromEntries(
    rows.map((row) => [row.urlId, row.reviewedAt.toISOString()]),
  );
}

export async function markSavedUrlsReviewed(
  ownerId: string,
  urlIds: number[],
) {
  const ids = cleanUrlIds(urlIds);
  if (!ids.length) return { reviewedAt: new Date(), count: 0, urlIds: ids };

  const reviewedAt = new Date();

  await prisma.$transaction([
    prisma.savedUrlReview.updateMany({
      where: { ownerId, urlId: { in: ids } },
      data: { reviewedAt },
    }),
    prisma.savedUrlReview.createMany({
      data: ids.map((urlId) => ({ ownerId, urlId, reviewedAt })),
      skipDuplicates: true,
    }),
  ]);

  return { reviewedAt, count: ids.length, urlIds: ids };
}

export async function clearSavedUrlReviews(
  ownerId: string,
  urlIds?: number[],
) {
  const ids = urlIds ? cleanUrlIds(urlIds) : [];
  const result = await prisma.savedUrlReview.deleteMany({
    where: {
      ownerId,
      ...(urlIds ? { urlId: { in: ids } } : {}),
    },
  });

  return { cleared: result.count };
}

export async function filterUpdatedSinceReview<T extends ReviewableUrlRow>(
  ownerId: string,
  rows: T[],
): Promise<T[]> {
  if (!rows.length) return rows;

  const reviewMap = await getSavedUrlReviewMap(
    ownerId,
    rows.map((row) => row.id),
  );

  return rows.filter((row) => {
    const reviewedAt = reviewMap[row.id];
    if (!reviewedAt) return true;
    return row.updatedAt.getTime() > new Date(reviewedAt).getTime();
  });
}

export async function countUpdatedSinceReview(
  ownerId: string,
  rows: ReviewableUrlRow[],
) {
  return (await filterUpdatedSinceReview(ownerId, rows)).length;
}
