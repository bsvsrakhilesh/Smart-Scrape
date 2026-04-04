export type TimelineGroupBy = "none" | "actor" | "sourceType";
export type TimelineSourceType = "URL" | "FILE";

type TimelineEntry = {
  id: string;
  itemType: string;
  label: string;
  summary: string | null;
  sortDate: string | null;
  sortDateEnd: string | null;
  sortPrecision: string | null;
  actorAgency: {
    id?: string | null;
    name?: string | null;
    shortName?: string | null;
  } | null;
  createdAt: string | null;
  updatedAt: string | null;
  event?: {
    eventDate?: string | null;
    eventDateText?: string | null;
    eventDatePrecision?: string | null;
    usedDocumentDateFallback?: boolean | null;
  } | null;
  position?: {
    effectiveDate?: string | null;
    effectiveDateText?: string | null;
    effectiveDatePrecision?: string | null;
  } | null;
  provenance?: {
    sourceDocument?: {
      kind?: string | null;
    } | null;
    documentRevision?: {
      captureType?: string | null;
    } | null;
  } | null;
  [key: string]: any;
};

type TimelineFilters = {
  actorAgencyId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  sourceType?: string | null;
  groupBy?: string | null;
  limit: number;
};

const APPROXIMATE_PRECISIONS = new Set([
  "MONTH",
  "YEAR",
  "APPROXIMATE",
  "UNKNOWN",
  "RANGE",
]);

function normalizeGroupBy(value: unknown): TimelineGroupBy {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();

  if (raw === "actor") return "actor";
  if (raw === "sourcetype" || raw === "source_type" || raw === "source-type") {
    return "sourceType";
  }

  return "none";
}

function normalizeSourceType(value: unknown): TimelineSourceType | null {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  return raw === "URL" || raw === "FILE" ? (raw as TimelineSourceType) : null;
}

function inferSourceType(entry: TimelineEntry): TimelineSourceType | null {
  const documentKind = String(entry.provenance?.sourceDocument?.kind ?? "")
    .trim()
    .toUpperCase();

  if (documentKind === "URL" || documentKind === "FILE") {
    return documentKind as TimelineSourceType;
  }

  const captureType = String(
    entry.provenance?.documentRevision?.captureType ?? "",
  )
    .trim()
    .toUpperCase();

  if (captureType === "UPLOAD") return "FILE";
  if (captureType === "URL_TEXT" || captureType === "URL_PDF") return "URL";

  return null;
}

function compareIsoNullableAsc(a: string | null, b: string | null) {
  if (a && b) return a.localeCompare(b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function enrichTimelineEntry(entry: TimelineEntry) {
  const sourceType = inferSourceType(entry);
  const usesDocumentDateFallback = Boolean(
    entry.event?.usedDocumentDateFallback,
  );

  const temporalBasis = usesDocumentDateFallback
    ? "document_date_fallback"
    : entry.event?.eventDate
      ? "event_date"
      : entry.position?.effectiveDate
        ? "position_effective_date"
        : "timeline_sort_date";

  const displayDate =
    entry.event?.eventDate ??
    entry.position?.effectiveDate ??
    entry.sortDate ??
    null;

  const displayDateText =
    entry.event?.eventDateText ?? entry.position?.effectiveDateText ?? null;

  const precision =
    entry.event?.eventDatePrecision ??
    entry.position?.effectiveDatePrecision ??
    entry.sortPrecision ??
    null;

  const isApproximateDate = APPROXIMATE_PRECISIONS.has(
    String(precision ?? "").toUpperCase(),
  );

  return {
    ...entry,
    sourceType,
    temporal: {
      basis: temporalBasis,
      displayDate,
      displayDateText,
      precision,
      isApproximateDate,
      usesDocumentDateFallback,
    },
  };
}

export function buildCaseTimelineView(args: {
  entries: TimelineEntry[];
  filters: TimelineFilters;
}) {
  const requestedSourceType = normalizeSourceType(args.filters.sourceType);
  const groupBy = normalizeGroupBy(args.filters.groupBy);

  let entries = args.entries.map(enrichTimelineEntry);

  if (requestedSourceType) {
    entries = entries.filter(
      (entry) => entry.sourceType === requestedSourceType,
    );
  }

  entries.sort(
    (a, b) =>
      compareIsoNullableAsc(a.sortDate, b.sortDate) ||
      compareIsoNullableAsc(a.createdAt, b.createdAt) ||
      String(a.id).localeCompare(String(b.id)),
  );

  const sourceTypeCounts: Record<string, number> = {};
  const byTemporalBasis: Record<string, number> = {};
  const actorIds = new Set<string>();

  for (const entry of entries) {
    const sourceKey = entry.sourceType ?? "UNKNOWN";
    sourceTypeCounts[sourceKey] = (sourceTypeCounts[sourceKey] ?? 0) + 1;

    const temporalKey = String(entry.temporal?.basis ?? "unknown");
    byTemporalBasis[temporalKey] = (byTemporalBasis[temporalKey] ?? 0) + 1;

    if (entry.actorAgency?.id) actorIds.add(entry.actorAgency.id);
  }

  const groups: Array<{
    key: string;
    label: string;
    entryCount: number;
    entries: typeof entries;
  }> = [];

  if (groupBy !== "none") {
    const groupMap = new Map<
      string,
      {
        key: string;
        label: string;
        entryCount: number;
        entries: typeof entries;
      }
    >();

    for (const entry of entries) {
      const key =
        groupBy === "actor"
          ? entry.actorAgency?.id || "__unknown_actor__"
          : entry.sourceType || "UNKNOWN";

      const label =
        groupBy === "actor"
          ? entry.actorAgency?.name ||
            entry.actorAgency?.shortName ||
            "Unattributed"
          : entry.sourceType || "Unknown source type";

      const existing = groupMap.get(key) || {
        key,
        label,
        entryCount: 0,
        entries: [],
      };

      existing.entryCount += 1;
      existing.entries.push(entry);
      groupMap.set(key, existing);
    }

    groups.push(
      ...Array.from(groupMap.values()).sort(
        (a, b) =>
          b.entryCount - a.entryCount ||
          String(a.label).localeCompare(String(b.label)),
      ),
    );
  }

  return {
    filters: {
      actorAgencyId: args.filters.actorAgencyId ?? null,
      dateFrom: args.filters.dateFrom ?? null,
      dateTo: args.filters.dateTo ?? null,
      sourceType: requestedSourceType ?? null,
      groupBy,
      limit: args.filters.limit,
    },
    summary: {
      entryCount: entries.length,
      eventCount: entries.filter((entry) => entry.itemType === "event").length,
      positionCount: entries.filter((entry) => entry.itemType === "position")
        .length,
      approximateDateCount: entries.filter(
        (entry) => entry.temporal?.isApproximateDate,
      ).length,
      documentDateFallbackCount: entries.filter(
        (entry) => entry.temporal?.usesDocumentDateFallback,
      ).length,
      actorCount: actorIds.size,
      sourceTypeCounts,
      byTemporalBasis,
    },
    groups,
    entries,
  };
}
