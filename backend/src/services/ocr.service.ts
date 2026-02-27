import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

function sortPagePngs(files: string[]) {
  const rx = /-(\d+)\.png$/i;
  return files
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .map((f) => {
      const m = f.match(rx);
      return { f, n: m ? Number(m[1]) : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.n - b.n)
    .map((x) => x.f);
}

async function safeExec(
  bin: string,
  args: string[],
  opts: { timeoutMs: number; cwd?: string },
) {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // OCR text can be big
    });
    return stdout ?? "";
  } catch (e: any) {
    // Make missing-dependency failures obvious
    const msg = String(e?.message || e);
    if (msg.includes("ENOENT")) {
      throw new Error(
        `OCR dependency missing: ${bin} not found in PATH. (Docker should install poppler-utils + tesseract-ocr.)`,
      );
    }
    throw new Error(`${bin} failed: ${msg}`);
  }
}

export async function ocrPdfToPagesFromFile(
  storagePath: string,
  opts: {
    dpi: number;
    langs: string;
    maxPages: number;
    renderTimeoutMs: number;
    pageTimeoutMs: number;
  },
): Promise<{ pageNumber: number; text: string }[]> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "smartscrape-ocr-"));
  const prefix = path.join(tmp, "page");

  try {
    // Render first N pages to PNG
    // Output files: page-1.png, page-2.png, ...
    const renderArgs = [
      "-f",
      "1",
      "-l",
      String(Math.max(1, opts.maxPages)),
      "-r",
      String(Math.max(72, opts.dpi)),
      "-png",
      storagePath,
      prefix,
    ];

    await safeExec("pdftoppm", renderArgs, {
      timeoutMs: opts.renderTimeoutMs,
    });

    const files = sortPagePngs(await fs.readdir(tmp));
    if (!files.length) {
      throw new Error("OCR render produced no images (pdftoppm output empty).");
    }

    const pages: { pageNumber: number; text: string }[] = [];

    for (const f of files) {
      const m = f.match(/-(\d+)\.png$/i);
      const pageNumber = m ? Number(m[1]) : pages.length + 1;

      const imgPath = path.join(tmp, f);

      // tesseract <image> stdout -l <langs> --dpi <dpi>
      const tArgs = [
        imgPath,
        "stdout",
        "-l",
        opts.langs || "eng",
        "--dpi",
        String(Math.max(72, opts.dpi)),
        "-c",
        "preserve_interword_spaces=1",
      ];

      const out = await safeExec("tesseract", tArgs, {
        timeoutMs: opts.pageTimeoutMs,
      });

      pages.push({
        pageNumber,
        text: (out || "").replace(/\u0000/g, "").trim(),
      });
    }

    return pages;
  } finally {
    // Best-effort cleanup
    try {
      await fs.rm(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
