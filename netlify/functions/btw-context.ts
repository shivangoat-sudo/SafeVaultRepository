type ContextCategory =
  | 'alcohol_retail'
  | 'passenger_transport'
  | 'cinema_culture'
  | 'sports'
  | 'telecom'
  | 'software_it'
  | 'fuel'
  | 'lodging'
  | 'food_retail'
  | 'pharmacy'
  | 'books_media'
  | 'construction'
  | 'professional_services'
  | 'mixed_or_unknown';

type LookupRequest = { queries?: string[] };
type LookupResult = { query: string; category: ContextCategory; confidence: number; source: string | null };

const MAX_QUERIES = 25;
const MAX_QUERY_LENGTH = 140;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 8000;
const cache = new Map<string, { expiresAt: number; result: LookupResult }>();

const CATEGORY_RULES: Array<{ category: ContextCategory; patterns: RegExp[]; confidence: number }> = [
  { category: 'alcohol_retail', patterns: [/slijter/i, /drankenspeciaalzaak/i, /wijnhandel/i, /liquor store/i, /wine shop/i, /alcoholische dranken/i], confidence: 0.96 },
  { category: 'passenger_transport', patterns: [/openbaar vervoer/i, /personenvervoer/i, /rail passenger/i, /busvervoer/i, /taxivervoer/i, /trein/i], confidence: 0.96 },
  { category: 'cinema_culture', patterns: [/bioscoop/i, /cinema/i, /theater/i, /museum/i, /concert/i], confidence: 0.95 },
  { category: 'sports', patterns: [/sportschool/i, /fitness/i, /sportaccommodatie/i, /gym/i, /zwembad/i, /sauna/i], confidence: 0.94 },
  { category: 'telecom', patterns: [/telecom/i, /internetprovider/i, /mobiele telefonie/i, /telecommunications/i], confidence: 0.95 },
  { category: 'software_it', patterns: [/software/i, /saas/i, /cloud computing/i, /webhosting/i, /it[- ]dienst/i, /technology company/i], confidence: 0.92 },
  { category: 'fuel', patterns: [/tankstation/i, /petrol station/i, /gas station/i, /brandstof/i], confidence: 0.96 },
  { category: 'lodging', patterns: [/hotel/i, /accommodation/i, /logies/i, /overnachting/i], confidence: 0.95 },
  { category: 'food_retail', patterns: [/supermarkt/i, /grocery store/i, /supermarket/i, /food retailer/i], confidence: 0.88 },
  { category: 'pharmacy', patterns: [/apotheek/i, /pharmacy/i, /pharmaceutical/i], confidence: 0.92 },
  { category: 'books_media', patterns: [/boekhandel/i, /bookstore/i, /publisher/i, /uitgeverij/i], confidence: 0.90 },
  { category: 'construction', patterns: [/bouwmarkt/i, /hardware store/i, /bouwbedrijf/i, /installatiebedrijf/i], confidence: 0.88 },
  { category: 'professional_services', patterns: [/accountant/i, /accountancy/i, /advocatenkantoor/i, /consultancy/i, /marketingbureau/i], confidence: 0.90 },
];

function cleanQuery(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b(?:NL)?\d{2}[A-Z]{0,2}\d{4,30}\b/gi, ' ')
    .replace(/\b\d{1,3}(?:[.,]\d{1,2})?\s*(?:EUR|EURO|€)\b/gi, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

function classifySearchText(text: string): { category: ContextCategory; confidence: number } {
  const hits = CATEGORY_RULES
    .map(rule => ({ ...rule, hits: rule.patterns.filter(pattern => pattern.test(text)).length }))
    .filter(rule => rule.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.confidence - a.confidence);

  if (!hits.length) return { category: 'mixed_or_unknown', confidence: 0 };
  const best = hits[0];
  return { category: best.category, confidence: Math.min(0.99, best.confidence + Math.min(0.03, (best.hits - 1) * 0.01)) };
}

async function searchJina(query: string): Promise<{ text: string; source: string | null }> {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) return { text: '', source: null };

  const url = `https://s.jina.ai/${encodeURIComponent(`${query} Netherlands company business official`)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/plain' },
      signal: controller.signal,
    });
    if (!response.ok) return { text: '', source: null };

    const text = (await response.text()).slice(0, 12000);
    const sourceMatch = text.match(/https?:\/\/[^\s)]+/i);
    return { text, source: sourceMatch?.[0] ?? null };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body: LookupRequest;
  try { body = await req.json() as LookupRequest; } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const queries = Array.from(new Set((body.queries ?? []).map(cleanQuery).filter(Boolean))).slice(0, MAX_QUERIES);
  const results: LookupResult[] = [];

  for (const query of queries) {
    const cached = cache.get(query);
    if (cached && cached.expiresAt > Date.now()) {
      results.push(cached.result);
      continue;
    }

    try {
      const { text, source } = await searchJina(query);
      const classification = classifySearchText(text);
      const result: LookupResult = { query, category: classification.category, confidence: classification.confidence, source };
      cache.set(query, { expiresAt: Date.now() + CACHE_TTL_MS, result });
      results.push(result);
    } catch {
      results.push({ query, category: 'mixed_or_unknown', confidence: 0, source: null });
    }
  }

  return Response.json({ results });
}
