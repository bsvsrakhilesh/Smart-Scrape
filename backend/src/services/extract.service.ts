import axios from 'axios';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import pdf from 'pdf-parse';
import dns from 'dns/promises';
import net from 'net';
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs/promises";

const MAX_HTML_BYTES = Number(process.env.EXTRACT_MAX_HTML_BYTES || 5 * 1024 * 1024); // 5MB
const PREVIEW_SNIPPET_CHARS = Number(process.env.EXTRACT_PREVIEW_CHARS || 260);
const USER_AGENT = process.env.EXTRACT_USER_AGENT || 'SmartScrapeBot/1.0';

function ipv4ToInt(ip: string) {
  const parts = ip.split('.').map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateIp(ip: string) {
  const family = net.isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    if (n == null) return true;

    const inRange = (a: string, b: string) => {
      const na = ipv4ToInt(a)!;
      const nb = ipv4ToInt(b)!;
      return n >= na && n <= nb;
    };

    return (
      inRange('10.0.0.0', '10.255.255.255') ||         // 10/8
      inRange('172.16.0.0', '172.31.255.255') ||       // 172.16/12
      inRange('192.168.0.0', '192.168.255.255') ||     // 192.168/16
      inRange('127.0.0.0', '127.255.255.255') ||       // loopback
      inRange('169.254.0.0', '169.254.255.255') ||     // link-local
      inRange('0.0.0.0', '0.255.255.255')              // "this network"
    );
  }

  if (family === 6) {
    const t = ip.toLowerCase();
    return (
      t === '::1' ||                 // loopback
      t.startsWith('fc') || t.startsWith('fd') || // fc00::/7 unique local
      t.startsWith('fe8') || t.startsWith('fe9') || t.startsWith('fea') || t.startsWith('feb') // fe80::/10 link-local (approx)
    );
  }

  // Not a valid IP string => treat as unsafe if we ever get here.
  return true;
}

async function assertSafeUrl(rawUrl: string) {
  const u = new URL(rawUrl);

  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Only http/https URLs are allowed');
  }

  const host = (u.hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local')) {
    throw new Error('Blocked hostname');
  }

  // DNS resolve and block private/internal IPs (SSRF protection)
  const addrs = await dns.lookup(host, { all: true });
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error('Blocked private/internal IP');
    }
  }
}

function cleanSnippet(text: string) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\u0000/g, '')
    .trim();
}

export async function extractTextFromUrl(url: string): Promise<string> {
  await assertSafeUrl(url);

  const { data: html } = await axios.get<string>(url, {
    timeout: 15000,
    responseType: 'text',
    maxContentLength: MAX_HTML_BYTES,
    maxBodyLength: MAX_HTML_BYTES,
    headers: { 'User-Agent': USER_AGENT },
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const title = article?.title || dom.window.document.title || '';
  const text = article?.textContent || dom.window.document.body?.textContent || '';
  return `${title}\n\n${text}`.trim();
}

export async function extractPreviewFromUrl(url: string): Promise<{ title: string; snippet: string }> {
  await assertSafeUrl(url);

  const { data: html } = await axios.get<string>(url, {
    timeout: 15000,
    responseType: 'text',
    maxContentLength: MAX_HTML_BYTES,
    maxBodyLength: MAX_HTML_BYTES,
    headers: { 'User-Agent': USER_AGENT },
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const dom = new JSDOM(html, { url });

  const ogTitle =
    dom.window.document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
    dom.window.document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
    '';

  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const title = (article?.title || ogTitle || dom.window.document.title || url).trim();

  const rawText = article?.textContent || dom.window.document.body?.textContent || '';
  const snippet = cleanSnippet(rawText).slice(0, PREVIEW_SNIPPET_CHARS);

  return { title, snippet };
}

export async function extractTextFromFile(filePath: string, mimeType: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (mimeType?.startsWith('text/') || ext === '.txt') {
    try {
      return (await readFile(filePath, 'utf8')).toString();
    } catch {
      /* fallthrough */
    }
  }
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const buf = await readFile(filePath);
    const out = await pdf(buf);
    return out.text || '';
  }
  try {
    return (await readFile(filePath, 'utf8')).toString();
  } catch {
    return '';
  }
}

export async function extractPdfPagesFromFile(storagePath: string): Promise<
  { pageNumber: number; text: string }[]
> {
  const buf = await fs.readFile(storagePath);
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const pdf = await loadingTask.promise;

  const pages: { pageNumber: number; text: string }[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Join items in reading order (good enough for v1)
    const strings = content.items
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);

    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber: i, text });
  }

  return pages;
}
