import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "../config/env";
import { fastModel, openaiClient } from "./openaiClient";

export type CollectorPlanInput = {
  website?: string;
  keywords: string;
  yearFrom?: string;
  yearTo?: string;
  jurisdiction?: string;
  region?: string;
  format?: "any" | "pdfOnly" | "excludePdf";
};

export type CollectorPlan = {
  website: string;
  keywords: string;
  yearFrom: string;
  yearTo: string;
  jurisdiction: string;
  region: string;
  format: "any" | "pdfOnly" | "excludePdf";
  rationale: string;
};

const CollectorPlanSchema = z.object({
  website: z.string().default(""),
  keywords: z.string().default(""),
  yearFrom: z.string().default(""),
  yearTo: z.string().default(""),
  jurisdiction: z.string().default(""),
  region: z.string().default(""),
  format: z.enum(["any", "pdfOnly", "excludePdf"]).default("any"),
  rationale: z.string().default(""),
});

function cleanWebsite(raw: string | undefined) {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  try {
    const maybeUrl = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(value)
      ? value
      : `https://${value}`;
    const u = new URL(maybeUrl);
    return u.hostname.replace(/^www\./i, "").trim();
  } catch {
    return value.replace(/^www\./i, "").split(/[\/?#\s]/)[0] ?? "";
  }
}

function cleanYear(raw: string | undefined) {
  const match = String(raw ?? "").trim().match(/^(\d{4})/);
  return match ? match[1] : "";
}

function sanitizePlan(raw: CollectorPlan): CollectorPlan {
  return {
    website: cleanWebsite(raw.website),
    keywords: String(raw.keywords ?? "").trim(),
    yearFrom: cleanYear(raw.yearFrom),
    yearTo: cleanYear(raw.yearTo),
    jurisdiction: String(raw.jurisdiction ?? "").trim(),
    region: String(raw.region ?? "").trim(),
    format: raw.format,
    rationale: String(raw.rationale ?? "").trim(),
  };
}

function heuristicPlan(input: CollectorPlanInput): CollectorPlan {
  const website = cleanWebsite(input.website);
  const text =
    `${input.website ?? ""} ${input.keywords ?? ""} ${input.jurisdiction ?? ""} ${input.region ?? ""}`.toLowerCase();

  let suggestedWebsite = website;
  let format: CollectorPlan["format"] = input.format ?? "any";

  if (!suggestedWebsite) {
    if (
      text.includes("supreme court") ||
      text.includes("court order") ||
      text.includes("judgment")
    ) {
      suggestedWebsite = "sci.gov.in";
    } else if (
      text.includes("parliament") ||
      text.includes("rajya sabha") ||
      text.includes("lok sabha")
    ) {
      suggestedWebsite = "sansad.in";
    } else if (text.includes("gazette") || text.includes("notification")) {
      suggestedWebsite = "egazette.nic.in";
    }
  }

  if (format === "any") {
    if (
      /court|order|judgment|affidavit|notification|report|guideline|committee/i.test(
        text,
      )
    ) {
      format = "pdfOnly";
    } else if (/news|newspaper|article|editorial|op-ed/i.test(text)) {
      format = "excludePdf";
    }
  }

  return sanitizePlan({
    website: suggestedWebsite,
    keywords: String(input.keywords ?? "").trim(),
    yearFrom: cleanYear(input.yearFrom),
    yearTo: cleanYear(input.yearTo),
    jurisdiction: String(input.jurisdiction ?? "").trim(),
    region: String(input.region ?? "").trim(),
    format,
    rationale:
      suggestedWebsite || format !== (input.format ?? "any")
        ? "Heuristic assist applied an official-domain or document-format bias based on your topic."
        : "Heuristic assist kept your inputs mostly unchanged because the intent was already specific.",
  });
}

export async function planCollectorQuery(
  input: CollectorPlanInput,
): Promise<CollectorPlan> {
  const normalized: CollectorPlanInput = {
    website: cleanWebsite(input.website),
    keywords: String(input.keywords ?? "").trim(),
    yearFrom: cleanYear(input.yearFrom),
    yearTo: cleanYear(input.yearTo),
    jurisdiction: String(input.jurisdiction ?? "").trim(),
    region: String(input.region ?? "").trim(),
    format: input.format ?? "any",
  };

  if (!normalized.keywords) {
    return sanitizePlan({
      website: normalized.website ?? "",
      keywords: "",
      yearFrom: normalized.yearFrom ?? "",
      yearTo: normalized.yearTo ?? "",
      jurisdiction: normalized.jurisdiction ?? "",
      region: normalized.region ?? "",
      format: normalized.format ?? "any",
      rationale: "Add a rough topic first so AI assist can sharpen the search plan.",
    });
  }

  if (!env.OPENAI_ENABLED || !env.OPENAI_API_KEY) {
    return heuristicPlan(normalized);
  }

  const system = [
    "You improve documentary evidence retrieval plans for a URL collector used in governance and policy research.",
    "The collector is used to fetch official documents, reports, court orders, parliamentary material, notifications, and news coverage.",
    "Return a tight search plan that improves recall and precision without making unsupported assumptions.",
    "IMPORTANT:",
    "- Prefer official domains only when the user clearly targets one institution or source family.",
    "- Leave website blank if a mixed-source search is better.",
    "- Format must be one of: any, pdfOnly, excludePdf.",
    "- Use pdfOnly for court orders, notifications, reports, affidavits, and formal documentary evidence when appropriate.",
    "- Use excludePdf for news-only searches when appropriate.",
    "- Keep yearFrom/yearTo blank unless the user asked for a specific period or clearly implies recent coverage.",
    "- Keep jurisdiction and region concise.",
    "- Keywords must be optimized for this UI syntax: commas mean AND, pipes mean OR groups.",
    "- Do not invent facts, case numbers, dates, or agencies.",
    "- Rationale should be brief and practical.",
  ].join("\n");

  const user = JSON.stringify(normalized, null, 2);

  try {
    const resp = await openaiClient().responses.parse({
      model: fastModel(),
      max_output_tokens: env.OPENAI_FAST_MAX_OUTPUT_TOKENS,
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Turn this rough researcher input into a stronger URL Collector plan.\n\nINPUT:\n${user}`,
        },
      ],
      text: { format: zodTextFormat(CollectorPlanSchema, "collector_plan") },
    });

    const out = resp.output_parsed;
    if (!out) return heuristicPlan(normalized);

    return sanitizePlan(out);
  } catch {
    return heuristicPlan(normalized);
  }
}
