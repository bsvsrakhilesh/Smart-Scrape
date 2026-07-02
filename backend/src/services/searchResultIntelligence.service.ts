import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "../config/env";
import { fastModel, openaiClient } from "./openaiClient";

export type SearchResultRow = {
  title: string;
  url: string;
  snippet?: string;
};

export type SearchResultDocType =
  | "court_order"
  | "notification"
  | "report"
  | "news_article"
  | "parliamentary_material"
  | "affidavit_filing"
  | "guideline_circular"
  | "official_document"
  | "other";

export type SearchResultSourceType =
  | "court"
  | "government"
  | "parliament"
  | "news"
  | "research"
  | "other";

export type SearchResultConfidence = "high" | "medium" | "low";

export type SearchResultIntelligence = {
  docType: SearchResultDocType;
  sourceType: SearchResultSourceType;
  fileTypeHint: "pdf" | "html" | "doc" | "other";
  confidence: SearchResultConfidence;
  reason: string;
};

export type EnrichedSearchResult = SearchResultRow & {
  intelligence: SearchResultIntelligence;
};

const AiItemSchema = z.object({
  index: z.number().int().min(0),
  docType: z.enum([
    "court_order",
    "notification",
    "report",
    "news_article",
    "parliamentary_material",
    "affidavit_filing",
    "guideline_circular",
    "official_document",
    "other",
  ]),
  sourceType: z.enum([
    "court",
    "government",
    "parliament",
    "news",
    "research",
    "other",
  ]),
  fileTypeHint: z.enum(["pdf", "html", "doc", "other"]),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().default(""),
});

const AiBatchSchema = z.object({
  items: z.array(AiItemSchema).default([]),
});

function detectFileType(url: string): SearchResultIntelligence["fileTypeHint"] {
  const text = String(url || "").toLowerCase();
  if (/\.pdf(?:$|[?#])/.test(text) || /format=pdf/.test(text)) return "pdf";
  if (/\.(doc|docx|rtf)(?:$|[?#])/.test(text)) return "doc";
  if (/\.html?(?:$|[?#])/.test(text)) return "html";
  return "other";
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function heuristicClassify(row: SearchResultRow): SearchResultIntelligence {
  const title = String(row.title || "");
  const snippet = String(row.snippet || "");
  const url = String(row.url || "");
  const host = getHostname(url);
  const lower = `${title} ${snippet} ${url}`.toLowerCase();
  const fileTypeHint = detectFileType(url);

  const has = (re: RegExp) => re.test(lower);
  const hostHas = (re: RegExp) => re.test(host);

  if (
    hostHas(/(^|\.)sci\.gov\.in$/) ||
    has(
      /supreme court|high court|tribunal|judgment|judgement|order dated|bench|writ petition|civil appeal|criminal appeal/,
    )
  ) {
    if (
      has(
        /affidavit|counter affidavit|status report|reply affidavit|ia no\.?|interlocutory application|petitioner|respondent/,
      )
    ) {
      return {
        docType: "affidavit_filing",
        sourceType: "court",
        fileTypeHint,
        confidence: "high",
        reason: "Court-style filing language detected.",
      };
    }

    return {
      docType: "court_order",
      sourceType: "court",
      fileTypeHint,
      confidence:
        hostHas(/(^|\.)sci\.gov\.in$/) || has(/judgment|judgement|order/)
          ? "high"
          : "medium",
      reason: "Court source or judgment/order language detected.",
    };
  }

  if (
    hostHas(/(^|\.)sansad\.in$/) ||
    has(
      /lok sabha|rajya sabha|parliament|question no\.?|debate|unstarred question|starred question|committee report|parliamentary standing committee/,
    )
  ) {
    return {
      docType: "parliamentary_material",
      sourceType: "parliament",
      fileTypeHint,
      confidence: "high",
      reason: "Parliamentary terms or Sansad source detected.",
    };
  }

  if (
    hostHas(/(^|\.)egazette\.nic\.in$/) ||
    has(
      /notification|gazette|extraordinary|ministry of|department of|s\.o\.|g\.s\.r\.|office memorandum|memorandum|circular|guidelines?/,
    )
  ) {
    const docType = has(/circular|guidelines?|office memorandum|memorandum/)
      ? "guideline_circular"
      : "notification";

    return {
      docType,
      sourceType: "government",
      fileTypeHint,
      confidence:
        hostHas(/\.gov\.in$/) || hostHas(/\.nic\.in$/) ? "high" : "medium",
      reason: "Government/notification language detected.",
    };
  }

  if (
    hostHas(
      /(^|\.)thehindu\.com$|(^|\.)indianexpress\.com$|(^|\.)timesofindia\.indiatimes\.com$|(^|\.)hindustantimes\.com$|(^|\.)scroll\.in$|(^|\.)livemint\.com$|(^|\.)ndtv\.com$|(^|\.)reuters\.com$|(^|\.)apnews\.com$|(^|\.)bbc\.com$/,
    ) ||
    has(/reported|according to the report|news|editorial|opinion|explained/)
  ) {
    return {
      docType: "news_article",
      sourceType: "news",
      fileTypeHint: fileTypeHint === "other" ? "html" : fileTypeHint,
      confidence: hostHas(
        /thehindu|indianexpress|reuters|bbc|ndtv|timesofindia|hindustantimes|scroll|livemint|apnews/,
      )
        ? "high"
        : "medium",
      reason: "News-style source or article language detected.",
    };
  }

  if (
    hostHas(
      /(^|\.)ipcc\.ch$|(^|\.)who\.int$|(^|\.)unep\.org$|(^|\.)cpcb\.nic\.in$|(^|\.)moef\.gov\.in$|(^|\.)niti\.gov\.in$/,
    ) ||
    has(
      /report|assessment|white paper|working paper|technical note|study|survey|findings|executive summary/,
    )
  ) {
    return {
      docType: has(/guidelines?|circular/)
        ? "guideline_circular"
        : has(/report|assessment|white paper|working paper|study|survey/)
          ? "report"
          : "official_document",
      sourceType: hostHas(/(^|\.)who\.int$|(^|\.)ipcc\.ch$|(^|\.)unep\.org$/)
        ? "research"
        : hostHas(/\.gov\.in$|\.nic\.in$/)
          ? "government"
          : "research",
      fileTypeHint,
      confidence: has(/report|assessment|technical note|study|survey/)
        ? "high"
        : "medium",
      reason: "Report/research wording detected.",
    };
  }

  if (hostHas(/\.gov\.in$|\.nic\.in$/)) {
    return {
      docType: "official_document",
      sourceType: "government",
      fileTypeHint,
      confidence: "medium",
      reason: "Official government domain detected.",
    };
  }

  return {
    docType: "other",
    sourceType: "other",
    fileTypeHint,
    confidence: "low",
    reason: "Not enough signals to classify confidently.",
  };
}

async function refineWithOpenAI(
  base: EnrichedSearchResult[],
): Promise<EnrichedSearchResult[]> {
  if (!env.OPENAI_ENABLED || !env.OPENAI_API_KEY || base.length === 0) {
    return base;
  }

  const candidates = base
    .map((item, index) => ({ index, item }))
    .filter(({ item }) => item.intelligence.confidence !== "high")
    .slice(0, 6);

  if (candidates.length === 0) return base;

  const payload = candidates.map(({ index, item }) => ({
    index,
    title: item.title,
    url: item.url,
    snippet: item.snippet ?? "",
    heuristic: item.intelligence,
  }));

  const system = [
    "You classify URL collector search results for a governance evidence platform.",
    "Choose the best label from the allowed enums only.",
    "Prefer official documentary labels for court orders, notifications, circulars, reports, parliamentary material, and filings.",
    "Use news_article for journalism/news coverage.",
    "Use official_document for government or institutional pages that are formal but do not fit a narrower label.",
    "Do not invent facts. Base the answer only on title, URL, snippet, and heuristic hints.",
    "Keep reasons short.",
  ].join("\n");

  try {
    const resp = await openaiClient().responses.parse({
      model: fastModel(),
      max_output_tokens: env.OPENAI_FAST_MAX_OUTPUT_TOKENS,
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Refine these search result classifications.\n\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
      text: { format: zodTextFormat(AiBatchSchema, "search_result_labels") },
    });

    const parsed = resp.output_parsed;
    if (!parsed?.items?.length) return base;

    const next = [...base];
    for (const item of parsed.items) {
      if (
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index >= next.length
      ) {
        continue;
      }

      next[item.index] = {
        ...next[item.index],
        intelligence: {
          docType: item.docType,
          sourceType: item.sourceType,
          fileTypeHint: item.fileTypeHint,
          confidence: item.confidence,
          reason:
            String(item.reason || "").trim() ||
            next[item.index].intelligence.reason,
        },
      };
    }

    return next;
  } catch {
    return base;
  }
}

export async function enrichSearchResults(
  rows: SearchResultRow[],
): Promise<EnrichedSearchResult[]> {
  const base = rows.map((row) => ({
    ...row,
    intelligence: heuristicClassify(row),
  }));

  return refineWithOpenAI(base);
}
