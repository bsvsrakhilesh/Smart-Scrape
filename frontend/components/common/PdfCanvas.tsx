import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, PDFDocumentProxy } from "pdfjs-dist";

// Ensure a worker for pdf.js (Vite-compatible)
let pdfWorkerPortReady: Promise<void> | null = null;
async function ensurePdfWorker() {
  if (
    (GlobalWorkerOptions as any).workerPort ||
    (GlobalWorkerOptions as any).workerSrc
  )
    return;
  if (pdfWorkerPortReady) return pdfWorkerPortReady;

  pdfWorkerPortReady = (async () => {
    try {
      const url = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      );
      const worker = new Worker(url, { type: "module" });
      (GlobalWorkerOptions as any).workerPort = worker;
    } catch {
      (GlobalWorkerOptions as any).workerSrc =
        "https://unpkg.com/pdfjs-dist@4/build/pdf.worker.min.mjs";
    }
  })();
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

export default function PdfCanvas({
  url,
  page,
  onReady,
  onError,
  onRendered,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);

  // Load the document (retry once with disableRange)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensurePdfWorker();
        try {
          const task = getDocument({ url });
          const _pdf = await task.promise;
          if (cancelled) return;
          setPdf(_pdf);
          onReady?.(_pdf.numPages);
          return;
        } catch {
          const task2 = getDocument({ url, disableRange: true });
          const _pdf2 = await task2.promise;
          if (cancelled) return;
          setPdf(_pdf2);
          onReady?.(_pdf2.numPages);
          return;
        }
      } catch (e: any) {
        if (!cancelled) onError?.(e?.message || "Failed to load PDF");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Render requested page whenever pdf or page changes
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const safePage = Math.min(Math.max(1, page), pdf.numPages);
      const pg = await pdf.getPage(safePage);
      if (cancelled) return;
      const viewport = pg.getViewport({ scale: 1.5 });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderTask = pg.render({ canvasContext: ctx, viewport });
      await renderTask.promise;
      if (!cancelled) onRendered?.();
    })().catch((e) => onError?.(e?.message || "Render failed"));
    return () => {
      cancelled = true;
    };
  }, [pdf, page, onError]);

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        className="rounded-xl border dark:border-neutral-800 shadow-sm"
      />
    </div>
  );
}
