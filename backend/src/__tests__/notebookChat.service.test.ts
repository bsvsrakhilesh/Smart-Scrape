import test from "node:test";
import assert from "node:assert/strict";

import { assertSelectedNotebookSourcesAttached } from "../services/notebookChatGuards.service";

test("assertSelectedNotebookSourcesAttached accepts empty or attached source scopes", () => {
  assert.doesNotThrow(() =>
    assertSelectedNotebookSourcesAttached(undefined, ["source-1"]),
  );
  assert.doesNotThrow(() =>
    assertSelectedNotebookSourcesAttached([], ["source-1"]),
  );
  assert.doesNotThrow(() =>
    assertSelectedNotebookSourcesAttached(["source-1"], ["source-1", "source-2"]),
  );
});

test("assertSelectedNotebookSourcesAttached rejects stale selected source ids", () => {
  assert.throws(
    () =>
      assertSelectedNotebookSourcesAttached(
        ["source-1", "removed-source"],
        ["source-1"],
      ),
    (err: any) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /selected sources are no longer attached/i);
      return true;
    },
  );
});
