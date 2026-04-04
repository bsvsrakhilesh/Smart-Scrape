import test from "node:test";
import assert from "node:assert/strict";

import { buildCaseTimelineView } from "../services/caseTimeline.service";

test("buildCaseTimelineView filters URL entries and preserves chronological order", () => {
  const out = buildCaseTimelineView({
    entries: [
      {
        id: "evt-late",
        itemType: "event",
        label: "Late URL event",
        summary: null,
        sortDate: "2024-02-10T00:00:00.000Z",
        sortDateEnd: null,
        sortPrecision: "DAY",
        actorAgency: { id: "a1", name: "CPCB", shortName: "CPCB" },
        createdAt: "2024-02-10T01:00:00.000Z",
        updatedAt: "2024-02-10T01:00:00.000Z",
        event: {
          eventDate: "2024-02-10T00:00:00.000Z",
          eventDateText: "10 Feb 2024",
          eventDatePrecision: "DAY",
          usedDocumentDateFallback: false,
        },
        provenance: {
          sourceDocument: { kind: "URL" },
          documentRevision: { captureType: "URL_TEXT" },
        },
      },
      {
        id: "pos-file",
        itemType: "position",
        label: "File position",
        summary: null,
        sortDate: "2024-01-05T00:00:00.000Z",
        sortDateEnd: null,
        sortPrecision: "DAY",
        actorAgency: { id: "a2", name: "DPCC", shortName: "DPCC" },
        createdAt: "2024-01-05T01:00:00.000Z",
        updatedAt: "2024-01-05T01:00:00.000Z",
        position: {
          effectiveDate: "2024-01-05T00:00:00.000Z",
          effectiveDateText: "5 Jan 2024",
          effectiveDatePrecision: "DAY",
        },
        provenance: {
          sourceDocument: { kind: "FILE" },
          documentRevision: { captureType: "UPLOAD" },
        },
      },
      {
        id: "evt-early",
        itemType: "event",
        label: "Early URL event",
        summary: null,
        sortDate: "2024-01-10T00:00:00.000Z",
        sortDateEnd: null,
        sortPrecision: "MONTH",
        actorAgency: { id: "a1", name: "CPCB", shortName: "CPCB" },
        createdAt: "2024-01-10T01:00:00.000Z",
        updatedAt: "2024-01-10T01:00:00.000Z",
        event: {
          eventDate: "2024-01-10T00:00:00.000Z",
          eventDateText: "Jan 2024",
          eventDatePrecision: "MONTH",
          usedDocumentDateFallback: true,
        },
        provenance: {
          sourceDocument: { kind: "URL" },
          documentRevision: { captureType: "URL_PDF" },
        },
      },
    ],
    filters: {
      actorAgencyId: null,
      dateFrom: null,
      dateTo: null,
      sourceType: "URL",
      groupBy: "actor",
      limit: 50,
    },
  });

  assert.equal(out.filters.sourceType, "URL");
  assert.equal(out.summary.entryCount, 2);
  assert.equal(out.summary.eventCount, 2);
  assert.equal(out.summary.positionCount, 0);
  assert.equal(out.summary.approximateDateCount, 1);
  assert.equal(out.summary.documentDateFallbackCount, 1);
  assert.deepEqual(
    out.entries.map((entry) => entry.id),
    ["evt-early", "evt-late"],
  );
  assert.equal(out.groups.length, 1);
  assert.equal(out.groups[0]?.key, "a1");
  assert.equal(out.groups[0]?.entryCount, 2);
});

test("buildCaseTimelineView groups by source type and tracks temporal basis counts", () => {
  const out = buildCaseTimelineView({
    entries: [
      {
        id: "evt-url",
        itemType: "event",
        label: "URL event",
        summary: null,
        sortDate: "2024-02-01T00:00:00.000Z",
        sortDateEnd: null,
        sortPrecision: "DAY",
        actorAgency: { id: "a1", name: "CPCB" },
        createdAt: "2024-02-01T01:00:00.000Z",
        updatedAt: "2024-02-01T01:00:00.000Z",
        event: {
          eventDate: "2024-02-01T00:00:00.000Z",
          eventDateText: "1 Feb 2024",
          eventDatePrecision: "DAY",
          usedDocumentDateFallback: false,
        },
        provenance: {
          sourceDocument: { kind: "URL" },
          documentRevision: { captureType: "URL_TEXT" },
        },
      },
      {
        id: "pos-file",
        itemType: "position",
        label: "File position",
        summary: null,
        sortDate: "2024-02-02T00:00:00.000Z",
        sortDateEnd: null,
        sortPrecision: "DAY",
        actorAgency: { id: "a2", name: "DPCC" },
        createdAt: "2024-02-02T01:00:00.000Z",
        updatedAt: "2024-02-02T01:00:00.000Z",
        position: {
          effectiveDate: "2024-02-02T00:00:00.000Z",
          effectiveDateText: "2 Feb 2024",
          effectiveDatePrecision: "DAY",
        },
        provenance: {
          sourceDocument: { kind: "FILE" },
          documentRevision: { captureType: "UPLOAD" },
        },
      },
    ],
    filters: {
      actorAgencyId: null,
      dateFrom: null,
      dateTo: null,
      sourceType: null,
      groupBy: "sourceType",
      limit: 50,
    },
  });

  assert.equal(out.summary.sourceTypeCounts.URL, 1);
  assert.equal(out.summary.sourceTypeCounts.FILE, 1);
  assert.equal(out.summary.byTemporalBasis.event_date, 1);
  assert.equal(out.summary.byTemporalBasis.position_effective_date, 1);
  assert.equal(out.groups.length, 2);
  assert.deepEqual(out.groups.map((group) => group.key).sort(), [
    "FILE",
    "URL",
  ]);
});
