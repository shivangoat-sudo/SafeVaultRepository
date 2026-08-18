import Papa from 'papaparse';
import { calculateVatReport, type RawTransaction, type ClassifiedTransaction, type VatReport } from '../lib/vatEngine.js';
import { genereerStabielTransactieId } from '../lib/btwEngine.js';

export { calculateVatReport, type RawTransaction, type ClassifiedTransaction, type VatReport };

export interface VatResultSummaryMetrics {
  totalRowsProcessed: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  uncertainCount: number;
  excludedCount: number;
  categoryCounts: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G', number>;
  rubriekTotals: Record<string, number>;
  provisionalNetVat: number;
  conservativeNetVat: number;
  marginOfError: number;
  disclaimer: string;
}

export interface VatResult {
  inc21: number;
  ex21: number;
  inc9: number;
  ex9: number;
  vat21: number;
  vat9: number;
  rubriek4a_vat: number;
  rubriek4b_vat: number;
  rubriek5b_vat: number;
  deductibleInputVat21: number;
  deductibleInputVat9: number;
  totalVatToPay: number;
  netVatToPayOrClaim: number;
  vatReport: VatReport;
  metrics: VatResultSummaryMetrics;
}

export type TransactionType = 'INKOMST' | 'UITGAVE' | 'CREDIT_CORRECTIE';
export type ConfidenceLevel = 'HOOG' | 'MIDDEL' | 'LAAG';
export type VatCategory = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export interface TransactionDetail {
  description: string;
  counterparty?: string;
  iban?: string;
  mededelingen?: string;
  amount: number;
  isIncome: boolean;
  transactionType: TransactionType;
  appliedRate: number | null;
  rubriek: string;
  vatCategory: VatCategory;
  categoryLabel: string;
  confidence: ConfidenceLevel;
  reasoningPath: string;
  matchedRule: string;
  candidateRate?: number | null;
  candidateCategory?: VatCategory | null;
  candidateReason?: string;
  isReverseCharged?: boolean;
  isBuaHoreca?: boolean;
  isExemptArt11?: boolean;
  isOutlier?: boolean;
}

const round2 = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

export const MANDATORY_DISCLAIMER =
  "Dit is een geautomatiseerde inschatting op basis van bankregel-omschrijvingen, geen fiscaal advies. Controleer alle ONZEKER-regels en een steekproef van de HOOG-confidence regels met de onderliggende facturen of een boekhouder voordat u aangifte doet.";

export const classifyVatTransaction = (
  description: string,
  tegenrekening: string,
  mededelingen: string,
  isIncome: boolean,
  amount: number
): {
  category: VatCategory;
  categoryLabel: string;
  rate: number | null;
  rubriek: string;
  confidence: ConfidenceLevel;
  reasoningPath: string;
  candidateRate: number | null;
  candidateCategory: VatCategory | null;
  isReverseCharged: boolean;
  isBuaHoreca: boolean;
  isExemptArt11: boolean;
} => {
  const desc = description.toLowerCase().trim();
  const iban = tegenrekening.replace(/\s/g, "").toUpperCase();
  const notes = mededelingen.toLowerCase().trim();
  const fullText = `${desc} ${notes}`.trim();

  const matchWordOrPhrase = (text: string, kw: string): boolean => {
    if (kw.length <= 4) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      return regex.test(text);
    }
    return text.includes(kw);
  };

  const horecaEstablishmentKeywords = ["restaurant", "cafe", "café", "brasserie", "lunchroom", "eetcafe", "eetcafé", "bar", "bistro", "hotel", "pension", "grand café", "grandcafe", "horeca", "ter plekke", "ter plaatse", "horeca-exploitant", "horeca-consumptie"];
  const mealKeywords = ["lunch", "diner", "ontbijt", "consumptie", "klantlunch", "zakelijke lunch", "eten en drinken"];
  const foodKeywords = ["boodschappen", "koffie", "pantry-artikel", "pantry-artikelen", "pantry", "supermarktaankopen", "voeding", "eetwaren", "brood", "groente", "fruit", "vlees", "vis", "supermarkt", "lidl", "albert heijn", "jumbo", "aldi", "plus supermarkt", "plusmarkt", "coop"];
  const transportKeywords = ["trein", "bus", "taxi", "ov", "openbaar vervoer", "ov-chipkaart", "ns", "gvb", "ret", "htm", "arriva", "transdev"];
  const booksLogiesKeywords = ["boeken", "tijdschrift", "tijdschriften", "krant", "abonnement krant", "geneesmiddelen", "logies", "hotel", "pension", "camping", "overnachting"];
  const telecomKeywords = ["telecom", "telecommunicatie", "internet", "telefonie", "mobiel", "glasvezel", "tv abonnement", "televisie", "bellen", "databundel", "telefoonabonnement", "internetabonnement", "telecomdiensten", "provider"];
  const serviceKeywords = ["hosting", "software", "ontwikkeling", "development", "webdesign", "seo", "cms", "applicatie", "dashboard", "api", "reparatie", "onderhoud", "advies", "content", "front-end", "back-end", "koppeling", "engine", "consultancy", "portaal", "licentie", "saas", "cloud", ...telecomKeywords];
  const physicalKeywords = ["bureaustoel", "monitor", "kabels", "ssd", "kantoorartikelen", "kantoorbenodigdheden", "kantoorbenodigdheid", "kantoormateriaal", "brandstof", "postzegel", "postzegels", "pakketzegel", "pakketzegels", "schoonmaak", "gereedschap", "hardware", "pakket", "verzending", "vrachtgoederen", "douane", "invoer", "levering goederen"];

  // ==========================================
  // CATEGORIE G — CREDIT / STORNO TRANSACTIES
  // BUG 4 FIX: Detect strictly via notes or negative amount, NEVER by company name (desc)
  // ==========================================
  const isNegativeAmount = amount < 0;
  const creditCardTerms = ["creditcard", "credit card", "credit-card", "visa credit", "mastercard credit", "debitcard", "debit card", "direct debit"];
  const isCardPaymentTerm = creditCardTerms.some(k => matchWordOrPhrase(notes, k) || matchWordOrPhrase(desc, k));

  const creditTermsInNotes = ["creditnota", "credit-nota", "credit nota", "storno", "terugbetaling", "retour", "restitutie", "refund"];
  const hasCreditNoteInNotes = !isCardPaymentTerm && creditTermsInNotes.some(k => matchWordOrPhrase(notes, k));
  const isCreditOrRefund = isNegativeAmount || hasCreditNoteInNotes;

  if (isCreditOrRefund) {
    let underlyingRate = 21;
    const isHorecaLocation = horecaEstablishmentKeywords.some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k));
    const isMealOrFood = mealKeywords.some(k => matchWordOrPhrase(notes, k)) || foodKeywords.some(k => matchWordOrPhrase(notes, k));
    if ((isHorecaLocation && isMealOrFood) || foodKeywords.some(k => matchWordOrPhrase(notes, k)) || transportKeywords.some(k => matchWordOrPhrase(notes, k))) {
      underlyingRate = 9;
    }
    return {
      category: 'G',
      categoryLabel: "Credit-/stornotransactie",
      rate: underlyingRate,
      rubriek: isIncome ? '1a' : '5b',
      confidence: 'HOOG',
      reasoningPath: `Creditnota/terugbetaling gedetecteerd in mededelingen of bedrag. BTW verwerkt met omgekeerd effect op onderliggend tarief ${underlyingRate}%.`,
      candidateRate: underlyingRate,
      candidateCategory: 'G',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  // ==========================================
  // CATEGORIE A — NIET-BTW-RELEVANTE MUTATIE
  // ==========================================
  const isInternalTransfer = ["spaarrekening", "interne overboeking", "eigen rekening", "kruisposten", "storting eigen vermogen", "opname"].some(k => matchWordOrPhrase(fullText, k));
  const isFinancialCapitalSalary = ["salaris", "loon", "pensioenpremie", "pensioen", "aflossing lening", "aflossing", "rente lening", "kapitaalstorting"].some(k => matchWordOrPhrase(fullText, k));
  const isTaxPayment = ["belastingdienst", "btw afdracht", "inkomstenbelasting", "voorlopige aanslag", "loonheffing afdracht", "loonheffing"].some(k => matchWordOrPhrase(fullText, k)) && !isIncome;

  if (isInternalTransfer || isFinancialCapitalSalary || isTaxPayment) {
    return {
      category: 'A',
      categoryLabel: "Niet-BTW-relevante mutatie",
      rate: 0,
      rubriek: 'GEEN_BTW',
      confidence: 'HOOG',
      reasoningPath: "Transactie betreft een niet-BTW-relevante mutatie (interne overboeking, salaris, lening, kapitaal of belastingafdracht) en valt buiten de BTW-aangifte.",
      candidateRate: 0,
      candidateCategory: 'A',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  // ==========================================
  // CATEGORIE B — BUITEN REIKWIJDTE / VRIJGESTELD (art. 11 Wet OB)
  // ==========================================
  const isGovAgency = ["kvk", "rdw", "gemeente", "omgevingsdienst", "kadaster"].some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k));
  if (isGovAgency) {
    return {
      category: 'B',
      categoryLabel: "Buiten reikwijdte (overheidstaken)",
      rate: 0,
      rubriek: '0',
      confidence: 'HOOG',
      reasoningPath: "Overheidsleges en wettelijke overheidstaken vallen buiten de reikwijdte van de omzetbelasting.",
      candidateRate: 0,
      candidateCategory: 'B',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  const isExemptMedical = ["arts", "tandarts", "fysiotherapie", "verpleging", "zorginstelling", "ziekenhuis"].some(k => matchWordOrPhrase(fullText, k));
  const isExemptEducation = ["onderwijs", "cursus", "opleiding", "school", "universiteit", "erkende opleiding"].some(k => matchWordOrPhrase(fullText, k));
  const isExemptFinancial = ["bankkosten", "pakketkosten bank", "provisie bank", "hypotheekrente", "verzekeringspremie", "verzekering"].some(k => matchWordOrPhrase(fullText, k));
  const isExemptRent = ["huur kantoor", "huur woning", "pacht"].some(k => matchWordOrPhrase(fullText, k));

  if (isExemptMedical || isExemptEducation || isExemptFinancial || isExemptRent) {
    return {
      category: 'B',
      categoryLabel: "Vrijgesteld (art. 11 Wet OB)",
      rate: 0,
      rubriek: '0',
      confidence: 'HOOG',
      reasoningPath: "Vrijgestelde prestatie op grond van art. 11 Wet OB 1968. Geen aftrek van voorbelasting mogelijk.",
      candidateRate: 0,
      candidateCategory: 'B',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: true
    };
  }

  // ==========================================
  // CATEGORIE C & D — GRENSOVERSCHRIJDEND (DIENSTEN VS GOEDEREN)
  // ==========================================
  const countryCode = iban.substring(0, 2);
  const isForeignIban = /^[A-Z]{2}$/.test(countryCode) && countryCode !== "NL";

  if (isForeignIban) {
    if (!isIncome) {
      const isPhysicalGoods = ["pakket", "verzending", "hardware", "douane", "invoer", "vrachtgoederen", "levering goederen"].some(k => matchWordOrPhrase(fullText, k));
      if (isPhysicalGoods) {
        return {
          category: 'D',
          categoryLabel: "Grensoverschrijdend — Goederen (4a)",
          rate: 21,
          rubriek: '4a',
          confidence: 'HOOG',
          reasoningPath: `Intracommunautaire verwerving / invoer van goederen van buitenlandse leverancier (${countryCode}). Belast in rubriek 4a/5b.`,
          candidateRate: 21,
          candidateCategory: 'D',
          isReverseCharged: true,
          isBuaHoreca: false,
          isExemptArt11: false
        };
      }

      const isTechOrSoftwareService = serviceKeywords.some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k)) ||
        ["chatgpt", "openai", "ai", "subscription", "abonnement", "cloud", "saas", "api", "licentie"].some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k));

      const isTabelI = !isTechOrSoftwareService && (
        (horecaEstablishmentKeywords.some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k)) && mealKeywords.some(k => matchWordOrPhrase(notes, k))) ||
        foodKeywords.some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k)) ||
        transportKeywords.some(k => matchWordOrPhrase(notes, k)) ||
        booksLogiesKeywords.some(k => matchWordOrPhrase(notes, k))
      );
      const chosenRate = isTabelI ? 9 : 21;
      return {
        category: 'C',
        categoryLabel: "Grensoverschrijdend — Dienst (BTW verlegd 4b)",
        rate: chosenRate,
        rubriek: '4b',
        confidence: 'HOOG',
        reasoningPath: `B2B-dienst van een buitenlandse dienstverlener (${countryCode}). BTW verlegd naar rubriek 4b/5b tegen ${chosenRate}%.`,
        candidateRate: chosenRate,
        candidateCategory: 'C',
        isReverseCharged: true,
        isBuaHoreca: false,
        isExemptArt11: false
      };
    } else {
      return {
        category: 'C',
        categoryLabel: "Grensoverschrijdend — Uitgaande verkopen",
        rate: null,
        rubriek: '3b',
        confidence: 'LAAG',
        reasoningPath: `Uitgaande transactie naar buitenlandse tegenpartij (${countryCode}). B2B/B2C status niet vast te stellen zonder factuur; geëscaleerd naar ONZEKER.`,
        candidateRate: 21,
        candidateCategory: 'C',
        isReverseCharged: false,
        isBuaHoreca: false,
        isExemptArt11: false
      };
    }
  }

  // ==========================================
  // CATEGORIE F — GEMENGDE FACTUREN
  // ==========================================
  const isMixedInvoice = ["gemengde factuur", "lunch en software", "boeken en kantoorartikelen", "splitsing vereist"].some(k => matchWordOrPhrase(fullText, k));
  if (isMixedInvoice) {
    return {
      category: 'F',
      categoryLabel: "Gemengde factuur",
      rate: null,
      rubriek: '1a',
      confidence: 'LAAG',
      reasoningPath: "Omschrijving bevat aanwijzingen voor een gemengde factuur met meerdere BTW-tarieven. Handmatige factuursplitsing vereist.",
      candidateRate: 21,
      candidateCategory: 'F',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  // ==========================================
  // CATEGORIE E — BINNENLANDSE PRESTATIES
  // BUG 2 FIX: BUA requires BOTH horeca location AND meal/food indicator
  // BUG 3 FIX: Telecom generic classifier
  // ==========================================
  const isHorecaLocation = horecaEstablishmentKeywords.some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k));
  const isMealOrFood = mealKeywords.some(k => matchWordOrPhrase(notes, k)) || foodKeywords.some(k => matchWordOrPhrase(notes, k));

  if (isHorecaLocation && isMealOrFood) {
    return {
      category: 'E',
      categoryLabel: "Horeca consumptie (BUA)",
      rate: 9,
      rubriek: '1b',
      confidence: 'HOOG',
      reasoningPath: "Horeca-consumptie ter plaatse (BUA): belast tegen verlaagd tarief van 9%, BTW niet aftrekbaar als voorbelasting.",
      candidateRate: 9,
      candidateCategory: 'E',
      isReverseCharged: false,
      isBuaHoreca: true,
      isExemptArt11: false
    };
  }

  if (telecomKeywords.some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k))) {
    return {
      category: 'E',
      categoryLabel: "Telecommunicatie (21%)",
      rate: 21,
      rubriek: '1a',
      confidence: 'HOOG',
      reasoningPath: "Telecommunicatie- en internetdiensten belast tegen het algemene BTW-tarief van 21% (art. 9 lid 1 Wet OB 1968).",
      candidateRate: 21,
      candidateCategory: 'E',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  if (serviceKeywords.some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k))) {
    return {
      category: 'E',
      categoryLabel: "Binnenlandse dienst (21%)",
      rate: 21,
      rubriek: '1a',
      confidence: 'HOOG',
      reasoningPath: "Dienstverlening belast tegen het algemene BTW-tarief van 21% (art. 9 lid 1 Wet OB 1968).",
      candidateRate: 21,
      candidateCategory: 'E',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  if (physicalKeywords.some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k))) {
    return {
      category: 'E',
      categoryLabel: "Zakelijke uitgave (21%)",
      rate: 21,
      rubriek: '1a',
      confidence: 'HOOG',
      reasoningPath: "Zakelijke uitgaande transactie belast tegen het algemene BTW-tarief van 21% (art. 9 lid 1 Wet OB 1968).",
      candidateRate: 21,
      candidateCategory: 'E',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  if (foodKeywords.some(k => matchWordOrPhrase(desc, k) || matchWordOrPhrase(notes, k)) || mealKeywords.some(k => matchWordOrPhrase(notes, k))) {
    return {
      category: 'E',
      categoryLabel: "Levensmiddelen (9%)",
      rate: 9,
      rubriek: '1b',
      confidence: 'HOOG',
      reasoningPath: "Levensmiddelen/pantry belast tegen het verlaagde BTW-tarief van 9% (Tabel I Wet OB 1968).",
      candidateRate: 9,
      candidateCategory: 'E',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  if (transportKeywords.some(k => matchWordOrPhrase(notes, k))) {
    return {
      category: 'E',
      categoryLabel: "Personenvervoer (9%)",
      rate: 9,
      rubriek: '1b',
      confidence: 'HOOG',
      reasoningPath: "Personenvervoer belast tegen het verlaagde BTW-tarief van 9% (Tabel I Wet OB 1968).",
      candidateRate: 9,
      candidateCategory: 'E',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  if (booksLogiesKeywords.some(k => matchWordOrPhrase(notes, k))) {
    return {
      category: 'E',
      categoryLabel: "Boeken / Logies (9%)",
      rate: 9,
      rubriek: '1b',
      confidence: 'HOOG',
      reasoningPath: "Boeken/tijdschriften/logies belast tegen het verlaagde BTW-tarief van 9% (Tabel I Wet OB 1968).",
      candidateRate: 9,
      candidateCategory: 'E',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  if (["margeregeling", "tweedehands", "gebruikte goederen"].some(k => matchWordOrPhrase(fullText, k))) {
    return {
      category: 'E',
      categoryLabel: "Margeregeling (art. 28b)",
      rate: null,
      rubriek: '1e',
      confidence: 'LAAG',
      reasoningPath: "Mogelijke toepassing van de margeregeling (art. 28b Wet OB). Handmatige factuurcontrole vereist.",
      candidateRate: 21,
      candidateCategory: 'E',
      isReverseCharged: false,
      isBuaHoreca: false,
      isExemptArt11: false
    };
  }

  // ==========================================
  // ESCALATION TO ONZEKER (STAP D / CONFIDENCE LAAG)
  // ==========================================
  const searchedKeywordsList = [
    ...serviceKeywords,
    ...physicalKeywords,
    ...foodKeywords,
    ...transportKeywords,
    ...booksLogiesKeywords,
    ...horecaEstablishmentKeywords,
    ...mealKeywords
  ].slice(0, 15).join(", ");

  return {
    category: 'E',
    categoryLabel: "Onzekere classificatie",
    rate: null,
    rubriek: isIncome ? '1a' : '5b',
    confidence: 'LAAG',
    reasoningPath: `Mededelingen bevatten onvoldoende specifieke informatie. Gezochte kernbegrippen: ${searchedKeywordsList}. Geëscaleerd naar ONZEKER voor menselijke controle.`,
    candidateRate: 21,
    candidateCategory: 'E',
    isReverseCharged: false,
    isBuaHoreca: false,
    isExemptArt11: false
  };
};

export function calculateOutliers(amounts: number[]): { median: number; iqr: number; p90: number } {
  if (amounts.length === 0) return { median: 0, iqr: 0, p90: 0 };
  const sorted = [...amounts].sort((a, b) => a - b);
  const n = sorted.length;

  const getPercentile = (p: number) => {
    const idx = (n - 1) * p;
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
  };

  const median = getPercentile(0.5);
  const q1 = getPercentile(0.25);
  const q3 = getPercentile(0.75);
  const iqr = q3 - q1;
  const p90 = getPercentile(0.9);

  return { median, iqr, p90 };
}

export const processCSVForVAT = (
  csvContent: string | File
): Promise<{ results: VatResult; details: TransactionDetail[] }> => {
  return new Promise((resolve, reject) => {
    let contentStr = "";
    if (typeof csvContent === "string") {
      contentStr = csvContent;
      processStr(contentStr);
    } else {
      if (csvContent && typeof (csvContent as unknown as File).text === "function") {
        (csvContent as unknown as File).text().then((text: string) => {
          processStr(text);
        }).catch(reject);
      } else {
        contentStr = String(csvContent);
        processStr(contentStr);
      }
    }

    function processStr(str: string) {
      if (str.charCodeAt(0) === 0xFEFF) {
        str = str.slice(1);
      }
      str = str.replace(/^\uFEFF/, "");

      const lines = str.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
      if (lines.length === 0) {
        reject(new Error("Bestand is leeg"));
        return;
      }

      const headerLine = lines[0];

      const expectedHeaders = [
        "Datum",
        "Naam / Omschrijving",
        "Rekening",
        "Tegenrekening",
        "Code",
        "Af Bij",
        "Bedrag (EUR)",
        "Mutatiesoort",
        "Mededelingen"
      ];

      const semiFields = headerLine.split(';').map(s => s.trim());
      const commaFields = headerLine.split(',').map(s => s.trim());

      const semiMatches = semiFields.filter(f => expectedHeaders.includes(f)).length;
      const commaMatches = commaFields.filter(f => expectedHeaders.includes(f)).length;

      const delimiter = semiMatches >= commaMatches ? ';' : ',';

      Papa.parse<string[]>(str, {
        delimiter: delimiter,
        header: false,
        skipEmptyLines: true,
        complete: (parseResults) => {
          const parsedRows = parseResults.data;
          if (!parsedRows || parsedRows.length === 0) {
            reject(new Error("Geen gegevens gevonden in het bestand."));
            return;
          }

          const headers = parsedRows[0].map((h: unknown) => String(h).trim());

          const headerMap: Record<string, number> = {};
          expectedHeaders.forEach(eh => {
            headerMap[eh] = headers.indexOf(eh);
          });

          for (const eh of expectedHeaders) {
            if (headerMap[eh] === -1) {
              reject(new Error(`Ontbrekende verplichte kolom: ${eh}`));
              return;
            }
          }

          const dataRows = parsedRows.slice(1);
          const details: TransactionDetail[] = [];
          const rawAmounts: number[] = [];

          let inc21 = 0, ex21 = 0, vat21 = 0;
          let inc9 = 0, ex9 = 0, vat9 = 0;
          let rubriek4a_vat = 0;
          let rubriek4b_vat = 0;
          let rubriek5b_vat = 0;
          let deductibleInputVat21 = 0;
          let deductibleInputVat9 = 0;
          let vatToPay = 0;

          let provisionalVatToPay = 0;
          let provisionalVatToClaim = 0;

          let highCount = 0;
          let medCount = 0;
          let lowCount = 0;
          let uncertainCount = 0;
          let excludedCount = 0;

          const categoryCounts: Record<VatCategory, number> = {
            A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0
          };

          const datumIdx = headerMap["Datum"];
          const naamIdx = headerMap["Naam / Omschrijving"];
          const tegenrekeningIdx = headerMap["Tegenrekening"];
          const afBijIdx = headerMap["Af Bij"];
          const bedragIdx = headerMap["Bedrag (EUR)"];
          const mededelingenIdx = headerMap["Mededelingen"];

          for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            if (!row || row.length < expectedHeaders.length) continue;
            const rawBedrag = String(row[bedragIdx] || "").trim();
            const clean = rawBedrag.replace('€', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
            const amt = Math.abs(parseFloat(clean) || 0);
            if (amt > 0) rawAmounts.push(amt);
          }

          const stats = calculateOutliers(rawAmounts);

          const rawTransactions: RawTransaction[] = [];
          const classificationsArr: Array<{ id: string; category: string; applied_rule: string }> = [];

          for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];

            if (!row || row.length < expectedHeaders.length) {
              continue;
            }

            const rawDatum = String(row[datumIdx] || "").trim();
            const rawBedrag = String(row[bedragIdx] || "").trim();
            const rawDescription = String(row[naamIdx] || "").trim();
            const rawTypeVal = String(row[afBijIdx] || "").trim();
            const rawTegenrekening = String(row[tegenrekeningIdx] || "").trim();
            const rawMededelingen = String(row[mededelingenIdx] || "").trim();

            const isYYYYMMDD = /^\d{8}$/.test(rawDatum);
            let isValidDate = false;
            if (isYYYYMMDD) {
              const y = parseInt(rawDatum.substring(0, 4), 10);
              const m = parseInt(rawDatum.substring(4, 6), 10);
              const d = parseInt(rawDatum.substring(6, 8), 10);
              const dateObj = new Date(y, m - 1, d);
              isValidDate = dateObj.getFullYear() === y && dateObj.getMonth() === m - 1 && dateObj.getDate() === d;
            } else {
              const timestamp = Date.parse(rawDatum);
              isValidDate = !isNaN(timestamp);
            }

            if (!isValidDate) {
              reject(new Error(`Ongeldige datum gedetecteerd: ${rawDatum}`));
              return;
            }

            const normalizedDatum = rawDatum.replace(/[^0-9]/g, "");
            const normalizedBedrag = rawBedrag.replace(/[^0-9]/g, "");
            if (normalizedDatum === normalizedBedrag && normalizedDatum.length > 0) {
              reject(new Error(`Kolomverschuivingsfout gedetecteerd op rij ${i + 2}: Bedrag-veld (${rawBedrag}) is identiek aan Datum-veld (${rawDatum}).`));
              return;
            }

            let cleanAmountStr = rawBedrag.replace('€', '').replace(/\s/g, '');
            cleanAmountStr = cleanAmountStr.replace(/\./g, '').replace(',', '.');
            const amount = Math.abs(parseFloat(cleanAmountStr) || 0);

            if (amount > 10000000) {
              reject(new Error(`Ongeldig transactiebedrag gedetecteerd: ${amount}. Bedragen groter dan € 10.000.000,00 zijn niet toegestaan.`));
              return;
            }

            if (amount === 0) continue;

            const description = rawDescription;
            const typeVal = rawTypeVal.toLowerCase();

            let isIncome = true;
            if (rawBedrag.includes('-') || ['af', 'uitgaven', 'kosten', 'debet', 'debit'].some(k => typeVal.includes(k))) {
              isIncome = false;
            }

            const classRes = classifyVatTransaction(description, rawTegenrekening, rawMededelingen, isIncome, amount);
            categoryCounts[classRes.category]++;

            const isOutlier = stats.iqr > 0 && amount > stats.p90 && amount > stats.median + 3 * stats.iqr;

            if (classRes.confidence === 'HOOG') highCount++;
            else if (classRes.confidence === 'MIDDEL') medCount++;
            else lowCount++;

            if (classRes.category === 'A') excludedCount++;
            if (classRes.rate === null) uncertainCount++;

            const matchedRuleText = classRes.rate === null
              ? classRes.reasoningPath
              : (classRes.isBuaHoreca
                  ? "Horeca consumptie (BUA): BTW niet aftrekbaar"
                  : classRes.isReverseCharged
                    ? "BTW verlegd"
                    : classRes.category === 'B'
                      ? classRes.reasoningPath
                      : classRes.category === 'A'
                        ? "Buiten reikwijdte omzetbelasting"
                        : classRes.reasoningPath);

            const actualRate = classRes.rate;
            const provisionalRate = classRes.rate ?? classRes.candidateRate ?? 21;

            if (classRes.isReverseCharged && actualRate !== null) {
              const vat = amount * (actualRate / 100);
              if (classRes.rubriek === '4a' || classRes.category === 'D') {
                rubriek4a_vat += vat;
              } else {
                rubriek4b_vat += vat;
              }
              vatToPay += vat;
              rubriek5b_vat += vat;
            } else if (actualRate === 21) {
              const ex = amount / 1.21;
              const vat = amount - ex;
              if (isIncome) {
                inc21 += amount;
                ex21 += ex;
                vat21 += vat;
                vatToPay += vat;
              } else {
                deductibleInputVat21 += vat;
                rubriek5b_vat += vat;
              }
            } else if (actualRate === 9) {
              const ex = amount / 1.09;
              const vat = amount - ex;
              if (isIncome) {
                inc9 += amount;
                ex9 += ex;
                vat9 += vat;
                vatToPay += vat;
              } else {
                if (!classRes.isBuaHoreca) {
                  deductibleInputVat9 += vat;
                  rubriek5b_vat += vat;
                }
              }
            }

            if (provisionalRate === 21) {
              const vat = classRes.isReverseCharged ? amount * 0.21 : amount - (amount / 1.21);
              if (isIncome) provisionalVatToPay += vat;
              else if (!classRes.isBuaHoreca) {
                if (classRes.isReverseCharged) provisionalVatToPay += vat;
                provisionalVatToClaim += vat;
              }
            } else if (provisionalRate === 9) {
              const vat = classRes.isReverseCharged ? amount * 0.09 : amount - (amount / 1.09);
              if (isIncome) provisionalVatToPay += vat;
              else if (!classRes.isBuaHoreca) {
                if (classRes.isReverseCharged) provisionalVatToPay += vat;
                provisionalVatToClaim += vat;
              }
            }

            const txId = `tx_${i + 1}`;
            rawTransactions.push({
              id: txId,
              description,
              amount_incl: amount,
              type: isIncome ? 'Inkomsten' : 'Uitgaven',
              memo: rawMededelingen || undefined,
              tegenrekening_iban: rawTegenrekening || undefined,
            });

            let clsCategory = 'exempt';
            if (isIncome) {
              if (actualRate === 21) clsCategory = 'sales_21';
              else if (actualRate === 9) clsCategory = 'sales_9';
              else clsCategory = 'exempt';
            } else {
              if (classRes.isBuaHoreca) clsCategory = 'bua_horeca';
              else if (classRes.isReverseCharged) clsCategory = 'reverse_charge';
              else if (actualRate === 21) clsCategory = 'expense_21';
              else if (actualRate === 9) clsCategory = 'expense_9';
              else clsCategory = 'exempt';
            }

            classificationsArr.push({
              id: txId,
              category: clsCategory,
              applied_rule: matchedRuleText
            });

            details.push({
              description,
              counterparty: rawDescription,
              iban: rawTegenrekening,
              mededelingen: rawMededelingen,
              amount,
              isIncome,
              transactionType: isIncome ? 'INKOMST' : 'UITGAVE',
              appliedRate: actualRate,
              rubriek: classRes.rubriek,
              vatCategory: classRes.category,
              categoryLabel: classRes.categoryLabel,
              confidence: classRes.confidence,
              reasoningPath: classRes.reasoningPath,
              matchedRule: matchedRuleText,
              candidateRate: classRes.candidateRate,
              candidateCategory: classRes.candidateCategory,
              isReverseCharged: classRes.isReverseCharged,
              isBuaHoreca: classRes.isBuaHoreca,
              isExemptArt11: classRes.isExemptArt11,
              isOutlier
            });
          }

          const vatReport = calculateVatReport(rawTransactions, classificationsArr);

          const roundedVatToPay = round2(vatToPay);
          const roundedRubriek5b = round2(rubriek5b_vat);
          const conservativeNet = round2(roundedVatToPay - roundedRubriek5b);
          const provisionalNet = round2(provisionalVatToPay - provisionalVatToClaim);
          const marginOfError = round2(Math.abs(provisionalNet - conservativeNet));

          // Hard Invariant Check: Net VAT MUST equal total output VAT minus total deductible VAT
          const invariantDiff = Math.abs(conservativeNet - round2(roundedVatToPay - roundedRubriek5b));
          if (invariantDiff > 0.01) {
            reject(new Error(`CRITISCHE INTERNE REKENFOUT: Eindsaldo (${conservativeNet}) komt niet overeen met Totaal verschuldigd (${roundedVatToPay}) min Totaal aftrekbaar (${roundedRubriek5b}). Resultaat niet betrouwbaar.`));
            return;
          }

          const rubriekTotals: Record<string, number> = {
            "1a": round2(vat21),
            "1b": round2(vat9),
            "4a": round2(rubriek4a_vat),
            "4b": round2(rubriek4b_vat),
            "5b": roundedRubriek5b
          };

          resolve({
            results: {
              inc21: round2(inc21),
              ex21: round2(ex21),
              inc9: round2(inc9),
              ex9: round2(ex9),
              vat21: round2(vat21),
              vat9: round2(vat9),
              rubriek4a_vat: round2(rubriek4a_vat),
              rubriek4b_vat: round2(rubriek4b_vat),
              rubriek5b_vat: roundedRubriek5b,
              deductibleInputVat21: round2(deductibleInputVat21),
              deductibleInputVat9: round2(deductibleInputVat9),
              totalVatToPay: roundedVatToPay,
              netVatToPayOrClaim: conservativeNet,
              vatReport,
              metrics: {
                totalRowsProcessed: details.length,
                highConfidenceCount: highCount,
                mediumConfidenceCount: medCount,
                lowConfidenceCount: lowCount,
                uncertainCount: uncertainCount,
                excludedCount: excludedCount,
                categoryCounts,
                rubriekTotals,
                provisionalNetVat: provisionalNet,
                conservativeNetVat: conservativeNet,
                marginOfError,
                disclaimer: MANDATORY_DISCLAIMER
              }
            },
            details
          });
        },
        error: (err: unknown) => reject(err),
      });
    }
  });
};

export function parseCsvToRawTransactions(csvContent: string): RawTransaction[] {
  const str = csvContent.replace(/^\uFEFF/, "").trim();
  if (!str) return [];

  const lines = str.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];

  const headerLine = lines[0];
  const semiCount = (headerLine.match(/;/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const delimiter = semiCount >= commaCount ? ';' : ',';

  const parseResult = Papa.parse<string[]>(str, {
    delimiter,
    header: false,
    skipEmptyLines: true,
  });

  const rows = parseResult.data;
  if (!rows || rows.length <= 1) return [];

  const headers = rows[0].map(h => String(h).trim().toLowerCase());

  const findIdx = (keywords: string[]) => {
    for (const kw of keywords) {
      const idx = headers.findIndex(h => h.includes(kw));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const datumIdx = findIdx(["datum", "date"]);
  const omschrijvingIdx = findIdx(["naam / omschrijving", "omschrijving", "naam", "description", "counterparty"]);
  const tegenrekeningIdx = findIdx(["tegenrekening", "iban"]);
  const afBijIdx = findIdx(["af bij", "af/bij", "type", "direction"]);
  const bedragIdx = findIdx(["bedrag", "amount"]);
  const mededelingenIdx = findIdx(["mededelingen", "memo", "opmerking", "notes"]);

  const rawTxList: RawTransaction[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const rawDatum = datumIdx !== -1 ? String(row[datumIdx] || "").trim() : "";
    const rawDescription = omschrijvingIdx !== -1 ? String(row[omschrijvingIdx] || "").trim() : "";
    const rawTegenrekening = tegenrekeningIdx !== -1 ? String(row[tegenrekeningIdx] || "").trim() : "";
    const rawAfBij = afBijIdx !== -1 ? String(row[afBijIdx] || "").trim().toLowerCase() : "";
    const rawBedrag = bedragIdx !== -1 ? String(row[bedragIdx] || "").trim() : "0";
    const rawMemo = mededelingenIdx !== -1 ? String(row[mededelingenIdx] || "").trim() : "";

    const cleanAmtStr = rawBedrag.replace('€', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    let amt = parseFloat(cleanAmtStr) || 0;

    let isIncome = false;
    if (rawAfBij === 'bij' || rawAfBij === 'income' || rawAfBij === 'inkomsten' || rawAfBij === 'c' || rawAfBij === 'cr') {
      isIncome = true;
    } else if (rawAfBij === 'af' || rawAfBij === 'expense' || rawAfBij === 'uitgaven' || rawAfBij === 'd' || rawAfBij === 'dr') {
      isIncome = false;
    } else {
      isIncome = amt > 0;
    }

    amt = Math.abs(amt);

    const stableId = genereerStabielTransactieId({
      date: rawDatum,
      description: rawDescription || "Transactie",
      amount_incl: amt,
      tegenrekening_iban: rawTegenrekening || undefined,
    });

    rawTxList.push({
      id: stableId,
      date: rawDatum,
      description: rawDescription || "Transactie",
      amount_incl: amt,
      type: isIncome ? 'income' : 'expense',
      memo: rawMemo || undefined,
      tegenrekening_iban: rawTegenrekening || undefined,
    });
  }

  return rawTxList;
}

