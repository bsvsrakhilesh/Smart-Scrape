// SPDX-License-Identifier: Apache-2.0

import app from './app';
import { healthCheck } from "./services/pyTaggerClient";

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
  // Loud startup check so "tagging stopped working" is immediately obvious
  healthCheck()
    .then(() => {
      console.log(`ai-tagger reachable at ${process.env.TAGGER_PY_URL || "http://localhost:7071"}`);
    })
    .catch((e) => {
      console.error(
        `ai-tagger NOT reachable. TAGGER_PY_URL=${process.env.TAGGER_PY_URL || "http://localhost:7071"}`,
        e?.message || e
      );
      console.error(
        "Fix: set TAGGER_PY_URL to the ai-tagger service address (NOT localhost if running in another container/host)."
      );
    });

});


