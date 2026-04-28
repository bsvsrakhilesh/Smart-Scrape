import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAiTagUrlQueueJobId,
  buildIngestionQueueJobId,
} from "../queues/queueJobId.util";

test("buildIngestionQueueJobId creates a stable safe id for ingest mode", () => {
  const jobId = buildIngestionQueueJobId("source-123", "ingest");

  assert.equal(jobId, "source-123__ingest");
  assert.equal(jobId.includes(":"), false);
});

test("buildIngestionQueueJobId sanitizes unsupported characters", () => {
  const jobId = buildIngestionQueueJobId("source:abc/xyz", "ocr");

  assert.equal(jobId, "source_abc_xyz__ocr");
  assert.equal(jobId.includes(":"), false);
});

test("buildAiTagUrlQueueJobId creates a BullMQ-safe URL tag job id", () => {
  const jobId = buildAiTagUrlQueueJobId(89);

  assert.equal(jobId, "ai-tag-url__89");
  assert.equal(jobId.includes(":"), false);
});
