export const AI_TAG_JOB_TIMEOUT_SEC = 300;
export const AI_TAG_JOB_POLL_MS = 1200;

export type AiTagRuntimeFields = {
  aiTagJobProgress?: number | null;
  aiTagJobStage?: string | null;
  aiTagJobMessage?: string | null;
  aiTagJobAttempt?: number | null;
  aiTagJobCached?: boolean | null;
};

type AiTagLike = AiTagRuntimeFields & {
  taggingStatus?: string | null;
  taggingError?: string | null;
  taggingJobId?: string | null;
  taggerVersion?: string | null;
  tags?: string[] | null;
  mimeType?: string | null;
};

const UNSUPPORTED_RE =
  /\b(not supported|unsupported|isn't available|not available for this file|not available for this type)\b/i;

export function clampAiTagProgress(
  value: unknown,
  fallback: number | null = null,
): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function isUnsupportedAiTagError(value: unknown) {
  return UNSUPPORTED_RE.test(String(value || "").trim());
}

export function canRetryAiTag(item: AiTagLike | null | undefined): boolean {
  if (!item) return false;

  const mime = String(item.mimeType || "").toLowerCase();
  if (mime === "folder") return false;

  const status = String(item.taggingStatus || "NONE").toUpperCase();
  const err = String(item.taggingError || "").trim();

  if (status === "RUNNING" || status === "PENDING") return false;
  if (isUnsupportedAiTagError(err)) return false;

  return status === "FAILED";
}

export function deriveAiTagRuntimeFromJob(
  data: any,
  previousProgress: number | null = null,
): AiTagRuntimeFields & {
  taggingStatus?: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
} {
  const state = String(data?.state || "").toUpperCase();

  if (state === "SUCCESS") {
    return {
      taggingStatus: "SUCCESS",
      aiTagJobProgress: 100,
      aiTagJobStage: null,
      aiTagJobMessage: null,
      aiTagJobAttempt: null,
      aiTagJobCached:
        typeof data?.cached === "boolean" ? Boolean(data.cached) : null,
    };
  }

  if (state === "FAILURE") {
    return {
      taggingStatus: "FAILED",
      aiTagJobProgress: clampAiTagProgress(data?.progress, previousProgress),
      aiTagJobStage: data?.stage ?? null,
      aiTagJobMessage: data?.message ?? null,
      aiTagJobAttempt: typeof data?.attempt === "number" ? data.attempt : null,
      aiTagJobCached: null,
    };
  }

  const prev = clampAiTagProgress(previousProgress, null);

  let fallback: number | null = prev;
  if (state === "PENDING") {
    fallback = prev == null ? 8 : Math.min(prev, 20);
  } else if (state === "RETRY") {
    fallback = prev == null ? 35 : Math.max(prev, 35);
  } else {
    fallback = prev == null ? 25 : Math.max(prev, 25);
  }

  return {
    taggingStatus: state === "PENDING" ? "PENDING" : "RUNNING",
    aiTagJobProgress: clampAiTagProgress(data?.progress, fallback),
    aiTagJobStage: data?.stage ?? null,
    aiTagJobMessage: data?.message ?? null,
    aiTagJobAttempt: typeof data?.attempt === "number" ? data.attempt : null,
    aiTagJobCached:
      typeof data?.cached === "boolean" ? Boolean(data.cached) : null,
  };
}

export function getAiTagUiSummary(item: AiTagLike | null | undefined): {
  label: string;
  detail: string;
  progress: number | null;
  cached: boolean;
  retryAllowed: boolean;
  unsupported: boolean;
  tone: "neutral" | "success" | "progress" | "danger";
} {
  const status = String(item?.taggingStatus || "NONE").toUpperCase();
  const progress = clampAiTagProgress(item?.aiTagJobProgress, null);
  const stage = String(item?.aiTagJobStage || "").trim();
  const message = String(item?.aiTagJobMessage || "").trim();
  const attempt =
    typeof item?.aiTagJobAttempt === "number" ? item.aiTagJobAttempt : null;
  const cached = Boolean(item?.aiTagJobCached);
  const tagCount = Array.isArray(item?.tags) ? item!.tags!.length : 0;
  const err = String(item?.taggingError || "").trim();
  const unsupported = isUnsupportedAiTagError(err);

  if (status === "SUCCESS") {
    return {
      label: cached ? "Tagged (cached)" : "Tagged",
      detail: item?.taggerVersion
        ? `Tagger ${item.taggerVersion}`
        : tagCount > 0
          ? `${tagCount} label${tagCount === 1 ? "" : "s"} on record`
          : "Metadata extracted",
      progress: 100,
      cached,
      retryAllowed: false,
      unsupported: false,
      tone: "success",
    };
  }

  if (status === "RUNNING") {
    return {
      label: progress != null ? `Running ${progress}%` : "Running",
      detail:
        [
          message || stage || "AI extraction in progress",
          attempt && attempt > 1 ? `Attempt ${attempt}` : null,
          cached ? "Cached result" : null,
        ]
          .filter(Boolean)
          .join(" - ") || "AI extraction in progress",
      progress,
      cached,
      retryAllowed: false,
      unsupported: false,
      tone: "progress",
    };
  }

  if (status === "PENDING") {
    return {
      label: progress != null ? `Queued ${progress}%` : "Queued",
      detail:
        [
          message || stage || "Waiting for worker pickup",
          attempt && attempt > 1 ? `Attempt ${attempt}` : null,
        ]
          .filter(Boolean)
          .join(" - ") || "Waiting for worker pickup",
      progress,
      cached,
      retryAllowed: false,
      unsupported: false,
      tone: "progress",
    };
  }

  if (status === "FAILED") {
    return {
      label: unsupported ? "Unsupported" : "Failed",
      detail: err || message || "AI extraction needs review",
      progress,
      cached: false,
      retryAllowed: canRetryAiTag(item),
      unsupported,
      tone: "danger",
    };
  }

  return {
    label: "Not started",
    detail: "No AI tag job has run yet",
    progress: null,
    cached: false,
    retryAllowed: false,
    unsupported: false,
    tone: "neutral",
  };
}
