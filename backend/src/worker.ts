import { EventEmitter } from "events";

// BullMQ wires several Redis-backed workers in one process here. Give the
// process a slightly higher listener budget so shared Redis socket listeners
// do not trigger noisy MaxListeners warnings during normal operation.
EventEmitter.defaultMaxListeners = 20;

async function startWorkers() {
  await Promise.all([
    import("./workers/embedding.worker"),
    import("./workers/ingestion.worker"),
    import("./workers/aiTagFile.worker"),
    import("./workers/aiTagUrl.worker"),
    import("./workers/savedUrlOperation.worker"),
  ]);

  console.log(
    "Workers started: embeddings + ingestion + ai-tag-file + ai-tag-url + saved-url-operations",
  );
}

void startWorkers();
