/**
 * ============================================================================
 * NEDERLANDSE BTW-REKENENGINE (WET OB 1968) — v2
 * ============================================================================
 *
 * Pure, zelfstandige TypeScript-module. Geen netwerkverkeer, geen externe
 * dependencies, geen API key nodig.
 *
 *   import { calculateVatReport } from './btwEngine';
 *   const report = calculateVatReport(transacties); // classificaties optioneel
 *
 * NIEUW IN v2:
 * - Automatische classificatie ("denkt als een Nederlandse boekhouder"): elke
 *   transactie wordt op omschrijving/leverancier herkend en gekoppeld aan de
 *   juiste BTW-regel, zonder dat je zelf classificaties hoeft aan te leveren.
 * - Herkenningsrapportage: hoeveel van de N transacties zijn automatisch
 *   herkend, hoeveel vallen terug op de standaardregel (21%, geen specifieke
 *   match) en welke transacties verdienen een controle door een mens.
 * - Korte, UI-vriendelijke toelichtingstekst per transactie (zoals in het
 *   voorbeeld: "Personenvervoer belast tegen het verlaagde BTW-tarief van 9%
 *   (Tabel I Wet OB 1968)." i.p.v. de volledige juridische tekst).
 *
 * BELANGRIJK — SCHEIDING VAN VERANTWOORDELIJKHEDEN:
 * Deze module doet GEEN documentverwerking (PDF/CSV/foto's inlezen). Dat is
 * met opzet: tekst-/beeldherkenning uit documenten hoort bij een multimodaal
 * taalmodel (zoals Gemini in Google AI Studio — zie de prompt die hierbij
 * geleverd wordt), maar alle BTW-REKENWERK moet deterministisch en
 * controleerbaar zijn. Daarom: het taalmodel mag transacties EXTRAHEREN en
 * een classificatie VOORSTELLEN, maar nooit zelf BTW-bedragen berekenen of
 * optellen — dat doet uitsluitend deze engine.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. TYPES
// ----------------------------------------------------------------------------

export type TransactionType = 'income' | 'expense';

/** De fiscale classificatie van een transactieregel (§2 beslisboom). */
export type ClassificationKey =
  | 'omzet_algemeen_21'      // Inkomsten, 21% (Art. 9 lid 1)
  | 'omzet_verlaagd_9'       // Inkomsten, 9% (Art. 9 lid 2 jo. Tabel I)
  | 'omzet_vrijgesteld_0'    // Inkomsten, vrijgesteld/buiten bereik (Art. 11)
  | 'kosten_algemeen_21'     // Uitgaven, 21%, aftrekbaar (Art. 15 lid 1 sub a)
  | 'kosten_verlaagd_9'      // Uitgaven, 9%, aftrekbaar (Art. 15 lid 1 sub a jo. Tabel I)
  | 'horeca_bua_9'           // Uitgaven, 9%, NIET aftrekbaar (Art. 15 lid 5 / BUA)
  | 'kosten_vrijgesteld_0'   // Uitgaven, buiten reikwijdte (overheidsleges e.d.)
  | 'verlegd_21'             // Verlegde BTW, buitenlandse B2B dienst (Art. 12 lid 2)
  | 'prive_geen_btw';        // Privéopname/-storting ondernemer: geen prestatie, buiten de BTW-aangifte

/** Ruwe, nog niet-fiscaal-verwerkte transactie zoals aangeleverd door import/OCR. */
export interface RawTransaction {
  id: string;
  type: TransactionType;
  /** Bedrag zoals op de factuur/bon staat (positief getal, in euro's). */
  amount_incl: number;
  description?: string;
  date?: string;
  /**
   * Extra vrije-tekst omschrijving/memo (bijv. het "Mededelingen"-veld van een
   * bankafschrift: "ChatGPT Plus Business Subscription", "Reiskosten Trein
   * Clientbezoek"). Vaak informatiever dan de kale leveranciersnaam en wordt
   * gebruikt als extra signaal in de classificatie voordat de engine
   * opgeeft en op de standaard terugvalt.
   */
  memo?: string;
  /**
   * IBAN van de tegenrekening, indien bekend (uit bankexports). Een
   * niet-Nederlands rekeningnummer is, in combinatie met andere signalen
   * (zie autoClassify), een aanwijzing voor een buitenlandse dienst
   * (mogelijk verleggingsregeling).
   */
  tegenrekening_iban?: string;
}

/**
 * Optionele koppeling van transactie-id naar fiscale classificatie —
 * gebruik dit om een automatische classificatie te overschrijven (bijv. na
 * handmatige correctie door de gebruiker). Wordt niets meegegeven voor een
 * transactie, dan classificeert de engine zelf via `autoClassify`.
 */
export type ClassificationMap = Record<string, ClassificationKey>;

/**
 * Meerdere onafhankelijke classificatievoorstellen per transactie-id — bv.
 * 3 losse Gemini-aanroepen die elk zelfstandig (zonder elkaars antwoord te
 * zien) een classificatie voorstellen voor transacties die de deterministische
 * `autoClassify` niet met zekerheid kon herkennen. De engine telt de stemmen
 * en gebruikt de meerderheid — zie `resolveConsensus`.
 */
export type AiProposalMap = Record<string, ClassificationKey[]>;

export type ClassificationSource =
  | 'automatisch_regelgebaseerd'    // exacte leveranciersnaam herkend — hoge zekerheid
  | 'automatisch_omschrijving'      // categorie herkend via trefwoorden in de memo/mededeling — hoge zekerheid
  | 'automatisch_gecombineerd'      // meerdere zwakkere signalen samen (bv. buitenlands IBAN + software-trefwoord) — gemiddelde zekerheid
  | 'ai_consensus_unaniem'          // alle onafhankelijke AI-pogingen kwamen op hetzelfde antwoord uit
  | 'ai_consensus_meerderheid'      // meerderheid van de AI-pogingen was het eens
  | 'geen_consensus_standaard'      // AI-pogingen liepen uiteen -> veilige standaard automatisch toegepast (échte onenigheid, dus wél twijfelgeval)
  | 'standaard_geen_uitzondering'   // geen enkele reden gevonden om af te wijken van het standaardtarief -> standaardtarief geldt met vertrouwen (GEEN twijfelgeval)
  | 'conflict_gedetecteerd'         // tegenstrijdige signalen (bv. Nederlandse rechtsvorm + buitenlands rekeningnummer + claim van verlegde BTW) -> échte twijfel
  | 'handmatig'                     // expliciete volledige override door de gebruiker (classifications-map)
  | 'handmatig_percentage';         // boekhouder heeft, als laatste redmiddel, alleen het BTW-percentage aangewezen (percentageOverrides)

export type Zekerheid = 'hoog' | 'gemiddeld' | 'laag';

/**
 * DE ENIGE OFFICIËLE DEFINITIE VAN "TWIJFELGEVAL" IN DEZE TOOL.
 *
 * Gebruik uitsluitend deze functie om te bepalen of een transactie als
 * twijfelgeval aan de gebruiker wordt getoond — bouw hier GEEN eigen
 * definitie voor in de host-app (bv. "alles wat niet 'hoog' is"). Dat is
 * precies de fout die eerder het aantal twijfelgevallen liet oplopen: zodra
 * de AI-consensus- en gecombineerde-signalenlagen erbij kwamen, ontstonden
 * er meer `zekerheid: 'gemiddeld'`-transacties (bv. meerderheidsconsensus,
 * buitenlands IBAN + trefwoord) — die zijn AUTOMATISCH OPGELOST en horen dus
 * niet als twijfelgeval te tellen, ook al is de zekerheid net iets lager dan
 * bij een exacte regelmatch. Alleen `zekerheid === 'laag'` betekent: geen
 * enkel signaal gevonden, nog steeds de kale standaard.
 *
 * Dit is exact het onderscheid dat een boekhouder (of Claude, in een chat)
 * intuïtief al maakt: een bevestigde aanname toont hij zonder voorbehoud,
 * alleen een compleet onbevestigd cijfer krijgt een kanttekening.
 */
export function isTwijfelgeval(t: ProcessedTransaction): boolean {
  return t.zekerheid === 'laag';
}

/**
 * Genereert een STABIEL transactie-ID op basis van de inhoud van de
 * transactie zelf (datum + omschrijving + bedrag + tegenrekening), in plaats
 * van de positie in de lijst ("t1", "t2", ...). Gebruik dit ID als sleutel
 * voor alles wat moet blijven bestaan tussen runs: eerdere AI-consensus,
 * en vooral eerdere boekhouder-beoordelingen (percentageOverrides). Een
 * positioneel ID verandert zodra er een regel wordt toegevoegd/verwijderd of
 * de sortering wijzigt — daardoor "vergeet" de tool eerder opgeloste
 * gevallen en lijken die bij een volgende run opnieuw twijfelachtig. Dat is
 * de meest waarschijnlijke oorzaak als het aantal twijfelgevallen na een
 * update onverwacht STIJGT in plaats van daalt.
 */
export function genereerStabielTransactieId(tx: {
  date?: string;
  description?: string;
  amount_incl: number;
  tegenrekening_iban?: string;
}): string {
  const basis = `${tx.date ?? ''}|${(tx.description ?? '').trim().toLowerCase()}|${tx.amount_incl.toFixed(2)}|${(tx.tegenrekening_iban ?? '').trim().toUpperCase()}`;
  // Kleine, deterministische hash (FNV-1a-achtig) — geen crypto-dependency nodig, werkt identiek in elke JS-omgeving (browser/Node/AI Studio).
  let hash = 2166136261;
  for (let i = 0; i < basis.length; i++) {
    hash ^= basis.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `tx_${(hash >>> 0).toString(16)}`;
}

export interface AppliedRule {
  classification: ClassificationKey;
  wetsartikel: string;
  /** Volledige juridische toelichting (voor rapportage/onderbouwing). */
  omschrijving: string;
  /** Korte toelichting voor de transactietabel in de UI (zoals gevraagd voorbeeld). */
  korte_toelichting: string;
  rubriek: string;
}

export interface ProcessedTransaction {
  id: string;
  date?: string;
  type: TransactionType;
  description?: string;
  classification: ClassificationKey;
  rate: 0 | 9 | 21;
  amount_incl_input: number;
  bedrag_excl: number;
  btw_bedrag: number;
  bedrag_incl: number;
  aftrekbaar: boolean;
  applied_rule: AppliedRule;
  /** true = met voldoende zekerheid geclassificeerd (regel of AI-consensus); false = veilige standaard toegepast bij gebrek aan match/consensus. */
  herkend: boolean;
  /** Leesbare toelichting op de herkenning zelf, bijv. "Herkend als horeca (café/restaurant)". */
  herkenningsbron: string;
  /** Hoe deze classificatie tot stand kwam — voor audit-doeleinden. */
  classificatie_bron: ClassificationSource;
  /** Indien AI-consensus is gebruikt: de individuele voorstellen die zijn vergeleken. */
  ai_voorstellen?: ClassificationKey[];
  /** Hoog = zekere match (vaste leverancier/expliciet trefwoord). Gemiddeld = combinatie van zwakkere signalen. Laag = geen enkel signaal gevonden, veilige standaard toegepast. */
  zekerheid: Zekerheid;
}

export interface HerkenningRapport {
  totaal_transacties: number;
  automatisch_herkend: number;
  standaard_toegepast: number;
  percentage_herkend: number;
  /** Transacties die zijn teruggevallen op de standaardregel — aanbevolen voor handmatige controle. */
  controle_aanbevolen: ProcessedTransaction[];
}

export interface VatReport {
  // --- De 8 verplichte hoofdvarianten ---
  totaal_incl_21: number;
  totaal_excl_21: number;
  totaal_incl_9: number;
  totaal_excl_9: number;
  totale_btw_21: number;
  totale_btw_9: number;
  niet_aftrekbare_btw: number;
  btw_eindsaldo: number;

  breakdown: {
    verschuldigde_btw_omzet_21: number;
    verschuldigde_btw_omzet_9: number;
    verlegde_btw_rubriek_2a: number;
    aftrekbare_btw_kosten_21: number;
    aftrekbare_btw_kosten_9: number;
    verschuldigde_btw_totaal: number;
    aftrekbare_btw_totaal: number;
  };

  herkenning: HerkenningRapport;
  /** Automatische zelfcontrole van de eigen rekenuitkomst — draait bij elke berekening, geen actie van de gebruiker nodig. */
  audit: AuditResult;
  transactions: ProcessedTransaction[];
}

export interface AuditResult {
  ok: boolean;
  /** Lege array = alles klopt. Elke regel is een concrete, reproduceerbare inconsistentie. */
  problemen: string[];
}

// ----------------------------------------------------------------------------
// 2. FISCALE REGEL-DEFINITIES (STANDAARDTEKSTEN PER CLASSIFICATIE)
// ----------------------------------------------------------------------------

interface RuleDefinition {
  rate: 0 | 9 | 21;
  mode: 'incl_split' | 'reverse_charge' | 'exempt';
  aftrekbaar: boolean;
  wetsartikel: string;
  omschrijving: string;
  korte_toelichting: string;
  rubriek: string;
}

const RULES: Record<ClassificationKey, RuleDefinition> = {
  omzet_algemeen_21: {
    rate: 21,
    mode: 'incl_split',
    aftrekbaar: false,
    wetsartikel: 'Art. 9 lid 1 Wet OB 1968',
    omschrijving:
      'Dienstverlening of levering belast tegen het algemene BTW-tarief van 21% (art. 9 lid 1 Wet OB 1968).',
    korte_toelichting:
      'Dienstverlening belast tegen het algemene BTW-tarief van 21% (art. 9 lid 1 Wet OB 1968).',
    rubriek: 'Verschuldigde BTW — Rubriek 1a',
  },
  omzet_verlaagd_9: {
    rate: 9,
    mode: 'incl_split',
    aftrekbaar: false,
    wetsartikel: 'Art. 9 lid 2 juncto Tabel I Wet OB 1968',
    omschrijving:
      'Prestatie belast tegen het verlaagde BTW-tarief van 9% (art. 9 lid 2 juncto Tabel I Wet OB 1968).',
    korte_toelichting:
      'Dienstverlening belast tegen het verlaagde BTW-tarief van 9% (art. 9 lid 2 jo. Tabel I Wet OB 1968).',
    rubriek: 'Verschuldigde BTW — Rubriek 1b',
  },
  omzet_vrijgesteld_0: {
    rate: 0,
    mode: 'exempt',
    aftrekbaar: false,
    wetsartikel: 'Art. 11 Wet OB 1968',
    omschrijving:
      'Vrijgesteld van omzetbelasting (art. 11 Wet OB 1968) of valt buiten de reikwijdte van de omzetbelasting.',
    korte_toelichting: 'Vrijgesteld van omzetbelasting (art. 11 Wet OB 1968).',
    rubriek: 'Vrijgesteld / buiten reikwijdte — Rubriek 1e',
  },
  kosten_algemeen_21: {
    rate: 21,
    mode: 'incl_split',
    aftrekbaar: true,
    wetsartikel: 'Art. 15 lid 1 sub a Wet OB 1968',
    omschrijving:
      'Zakelijke uitgaande transactie belast met 21% BTW; BTW volledig aftrekbaar als voorbelasting (art. 15 lid 1 sub a Wet OB 1968).',
    korte_toelichting:
      'Zakelijke uitgave belast tegen het algemene BTW-tarief van 21%, volledig aftrekbaar (art. 15 lid 1 sub a Wet OB 1968).',
    rubriek: 'Aftrekbare voorbelasting — Rubriek 5b',
  },
  kosten_verlaagd_9: {
    rate: 9,
    mode: 'incl_split',
    aftrekbaar: true,
    wetsartikel: 'Art. 15 lid 1 sub a juncto Tabel I Wet OB 1968',
    omschrijving:
      'Zakelijke uitgaande transactie belast met 9% BTW; BTW aftrekbaar als voorbelasting (art. 15 lid 1 sub a juncto Tabel I Wet OB 1968).',
    korte_toelichting:
      'Zakelijke uitgave belast tegen het verlaagde BTW-tarief van 9%, aftrekbaar (Tabel I Wet OB 1968).',
    rubriek: 'Aftrekbare voorbelasting — Rubriek 5b',
  },
  horeca_bua_9: {
    rate: 9,
    mode: 'incl_split',
    aftrekbaar: false,
    wetsartikel: 'Art. 15 lid 5 Wet OB 1968 juncto BUA (1968)',
    omschrijving:
      'Eten en drinken voor consumptie ter plaatse in een horecagelegenheid; BTW uitgesloten van aftrek (art. 15 lid 5 Wet OB 1968 / BUA).',
    korte_toelichting: 'Horeca consumptie (BUA): BTW niet aftrekbaar.',
    rubriek: 'Niet-aftrekbare BTW (BUA) — geen Rubriek 5b',
  },
  kosten_vrijgesteld_0: {
    rate: 0,
    mode: 'exempt',
    aftrekbaar: false,
    wetsartikel: 'Buiten reikwijdte Wet OB 1968 (bijv. overheidsleges, griffierecht, loonheffingen)',
    omschrijving:
      'Betaling die geen vergoeding voor een belaste prestatie is (overheidsleges, boetes, loonheffing, griffierecht e.d.) en daarom buiten de reikwijdte van de omzetbelasting valt.',
    korte_toelichting: 'Overheidsleges / buiten de reikwijdte van de omzetbelasting.',
    rubriek: 'Geen BTW-effect',
  },
  verlegd_21: {
    rate: 21,
    mode: 'reverse_charge',
    aftrekbaar: true,
    wetsartikel: 'Art. 12 lid 2 Wet OB 1968',
    omschrijving:
      'BTW verlegd door buitenlandse dienstverlener (art. 12 lid 2 Wet OB 1968). BTW verschuldigd in Rubriek 2a en gelijktijdig aftrekbaar in Rubriek 5b (netto effect € 0,00).',
    korte_toelichting: 'BTW verlegd (buitenlandse dienstverlener, art. 12 lid 2 Wet OB 1968).',
    rubriek: 'Verlegde BTW — Rubriek 2a + 5b',
  },
  prive_geen_btw: {
    rate: 0,
    mode: 'exempt',
    aftrekbaar: false,
    wetsartikel: 'Geen omzetbelastingplichtige prestatie (privéopname/-storting ondernemer)',
    omschrijving:
      'Privéopname of -storting van de ondernemer: er staat geen levering of dienst tegenover, dus dit is geen prestatie in de zin van de Wet OB 1968 en telt niet mee in de BTW-aangifte (geen omzet, geen kosten, geen voorbelasting).',
    korte_toelichting: 'Privéopname/-storting ondernemer: geen BTW-plichtige prestatie, buiten de aangifte.',
    rubriek: 'Geen BTW-effect (privé, niet in de aangifte)',
  },
};

// ----------------------------------------------------------------------------
// 3. AUTOMATISCHE CLASSIFICATIE — "DENKT ALS EEN NEDERLANDSE BOEKHOUDER"
// ----------------------------------------------------------------------------
//
// Werkt in oplopend uitgebreide LAGEN, precies zoals een boekhouder die een
// onbekende regel tegenkomt niet meteen opgeeft, maar méér verbanden erbij
// zoekt voordat hij naar de standaard grijpt:
//
//   Laag 1 — exacte leveranciersnaam (hoge zekerheid)
//   Laag 2 — trefwoorden in de memo/mededeling, vaak informatiever dan de
//            kale naam (bv. "ChatGPT Plus Business Subscription") (hoge zekerheid)
//   Laag 3 — gecombineerde zwakkere signalen: buitenlands IBAN + software-/
//            dienst-trefwoord in naam of memo (gemiddelde zekerheid)
//   Laag 4 — brede categorie-woordenboeken (hosting, koerier, brandstof,
//            verzekering, notaris/advocaat/accountant, marketing/reclame)
//            (hoge zekerheid, maar generieker dan laag 1)
//   Laag 5 — pas als NIETS hierboven iets oplevert: fiscaal veilige
//            standaard, gemarkeerd `herkend: false` zodat dit zichtbaar
//            blijft in de audit-trail (maar zonder dat de gebruiker iets
//            hoeft te doen — de engine gaat gewoon door).
//
// Elke laag wordt voor élke transactie geprobeerd voordat wordt opgegeven;
// er wordt dus nooit na de eerste mislukte poging gestopt.

interface ClassifyContext {
  description: string;
  memo: string;
  combined: string; // description + memo, voor brede woordenboek-matches
  type: TransactionType;
  tegenrekening_iban?: string;
}

interface ClassifyResult {
  classification: ClassificationKey;
  herkend: boolean;
  herkenningsbron: string;
  korte_toelichting_override?: string;
  bron: ClassificationSource;
  zekerheid: Zekerheid;
}

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function pad(s: string): string {
  return ` ${s.toLowerCase()} `;
}

/** Bekende buitenlandse SaaS/tech-leveranciers waarvoor de verleggingsregeling geldt. */
const REVERSE_CHARGE_VENDORS = [
  'openai', 'anthropic', 'elevenlabs', 'netlify', 'github', 'gitlab',
  'adobe systems', 'resend', 'google cloud', 'google ireland', 'microsoft ireland',
  'amazon web services', 'aws europe', 'stripe', 'zoom communications', 'slack technologies',
  'notion labs', 'figma', 'canva', 'cloudflare', 'vercel', 'twilio', 'sendgrid',
  'digitalocean', 'heroku', 'atlassian', 'zapier', 'hubspot', 'dropbox',
  'meta platforms', 'linkedin ireland', 'apple distribution international',
  'mailchimp', 'intercom', 'asana', 'monday.com', 'airtable', 'miro',
  'openweather', 'algolia', 'segment.io', 'mixpanel', 'amplitude', 'datadog',
];

const HORECA_KEYWORDS = [
  'café', 'cafe', 'restaurant', 'horeca', 'brasserie', 'bistro', 'lunchroom',
  'eetcafé', 'eetcafe', 'grand café', 'grand cafe', 'cafetaria', 'snackbar',
  'eetgelegenheid', 'proeflokaal', 'lunch', 'diner met klant', 'zakendiner',
];

const TRANSPORT_KEYWORDS = [
  'ns zakelijk', 'nederlandse spoorwegen', ' ns ', 'ret ', 'gvb', 'connexxion',
  'arriva', 'qbuzz', 'ov-chipkaart', 'ovchipkaart', 'taxi', 'uber', 'trein',
  'openbaar vervoer', 'reiskosten trein',
];

const FOOD_KEYWORDS = [
  'albert heijn', 'jumbo', 'lidl', 'aldi', 'plus supermarkt', 'coop supermarkt',
  'dirk van den broek', 'vomar', 'spar', 'boni', 'supermarkt', 'pantry',
];

const GOVERNMENT_KEYWORDS = [
  'belastingdienst', 'kamer van koophandel', ' kvk ', 'kvk nederland', 'rdw',
  'uwv', 'gemeente', 'rijksoverheid', 'douane', 'griffierecht', 'cbr',
  'btw aangifte', 'inkomstenbelasting', 'aanslag',
];

const TELECOM_KEYWORDS = [
  'ziggo', 'kpn', 't-mobile', 'tmobile', 'vodafone', 'odido', 'tele2', 'xs4all', 'freedom internet',
];

/** Laag 4: bredere, generieke Nederlandse bedrijfscategorieën (blijven 21%, aftrekbaar, maar met een specifiekere toelichting dan de kale standaard). */
const HOSTING_KEYWORDS = ['hosting', 'domein', 'domeinnaam', 'transip', 'vps', 'server'];
const COURIER_KEYWORDS = ['postnl', 'pakket', 'koerier', 'dhl', 'ups ', 'aangetekende post', 'pakketzegel'];
const FUEL_KEYWORDS = ['shell', 'bp station', 'esso', 'tinq', 'tankstation', 'brandstof', 'tanken', 'total energies'];
const PROFESSIONAL_SERVICES_KEYWORDS = ['notaris', 'accountant', 'advocaat', 'advocatenkantoor', 'boekhouder', 'administratiekantoor'];
const MARKETING_KEYWORDS = ['marketing', 'reclame', 'advertentie', 'seo', 'campagne'];
const OFFICE_SUPPLIES_KEYWORDS = ['kantoorartikelen', 'staples', 'kantoorbenodigdheden', 'bureaustoel', 'kantoorinrichting'];

/** Insurance is fiscaal vrijgesteld (art. 11 lid 1 sub k Wet OB 1968), niet 21%. */
const INSURANCE_KEYWORDS = ['verzekering', 'assurantie', 'polis'];

/** Trefwoorden die, gecombineerd met een buitenlands IBAN, wijzen op een buitenlandse (SaaS-)dienst. */
const FOREIGN_SERVICE_HINT_KEYWORDS = [
  'subscription', 'plan', 'license', 'licence', 'saas', 'api', 'cloud',
  'software', 'creator', 'usage', 'credits', 'seats', 'membership',
];

/** Landcodes waarbij een dienst vrijwel zeker geen NL-BTW op de factuur heeft staan (dus verleggingskandidaat). */
const NON_NL_IBAN_PREFIXES_OF_INTEREST = ['US', 'IE', 'GB', 'CH', 'SG', 'CA', 'AU'];

function ibanCountry(iban: string | undefined): string | null {
  if (!iban) return null;
  const trimmed = iban.trim().toUpperCase();
  return trimmed.length >= 2 ? trimmed.slice(0, 2) : null;
}

// --- Laag 0: privéopname/-storting — geldt voor zowel inkomsten als uitgaven, altijd als eerste gecheckt ---
const PRIVATE_KEYWORDS = [
  'privé', 'prive', 'privéopname', 'priveopname', 'privéstorting', 'privestorting',
  'opname eigenaar', 'storting eigenaar', 'kapitaalstorting', 'ondernemer privé',
];

function layer0_privateTransaction(ctx: ClassifyContext): ClassifyResult | null {
  if (matchesAny(ctx.combined, PRIVATE_KEYWORDS)) {
    return {
      classification: 'prive_geen_btw',
      herkend: true,
      herkenningsbron: 'Herkend als privéopname/-storting van de ondernemer — geen prestatie, dus buiten de BTW-aangifte gehouden.',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  return null;
}

// --- Laag 1: exacte leveranciersnaam -----------------------------------------
function layer1_knownVendor(ctx: ClassifyContext): ClassifyResult | null {
  const normType = (ctx.type === 'income' || (ctx.type as unknown) === 'Inkomsten') ? 'income' : 'expense';
  if (normType !== 'expense') return null;
  if (matchesAny(pad(ctx.description), REVERSE_CHARGE_VENDORS)) {
    return {
      classification: 'verlegd_21',
      herkend: true,
      herkenningsbron: 'Herkend als bekende buitenlandse SaaS/tech-leverancier (verleggingsregeling art. 12 lid 2 Wet OB 1968).',
      bron: 'automatisch_regelgebaseerd',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(pad(ctx.description), HORECA_KEYWORDS)) {
    return {
      classification: 'horeca_bua_9',
      herkend: true,
      herkenningsbron: 'Herkend als horeca-uitgave (café/restaurant) — BTW-aftrek uitgesloten onder het BUA.',
      bron: 'automatisch_regelgebaseerd',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(pad(ctx.description), FOOD_KEYWORDS)) {
    return {
      classification: 'kosten_verlaagd_9',
      herkend: true,
      herkenningsbron: 'Herkend als levensmiddelen/supermarkt (verlaagd tarief 9%).',
      korte_toelichting_override: 'Levensmiddelen/pantry belast tegen het verlaagde BTW-tarief van 9% (Tabel I Wet OB 1968).',
      bron: 'automatisch_regelgebaseerd',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(pad(ctx.description), GOVERNMENT_KEYWORDS)) {
    return {
      classification: 'kosten_vrijgesteld_0',
      herkend: true,
      herkenningsbron: 'Herkend als overheidsinstantie/wettelijke heffing — buiten de reikwijdte van de omzetbelasting.',
      korte_toelichting_override: 'Overheidsleges en wettelijke overheidstaken vallen buiten de reikwijdte van de omzetbelasting.',
      bron: 'automatisch_regelgebaseerd',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(pad(ctx.description), TELECOM_KEYWORDS)) {
    return {
      classification: 'kosten_algemeen_21',
      herkend: true,
      herkenningsbron: 'Herkend als telecom-/internetaanbieder (algemeen tarief 21%, aftrekbaar).',
      korte_toelichting_override: 'Telecommunicatie- en internetdiensten belast tegen het algemene BTW-tarief van 21% (art. 9 lid 1 Wet OB 1968).',
      bron: 'automatisch_regelgebaseerd',
      zekerheid: 'hoog',
    };
  }
  return null;
}

// --- Laag 2: trefwoorden in de memo/mededeling -------------------------------
function layer2_memoKeywords(ctx: ClassifyContext): ClassifyResult | null {
  const normType = (ctx.type === 'income' || (ctx.type as unknown) === 'Inkomsten') ? 'income' : 'expense';
  if (normType !== 'expense' || !ctx.memo) return null;
  const memo = pad(ctx.memo);
  if (matchesAny(memo, TRANSPORT_KEYWORDS)) {
    return {
      classification: 'kosten_verlaagd_9',
      herkend: true,
      herkenningsbron: 'Herkend via de mededeling als personenvervoer (verlaagd tarief 9%).',
      korte_toelichting_override: 'Personenvervoer belast tegen het verlaagde BTW-tarief van 9% (Tabel I Wet OB 1968).',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(memo, HORECA_KEYWORDS)) {
    return {
      classification: 'horeca_bua_9',
      herkend: true,
      herkenningsbron: 'Herkend via de mededeling als horeca-consumptie — BTW-aftrek uitgesloten onder het BUA.',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(memo, GOVERNMENT_KEYWORDS)) {
    return {
      classification: 'kosten_vrijgesteld_0',
      herkend: true,
      herkenningsbron: 'Herkend via de mededeling als overheidsgerelateerde betaling — buiten de reikwijdte van de omzetbelasting.',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  return null;
}

// --- Laag 3B: ECHTE tegenstrijdigheid — Nederlandse rechtsvorm + buitenlands rekeningnummer + claim van verlegde BTW ---
const NL_ENTITY_SUFFIXES = ['b.v.', ' bv ', ' bv/', 'n.v.', ' nv ', 'v.o.f.', ' vof ', 'eenmanszaak'];
const REVERSE_CHARGE_CLAIM_KEYWORDS = ['btw verlegd', 'verlegde btw', 'reverse charge', 'vat reverse'];

function layer3b_conflictDetection(ctx: ClassifyContext): ClassifyResult | null {
  const normType = (ctx.type === 'income' || (ctx.type as unknown) === 'Inkomsten') ? 'income' : 'expense';
  if (normType !== 'expense') return null;
  const country = ibanCountry(ctx.tegenrekening_iban);
  if (!country || country === 'NL') return null;
  const looksLikeDutchEntity = matchesAny(pad(ctx.description), NL_ENTITY_SUFFIXES);
  const claimsReverseCharge = matchesAny(ctx.combined, REVERSE_CHARGE_CLAIM_KEYWORDS);
  if (looksLikeDutchEntity && claimsReverseCharge) {
    return {
      classification: 'kosten_algemeen_21',
      herkend: false,
      herkenningsbron: `Tegenstrijdige signalen: de naam wijst op een Nederlandse rechtsvorm (B.V./N.V./VOF), terwijl de mededeling verlegde BTW claimt en het rekeningnummer (${country}) buitenlands is. Verlegde BTW geldt alleen voor echte buitenlandse dienstverlening — dit verdient een menselijke controle voordat het tarief vaststaat.`,
      bron: 'conflict_gedetecteerd',
      zekerheid: 'laag',
    };
  }
  return null;
}

// --- Laag 3: gecombineerde zwakkere signalen (buitenlands IBAN + dienst-trefwoord) ---
function layer3_combinedSignals(ctx: ClassifyContext): ClassifyResult | null {
  const normType = (ctx.type === 'income' || (ctx.type as unknown) === 'Inkomsten') ? 'income' : 'expense';
  if (normType !== 'expense') return null;
  const country = ibanCountry(ctx.tegenrekening_iban);
  if (!country || country === 'NL') return null;
  const hasServiceHint = matchesAny(ctx.combined, FOREIGN_SERVICE_HINT_KEYWORDS);
  if (hasServiceHint && NON_NL_IBAN_PREFIXES_OF_INTEREST.includes(country)) {
    return {
      classification: 'verlegd_21',
      herkend: true,
      herkenningsbron: `Vermoedelijk buitenlandse dienst: rekeningnummer uit ${country} gecombineerd met een dienst-/software-gerelateerde omschrijving (verleggingsregeling art. 12 lid 2 Wet OB 1968). Niet op een vaste leverancierslijst, maar wel op basis van sterke combinatie van signalen.`,
      bron: 'automatisch_gecombineerd',
      zekerheid: 'gemiddeld',
    };
  }
  return null;
}

// --- Laag 4: brede generieke categorieën -------------------------------------
function layer4_broadCategories(ctx: ClassifyContext): ClassifyResult | null {
  const normType = (ctx.type === 'income' || (ctx.type as unknown) === 'Inkomsten') ? 'income' : 'expense';
  if (normType !== 'expense') return null;
  const c = ctx.combined;
  if (matchesAny(c, INSURANCE_KEYWORDS)) {
    return {
      classification: 'kosten_vrijgesteld_0',
      herkend: true,
      herkenningsbron: 'Herkend als verzekeringspremie — vrijgesteld van omzetbelasting (art. 11 lid 1 sub k Wet OB 1968).',
      korte_toelichting_override: 'Verzekeringspremie: vrijgesteld van omzetbelasting (art. 11 lid 1 sub k Wet OB 1968).',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(c, HOSTING_KEYWORDS)) {
    return {
      classification: 'kosten_algemeen_21',
      herkend: true,
      herkenningsbron: 'Herkend als hosting-/domeindienst (algemeen tarief 21%, aftrekbaar).',
      korte_toelichting_override: 'Hosting- en domeindiensten belast tegen het algemene BTW-tarief van 21% (art. 15 lid 1 sub a Wet OB 1968).',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(c, COURIER_KEYWORDS)) {
    return {
      classification: 'kosten_algemeen_21',
      herkend: true,
      herkenningsbron: 'Herkend als post-/pakketdienst (algemeen tarief 21%, aftrekbaar).',
      korte_toelichting_override: 'Post- en pakketdiensten belast tegen het algemene BTW-tarief van 21% (art. 15 lid 1 sub a Wet OB 1968).',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(c, FUEL_KEYWORDS)) {
    return {
      classification: 'kosten_algemeen_21',
      herkend: true,
      herkenningsbron: 'Herkend als brandstofkosten zakelijk gebruik (algemeen tarief 21%, aftrekbaar).',
      korte_toelichting_override: 'Brandstofkosten voor zakelijk gebruik belast tegen het algemene BTW-tarief van 21% (art. 15 lid 1 sub a Wet OB 1968).',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(c, PROFESSIONAL_SERVICES_KEYWORDS)) {
    return {
      classification: 'kosten_algemeen_21',
      herkend: true,
      herkenningsbron: 'Herkend als professionele dienstverlening (notaris/accountant/advocaat) — algemeen tarief 21%, aftrekbaar.',
      korte_toelichting_override: 'Professionele dienstverlening belast tegen het algemene BTW-tarief van 21% (art. 15 lid 1 sub a Wet OB 1968).',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(c, MARKETING_KEYWORDS)) {
    return {
      classification: 'kosten_algemeen_21',
      herkend: true,
      herkenningsbron: 'Herkend als marketing-/reclame-uitgave (algemeen tarief 21%, aftrekbaar).',
      korte_toelichting_override: 'Marketing- en reclamediensten belast tegen het algemene BTW-tarief van 21% (art. 15 lid 1 sub a Wet OB 1968).',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  if (matchesAny(c, OFFICE_SUPPLIES_KEYWORDS)) {
    return {
      classification: 'kosten_algemeen_21',
      herkend: true,
      herkenningsbron: 'Herkend als kantoorartikelen/-inrichting (algemeen tarief 21%, aftrekbaar).',
      korte_toelichting_override: 'Kantoorartikelen belast tegen het algemene BTW-tarief van 21% (art. 15 lid 1 sub a Wet OB 1968).',
      bron: 'automatisch_omschrijving',
      zekerheid: 'hoog',
    };
  }
  return null;
}

/**
 * Automatische classificatie op basis van leverancier, memo/mededeling en
 * (indien beschikbaar) IBAN van de tegenrekening. Probeert alle vier de lagen
 * hierboven vóórdat wordt teruggevallen op de fiscaal veilige standaard —
 * "blijft zoeken naar de juiste verbanden" in plaats van meteen op te geven.
 */
export function autoClassify(
  description: string | undefined,
  type: TransactionType,
  memo?: string,
  tegenrekening_iban?: string
): { classification: ClassificationKey; herkend: boolean; herkenningsbron: string; korte_toelichting_override?: string; bron: ClassificationSource; zekerheid: Zekerheid } {
  const normType: 'income' | 'expense' = (type === 'income' || (type as unknown) === 'Inkomsten') ? 'income' : 'expense';
  const ctx: ClassifyContext = {
    description: description ?? '',
    memo: memo ?? '',
    combined: pad(`${description ?? ''} ${memo ?? ''}`),
    type: normType,
    tegenrekening_iban,
  };

  // Laag 0 geldt voor beide richtingen: een privéopname/-storting is nooit omzet of kosten.
  const priv = layer0_privateTransaction(ctx);
  if (priv) return priv;

  if (normType === 'expense') {
    const layers = [layer1_knownVendor, layer2_memoKeywords, layer3b_conflictDetection, layer3_combinedSignals, layer4_broadCategories];
    for (const layer of layers) {
      const result = layer(ctx);
      if (result) return result;
    }
    // Alle lagen doorlopen, geen enkel signaal (positief of tegenstrijdig)
    // gevonden: er is geen reden om af te wijken van het algemene tarief,
    // dus geldt dat tarief — met vertrouwen, niet als gok. Dit is GEEN
    // twijfelgeval: "geen uitzondering van toepassing" is zelf al het
    // juiste, volledig onderbouwde antwoord (art. 15 lid 1 sub a Wet OB
    // 1968 is de standaardregel, geen noodgreep).
    return {
      classification: 'kosten_algemeen_21',
      herkend: true,
      herkenningsbron:
        'Geen leverancier, trefwoord, categorie of IBAN-signaal wijst op een verlaagd tarief, vrijstelling of verlegging — het algemene tarief van 21% is dan het fiscaal juiste standaardantwoord.',
      bron: 'standaard_geen_uitzondering',
      zekerheid: 'hoog',
    };
  }

  // type === 'income'
  if (matchesAny(pad(ctx.description), GOVERNMENT_KEYWORDS) || matchesAny(pad(ctx.memo), GOVERNMENT_KEYWORDS)) {
    return {
      classification: 'omzet_vrijgesteld_0',
      herkend: true,
      herkenningsbron: 'Herkend als overheidsgerelateerde ontvangst — buiten de reikwijdte van de omzetbelasting.',
      bron: 'automatisch_regelgebaseerd',
      zekerheid: 'hoog',
    };
  }
  // Zelfde redenering als bij uitgaven: geen signaal voor iets anders dan
  // het algemene tarief gevonden -> dat tarief geldt met vertrouwen.
  return {
    classification: 'omzet_algemeen_21',
    herkend: true,
    herkenningsbron:
      'Geen trefwoord of categorie wijst op een verlaagd tarief of vrijstelling — het algemene tarief van 21% is dan het fiscaal juiste standaardantwoord voor binnenlandse B2B-dienstverlening.',
    bron: 'standaard_geen_uitzondering',
    zekerheid: 'hoog',
  };
}

// ----------------------------------------------------------------------------
// 3B. CONSENSUS OVER MEERDERE ONAFHANKELIJKE AI-CLASSIFICATIES ("3X CHECKEN")
// ----------------------------------------------------------------------------
//
// Voor transacties die de deterministische `autoClassify` niet met zekerheid
// kan plaatsen (onbekende leverancier), levert de aanroepende applicatie
// meerdere ONAFHANKELIJKE classificatievoorstellen aan (bv. 3 losse
// Gemini-aanroepen die elkaars antwoord niet zien). Deze functie telt de
// stemmen: bij eenparigheid of meerderheid wordt dat antwoord gebruikt, bij
// verdeelde stemmen valt de engine automatisch terug op de fiscaal veilige
// standaard — zonder dat er ooit een vraag aan de gebruiker wordt gesteld.

function resolveConsensus(proposals: ClassificationKey[]): {
  classification: ClassificationKey | null;
  unanimous: boolean;
  majority: boolean;
} {
  if (proposals.length === 0) {
    return { classification: null, unanimous: false, majority: false };
  }
  const counts = new Map<ClassificationKey, number>();
  for (const p of proposals) counts.set(p, (counts.get(p) ?? 0) + 1);

  let best: ClassificationKey | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }

  return {
    classification: best,
    unanimous: bestCount === proposals.length,
    majority: bestCount > proposals.length / 2,
  };
}

// ----------------------------------------------------------------------------
// 4. HULPFUNCTIES
// ----------------------------------------------------------------------------

/** Rond af op 2 decimalen en voorkomt drijvende-kommafouten. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Kleine tolerantie voor afrondingsverschillen bij optelsommen van centen. */
const ROUNDING_TOLERANCE = 0.02;
function approxEqual(a: number, b: number, tolerance = ROUNDING_TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance;
}

function processTransaction(
  tx: RawTransaction,
  classification: ClassificationKey,
  herkend: boolean,
  herkenningsbron: string,
  classificatie_bron: ClassificationSource,
  zekerheid: Zekerheid,
  korte_toelichting_override?: string,
  ai_voorstellen?: ClassificationKey[]
): ProcessedTransaction {
  const rule = RULES[classification];
  if (!rule) {
    throw new Error(`Onbekende classificatie "${classification}" voor transactie ${tx.id}.`);
  }

  let bedrag_excl: number;
  let btw_bedrag: number;
  let bedrag_incl: number;

  switch (rule.mode) {
    case 'incl_split': {
      bedrag_excl = round2(tx.amount_incl / (1 + rule.rate / 100));
      btw_bedrag = round2(tx.amount_incl - bedrag_excl);
      bedrag_incl = round2(tx.amount_incl);
      break;
    }
    case 'exempt': {
      bedrag_excl = round2(tx.amount_incl);
      btw_bedrag = 0;
      bedrag_incl = round2(tx.amount_incl);
      break;
    }
    case 'reverse_charge': {
      bedrag_excl = round2(tx.amount_incl);
      btw_bedrag = round2(tx.amount_incl * (rule.rate / 100));
      bedrag_incl = round2(bedrag_excl + btw_bedrag);
      break;
    }
  }

  const normType: 'income' | 'expense' = (tx.type === 'income' || (tx.type as unknown) === 'Inkomsten') ? 'income' : 'expense';

  return {
    id: tx.id,
    date: tx.date,
    type: normType,
    description: tx.description,
    classification,
    rate: rule.rate,
    amount_incl_input: tx.amount_incl,
    bedrag_excl,
    btw_bedrag,
    bedrag_incl,
    aftrekbaar: rule.aftrekbaar,
    applied_rule: {
      classification,
      wetsartikel: rule.wetsartikel,
      omschrijving: rule.omschrijving,
      korte_toelichting: korte_toelichting_override ?? rule.korte_toelichting,
      rubriek: rule.rubriek,
    },
    herkend,
    herkenningsbron,
    classificatie_bron,
    ai_voorstellen,
    zekerheid,
  };
}

export type BtwPercentage = 0 | 9 | 21;

/** Eén boekhouder-beoordeling: het gekozen tarief plus (optioneel) wie de keuze maakte, voor de "Door X beoordeeld"-toelichting in de UI. */
export interface BoekhouderBeoordeling {
  percentage: BtwPercentage;
  /** Naam van de boekhouder die deze knop heeft ingedrukt — verschijnt letterlijk in de toelichting van de transactie. */
  beoordeeld_door?: string;
}

/**
 * Vertaalt een simpele boekhouder-keuze ("dit is 0/9/21%") naar de juiste
 * classificatie voor de standaardbehandeling van dat tarief. Dit is bewust
 * de EENVOUDIGE driekeuze-variant (geen vijfde optie voor horeca/BUA of
 * verlegde BTW) — als een transactie zo'n bijzondere behandeling nodig
 * heeft, herkent de engine dat normaliter al automatisch in een eerdere
 * laag; deze functie is puur het laatste redmiddel voor de kleine rest die
 * na alle automatische pogingen alsnog onopgelost blijft.
 */
function classificationFromPercentage(pct: BtwPercentage, type: TransactionType): ClassificationKey {
  const normType = (type === 'income' || (type as unknown) === 'Inkomsten');
  if (normType) {
    if (pct === 0) return 'omzet_vrijgesteld_0';
    if (pct === 9) return 'omzet_verlaagd_9';
    return 'omzet_algemeen_21';
  }
  if (pct === 0) return 'kosten_vrijgesteld_0';
  if (pct === 9) return 'kosten_verlaagd_9'; // aftrekbaar; voor het niet-aftrekbare horeca/BUA-geval blijft de volledige classifications-map beschikbaar
  return 'kosten_algemeen_21';
}

export interface CalculateVatReportOptions {
  /** Handmatige/overschreven classificaties per transactie-id (indien de gebruiker toch corrigeert, inclusief bijzondere gevallen als horeca/BUA of verlegd). */
  classifications?: ClassificationMap;
  /**
   * Meerdere onafhankelijke AI-classificatievoorstellen per transactie-id,
   * bedoeld voor transacties die `autoClassify` niet met zekerheid kon
   * plaatsen. Geef minimaal 3 onafhankelijke voorstellen per transactie mee
   * voor het "3x checken"-mechanisme (meerderheid wint, anders veilige
   * standaard). Ontbreekt een id, of is er geen meerderheid, dan valt de
   * engine automatisch en zonder tussenkomst terug op de fiscaal veilige
   * standaardregel — tenzij er ook een percentageOverride is (zie hieronder).
   */
  aiProposals?: AiProposalMap;
  /**
   * LAATSTE REDMIDDEL: per transactie-id een door de boekhouder handmatig
   * aangewezen BTW-percentage (0, 9 of 21), voor de kleine rest die na alle
   * automatische lagen én AI-consensus nog steeds `zekerheid: 'laag'` heeft
   * (zie `vindEscalatieKandidaten`). De engine rekent dit percentage
   * vervolgens gewoon mee in de totalen, inclusief excl./incl.-splitsing en
   * aftrekbaarheid — de boekhouder hoeft het bedrag zelf niet uit te
   * rekenen, alleen het tarief te kiezen. BELANGRIJK VOOR PERSISTENTIE: sla
   * deze map bij de host-app op (gekoppeld aan `genereerStabielTransactieId`,
   * niet aan een positioneel "t1"-id) en geef 'm bij elke volgende run
   * opnieuw mee — anders "vergeet" de tool een eerder afgehandeld geval en
   * duikt het bij de volgende upload weer op als twijfelgeval.
   */
  percentageOverrides?: Record<string, BoekhouderBeoordeling>;
}

// ----------------------------------------------------------------------------
// 5. HOOFDFUNCTIE
// ----------------------------------------------------------------------------

/**
 * Berekent het volledige BTW-rapport voor een dynamische set transacties.
 * Classificeert volledig automatisch (geen handmatige actie nodig), volgens
 * deze volgorde per transactie:
 *   1. Volledige handmatige override (`classifications`, indien meegegeven).
 *   2. Deterministische leveranciersherkenning (`autoClassify`, 5 lagen) —
 *      hoge zekerheid, geen AI nodig.
 *   3. Consensus over meerdere onafhankelijke AI-voorstellen ("3x checken")
 *      — gebruikt bij eenparigheid of meerderheid.
 *   4. Handmatige percentage-override (`percentageOverrides`) — het
 *      allerlaatste redmiddel: de boekhouder heeft na alle voorgaande
 *      pogingen alsnog een tarief aangewezen; de engine rekent dat mee.
 *   5. Fiscaal veilige standaard (algemeen tarief, wél aftrekbaar) — alleen
 *      als werkelijk niets van bovenstaande iets opleverde.
 * Werkt onafhankelijk van het aantal transacties (getest tot 4000+, zie
 * validatiescript).
 */
export function calculateVatReport(
  rawTransactions: RawTransaction[],
  options: CalculateVatReportOptions = {}
): VatReport {
  const { classifications = {}, aiProposals = {}, percentageOverrides = {} } = options;

  const processed = rawTransactions.map((tx) => {
    const manual = classifications[tx.id];
    if (manual) {
      return processTransaction(tx, manual, true, 'Handmatig geclassificeerd door gebruiker.', 'handmatig', 'hoog');
    }

    // Een eerdere boekhouder-beoordeling heeft ALTIJD voorrang, ook boven een
    // (mogelijk andersluidende) automatische herkenning. Dit garandeert dat
    // een eenmaal afgehandeld geval nooit meer terugklapt naar "twijfel" bij
    // een volgende run — zolang de host-app dit object persisteert en
    // opnieuw meegeeft (zie CalculateVatReportOptions.percentageOverrides).
    const beoordeling = percentageOverrides[tx.id];
    if (beoordeling) {
      const naam = beoordeling.beoordeeld_door?.trim();
      return processTransaction(
        tx,
        classificationFromPercentage(beoordeling.percentage, tx.type),
        true,
        naam ? `Door ${naam} beoordeeld.` : `Handmatig ${beoordeling.percentage}% toegewezen door de boekhouder.`,
        'handmatig_percentage',
        'hoog'
      );
    }

    const auto = autoClassify(tx.description, tx.type, tx.memo, tx.tegenrekening_iban);
    if (auto.herkend) {
      return processTransaction(
        tx,
        auto.classification,
        true,
        auto.herkenningsbron,
        auto.bron,
        auto.zekerheid,
        auto.korte_toelichting_override
      );
    }

    // Alle classificatielagen doorzocht en niets gevonden -> probeer consensus
    // over onafhankelijke AI-voorstellen als extra, laatste zoeklaag.
    const proposals = aiProposals[tx.id];
    if (proposals && proposals.length >= 2) {
      const consensus = resolveConsensus(proposals);
      if (consensus.classification && consensus.unanimous) {
        return processTransaction(
          tx,
          consensus.classification,
          true,
          `AI-classificatie: alle ${proposals.length} onafhankelijke controles kwamen op hetzelfde antwoord uit.`,
          'ai_consensus_unaniem',
          'hoog',
          undefined,
          proposals
        );
      }
      if (consensus.classification && consensus.majority) {
        return processTransaction(
          tx,
          consensus.classification,
          true,
          `AI-classificatie: meerderheid van de onafhankelijke controles (${proposals.length}x gecheckt) was het eens.`,
          'ai_consensus_meerderheid',
          'gemiddeld',
          undefined,
          proposals
        );
      }
      // Geen meerderheid en geen boekhouder-override: automatisch terugvallen op de veilige standaard, geen mensen nodig.
      return processTransaction(
        tx,
        auto.classification,
        false,
        `AI-controles liepen uiteen (${proposals.length}x gecheckt, geen meerderheid) — automatisch veilige standaard toegepast.`,
        'geen_consensus_standaard',
        'laag',
        undefined,
        proposals
      );
    }

    // Alle lagen (regels, memo, gecombineerde signalen, brede categorieën, AI)
    // zijn doorzocht en er is geen boekhouder-override — pas nu wordt de
    // veilige standaard toegepast.
    return processTransaction(tx, auto.classification, false, auto.herkenningsbron, auto.bron, auto.zekerheid);
  });

  let totaal_incl_21 = 0;
  let totaal_excl_21 = 0;
  let totaal_incl_9 = 0;
  let totaal_excl_9 = 0;
  let totale_btw_21 = 0;
  let totale_btw_9 = 0;
  let niet_aftrekbare_btw = 0;

  let verschuldigde_btw_omzet_21 = 0;
  let verschuldigde_btw_omzet_9 = 0;
  let verlegde_btw_rubriek_2a = 0;
  let aftrekbare_btw_kosten_21 = 0;
  let aftrekbare_btw_kosten_9 = 0;

  let automatisch_herkend = 0;
  const controle_aanbevolen: ProcessedTransaction[] = [];

  for (const p of processed) {
    if (p.herkend) {
      automatisch_herkend += 1;
    } else {
      controle_aanbevolen.push(p);
    }

    if (p.classification === 'verlegd_21') {
      verlegde_btw_rubriek_2a += p.btw_bedrag;
      continue; // geen incl./excl.-opbouw; zie toelichting in de moduledocs hierboven
    }

    if (p.rate === 21) {
      totaal_incl_21 += p.bedrag_incl;
      totaal_excl_21 += p.bedrag_excl;
      totale_btw_21 += p.btw_bedrag;
    } else if (p.rate === 9) {
      totaal_incl_9 += p.bedrag_incl;
      totaal_excl_9 += p.bedrag_excl;
      totale_btw_9 += p.btw_bedrag;
    }

    if (p.classification === 'horeca_bua_9') {
      niet_aftrekbare_btw += p.btw_bedrag;
    }

    if (p.type === 'income') {
      if (p.rate === 21) verschuldigde_btw_omzet_21 += p.btw_bedrag;
      if (p.rate === 9) verschuldigde_btw_omzet_9 += p.btw_bedrag;
    } else if (p.aftrekbaar) {
      if (p.rate === 21) aftrekbare_btw_kosten_21 += p.btw_bedrag;
      if (p.rate === 9) aftrekbare_btw_kosten_9 += p.btw_bedrag;
    }
  }

  const verschuldigde_btw_totaal = round2(
    verschuldigde_btw_omzet_21 + verschuldigde_btw_omzet_9 + verlegde_btw_rubriek_2a
  );
  // LET OP — bugfix: niet_aftrekbare_btw (BUA/horeca) wordt HIER NIET nogmaals
  // afgetrokken. Die transacties zitten door hun classificatie (horeca_bua_9)
  // al buiten aftrekbare_btw_kosten_9 — ze zijn daar nooit in meegeteld. Een
  // extra "- niet_aftrekbare_btw" zou dat bedrag dus dubbel in mindering
  // brengen en het eindsaldo ten onrechte hoger maken.
  const aftrekbare_btw_totaal = round2(aftrekbare_btw_kosten_21 + aftrekbare_btw_kosten_9 + verlegde_btw_rubriek_2a);
  const btw_eindsaldo = round2(verschuldigde_btw_totaal - aftrekbare_btw_totaal);

  const totaal_transacties = processed.length;
  const standaard_toegepast = totaal_transacties - automatisch_herkend;

  const audit = auditReport(processed, {
    totaal_incl_21: round2(totaal_incl_21),
    totale_btw_21: round2(totale_btw_21),
    totaal_incl_9: round2(totaal_incl_9),
    totale_btw_9: round2(totale_btw_9),
    verschuldigde_btw_totaal,
    aftrekbare_btw_totaal,
    btw_eindsaldo,
  });

  return {
    totaal_incl_21: round2(totaal_incl_21),
    totaal_excl_21: round2(totaal_excl_21),
    totaal_incl_9: round2(totaal_incl_9),
    totaal_excl_9: round2(totaal_excl_9),
    totale_btw_21: round2(totale_btw_21),
    totale_btw_9: round2(totale_btw_9),
    niet_aftrekbare_btw: round2(niet_aftrekbare_btw),
    btw_eindsaldo,
    breakdown: {
      verschuldigde_btw_omzet_21: round2(verschuldigde_btw_omzet_21),
      verschuldigde_btw_omzet_9: round2(verschuldigde_btw_omzet_9),
      verlegde_btw_rubriek_2a: round2(verlegde_btw_rubriek_2a),
      aftrekbare_btw_kosten_21: round2(aftrekbare_btw_kosten_21),
      aftrekbare_btw_kosten_9: round2(aftrekbare_btw_kosten_9),
      verschuldigde_btw_totaal,
      aftrekbare_btw_totaal,
    },
    herkenning: {
      totaal_transacties,
      automatisch_herkend,
      standaard_toegepast,
      percentage_herkend: totaal_transacties === 0 ? 0 : round2((automatisch_herkend / totaal_transacties) * 100),
      controle_aanbevolen,
    },
    audit,
    transactions: processed,
  };
}

// ----------------------------------------------------------------------------
// 5B. AUTOMATISCHE ZELF-AUDIT — DRAAIT BIJ ELKE BEREKENING, GEEN ACTIE NODIG
// ----------------------------------------------------------------------------
//
// Herberekent de kerntotalen onafhankelijk vanuit de losse transactieregels
// en vergelijkt dat met wat de hoofdfunctie heeft opgeteld. Dit vangt
// programmeerfouten of afrondingsinconsistenties af — vóórdat een gebruiker
// het cijfer ooit te zien krijgt. Draait bij elke aanroep, ongeacht het
// aantal transacties (20 of 4000 maakt voor deze controle niets uit).

function auditReport(
  processed: ProcessedTransaction[],
  totals: {
    totaal_incl_21: number;
    totale_btw_21: number;
    totaal_incl_9: number;
    totale_btw_9: number;
    verschuldigde_btw_totaal: number;
    aftrekbare_btw_totaal: number;
    btw_eindsaldo: number;
  }
): AuditResult {
  const problemen: string[] = [];

  // Check 1: per transactie klopt excl. + btw = incl.
  for (const t of processed) {
    if (!approxEqual(t.bedrag_excl + t.btw_bedrag, t.bedrag_incl)) {
      problemen.push(
        `Transactie ${t.id} (${t.description ?? 'onbekend'}): excl. (${t.bedrag_excl}) + BTW (${t.btw_bedrag}) komt niet overeen met incl. (${t.bedrag_incl}).`
      );
    }
    if (![0, 9, 21].includes(t.rate)) {
      problemen.push(`Transactie ${t.id}: ongeldig BTW-tarief ${t.rate}.`);
    }
    if (t.amount_incl_input < 0) {
      problemen.push(`Transactie ${t.id}: negatief bedrag (${t.amount_incl_input}) — controleer brondocument.`);
    }
  }

  // Check 2: onafhankelijke herberekening van totale_btw_21 / totale_btw_9 vanuit de losse regels.
  const herberekend_btw_21 = round2(
    processed
      .filter((t) => t.rate === 21 && t.classification !== 'verlegd_21')
      .reduce((sum, t) => sum + t.btw_bedrag, 0)
  );
  const herberekend_btw_9 = round2(processed.filter((t) => t.rate === 9).reduce((sum, t) => sum + t.btw_bedrag, 0));

  if (!approxEqual(herberekend_btw_21, totals.totale_btw_21)) {
    problemen.push(
      `Onafhankelijke herberekening van totale_btw_21 (${herberekend_btw_21}) wijkt af van het gerapporteerde totaal (${totals.totale_btw_21}).`
    );
  }
  if (!approxEqual(herberekend_btw_9, totals.totale_btw_9)) {
    problemen.push(
      `Onafhankelijke herberekening van totale_btw_9 (${herberekend_btw_9}) wijkt af van het gerapporteerde totaal (${totals.totale_btw_9}).`
    );
  }

  // Check 3: eindsaldo = verschuldigd - aftrekbaar.
  const herberekend_eindsaldo = round2(totals.verschuldigde_btw_totaal - totals.aftrekbare_btw_totaal);
  if (!approxEqual(herberekend_eindsaldo, totals.btw_eindsaldo)) {
    problemen.push(
      `Eindsaldo (${totals.btw_eindsaldo}) komt niet overeen met verschuldigd (${totals.verschuldigde_btw_totaal}) min aftrekbaar (${totals.aftrekbare_btw_totaal}).`
    );
  }

  return { ok: problemen.length === 0, problemen };
}

// ----------------------------------------------------------------------------
// 7. ESCALATIE — WELKE TRANSACTIES VERDIENEN NOG EXTRA ZOEKWERK
// ----------------------------------------------------------------------------
//
// De 5 classificatielagen + AI-consensus lossen het merendeel automatisch op.
// Wat overblijft met `zekerheid: 'laag'` heeft geen van die lagen kunnen
// bevestigen. Voor generieke binnenlandse omzet/inkoop is dat vaak geen
// probleem: 21% ís dan al het fiscaal juiste antwoord, er ís geen andere
// regel te vinden. Maar soms is het wél echt onzeker (nieuwe buitenlandse
// leverancier, onduidelijke rechtsvorm, tegenstrijdige signalen). Deze
// functie geeft de aanroepende applicatie een expliciete, herbruikbare lijst
// om GERICHT verder onderzoek op te doen — in plaats van blind te gokken of
// klakkeloos te accepteren.
//
// AANBEVOLEN WERKWIJZE VOOR DE HOST-APP (bv. Google AI Studio):
//   Ronde 1: calculateVatReport() zonder extra opties — lost het merendeel op.
//   Ronde 2-N: voor elke `vindEscalatieKandidaten()`-uitkomst, doe 3 nieuwe
//              onafhankelijke AI-classificaties MET de aanbevolen_zoekacties
//              als extra context, geef ze mee als aiProposals, reken opnieuw.
//              Herhaal tot er niets meer bijkomt of tot MAX_AANBEVOLEN_ESCALATIE_RONDES
//              is bereikt — daarna levert nóg een ronde vrijwel zeker niets meer op.
//   Laatste redmiddel: wat na die rondes nog steeds `zekerheid: 'laag'` heeft,
//              krijgt de boekhouder voorgelegd met de 3-knops percentagekeuze
//              (zie BOEKHOUDER_PERCENTAGE_OPTIES hieronder). Diens keuze gaat
//              als percentageOverrides mee in de laatste, definitieve
//              calculateVatReport()-aanroep.

/** Praktische bovengrens: meer automatische zoekrondes leveren doorgaans geen extra zekerheid meer op zodra alle signalen zijn uitgeput. */
export const MAX_AANBEVOLEN_ESCALATIE_RONDES = 3;

export interface EscalatieKandidaat {
  transactie: ProcessedTransaction;
  /** Concrete, uitvoerbare onderzoeksstappen — bedoeld voor een host-app met internettoegang (deze module heeft die zelf niet). */
  aanbevolen_zoekacties: string[];
}

/**
 * Selecteert alle transacties die na de volledige classificatiepijplijn nog
 * `zekerheid: 'laag'` hebben, en geeft per transactie concrete
 * vervolgstappen voor verder (geautomatiseerd) onderzoek. Bedoeld om in een
 * lus te worden gebruikt door de host-applicatie (die wél internet-/
 * AI-toegang heeft): voor elke kandidaat opnieuw classificeren met bredere
 * context, en het resultaat als extra `aiProposals`-stem meegeven aan een
 * volgende `calculateVatReport`-aanroep. Begrens dit praktisch tot een klein
 * aantal rondes (bv. 2-3) — oneindig doorzoeken levert geen extra zekerheid
 * op zodra alle beschikbare signalen al zijn uitgeput.
 */
export function vindEscalatieKandidaten(report: VatReport): EscalatieKandidaat[] {
  return report.transactions
    .filter(isTwijfelgeval)
    .map((t) => {
      const stappen: string[] = [];
      if (t.type === 'expense') {
        stappen.push(
          `Zoek de leveranciersnaam "${t.description ?? ''}" op (bv. web) om vast te stellen of dit een Nederlandse, EU- of niet-EU-partij is.`
        );
        if (t.applied_rule.rubriek.includes('Verlegde')) {
          stappen.push('Controleer het buitenlandse BTW-nummer via VIES om de verleggingsregeling te bevestigen.');
        } else {
          stappen.push('Controleer of de leverancier een KVK-inschrijving en Nederlands BTW-nummer heeft (bevestigt binnenlands 21%).');
        }
        stappen.push('Kijk of de rechtsvorm in de naam (BV, Inc, Ltd, GmbH) overeenkomt met het land van de tegenrekening — bij een mismatch (zoals "X B.V." met een claim van verlegde BTW) eerst die tegenstrijdigheid navragen bij de bron.');
      } else {
        stappen.push(
          `Zoek de klantnaam "${t.description ?? ''}" op om te bevestigen dat dit een gewone (niet-vrijgestelde) binnenlandse B2B-dienst betreft.`
        );
        stappen.push('Controleer de onderliggende factuur (indien beschikbaar) op een expliciet vermeld BTW-tarief.');
      }
      return { transactie: t, aanbevolen_zoekacties: stappen };
    });
}

// ----------------------------------------------------------------------------
// 8. LAATSTE REDMIDDEL — DE 3-KNOPS PERCENTAGEKEUZE VOOR DE BOEKHOUDER
// ----------------------------------------------------------------------------
//
// Voor transacties die na alle escalatierondes nog steeds `zekerheid: 'laag'`
// hebben, toont de UI dit simpele keuzemenu: precies 3 knoppen (0%, 9%,
// 21%), niets anders — geen aparte classificatie-dropdown, geen handmatige
// bedragberekening. De boekhouder kiest alleen het tarief; alle rekenwerk
// (excl./incl.-splitsing, aftrekbaarheid, verwerking in de 8 hoofdtotalen)
// doet de engine daarna zelf via `percentageOverrides`.

export interface BoekhouderPercentageOptie {
  percentage: BtwPercentage;
  label: string;
}

/** Canonieke bron voor het 3-knops keuzemenu — gebruik deze array om de UI te bouwen, niet een losse hardcoded lijst. */
export const BOEKHOUDER_PERCENTAGE_OPTIES: BoekhouderPercentageOptie[] = [
  { percentage: 0, label: '0%' },
  { percentage: 9, label: '9%' },
  { percentage: 21, label: '21%' },
];

// ----------------------------------------------------------------------------
// 9. UI-HULPFUNCTIE — TRANSACTIETABEL ZOALS IN HET VOORBEELD
// ----------------------------------------------------------------------------

export interface TransactionTableRow {
  transactie_id: string;
  omschrijving: string;
  bedrag: string;   // bv. "€ 2.178,00"
  type: 'Inkomsten' | 'Uitgaven';
  btw: string;       // bv. "21%"
  toegepaste_regel: string; // korte toelichting, zoals in het voorbeeld
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n);
}

function toRow(t: ProcessedTransaction): TransactionTableRow {
  return {
    transactie_id: t.id,
    omschrijving: t.description ?? '(geen omschrijving)',
    bedrag: formatEuro(t.amount_incl_input),
    type: t.type === 'income' ? 'Inkomsten' : 'Uitgaven',
    btw: `${t.rate}%`,
    toegepaste_regel: t.applied_rule.korte_toelichting,
  };
}

/** Zet een VatReport om naar de exacte tabelweergave zoals in het voorbeeld (Omschrijving/Bedrag/Type/BTW/Toegepaste regel). */
export function toTransactionTable(report: VatReport): TransactionTableRow[] {
  return report.transactions.map(toRow);
}

export interface TweeKolommenWeergave {
  /** Alles waar de tool achter staat — inclusief AI-consensus en boekhouder-beoordelingen. Toon dit zonder enig voorbehoud, precies zoals bevestigde regels. */
  zeker: TransactionTableRow[];
  /** Uitsluitend transacties waar `isTwijfelgeval()` true voor is — de enige regels die nog een keuzemenu (0/9/21%) moeten tonen. */
  twijfelgevallen: TransactionTableRow[];
}

/**
 * Splitst de transactietabel in exact de twee kolommen die de UI moet tonen:
 * "zeker" en "twijfelgevallen" — gebaseerd op de ENE canonieke definitie
 * (`isTwijfelgeval`). Zodra de boekhouder een transactie beoordeelt
 * (percentageOverrides + beoordeeld_door) en de host-app opnieuw rekent,
 * verschijnt die transactie hier automatisch in "zeker" met de toelichting
 * "Door {naam} beoordeeld." — er is geen aparte stap nodig om 'm handmatig
 * van kolom te wisselen.
 */
export function tweeKolommenWeergave(report: VatReport): TweeKolommenWeergave {
  const zeker: TransactionTableRow[] = [];
  const twijfelgevallen: TransactionTableRow[] = [];
  for (const t of report.transactions) {
    (isTwijfelgeval(t) ? twijfelgevallen : zeker).push(toRow(t));
  }
  return { zeker, twijfelgevallen };
}
