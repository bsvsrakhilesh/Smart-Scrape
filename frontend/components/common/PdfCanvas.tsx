import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from "pdfjs-dist";
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

// Use a bundled same-origin worker so PDF preview stays CSP-safe in production.
let pdfWorkerPortReady: Promise<boolean> | null = null;

async function ensurePdfWorker() {
  if ((GlobalWorkerOptions as any).workerPort) return true;
  if (pdfWorkerPortReady) return pdfWorkerPortReady;

  pdfWorkerPortReady = Promise.resolve().then(() => {
    try {
      (GlobalWorkerOptions as any).workerSrc = undefined;
      (GlobalWorkerOptions as any).workerPort = new PdfJsWorker();
      return true;
    } catch {
      (GlobalWorkerOptions as any).workerPort = null;
      return false;
    }
  });

  return pdfWorkerPortReady;
}

type Props = {
  url: string;
  /** 1-indexed page number, controlled by parent */
  page: number;
  /** Called once the document loads with total pages */
  onReady?: (numPages: number) => void;
  /** Called on load/render failure */
  onError?: (message?: string) => void;
  /** Called after a page is rendered */
  onRendered?: () => void;
};

async function fetchPdfBytes(url: string, signal: AbortSignal) {
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/pdf, application/octet-stream;q=0.9, */*;q=0.1",
    },
    signal,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.clone().json();
      detail = body?.message ? `: ${body.message}` : "";
    } catch {
      try {
        const text = await res.clone().text();
        detail = text ? `: ${text.slice(0, 160)}` : "";
      } catch {
        detail = "";
      }
    }
    throw new Error(`Preview request failed with HTTP ${res.status}${detail}`);
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 8) {
    throw new Error("Preview response was empty.");
  }

  return new Uint8Array(buffer);
}

export default function PdfCanvas({
  url,
  page,
  onReady,
  onError,
  onRendered,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const callbacksRef = useRef({ onReady, onError, onRendered });

  useEffect(() => {
    callbacksRef.current = { onReady, onError, onRendered };
  }, [onReady, onError, onRendered]);

  // Load the document. Try pdf.js URL streaming first, then fall back to an
  // authenticated full fetch so previews keep working behind proxies/auth.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let loadedPdf: PDFDocumentProxy | null = null;

    (async () => {
      try {
        const workerReady = await ensurePdfWorker();

        try {
          const task = getDocument({
            url,
            withCredentials: true,
            disableWorker: !workerReady,
            httpHeaders: {
              Accept:
                "application/pdf, application/octet-stream;q=0.9, */*;q=0.1",
            },
          });
          const _pdf = await task.promise;
          if (cancelled) return;
          loadedPdf = _pdf;
          setPdf(_pdf);
          callbacksRef.current.onReady?.(_pdf.numPages);
          return;
        } catch {
          const data = await fetchPdfBytes(url, controller.signal);
          if (cancelled) return;
          const task2 = getDocument({
            data,
            disableWorker: true,
            disableRange: true,
            disableStream: true,
          });
          const _pdf2 = await task2.promise;
          if (cancelled) return;
          loadedPdf = _pdf2;
          setPdf(_pdf2);
          callbacksRef.current.onReady?.(_pdf2.numPages);
          return;
        }
      } catch (e: any) {
        if (!cancelled) {
          callbacksRef.current.onError?.(e?.message || "Failed to load PDF");
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (loadedPdf) {
        void loadedPdf.destroy().catch(() => {});
      }
    };
  }, [url]);

  // Render requested page whenever pdf or page changes
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | null =
      null;

    (async () => {
      const safePage = Math.min(Math.max(1, page), pdf.numPages);
      const pg = await pdf.getPage(safePage);
      if (cancelled) return;
      const viewport = pg.getViewport({ scale: 1.5 });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      renderTask = pg.render({ canvasContext: ctx, viewport });
      await renderTask.promise;
      if (!cancelled) callbacksRef.current.onRendered?.();
    })().catch((e) => {
      if (!cancelled && e?.name !== "RenderingCancelledException") {
        callbacksRef.current.onError?.(e?.message || "Render failed");
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, page]);

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        className="max-w-full rounded-xl border shadow-sm dark:border-neutral-800"
      />
    </div>
  );
}
