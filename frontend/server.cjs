// server.cjs (CommonJS so it works even with "type":"module" in package.json)
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// For Node < 18, polyfill fetch:
if (typeof fetch === 'undefined') {
  global.fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

const app = express();
app.use(cors());

// Optional: human-friendly root
app.get('/', (_req, res) => {
  res.type('text/plain').send(
    'Search proxy is running.\nUse /api/health or /api/search?q=site:example.com%20keywords'
  );
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing q' });

    const key = process.env.GOOGLE_CSE_KEY;
    const cx  = process.env.GOOGLE_CSE_CX;
    if (!key || !cx) {
      return res.status(500).json({ error: 'Missing GOOGLE_CSE_KEY or GOOGLE_CSE_CX' });
    }

    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', key);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', q);
    url.searchParams.set('num', '10');

    const r = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    let body;
    try { body = ct.includes('application/json') ? JSON.parse(text) : { raw: text }; }
    catch { body = { raw: text }; }

    if (!r.ok) {
      const message = body?.error?.message || body?.raw || `HTTP ${r.status}`;
      console.error('[proxy] Google API error:', r.status, message);
      return res.status(r.status).json({ error: message, status: r.status });
    }

    return res.status(200).json(body);
  } catch (err) {
    console.error('[proxy] Uncaught error:', err);
    return res.status(500).json({ error: err?.message || 'Server error' });
  }
});

const PORT = process.env.PORT || 5174;
app.listen(PORT, () => console.log(`[proxy] listening on http://localhost:${PORT}`));
