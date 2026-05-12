import React from "react";
import StructuredTags from "./StructuredTags";

type EvidenceTone = "green" | "blue" | "violet" | "slate" | "ghost";

type EvidencePill = {
  label: string;
  tone: EvidenceTone;
};

type EvidenceSummaryCard = {
  label: string;
  value: React.ReactNode;
  meta?: React.ReactNode;
};

type EvidenceTimelineItem = {
  id: string;
  title: string;
  time?: string | null;
  detail: React.ReactNode;
  tone: Exclude<EvidenceTone, "ghost">;
};

type EvidenceFactRow = {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
};

type EvidenceAction = {
  label: string;
  onClick: () => void | Promise<void>;
  primary?: boolean;
  icon?: React.ReactNode;
  title?: string;
};

type Props = {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  pills?: EvidencePill[];
  actions?: EvidenceAction[];
  summaryCards?: EvidenceSummaryCard[];
  aiCard?: EvidenceSummaryCard | null;
  timelineItems?: EvidenceTimelineItem[];
  structured?: any;
  tagDetails?: any[] | null;
  smartTags?: any | null;
  structuredIntelligence?: any | null;
  intelligenceRows?: EvidenceFactRow[];
  provenanceRows?: EvidenceFactRow[];
};

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="ei-fact-row">
      <div className="ei-fact-row__label">{label}</div>
      <div className={`ei-fact-row__value ${mono ? "font-mono" : ""}`}>
        <div
          className={[
            "ei-fact-row__valueInner",
            mono ? "break-all" : "",
          ].join(" ")}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "-";
  }
}

export default function EvidenceOverviewPanel({
  eyebrow,
  title,
  subtitle,
  pills = [],
  actions = [],
  summaryCards = [],
  aiCard = null,
  timelineItems = [],
  structured = null,
  tagDetails = null,
  smartTags = null,
  structuredIntelligence = null,
  intelligenceRows = [],
  provenanceRows = [],
}: Props) {
  return (
    <div
      className="ei-shell"
      style={{ inlineSize: "100%", maxInlineSize: "100%", minInlineSize: 0 }}
    >
      <div className="ei-hero">
        {eyebrow ? <div className="ei-hero__eyebrow">{eyebrow}</div> : null}
        <h3 className="ei-hero__title">{title}</h3>
        {subtitle ? <p className="ei-hero__subtitle">{subtitle}</p> : null}

        {pills.length > 0 ? (
          <div className="ei-pill-row">
            {pills.map((pill, idx) => (
              <span
                key={`${pill.label}-${idx}`}
                className={`ei-pill ei-pill--${pill.tone}`}
              >
                {pill.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {actions.length > 0 ? (
        <div className="ei-toolbar">
          {actions.map((action, idx) => (
            <button
              key={`${action.label}-${idx}`}
              type="button"
              className={[
                "ei-toolbar__btn",
                action.primary ? "ei-toolbar__btn--primary" : "",
              ].join(" ")}
              onClick={action.onClick}
              title={action.title ?? action.label}
            >
              {action.icon ? action.icon : null}
              {action.label}
            </button>
          ))}
        </div>
      ) : null}

      {summaryCards.length > 0 ? (
        <div className="ei-summary-grid">
          {summaryCards.map((card, idx) => (
            <div
              key={`${String(card.label)}-${idx}`}
              className="ei-summary-card"
            >
              <span className="ei-summary-card__label">{card.label}</span>
              <strong className="ei-summary-card__value">{card.value}</strong>
              <small className="ei-summary-card__meta">
                {card.meta ?? "-"}
              </small>
            </div>
          ))}
        </div>
      ) : null}

      {aiCard ? (
        <div className="ei-summary-card">
          <span className="ei-summary-card__label">{aiCard.label}</span>
          <strong className="ei-summary-card__value">{aiCard.value}</strong>
          <small className="ei-summary-card__meta">{aiCard.meta ?? "-"}</small>
        </div>
      ) : null}

      {timelineItems.length > 0 ? (
        <div className="ei-card">
          <div className="ei-card__head">
            <div className="ei-card__title">Chain of custody</div>
            <div className="ei-card__meta">Timeline-first provenance</div>
          </div>

          <div className="ei-timeline">
            {timelineItems.map((item) => (
              <div key={item.id} className="ei-timeline__item">
                <div
                  className={`ei-timeline__dot ei-timeline__dot--${item.tone}`}
                />
                <div className="ei-timeline__body">
                  <div className="ei-timeline__titleRow">
                    <div className="ei-timeline__title">{item.title}</div>
                    <div className="ei-timeline__time">
                      {formatDateTime(item.time)}
                    </div>
                  </div>
                  <div className="ei-timeline__detail">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {structured || tagDetails?.length || smartTags || structuredIntelligence ? (
        <StructuredTags
          structured={structured}
          tagDetails={tagDetails}
          smartTags={smartTags}
          structuredIntelligence={structuredIntelligence}
        />
      ) : null}

      {intelligenceRows.length > 0 ? (
        <div className="ei-card">
          <div className="ei-card__head">
            <div className="ei-card__title">Source intelligence</div>
            <div className="ei-card__meta">Origin and publication context</div>
          </div>

          <div className="divide-y divide-[hsl(var(--border))]">
            {intelligenceRows.map((row, idx) => (
              <Row
                key={`${row.label}-${idx}`}
                label={row.label}
                value={row.value}
                mono={row.mono}
              />
            ))}
          </div>
        </div>
      ) : null}

      {provenanceRows.length > 0 ? (
        <div className="ei-card">
          <div className="ei-card__head">
            <div className="ei-card__title">Raw provenance</div>
            <div className="ei-card__meta">Traceability and audit fields</div>
          </div>

          <div className="divide-y divide-[hsl(var(--border))]">
            {provenanceRows.map((row, idx) => (
              <Row
                key={`${row.label}-${idx}`}
                label={row.label}
                value={row.value}
                mono={row.mono}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
