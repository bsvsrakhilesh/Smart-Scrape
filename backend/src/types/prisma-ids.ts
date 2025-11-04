import { Prisma } from "@prisma/client";

/**
 * These aliases read the id types from your generated Prisma types,
 * so they always match your schema (String vs Int) without guessing.
 */
export type StoredFileId = NonNullable<Prisma.StoredFileWhereUniqueInput["id"]>;
export type UrlId        = NonNullable<Prisma.UrlWhereUniqueInput["id"]>;
