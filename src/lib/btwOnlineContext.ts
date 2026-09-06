import type { RawTransaction } from './btwSafeTypes';

type ContextCategory =
  | 'non_eu_software'
  | 'eu_software'
  | 'postnl_packages'
  | 'horeca'
  | 'dental_exempt'
  | 'government_no_vat'
  | 'food_retail'
  | 'professional_services'
  | 'marketing_services'
  | 'alcohol_retail'
  | 'passenger_transport'
  | 'cinema_culture'
  | 'sports'
  | 'telecom'
  | 'software_it'
  | 'fuel'
  | 'lodging'
  | 'pharmacy'
  | 'books_media'
  | 'construction'
  | 'finance_no_vat'
  | 'bank_fees_no_vat'
  | 'salary_no_vat'
  | 'taxes_no_vat'
  | 'mixed_or_unknown';

type ContextResult = { query: string; category: ContextCategory; confidence: number; source: string | null };

const LOCAL_CONTEXT: Array<{ category: ContextCategory; pattern: RegExp }> = [
  { category: 'non_eu_software', pattern: /\b(?:openai(?:\s+llc)?|elevenlabs(?:\s+inc)?|anthropic(?:\s+pbc)?|netlify(?:\s+inc)?|github(?:\s+inc)?|resend(?:\s+inc)?)\b/i },
  { category: 'eu_software', pattern: /\b(?:adobe\s+systems?\s+software|apple\s+distribution\s+international|google\s+cloud\s+emea)\b/i },
  { category: 'postnl_packages', pattern: /\bpostnl\b.*\bpakketten?\b|\bpakketten?\b.*\bpostnl\b/i },
  { category: 'dental_exempt', pattern: /\b(?:kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling)\b/i },
  { category: 'government_no_vat', pattern: /\b(?:kvk|kamer\s+van\s+koophandel)\b/i },
  { category: 'marketing_services', pattern: /\b(?:didi\s+talks|marketingbureau|marketing\s+agency|marketingdienst|online\s+marketing)\b/i },
  { category: 'professional_services', pattern: /\b(?:advocatenkantoor|advocaat|jurist|accountant|boekhouder|notaris|consultancy|consultant|adviesbureau|adviesdienst)\b/i },
  { category: 'food_retail', pattern: /\b(?:albert\s+heijn\s+zakelijk|supermarkt|voedingsmiddelen|levensmiddelen|boodschappen|drinkwater|waterrekening)\b/i },
  { category: 'horeca', pattern: /(?:café|cafe|grand\s+café|grand\s+cafe|restaurant|horeca|hotelrestaurant)\b/i },
  { category: 'salary_no_vat', pattern: /\b(?:loon|salaris|salarisbetaling|payroll|nettoloon|dividend)\b/i },
  { category: 'finance_no_vat', pattern: /\b(?:lening|aflossing|rente|rentevergoeding|krediet)\b/i },
  { category: 'taxes_no_vat', pattern: /\b(?:belastingdienst|inkomstenbelasting|vennootschapsbelasting|loonheffing|btw-aangifte|belastingaanslag)\b/i },
  { category: 'bank_fees_no_vat', pattern: /\b(?:bankkosten|rekeningkosten|bank fee|payment fee|transactiekosten|betalingskosten)\b/i },
  { category: 'alcohol_retail', pattern: /\b(?:gall\s*&?\s*gall|gall\s+and\s+gall|slijterij|drankenspeciaalzaak)\b/i },
  { category: 'passenger_transport', pattern: /\b(?:ns|arriva|ret|gvb|connexxion|nederlandse spoorwegen|ov-chipkaart|treinreis|busreis|tramreis|metroreis|taxi|personenvervoer)\b/i },
  { category: 'cinema_culture', pattern: /\b(?:path[eé]|pathe|bioscoop|theater|museum|concert)\b/i },
  { category: 'sports', pattern: /\b(?:basic[-\s]?fit|fit\s*for\s*free|sportschool|fitnesscentrum|sportclub|zwembad|sauna)\b/i },
  { category: 'telecom', pattern: /\b(?:kpn|vodafone|odido|ziggo|internet|telefoon|telecom)\b/i },
  { category: 'software_it', pattern: /\b(?:transip|exact\s+online|afas|software|hosting|licentie|cloud|webhosting)\b/i },
  { category: 'fuel', pattern: /\b(?:shell|bp|esso|tango|totalenergies|texaco|benzine|diesel|brandstof)\b/i },
  { category: 'lodging', pattern: /\b(?:hotel|booking\.com|airbnb|pension|vakantiehuis|camping|overnachting|logies)\b/i },
  { category: 'pharmacy', pattern: /\b(?:apotheek|geneesmiddelen|medicijnen)\b/i },
  { category: 'books_media', pattern: /\b(?:boekhandel|boek|boeken|dagblad|tijdschrift|periodiek)\b/i },
  { category: 'construction', pattern: /\b(?:gamma|karwei|praxis|bouwmarkt|bouwbedrijf|installatiebedrijf)\b/i },
];

function cleanDescription(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b(?:NL)?\d{2}[A-Z]{0,2}\d{4,30}\b/gi, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function localCategory(query: string): ContextCategory | null {
  return LOCAL_CONTEXT.find(rule => rule.pattern.test(query))?.category ?? null;
}

function contextMarker(result: ContextResult): string {
  if (result.category === 'mixed_or_unknown' || result.confidence < 0.85) return '';
  const labels: Record<Exclude<ContextCategory, 'mixed_or_unknown'>, string> = {
    non_eu_software: 'bekende niet-EU software/IT-leverancier; 4a verlegd 21%',
    eu_software: 'bekende EU software/IT-leverancier; 4b verlegd 21%',
    postnl_packages: 'PostNL pakketdienst; 21%',
    horeca: 'horeca; 9% en niet-aftrekbaar als voorbelasting waar van toepassing',
    dental_exempt: 'tandheelkundige medische behandeling; vrijstelling waar wettelijk van toepassing',
    government_no_vat: 'KVK/heffing zonder btw; geen btw-bedrag fabriceren',
    food_retail: 'supermarkt/voedingsmiddelenhandel; 9%-categorie',
    professional_services: 'professionele zakelijke dienstverlening; 21%-categorie',
    marketing_services: 'marketingdienst; 21%-categorie',
    alcohol_retail: 'slijterij/drankenspeciaalzaak; alcoholische dranken',
    passenger_transport: 'personenvervoer/openbaar vervoer',
    cinema_culture: 'bioscoop/culturele of recreatieve toegang',
    sports: 'sportbeoefening/fitness',
    telecom: 'telecom/internetdienst',
    software_it: 'software/IT-dienst',
    fuel: 'tankstation/brandstof',
    lodging: 'logies/accommodatie; 21% vanaf 2026',
    pharmacy: 'apotheek/geneesmiddelen',
    books_media: 'boekhandel/boeken en periodieken',
    construction: 'bouwmarkt/bouwbedrijf',
    finance_no_vat: 'financiering; geen normale btw-voorbelasting',
    bank_fees_no_vat: 'bankkosten; geen aftrekbare btw op basis van bankregel fabriceren',
    salary_no_vat: 'loon/dividend; geen btw',
    taxes_no_vat: 'belastingbetaling; geen btw',
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

  // First layer: deterministic local knowledge. It is deliberately broader than
  // the fiscal engine, because its job is to surface context before classification.
  for (const query of queries) {
    const category = localCategory(query);
    if (category) {
      resolved.set(query, {
        query,
        category,
        confidence: 0.99,
        source: 'SafeVault deterministic merchant/context registry',
      });
    }
  }

  // Second layer: bounded contextual lookup. It returns context only, never a VAT
  // rate; Dutch VAT policy remains the sole authority for the fiscal result.
  const unresolvedQueries = queries.filter(query => !resolved.has(query));
  for (let offset = 0; offset < unresolvedQueries.length; offset += 25) {
    const batch = unresolvedQueries.slice(offset, offset + 25);
    try {
      const response = await fetch('/.netlify/functions/btw-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: batch }),
      });
      if (!response.ok) continue;
      const payload = await response.json() as { results?: ContextResult[] };
      for (const result of payload.results ?? []) {
        if (result?.query && result.category && result.confidence >= 0.85) {
          resolved.set(result.query, result);
        }
      }
    } catch {
      // Online enrichment is optional. Network failure must not block or alter VAT calculation.
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
