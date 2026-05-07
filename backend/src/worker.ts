import "./workers/embedding.worker";
import "./workers/ingestion.worker";
import "./workers/aiTagUrl.worker";
import "./workers/savedUrlOperation.worker";

console.log(
  "Workers started: embeddings + ingestion + ai-tag-url + saved-url-operations",
);
