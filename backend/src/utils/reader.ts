import type { Page } from "puppeteer";
import { createDom } from "./dom";
import { Readability } from "@mozilla/readability";

// NOTE: This version skips sanitize-html to avoid changing your lock file.
// If you later want sanitization, I can give you that patch too.

const PRINT_CSS = `
  @page { margin: 14mm; }
  html, body { padding: 0; margin: 0; }
  body { font: 14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans"; color:#111; }
  h1,h2,h3 { line-height: 1.25; }
  img,svg,video { max-width: 100%; height: auto; }
  figure { margin: 0 0 1em 0; }
  .ad,.ads,.advertisement,[id*="ad-"],[class*="ad-"],.adsbygoogle { display: none !important; }
  article { max-width: 780px; margin: 0 auto; }
`;

export async function setReadableContentOnPage(page: Page, url: string) {
  const res = await fetch(url as any, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept-language": "en-US,en;q=0.8",
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    },
  });

  if (!res.ok) throw new Error(`FETCH_FAILED:${res.status}`);

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const isHtml =
    ct.includes("text/html") || ct.includes("application/xhtml+xml");

  // IMPORTANT: never attempt Readability on PDFs/binary
  if (!isHtml) throw new Error(`NOT_HTML:${ct || "unknown"}`);

  const html = await res.text();

  const dom = createDom(html, url);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article || !article.content) throw new Error("Readability failed");

  const safe = article.content; // keep as-is (no sanitize to avoid new deps)

  const docHtml = `<!doctype html><html><head>
    <meta charset="utf-8"/><title>${article.title ?? ""}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <style>${PRINT_CSS}</style>
  </head><body><article>${safe}</article></body></html>`;

  await page.setContent(docHtml, { waitUntil: "load" });
}

export async function hardenLivePage(page: Page, originUrl: string) {
  const originHost = new URL(originUrl).hostname;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    let host = "";
    try {
      host = new URL(req.url()).hostname;
    } catch {}
    const thirdParty = host && host !== originHost;

    if (["websocket", "eventsource", "font", "media"].includes(type))
      return req.abort();
    if ((type === "fetch" || type === "xhr" || type === "script") && thirdParty)
      return req.abort();
    req.continue();
  });

  await page.addStyleTag({
    content: `
    .ad,.ads,.advertisement,[id*="ad-"],[class*="ad-"],.adsbygoogle,
    .sponsored,.promo,.subscription,.paywall,.newsletter { display: none !important; }
  `,
  });
}
