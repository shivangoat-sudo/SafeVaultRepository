import type { RawTransaction } from './btwSafeTypes';

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

type ContextResult = { query: string; category: ContextCategory; confidence: number; source: string | null };

const LOCAL_CONTEXT: Array<{ category: ContextCategory; pattern: RegExp }> = [
  { category: 'alcohol_retail', pattern: /\b(gall\s*&?\s*gall|gall\s+and\s+gall|slijterij|drankenspeciaalzaak)\b/i },
  { category: 'passenger_transport', pattern: /\b(ns|arriva|ret|gvb|connexxion|nederlandse spoorwegen)\b/i },
  { category: 'cinema_culture', pattern: /\b(path[ée]|pathe|bioscoop|theater|museum)\b/i },
  { category: 'sports', pattern: /\b(basic[-\s]?fit|fit\s*for\s*free|sportschool|fitnesscentrum)\b/i },
  { category: 'telecom', pattern: /\b(kpn|vodafone|odido|ziggo)\b/i },
  { category: 'software_it', pattern: /\b(transip|exact\s+online|afas)\b/i },
  { category: 'fuel', pattern: /\b(shell|bp|esso|tango|totalenergies|texaco)\b/i },
  { category: 'lodging', pattern: /\b(hotel|booking\.com|airbnb)\b/i },
  { category: 'construction', pattern: /\b(gamma|karwei|praxis|bouwmarkt)\b/i },
];

function cleanDescription(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b(?:NL)?\d{2}[A-Z]{0,2}\d{4,30}\b/gi, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function localCategory(query: string): ContextCategory | null {
  return LOCAL_CONTEXT.find(rule => rule.pattern.test(query))?.category ?? null;
}

function contextMarker(result: ContextResult): string {
  if (result.category === 'mixed_or_unknown' || result.confidence < 0.85) return '';
  const labels: Record<Exclude<ContextCategory, 'mixed_or_unknown'>, string> = {
    alcohol_retail: 'slijterij/drankenspeciaalzaak; alcoholische dranken',
    passenger_transport: 'personenvervoer/openbaar vervoer',
    cinema_culture: 'bioscoop/culturele of recreatieve toegang',
    sports: 'sportbeoefening/fitness',
    telecom: 'telecom/internetdienst',
    software_it: 'software/IT-dienst',
    fuel: 'tankstation/brandstof',
    lodging: 'logies/accommodatie',
    food_retail: 'supermarkt/voedingsmiddelenhandel',
    pharmacy: 'apotheek/geneesmiddelen',
    books_media: 'boekhandel/boeken en periodieken',
    construction: 'bouwmarkt/bouwbedrijf',
    professional_services: 'professionele zakelijke dienstverlening',
  };
  return `[SafeVault context: ${labels[result.category]}]`;
}

export async function enrichVatTransactions(rows: RawTransaction[]): Promise<RawTransaction[]> {
  const byQuery = new Map<string, RawTransaction[]>();
  for (const row of rows) {
    const query = cleanDescription(`${row.description ?? ''} ${row.memo ?? ''}`);
    if (!query) continue;
    const bucket = byQuery.get(query) ?? [];
    bucket.push(row);
    byQuery.set(query, bucket);
  }

  const queries = [...byQuery.keys()];
  const resolved = new Map<string, ContextResult>();

  // Deterministic local knowledge always wins and avoids unnecessary external requests.
  for (const query of queries) {
    const category = localCategory(query);
    if (category) resolved.set(query, { query, category, confidence: 0.99, source: 'SafeVault local merchant knowledge' });
  }

  const unresolvedQueries = queries.filter(query => !resolved.has(query));
  if (unresolvedQueries.length) {
    try {
      const response = await fetch('/.netlify/functions/btw-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: unresolvedQueries.slice(0, 25) }),
      });
      if (response.ok) {
        const payload = await response.json() as { results?: ContextResult[] };
        for (const result of payload.results ?? []) {
          if (result?.query && result.category && result.confidence >= 0.85) resolved.set(result.query, result);
        }
      }
    } catch {
      // Online enrichment is an enhancement only. VAT calculation must remain deterministic.
    }
  }

  return rows.map(row => {
    const query = cleanDescription(`${row.description ?? ''} ${row.memo ?? ''}`);
    const result = resolved.get(query);
    const marker = result ? contextMarker(result) : '';
    if (!marker || String(row.description ?? '').includes(marker)) return row;
    return { ...row, description: `${String(row.description ?? '').trim()} ${marker}`.trim() };
  });
}
