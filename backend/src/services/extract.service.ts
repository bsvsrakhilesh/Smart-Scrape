import axios from 'axios';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import pdf from 'pdf-parse';

export async function extractTextFromUrl(url: string): Promise<string> {
  const { data: html } = await axios.get<string>(url, { timeout: 15000, responseType: 'text' });
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const title = article?.title || dom.window.document.title || '';
  const text = article?.textContent || dom.window.document.body?.textContent || '';
  return `${title}\n\n${text}`.trim();
}

export async function extractTextFromFile(filePath: string, mimeType: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (mimeType?.startsWith('text/') || ext === '.txt') {
    try { return (await readFile(filePath, 'utf8')).toString(); } catch { /* fallthrough */ }
  }
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const buf = await readFile(filePath);
    const out = await pdf(buf);
    return out.text || '';
  }
  try { return (await readFile(filePath, 'utf8')).toString(); } catch { return ''; }
}
