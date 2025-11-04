/* Phrase-aware + unigram tagger (PMI + TF with domain boosts). */
const EN_STOP = new Set(`
a about above across after again against all almost alone along already also although always am among amount
an and another any anyhow anyone anything anyway anywhere are around as at back be became because become becomes
becoming been before behind being below beside besides between beyond both but by can cannot could
did do does doing done down due during each either else elsewhere enough especially etc even ever every everyone
everything everywhere except few first five for former formerly from further get give go had has have having
he hence her hereafter hereby herein hereupon hers herself him himself his how however hundred i ie if in inc indeed
into is it its itself keep last latter latterly least less ltd made many may me meanwhile might mine more moreover most mostly
move much must my myself name namely neither never nevertheless next nine no nobody none noone nor not nothing now
nowhere of off often on once one only onto or other others otherwise our ours ourselves out over own part perhaps please put
rather re same see seem seemed seeming seems serious several she should show side since sincere six sixty so some somehow
someone something sometime sometimes somewhere still such system take ten than that the their them themselves then thence
there thereafter thereby therefore therein thereupon these they thin third this those though three through throughout thru
thus to together too top toward towards under until up upon us very via was we well were what whatever
when whence whenever where whereafter whereas whereby wherein whereupon wherever whether which while whither who whoever
whole whom whose why will with within without would yet you your yours yourself yourselves
`.trim().split(/\s+/));

const NEWS_STOP = new Set(`
section length words body reprint rights timescontent com byline photo agency staff reporter exclusive edit editpage oped
breaking live update updated edition archive press release syndicate state bureau city bureau special correspondent pti tnn ani afp ap
monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december
today yesterday tomorrow
`.trim().split(/\s+/));

const OUTLET_STOP = new Set(`
times india toi indianexpress hindustantimes ndtv livemint scroll quint thehindu telegraph deccan herald ht
`.trim().split(/\s+/));

const DOMAIN_BOOST: Record<string, number> = {
  pm25: 1.6, pm10: 1.5, iodide: 1.4, nanoparticle: 1.5, seeding: 1.4, cloud: 1.2,
  airspace: 1.3, aircraft: 1.2, sortie: 1.2, cessna: 1.3, impact: 1.1, dew: 1.2,
  altitude: 1.2, wind: 1.1, feasibility: 1.3, meteorological: 1.3, caaqms: 1.6,
  kanpur: 1.2, iit: 1.2, silver: 1.2
};

const TOKEN_RX = /[A-Za-z][A-Za-z0-9.\-]*/g;

function normalizeToken(tok: string): string {
  let t = tok.replace(/[’'"()[\]{}.,:;!?–—/\\]/g, '').toLowerCase();
  t = t.replace(/real-time/g, 'realtime')
       .replace(/pm\s*2\.?5/gi, 'pm25')
       .replace(/pm\s*10/gi, 'pm10')
       .replace(/-/g, '');
  return t;
}
function basicLemma(t: string): string {
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (t.endsWith('ves') && t.length > 4) return t.slice(0, -3) + 'f';
  if (t.endsWith('es') && t.length > 4 && !t.endsWith('ies') && !t.endsWith('ses')) return t.slice(0, -2);
  if (t.endsWith('s') && t.length > 4 && !t.endsWith('ss') && !t.endsWith('us')) return t.slice(0, -1);
  return t;
}

export function stripNewsBoilerplate(text: string): string {
  const headerPatterns = [
    /^\s*section:\s*\w+.*$/i,
    /^\s*length:\s*\d+.*$/i,
    /^\s*(body|byline)\s*$/i,
    /^\s*for reprint rights:.*$/i,
    /^\s*(updated|published)\s*:\s*.*$/i,
    /^\s*(the\s+times\s+of\s+india|toi).*/i,
    /^\s*(delhi|mumbai|bengaluru|kolkata|chennai|hyderabad)\s*:\s*.*/i,
    /^\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday).*/i,
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}.*/i
  ];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => !!l && !headerPatterns.some((rx) => rx.test(l)))
    .join('\n');
}

function tokenize(text: string): string[] {
  const toks: string[] = [];
  const raw = text.match(TOKEN_RX) || [];
  for (const r of raw) {
    const n = basicLemma(normalizeToken(r));
    if (!n || n.length < 3) continue;
    if (/^\d+$/.test(n)) continue;
    if (EN_STOP.has(n) || NEWS_STOP.has(n) || OUTLET_STOP.has(n)) continue;
    toks.push(n);
  }
  return toks;
}

function count<T>(arr: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

function genPhrases(tokens: string[], maxGram = 3): string[][] {
  const out: string[][] = [];
  for (let n = 2; n <= maxGram; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const ng = tokens.slice(i, i + n);
      const head = ng[0], tail = ng[ng.length - 1];
      if (EN_STOP.has(head) || NEWS_STOP.has(head) || OUTLET_STOP.has(head)) continue;
      if (EN_STOP.has(tail) || NEWS_STOP.has(tail) || OUTLET_STOP.has(tail)) continue;
      out.push(ng);
    }
  }
  return out;
}

function pmiScores(tokens: string[], tfUni: Map<string, number>, tfPhr: Map<string, number>): Map<string, number> {
  const total = Array.from(tfUni.values()).reduce((a, b) => a + b, 0) || 1;
  const pUni = new Map<string, number>();
  tfUni.forEach((v, k) => pUni.set(k, v / total));

  const pmi = new Map<string, number>();
  tfPhr.forEach((c, key) => {
    const terms = key.split('\t');
    const windows = Math.max(1, tokens.length - terms.length + 1);
    const pNg = c / windows;
    let denom = 1.0;
    for (const t of terms) denom *= (pUni.get(t) || 1e-12);
    const val = Math.log(Math.max(pNg / denom, 1e-12));
    pmi.set(key, val);
  });
  return pmi;
}

export type TaggerOpts = { maxGram?: number; pmiThresh?: number; topk?: number };

export function tagText(text: string, opts: TaggerOpts = {}) {
  const { maxGram = 3, pmiThresh = 1.2, topk = 20 } = opts;

  const cleaned = stripNewsBoilerplate(text);
  const tokens = tokenize(cleaned);

  const tfUni = count(tokens);
  const uniScores = new Map<string, number>();
  tfUni.forEach((c, w) => {
    const base = c * (DOMAIN_BOOST[w] || 1.0);
    uniScores.set(w, base);
  });

  const phrArr = genPhrases(tokens, maxGram);
  const tfPhr = new Map<string, number>();
  for (const ng of phrArr) {
    const key = ng.join('\t');
    tfPhr.set(key, (tfPhr.get(key) || 0) + 1);
  }
  const pmi = pmiScores(tokens, tfUni, tfPhr);
  const phScores = new Map<string, number>();
  tfPhr.forEach((c, key) => {
    const terms = key.split('\t');
    const p = pmi.get(key) || 0;
    if (p < pmiThresh) return;
    const avgWord = terms.reduce((s, t) => s + (uniScores.get(t) || 0), 0) / terms.length;
    const score = c * (avgWord + 1e-6) * (1 + p / 3);
    phScores.set(key, score);
  });

  const rankedPhrases = Array.from(phScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k.split('\t').join(' '));

  const used = new Set<string>();
  for (const p of rankedPhrases) p.split(' ').forEach((w) => used.add(w));

  const rankedUnigrams = Array.from(uniScores.entries()).sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const combined: string[] = [];

  for (const p of rankedPhrases) {
    combined.push(p);
    if (combined.length >= topk) break;
  }
  if (combined.length < topk) {
    for (const w of rankedUnigrams) {
      if (used.has(w)) continue;
      combined.push(w);
      if (combined.length >= topk) break;
    }
  }
  return { phrases: rankedPhrases.slice(0, topk), unigrams: rankedUnigrams.slice(0, topk), combined };
}
