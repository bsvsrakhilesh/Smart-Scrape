import crypto from "crypto";
import {
  AgencyCategory,
  DocumentRelationType,
  EventDatePrecision,
  GovernanceGapType,
  GovernanceIssueKind,
  GovernanceIssueStatus,
  MandateType,
  PositionPolarity,
  Prisma,
} from "../generated/prisma/client";

type Tx = Prisma.TransactionClient;

const APP_VERSION = process.env.APP_VERSION || "dev";
const CODE_SHA = process.env.CODE_SHA || process.env.GIT_SHA || null;
const GOVERNANCE_PIPELINE_NAME = "governance.graph.materialize";

const AGENCY_CATEGORY_MAP: Record<string, AgencyCategory> = {
  regulator: AgencyCategory.REGULATOR,
  judiciary: AgencyCategory.JUDICIARY,
  ministry: AgencyCategory.MINISTRY,
  executive: AgencyCategory.EXECUTIVE,
  local_body: AgencyCategory.LOCAL_BODY,
  research_body: AgencyCategory.RESEARCH_BODY,
  civil_society: AgencyCategory.CIVIL_SOCIETY,
  private_sector: AgencyCategory.PRIVATE_SECTOR,
  other: AgencyCategory.OTHER,
};

const ISSUE_KIND_MAP: Record<string, GovernanceIssueKind> = {
  governance_issue: GovernanceIssueKind.GOVERNANCE_ISSUE,
  case_file: GovernanceIssueKind.CASE_FILE,
};

const MANDATE_TYPE_MAP: Record<string, MandateType> = {
  statutory: MandateType.STATUTORY,
  regulatory: MandateType.REGULATORY,
  advisory: MandateType.ADVISORY,
  enforcement: MandateType.ENFORCEMENT,
  operational: MandateType.OPERATIONAL,
  coordination: MandateType.COORDINATION,
  reporting: MandateType.REPORTING,
  monitoring: MandateType.MONITORING,
  other: MandateType.OTHER,
};

const POLARITY_MAP: Record<string, PositionPolarity> = {
  support: PositionPolarity.SUPPORT,
  oppose: PositionPolarity.OPPOSE,
  neutral: PositionPolarity.NEUTRAL,
  mixed: PositionPolarity.MIXED,
  unknown: PositionPolarity.UNKNOWN,
};

const GAP_TYPE_MAP: Record<string, GovernanceGapType> = {
  overlap: GovernanceGapType.OVERLAP,
  ambiguity: GovernanceGapType.AMBIGUITY,
  accountability: GovernanceGapType.ACCOUNTABILITY,
  coordination: GovernanceGapType.COORDINATION,
  enforcement: GovernanceGapType.ENFORCEMENT,
  data: GovernanceGapType.DATA,
  evidence: GovernanceGapType.EVIDENCE,
  coverage: GovernanceGapType.COVERAGE,
  other: GovernanceGapType.OTHER,
};

const RELATION_TYPE_MAP: Record<string, DocumentRelationType> = {
  contradiction: DocumentRelationType.CONTRADICTION,
  tension: DocumentRelationType.TENSION,
  override: DocumentRelationType.OVERRIDE,
  reinforcement: DocumentRelationType.REINFORCEMENT,
  alignment: DocumentRelationType.ALIGNMENT,
  duplication: DocumentRelationType.DUPLICATION,
  reference: DocumentRelationType.REFERENCE,
  supersedes: DocumentRelationType.SUPERSEDES,
  other: DocumentRelationType.OTHER,
};

type SyncArgs = {
  governance: any;
  taggerVersion?: string | null;
  llmModel?: string | null;
};

type ChunkRef = {
  id: string;
  revisionId: string;
  text: string;
  normalizedText: string;
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
};

type SyncContext = {
  sourceDocumentId: string;
  documentRevisionId: string | null;
  pipelineConfigId: string | null;
  sourceRevisions: Array<{ id: string; pipelineConfigId: string | null }>;
  chunks: ChunkRef[];
};

type ParsedDate = {
  date: Date | null;
  precision: EventDatePrecision;
};

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function cleanText(value: unknown, max = 500): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.slice(0, max);
}

function cleanEvidence(value: unknown): string | null {
  return cleanText(value, 4000);
}

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^\[[^\]]+\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function toConfidence(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(1, num));
}

function uniqueInts(values: Array<number | null | undefined>): number[] {
  return Array.from(
    new Set(
      values.filter((v): v is number => Number.isInteger(v) && Number(v) > 0),
    ),
  );
}

function stableStringify(value: any): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
    .join(",")}}`;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function getOrCreateGovernancePipelineConfigTx(
  tx: Tx,
  config: Prisma.InputJsonObject,
) {
  const normalized = stableStringify(config);
  const configHash = sha256(normalized);

  return tx.pipelineConfig.upsert({
    where: {
      name_version_configHash: {
        name: GOVERNANCE_PIPELINE_NAME,
        version: APP_VERSION,
        configHash,
      },
    },
    update: {},
    create: {
      name: GOVERNANCE_PIPELINE_NAME,
      version: APP_VERSION,
      config: config as Prisma.InputJsonObject,
      configHash,
      codeSha: CODE_SHA,
    },
    select: { id: true },
  });
}

function mapAgencyCategory(value: unknown): AgencyCategory | null {
  const key = normalizeKey(value).replace(/ /g, "_");
  return AGENCY_CATEGORY_MAP[key] ?? null;
}

function mapIssueKind(value: unknown): GovernanceIssueKind {
  const key = normalizeKey(value).replace(/ /g, "_");
  return ISSUE_KIND_MAP[key] ?? GovernanceIssueKind.GOVERNANCE_ISSUE;
}

function mapMandateType(value: unknown): MandateType {
  const key = normalizeKey(value).replace(/ /g, "_");
  return MANDATE_TYPE_MAP[key] ?? MandateType.OTHER;
}

function mapPolarity(value: unknown): PositionPolarity {
  const key = normalizeKey(value).replace(/ /g, "_");
  return POLARITY_MAP[key] ?? PositionPolarity.UNKNOWN;
}

function mapGapType(value: unknown): GovernanceGapType {
  const key = normalizeKey(value).replace(/ /g, "_");
  return GAP_TYPE_MAP[key] ?? GovernanceGapType.OTHER;
}

function mapRelationType(value: unknown): DocumentRelationType {
  const key = normalizeKey(value).replace(/ /g, "_");
  return RELATION_TYPE_MAP[key] ?? DocumentRelationType.OTHER;
}

function parseDateText(value: unknown): ParsedDate {
  const raw = cleanText(value, 120);
  if (!raw) {
    return { date: null, precision: EventDatePrecision.UNKNOWN };
  }

  const isoDay = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDay) {
    return {
      date: new Date(
        Date.UTC(Number(isoDay[1]), Number(isoDay[2]) - 1, Number(isoDay[3])),
      ),
      precision: EventDatePrecision.DAY,
    };
  }

  const dmy = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;

    return {
      date: new Date(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1]))),
      precision: EventDatePrecision.DAY,
    };
  }

  const monthYear = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const dt = new Date(`${monthYear[1]} 1, ${monthYear[2]} UTC`);
    if (!Number.isNaN(dt.getTime())) {
      return { date: dt, precision: EventDatePrecision.MONTH };
    }
  }

  const yearOnly = raw.match(/^(19|20)\d{2}$/);
  if (yearOnly) {
    return {
      date: new Date(Date.UTC(Number(raw), 0, 1)),
      precision: EventDatePrecision.YEAR,
    };
  }

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return { date: direct, precision: EventDatePrecision.EXACT };
  }

  return { date: null, precision: EventDatePrecision.UNKNOWN };
}

async function getRelatedSourceDataTx(
  tx: Tx,
  args: {
    documentRevisionId?: string | null;
    storedFileId?: string | null;
    urlId?: number | null;
  },
): Promise<{
  revisions: Array<{ id: string; pipelineConfigId: string | null }>;
  chunks: ChunkRef[];
}> {
  let revisions = args.documentRevisionId
    ? await tx.sourceRevision.findMany({
        where: { documentRevisionId: args.documentRevisionId },
        select: { id: true, pipelineConfigId: true },
      })
    : [];

  if (revisions.length === 0) {
    const notebookSources = await tx.notebookSource.findMany({
      where: {
        OR: [
          ...(args.storedFileId ? [{ fileId: args.storedFileId }] : []),
          ...(args.urlId ? [{ urlId: args.urlId }] : []),
        ],
      },
      select: { activeRevisionId: true },
    });

    const activeIds = Array.from(
      new Set(
        notebookSources
          .map((row) => row.activeRevisionId)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (activeIds.length > 0) {
      revisions = await tx.sourceRevision.findMany({
        where: { id: { in: activeIds } },
        select: { id: true, pipelineConfigId: true },
      });
    }
  }

  const chunks = revisions.length
    ? await tx.sourceChunk.findMany({
        where: { revisionId: { in: revisions.map((r) => r.id) } },
        select: {
          id: true,
          revisionId: true,
          text: true,
          pageStart: true,
          pageEnd: true,
          charStart: true,
          charEnd: true,
        },
      })
    : [];

  return {
    revisions,
    chunks: chunks.map((chunk) => ({
      ...chunk,
      normalizedText: normalizeKey(chunk.text),
    })),
  };
}

async function buildStoredFileContextTx(
  tx: Tx,
  storedFileId: string,
  args: SyncArgs,
): Promise<SyncContext> {
  const file = await tx.storedFile.findUnique({
    where: { id: storedFileId },
    select: {
      id: true,
      urlId: true,
      documentRevision: { select: { id: true, documentId: true } },
    },
  });

  if (!file?.documentRevision) {
    throw new Error(
      `StoredFile ${storedFileId} is missing documentRevision linkage`,
    );
  }

  const related = await getRelatedSourceDataTx(tx, {
    documentRevisionId: file.documentRevision.id,
    storedFileId,
    urlId: file.urlId ?? null,
  });

  const pc = await getOrCreateGovernancePipelineConfigTx(tx, {
    profile: "governance",
    payloadVersion: Number(args.governance?.version ?? 1),
    taggerVersion: args.taggerVersion ?? null,
    llmModel: args.llmModel ?? null,
    mode: "stored_file",
  });

  return {
    sourceDocumentId: file.documentRevision.documentId,
    documentRevisionId: file.documentRevision.id,
    pipelineConfigId: pc.id,
    sourceRevisions: related.revisions,
    chunks: related.chunks,
  };
}

async function buildUrlContextTx(
  tx: Tx,
  urlId: number,
  args: SyncArgs,
): Promise<SyncContext> {
  const row = await tx.url.findUnique({
    where: { id: urlId },
    select: { id: true },
  });
  if (!row) throw new Error(`Url not found: ${urlId}`);

  const latestSnapshot = await tx.storedFile.findFirst({
    where: { urlId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      documentRevision: { select: { id: true, documentId: true } },
    },
  });

  let sourceDocumentId: string;
  const documentRevisionId = latestSnapshot?.documentRevision?.id ?? null;

  if (latestSnapshot?.documentRevision?.documentId) {
    sourceDocumentId = latestSnapshot.documentRevision.documentId;
  } else {
    const doc = await tx.document.upsert({
      where: { urlId },
      update: {},
      create: { kind: "URL" as any, urlId },
      select: { id: true },
    });
    sourceDocumentId = doc.id;
  }

  const related = await getRelatedSourceDataTx(tx, {
    documentRevisionId,
    storedFileId: latestSnapshot?.id ?? null,
    urlId,
  });

  const pc = await getOrCreateGovernancePipelineConfigTx(tx, {
    profile: "governance",
    payloadVersion: Number(args.governance?.version ?? 1),
    taggerVersion: args.taggerVersion ?? null,
    llmModel: args.llmModel ?? null,
    mode: "url",
  });

  return {
    sourceDocumentId,
    documentRevisionId,
    pipelineConfigId: pc.id,
    sourceRevisions: related.revisions,
    chunks: related.chunks,
  };
}

function extractPageNumbers(
  locator: Record<string, any> | null,
  evidence: string | null,
  matchedChunks: ChunkRef[],
): number[] {
  const locatorPageRaw = locator ? Number(locator.pageNumber) : NaN;
  const locatorPage = Number.isInteger(locatorPageRaw) ? locatorPageRaw : null;

  const evidencePage = evidence?.match(/^\[page\s+(\d+)\]/i);

  const chunkPages = matchedChunks.flatMap((chunk) => {
    if (
      Number.isInteger(chunk.pageStart) &&
      Number.isInteger(chunk.pageEnd) &&
      chunk.pageStart !== null &&
      chunk.pageEnd !== null
    ) {
      const out: number[] = [];
      for (let page = chunk.pageStart; page <= chunk.pageEnd; page += 1) {
        out.push(page);
      }
      return out;
    }
    if (Number.isInteger(chunk.pageStart) && chunk.pageStart !== null) {
      return [chunk.pageStart];
    }
    if (Number.isInteger(chunk.pageEnd) && chunk.pageEnd !== null) {
      return [chunk.pageEnd];
    }
    return [];
  });

  return uniqueInts([
    locatorPage,
    evidencePage ? Number(evidencePage[1]) : null,
    ...chunkPages,
  ]);
}

function scoreChunkMatch(
  needleWords: string[],
  chunk: ChunkRef,
  fragment: string,
): number {
  let score = 0;
  if (fragment && chunk.normalizedText.includes(fragment)) score += 10;
  for (const word of needleWords) {
    if (chunk.normalizedText.includes(word)) score += 1;
  }
  return score;
}

function findMatchingChunks(evidence: string | null, chunks: ChunkRef[]) {
  const normalized = normalizeKey(evidence);
  if (!normalized || chunks.length === 0) return [];

  const words = Array.from(
    new Set(normalized.split(" ").filter((word) => word.length >= 4)),
  ).slice(0, 12);

  const fragment = words.slice(0, Math.min(words.length, 8)).join(" ");

  return chunks
    .map((chunk) => ({
      chunk,
      score: scoreChunkMatch(words, chunk, fragment),
    }))
    .filter((row) => row.score >= 4)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.chunk.normalizedText.length - b.chunk.normalizedText.length,
    )
    .slice(0, 3)
    .map((row) => row.chunk);
}

async function createExtractionTraceTx(
  tx: Tx,
  ctx: SyncContext,
  rawItem: Record<string, any>,
  meta: { model?: string | null; taggerVersion?: string | null },
) {
  const locator = isObject(rawItem.locator) ? rawItem.locator : null;
  const evidenceText = cleanEvidence(rawItem.evidence);
  const matchedChunks = findMatchingChunks(evidenceText, ctx.chunks);
  const sourceRevisionId =
    matchedChunks[0]?.revisionId ?? ctx.sourceRevisions[0]?.id ?? null;
  const pageNumbers = extractPageNumbers(locator, evidenceText, matchedChunks);

  return tx.extractionTrace.create({
    data: {
      sourceDocumentId: ctx.sourceDocumentId,
      documentRevisionId: ctx.documentRevisionId,
      sourceRevisionId,
      pipelineConfigId: ctx.pipelineConfigId,
      chunkIds: matchedChunks.map((chunk) => chunk.id),
      pageNumbers,
      charStart: matchedChunks[0]?.charStart ?? null,
      charEnd: matchedChunks[0]?.charEnd ?? null,
      evidenceText: evidenceText ?? null,
      evidenceLocator: (locator ?? null) as any,
      confidence: toConfidence(rawItem.confidence),
      extractionModel: meta.model ?? null,
      extractionVersion: meta.taggerVersion ?? null,
      rawPayload: rawItem as any,
    },
    select: { id: true },
  });
}

async function getOrCreateAgencyTx(
  tx: Tx,
  cache: Map<string, string>,
  args: {
    name: unknown;
    shortName?: unknown;
    category?: unknown;
    jurisdiction?: unknown;
    originTraceId?: string | null;
  },
): Promise<string | null> {
  const name = cleanText(args.name, 160);
  if (!name) return null;

  const slug = slugify(name);
  const cached = cache.get(slug);
  if (cached) return cached;

  const row = await tx.agency.upsert({
    where: { slug },
    update: {
      name,
      shortName: cleanText(args.shortName, 80) ?? undefined,
      category: mapAgencyCategory(args.category) ?? undefined,
      jurisdiction: cleanText(args.jurisdiction, 120) ?? undefined,
    },
    create: {
      slug,
      name,
      shortName: cleanText(args.shortName, 80),
      category: mapAgencyCategory(args.category),
      jurisdiction: cleanText(args.jurisdiction, 120),
      originTraceId: args.originTraceId ?? null,
    },
    select: { id: true },
  });

  cache.set(slug, row.id);
  return row.id;
}

async function getOrCreateIssueTx(
  tx: Tx,
  cache: Map<string, string>,
  args: {
    title: unknown;
    summary?: unknown;
    kind?: unknown;
    originTraceId?: string | null;
  },
): Promise<string | null> {
  const title = cleanText(args.title, 220);
  if (!title) return null;

  const slug = slugify(title);
  const cached = cache.get(slug);
  if (cached) return cached;

  const row = await tx.governanceIssue.upsert({
    where: { slug },
    update: {
      title,
      summary: cleanText(args.summary, 400) ?? undefined,
      kind: mapIssueKind(args.kind),
      status: GovernanceIssueStatus.OPEN,
    },
    create: {
      slug,
      title,
      summary: cleanText(args.summary, 400),
      kind: mapIssueKind(args.kind),
      status: GovernanceIssueStatus.OPEN,
      originTraceId: args.originTraceId ?? null,
    },
    select: { id: true },
  });

  cache.set(slug, row.id);
  return row.id;
}

async function linkIssueAgencyTx(
  tx: Tx,
  issueId: string | null,
  agencyId: string | null,
  roleLabel?: string | null,
) {
  if (!issueId || !agencyId) return;

  await tx.governanceIssueAgency.upsert({
    where: { issueId_agencyId: { issueId, agencyId } },
    update: { roleLabel: roleLabel ?? undefined },
    create: {
      issueId,
      agencyId,
      roleLabel: roleLabel ?? null,
    },
  });
}

function claimCacheKey(
  agencyName: string | null,
  claimText: string | null,
): string | null {
  const text = normalizeKey(claimText);
  if (!text) return null;
  return `${normalizeKey(agencyName)}::${text}`;
}

async function deleteExistingTracesTx(tx: Tx, ctx: SyncContext) {
  if (ctx.documentRevisionId) {
    await tx.extractionTrace.deleteMany({
      where: { documentRevisionId: ctx.documentRevisionId },
    });
    return;
  }

  await tx.extractionTrace.deleteMany({
    where: {
      sourceDocumentId: ctx.sourceDocumentId,
      documentRevisionId: null,
    },
  });
}

async function materializeGovernanceTx(
  tx: Tx,
  ctx: SyncContext,
  args: SyncArgs,
) {
  await deleteExistingTracesTx(tx, ctx);

  const payload = isObject(args.governance) ? args.governance : {};
  const agencies = asArray(payload.agencies);
  const issues = asArray(payload.issues);
  const mandates = asArray(payload.mandates);
  const claims = asArray(payload.claims);
  const events = asArray(payload.events);
  const positions = asArray(payload.positions);
  const gaps = asArray(payload.gaps);
  const relations = asArray(payload.relations);

  const agencyCache = new Map<string, string>();
  const issueCache = new Map<string, string>();
  const claimCache = new Map<
    string,
    { id: string; issueId: string | null; agencyId: string | null }
  >();

  for (const item of agencies) {
    const trace = await createExtractionTraceTx(tx, ctx, item, {
      model: args.llmModel ?? null,
      taggerVersion: args.taggerVersion ?? null,
    });

    await getOrCreateAgencyTx(tx, agencyCache, {
      name: item.name,
      shortName: item.shortName,
      category: item.category,
      jurisdiction: item.jurisdiction,
      originTraceId: trace.id,
    });
  }

  for (const item of issues) {
    const trace = await createExtractionTraceTx(tx, ctx, item, {
      model: args.llmModel ?? null,
      taggerVersion: args.taggerVersion ?? null,
    });

    await getOrCreateIssueTx(tx, issueCache, {
      title: item.title,
      summary: item.summary,
      kind: item.kind,
      originTraceId: trace.id,
    });
  }

  for (const item of mandates) {
    const trace = await createExtractionTraceTx(tx, ctx, item, {
      model: args.llmModel ?? null,
      taggerVersion: args.taggerVersion ?? null,
    });

    const title = cleanText(item.title, 220);
    const agencyId = await getOrCreateAgencyTx(tx, agencyCache, {
      name: item.agencyName,
      originTraceId: trace.id,
    });
    const issueId = await getOrCreateIssueTx(tx, issueCache, {
      title: item.issueTitle,
      originTraceId: trace.id,
    });

    if (!title || !agencyId) continue;

    const effective = parseDateText(item.effectiveDateText);

    await tx.mandate.create({
      data: {
        agencyId,
        issueId,
        traceId: trace.id,
        title,
        description: cleanText(item.description, 800),
        mandateType: mapMandateType(item.mandateType),
        effectiveFrom: effective.date,
      },
    });

    await linkIssueAgencyTx(tx, issueId, agencyId, "mandate");
  }

  for (const item of claims) {
    const trace = await createExtractionTraceTx(tx, ctx, item, {
      model: args.llmModel ?? null,
      taggerVersion: args.taggerVersion ?? null,
    });

    const issueId = await getOrCreateIssueTx(tx, issueCache, {
      title: item.issueTitle,
      originTraceId: trace.id,
    });
    const agencyName = cleanText(item.subjectAgencyName, 160);
    const agencyId = await getOrCreateAgencyTx(tx, agencyCache, {
      name: agencyName,
      originTraceId: trace.id,
    });
    const claimText = cleanText(item.claimText, 2000);

    if (!claimText) continue;

    const created = await tx.documentClaim.create({
      data: {
        issueId,
        traceId: trace.id,
        claimText,
        claimSummary: cleanText(item.claimSummary, 500),
        subjectAgencyId: agencyId,
        polarity: mapPolarity(item.polarity),
        scopeText: cleanText(item.scopeText, 220),
        normalizedKey: normalizeKey(`${agencyName ?? ""} ${claimText}`),
      },
      select: { id: true },
    });

    const key = claimCacheKey(agencyName, claimText);
    if (key) {
      claimCache.set(key, {
        id: created.id,
        issueId,
        agencyId,
      });
    }

    await linkIssueAgencyTx(tx, issueId, agencyId, "claim_subject");
  }

  for (const item of events) {
    const trace = await createExtractionTraceTx(tx, ctx, item, {
      model: args.llmModel ?? null,
      taggerVersion: args.taggerVersion ?? null,
    });

    const title = cleanText(item.title, 220);
    if (!title) continue;

    const issueId = await getOrCreateIssueTx(tx, issueCache, {
      title: item.issueTitle,
      originTraceId: trace.id,
    });
    const agencyId = await getOrCreateAgencyTx(tx, agencyCache, {
      name: item.actorAgencyName,
      originTraceId: trace.id,
    });
    const parsed = parseDateText(item.eventDateText);

    const event = await tx.documentEvent.create({
      data: {
        issueId,
        actorAgencyId: agencyId,
        traceId: trace.id,
        title,
        summary: cleanText(item.summary, 800),
        eventDate: parsed.date,
        eventDateText: cleanText(item.eventDateText, 120),
        eventDatePrecision: parsed.precision,
        sortDate: parsed.date,
        sortDateEnd: parsed.date,
        usedDocumentDateFallback: false,
      },
      select: { id: true },
    });

    if (issueId) {
      await tx.issueTimelineEntry.create({
        data: {
          issueId,
          eventId: event.id,
          traceId: trace.id,
          label: title,
          summary: cleanText(item.summary, 800),
          sortDate: parsed.date,
          sortDateEnd: parsed.date,
          sortPrecision: parsed.precision,
          actorAgencyId: agencyId,
        },
      });
    }

    await linkIssueAgencyTx(tx, issueId, agencyId, "event_actor");
  }

  for (const item of positions) {
    const trace = await createExtractionTraceTx(tx, ctx, item, {
      model: args.llmModel ?? null,
      taggerVersion: args.taggerVersion ?? null,
    });

    const issueId = await getOrCreateIssueTx(tx, issueCache, {
      title: item.issueTitle,
      originTraceId: trace.id,
    });
    const agencyName = cleanText(item.agencyName, 160);
    const agencyId = await getOrCreateAgencyTx(tx, agencyCache, {
      name: agencyName,
      originTraceId: trace.id,
    });
    const stanceText = cleanText(item.stanceText, 2000);

    if (!issueId || !agencyId || !stanceText) continue;

    const parsed = parseDateText(item.effectiveDateText);
    const claimMatch =
      claimCache.get(claimCacheKey(agencyName, stanceText) || "") ?? null;

    const position = await tx.actorPosition.create({
      data: {
        issueId,
        agencyId,
        claimId: claimMatch?.id ?? null,
        traceId: trace.id,
        stanceText,
        stanceSummary: cleanText(item.stanceSummary, 500),
        polarity: mapPolarity(item.polarity),
        effectiveDate: parsed.date,
        effectiveDateText: cleanText(item.effectiveDateText, 120),
        effectiveDatePrecision: parsed.precision,
      },
      select: { id: true },
    });

    await tx.issueTimelineEntry.create({
      data: {
        issueId,
        positionId: position.id,
        traceId: trace.id,
        label: cleanText(item.stanceSummary, 220) ?? stanceText.slice(0, 220),
        summary: cleanText(item.stanceSummary, 800) ?? stanceText,
        sortDate: parsed.date,
        sortDateEnd: parsed.date,
        sortPrecision: parsed.precision,
        actorAgencyId: agencyId,
      },
    });

    await linkIssueAgencyTx(tx, issueId, agencyId, "position_actor");
  }

  for (const item of gaps) {
    const trace = await createExtractionTraceTx(tx, ctx, item, {
      model: args.llmModel ?? null,
      taggerVersion: args.taggerVersion ?? null,
    });

    const summary = cleanText(item.summary, 1200);
    if (!summary) continue;

    const issueId = await getOrCreateIssueTx(tx, issueCache, {
      title: item.issueTitle,
      originTraceId: trace.id,
    });
    const primaryAgencyId = await getOrCreateAgencyTx(tx, agencyCache, {
      name: item.primaryAgencyName,
      originTraceId: trace.id,
    });
    const secondaryAgencyId = await getOrCreateAgencyTx(tx, agencyCache, {
      name: item.secondaryAgencyName,
      originTraceId: trace.id,
    });

    await tx.governanceGap.create({
      data: {
        issueId,
        primaryAgencyId,
        secondaryAgencyId,
        traceId: trace.id,
        gapType: mapGapType(item.gapType),
        summary,
        severity: toConfidence(item.severity),
      },
    });

    await linkIssueAgencyTx(tx, issueId, primaryAgencyId, "gap_primary");
    await linkIssueAgencyTx(tx, issueId, secondaryAgencyId, "gap_secondary");
  }

  for (const item of relations) {
    const trace = await createExtractionTraceTx(tx, ctx, item, {
      model: args.llmModel ?? null,
      taggerVersion: args.taggerVersion ?? null,
    });

    const issueId = await getOrCreateIssueTx(tx, issueCache, {
      title: item.issueTitle,
      originTraceId: trace.id,
    });

    const fromAgencyName = cleanText(item.fromAgencyName, 160);
    const toAgencyName = cleanText(item.toAgencyName, 160);

    const fromAgencyId = await getOrCreateAgencyTx(tx, agencyCache, {
      name: fromAgencyName,
      originTraceId: trace.id,
    });
    const toAgencyId = await getOrCreateAgencyTx(tx, agencyCache, {
      name: toAgencyName,
      originTraceId: trace.id,
    });

    const fromClaimKey = claimCacheKey(
      fromAgencyName,
      cleanText(item.fromClaimText, 2000),
    );
    const toClaimKey = claimCacheKey(
      toAgencyName,
      cleanText(item.toClaimText, 2000),
    );

    const fromClaim = fromClaimKey ? claimCache.get(fromClaimKey) : null;
    const toClaim = toClaimKey ? claimCache.get(toClaimKey) : null;

    await tx.documentRelation.create({
      data: {
        issueId,
        fromClaimId: fromClaim?.id ?? null,
        toClaimId: toClaim?.id ?? null,
        fromAgencyId,
        toAgencyId,
        traceId: trace.id,
        relationType: mapRelationType(item.relationType),
        confidence: toConfidence(item.confidence),
        rationale: cleanText(item.rationale, 1200),
      },
    });

    await linkIssueAgencyTx(tx, issueId, fromAgencyId, "relation_from");
    await linkIssueAgencyTx(tx, issueId, toAgencyId, "relation_to");
  }
}

export async function syncGovernanceForStoredFileTx(
  tx: Tx,
  storedFileId: string,
  args: SyncArgs,
) {
  const ctx = await buildStoredFileContextTx(tx, storedFileId, args);
  await materializeGovernanceTx(tx, ctx, args);
}

export async function syncGovernanceForUrlTx(
  tx: Tx,
  urlId: number,
  args: SyncArgs,
) {
  const ctx = await buildUrlContextTx(tx, urlId, args);
  await materializeGovernanceTx(tx, ctx, args);
}
