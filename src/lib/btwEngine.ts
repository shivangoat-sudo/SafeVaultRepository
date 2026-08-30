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
  | 'handmatig_percentage'         // boekhouder heeft, als laatste redmiddel, alleen het BTW-percentage aangewezen (percentageOverrides)
  | 'twijfel_onvoldoende_informatie'; // onvoldoende informatie: NOOIT automatisch als fiscale uitkomst meenemen

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
 * BETROUWBAARHEIDSSCORE — heuristische indicator (0-100), GEEN formele
 * certificering. Gebaseerd op: (a) of de interne zelfcontroles (audit)
 * kloppen, (b) welk aandeel van de transacties nog op de standaard draait
 * zonder bevestigde herkenning, en (c) hoeveel mogelijke dubbele transacties
 * zijn gevonden. Bedoeld als praktisch signaal voor de gebruiker, niet als
 * vervanging van een fiscale beoordeling.
 */
export function berekenBetrouwbaarheidsscore(report: VatReport): number {
  let score = 100;
  if (!report.audit.ok) {
    score -= Math.min(50, report.audit.problemen.length * 10);
  }
  const totaal = report.herkenning.totaal_transacties;
  if (totaal > 0) {
    const twijfelFractie = report.transactions.filter(isTwijfelgeval).length / totaal;
    score -= twijfelFractie * 20;
  }
  score -= Math.min(10, report.mogelijke_dubbele_transacties.length * 2);
  return round2(Math.max(0, Math.min(100, score)));
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
  // Twee onafhankelijke 32-bit FNV-1a-hashes met verschillende startwaarden,
  // samengevoegd tot een effectief 64-bit ID. Eén enkele 32-bit hash heeft
  // bij grote bestanden (duizenden regels, bv. een glazenwasser met een
  // jaar aan dagelijkse mutaties) een niet-verwaarloosbare kans dat twee
  // VERSCHILLENDE transacties toevallig hetzelfde ID krijgen — met een
  // belastingberekening als toepassing is dat risico het niet waard. Met
  // twee onafhankelijke hashes is de kans op botsing verwaarloosbaar, ook
  // bij tienduizenden transacties.
  let hashA = 2166136261;
  let hashB = 0x811c9dc5 ^ 0x9e3779b9; // andere startwaarde dan hashA
  for (let i = 0; i < basis.length; i++) {
    const c = basis.charCodeAt(i);
    hashA ^= c;
    hashA = Math.imul(hashA, 16777619);
    hashB = Math.imul(hashB ^ c, 2654435761);
  }
  return `tx_${(hashA >>> 0).toString(16)}${(hashB >>> 0).toString(16)}`;
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
  /** Onafgeronde excl./BTW-waarden, uitsluitend bedoeld voor optelling naar de hoofdtotalen (zie exacteSplit) — niet tonen aan de gebruiker, gebruik bedrag_excl/btw_bedrag voor weergave. */
  _bedrag_excl_precisie: number;
  _btw_bedrag_precisie: number;
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

// ----------------------------------------------------------------------------
// NETTO BTW-OVERZICHT — DE LEIDENDE, GEBRUIKERSGERICHTE WEERGAVE
// ----------------------------------------------------------------------------
//
// BTW over inkomsten en BTW over uitgaven zijn twee volledig gescheiden
// stromen met een verschillende betekenis (verschuldigd vs. aftrekbaar).
// Deze structuur is bewust ontworpen zodat de gebruiker élk getoond bedrag
// kan optellen en exact op het volgende totaal uitkomt — inclusief het
// eindresultaat. Géén van de velden hierin is een "gemengd" getal (zoals
// totale_btw_21/totale_btw_9 dat wél zijn — die blijven verderop in dit
// bestand bestaan voor interne validatie/traceerbaarheid, maar zijn NOOIT
// bedoeld als leidend cijfer in de UI).
//
// Belangrijk verschil met de rest van de engine: de deelbedragen hieronder
// worden EERST individueel afgerond (op 2 decimalen, zoals ze getoond
// worden), en de totalen zijn de som van DIE afgeronde deelbedragen — niet
// een apart afgeronde som van de ongeronde precisie-waarden. Dat garandeert
// dat "€3.197,29 + €87,94" voor de gebruiker altijd EXACT "€3.285,23"
// oplevert, ook in randgevallen waar afronding anders een cent zou kunnen
// schelen.

export interface VerschuldigdeBtwRegel {
  label: string;
  bedrag: number;
}

export interface NettoBtwOverzicht {
  verschuldigd: {
    /** BTW over inkomsten belast tegen 21%. */
    inkomsten_21: number;
    /** BTW over inkomsten belast tegen 9%. */
    inkomsten_9: number;
    /** Zelf berekende BTW over buitenlandse diensten (verleggingsregeling) — telt hier mee als verschuldigd (Rubriek 2a). */
    verlegde_btw: number;
    /** inkomsten_21 + inkomsten_9 + verlegde_btw, som van de HIERBOVEN getoonde (al afgeronde) bedragen. */
    totaal: number;
  };
  aftrekbaar: {
    /** Aftrekbare voorbelasting over uitgaven belast tegen 21%. */
    uitgaven_21: number;
    /** Aftrekbare voorbelasting over uitgaven belast tegen 9%. */
    uitgaven_9: number;
    /** Dezelfde verlegde BTW als bij verschuldigd — direct aftrekbaar tegenover de zelf berekende verschuldigde BTW (Rubriek 5b), netto-effect nul. */
    verlegde_btw: number;
    /** uitgaven_21 + uitgaven_9 + verlegde_btw, som van de HIERBOVEN getoonde (al afgeronde) bedragen. */
    totaal: number;
  };
  /** Ter informatie — géén onderdeel van verschuldigd of aftrekbaar. BTW die niet als voorbelasting mag worden afgetrokken (BUA/horeca, art. 15 lid 5). */
  niet_aftrekbaar_ter_info: number;
  /** verschuldigd.totaal − aftrekbaar.totaal. Positief = af te dragen, negatief = terug te vorderen. */
  netto_btw: number;
  status: 'af_te_dragen' | 'terug_te_vorderen';
  /** Kant-en-klare, leesbare toelichtingstekst met automatisch wisselende "af te dragen"/"terug te vorderen"-formulering — direct te tonen in een uitklapbaar blok. */
  toelichting: string;
}

function formatEuroKaal(n: number): string {
  return new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
}

/**
 * Bouwt het leidende, transparante BTW-overzicht (verschuldigd/aftrekbaar
 * volledig gescheiden) vanuit een reeds berekend VatReport. Wordt ook
 * automatisch als report.overzicht meegeleverd — deze functie hoeft de
 * host-app dus niet apart aan te roepen, maar is ook los bruikbaar.
 */
export function bouwNettoBtwOverzicht(r: {
  breakdown: VatReport['breakdown'];
  niet_aftrekbare_btw: number;
}): NettoBtwOverzicht {
  const inkomsten_21 = round2(r.breakdown.verschuldigde_btw_omzet_21);
  const inkomsten_9 = round2(r.breakdown.verschuldigde_btw_omzet_9);
  const verlegd = round2(r.breakdown.verlegde_btw_rubriek_2a);
  const uitgaven_21 = round2(r.breakdown.aftrekbare_btw_kosten_21);
  const uitgaven_9 = round2(r.breakdown.aftrekbare_btw_kosten_9);

  // Totalen zijn de som van de HIERBOVEN al-afgeronde regels — garandeert
  // exacte optelbaarheid voor de gebruiker (zie moduledocumentatie hierboven).
  const verschuldigd_totaal = round2(inkomsten_21 + inkomsten_9 + verlegd);
  const aftrekbaar_totaal = round2(uitgaven_21 + uitgaven_9 + verlegd);
  const netto_btw = round2(verschuldigd_totaal - aftrekbaar_totaal);
  const status: 'af_te_dragen' | 'terug_te_vorderen' = netto_btw >= 0 ? 'af_te_dragen' : 'terug_te_vorderen';

  const toelichting =
    status === 'af_te_dragen'
      ? `€${formatEuroKaal(verschuldigd_totaal)} verschuldigde BTW\n− €${formatEuroKaal(aftrekbaar_totaal)} aftrekbare voorbelasting\n= €${formatEuroKaal(netto_btw)} af te dragen`
      : `€${formatEuroKaal(verschuldigd_totaal)} verschuldigde BTW\n− €${formatEuroKaal(aftrekbaar_totaal)} aftrekbare voorbelasting\n= −€${formatEuroKaal(netto_btw)}\n€${formatEuroKaal(netto_btw)} terug te vorderen`;

  return {
    verschuldigd: { inkomsten_21, inkomsten_9, verlegde_btw: verlegd, totaal: verschuldigd_totaal },
    aftrekbaar: { uitgaven_21, uitgaven_9, verlegde_btw: verlegd, totaal: aftrekbaar_totaal },
    niet_aftrekbaar_ter_info: round2(r.niet_aftrekbare_btw),
    netto_btw,
    status,
    toelichting,
  };
}

export interface VatReport {
  // --- De 8 verplichte hoofdvarianten ---
  // LET OP: totale_btw_21 en totale_btw_9 zijn GEMENGDE getallen (verschuldigde
  // BTW over inkomsten + aftrekbare BTW over uitgaven van hetzelfde tarief
  // samen opgeteld). Ze zijn bedoeld als informatief/validatiecijfer, NIET
  // als leidend getal in de UI en NOOIT als basis voor het eindsaldo — gebruik
  // daarvoor uitsluitend `overzicht` hieronder (zie NettoBtwOverzicht).
  totaal_incl_21: number;
  totaal_excl_21: number;
  totaal_incl_9: number;
  totaal_excl_9: number;
  totale_btw_21: number;
  totale_btw_9: number;
  niet_aftrekbare_btw: number;
  btw_eindsaldo: number;

  /** DE LEIDENDE, GEBRUIKERSGERICHTE WEERGAVE — verschuldigd en aftrekbaar volledig gescheiden, gegarandeerd optelbaar. Gebruik dit object voor de UI, niet de individuele velden hierboven. */
  overzicht: NettoBtwOverzicht;

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
  /** Regels die NIET zijn meegerekend omdat ze werden herkend als samenvatting/totaal (zie filterSamenvattingsregels) — nooit stilzwijgend weggelaten, altijd hier zichtbaar met reden. */
  genegeerde_samenvattingsregels: GenegeerdeSamenvattingsregel[];
  /** Groepen transacties met identieke datum+omschrijving+bedrag — mogelijk een dubbele import, mogelijk legitiem. Blijven meegeteld in de berekening; toon dit aan de gebruiker ter bevestiging, voeg niet automatisch samen. */
  mogelijke_dubbele_transacties: MogelijkDubbeleGroep[];
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

// Tekens die meetellen als "onderdeel van een woord" — gebruikt om
// woordgrenzen te bepalen. Standaard \b in JS-regex werkt niet goed met
// Nederlandse letters (é, ë, ç, ...), vandaar deze eigen tekenklasse.
const WOORD_TEKENS = 'a-z0-9àáâäæçèéêëìíîïñòóôöùúûüý';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Zoekt trefwoorden op WOORDGRENZEN, niet als kale substring. Voorkomt
 * valse positieven zoals "esso" (brandstofmerk) dat toevallig binnen
 * "acc-ESSO-ire" (Bol.com-omschrijving "...Accessoire") voorkomt. Elk
 * trefwoord moet dus als los woord/losse woordgroep voorkomen, omringd
 * door begin/einde van de tekst of een niet-woordteken (spatie,
 * leesteken).
 */
// Regex-cache: voorkomt dat dezelfde patronen duizenden keren opnieuw
// worden gecompileerd bij grote bestanden (belangrijk bij 4000+ transacties).
const regexCache = new Map<string, RegExp>();
function getPattern(needle: string): RegExp {
  let re = regexCache.get(needle);
  if (!re) {
    re = new RegExp(`(?:^|[^${WOORD_TEKENS}])${escapeRegExp(needle)}(?:[^${WOORD_TEKENS}]|$)`, 'i');
    regexCache.set(needle, re);
  }
  return re;
}

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needleRaw) => {
    const needle = needleRaw.trim().toLowerCase();
    if (!needle) return false;
    return getPattern(needle).test(haystack);
  });
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

/** Boeken, tijdschriften, kranten en e-books vallen onder Tabel I (9%) — zowel bij verkoop (omzet) als inkoop (kosten). */
const BOEKEN_KEYWORDS = ['boek', 'boeken', 'tijdschrift', 'tijdschriften', 'e-book', 'ebook', 'krant', 'dagblad'];

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
  if (ctx.type !== 'expense') return null;
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
  if (ctx.type !== 'expense' || !ctx.memo) return null;
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

// --- Laag 2B: expliciet in de tekst genoemd BTW-percentage — een sterk
// signaal, want de bron zegt het letterlijk zelf ("Verkoop 9%", "Factuur
// incl. 21% BTW"). Geldt voor zowel inkomsten als uitgaven en gaat vóór de
// zwakkere gecombineerde/brede-categorie-lagen (3, 3B, 4), maar NIET vóór
// een specifieke categorie-match (horeca, overheid, boeken, transport, ...)
// — die geeft namelijk zowel het tarief ALS de juiste aftrekbaarheid/
// wettelijk verplichte indeling in één keer, wat vollediger en dwingender
// is dan een kaal percentage (bv. boeken zijn wettelijk altijd 9%, ook als
// de tekst per ongeluk "21%" zou noemen).
//
// VEILIGHEIDSGRENS: een percentage in de tekst betekent niet altijd een
// BTW-tarief — "Rentevergoeding 9%" of "21% korting" hebben niets met BTW
// te maken. Daarom: expliciet BLOKKEREN bij niet-BTW-context-woorden, en
// alleen 'hoog' vertrouwen geven als het woord "btw" (of variant) ook
// daadwerkelijk in de tekst staat; zonder dat woord blijft het 'gemiddeld'
// (nog steeds automatisch toegepast, maar met een lagere zekerheidslabel).
const EXPLICIET_PERCENTAGE_PATROON = /(^|[^0-9])(0|9|21)\s?%/;
const NIET_BTW_PERCENTAGE_CONTEXT = [
  'korting', 'rente', 'rendement', 'reductie', 'discount', 'rentevergoeding',
  'aflossing', 'annuïteit', 'annuiteit', 'rentepercentage', 'rabat',
];
const BTW_CONTEXT_WOORDEN = ['btw', 'b.t.w', 'omzetbelasting', 'incl.', 'excl.', 'incl ', 'excl '];

function layer2c_boekenExpense(ctx: ClassifyContext): ClassifyResult | null {
  if (!matchesAny(ctx.combined, BOEKEN_KEYWORDS)) return null;
  return {
    classification: 'kosten_verlaagd_9',
    herkend: true,
    herkenningsbron: 'Herkend als boeken/tijdschriften (Tabel I, wettelijk verlaagd tarief 9%).',
    korte_toelichting_override: 'Boeken/tijdschriften belast tegen het verlaagde BTW-tarief van 9% (Tabel I Wet OB 1968).',
    bron: 'automatisch_omschrijving',
    zekerheid: 'hoog',
  };
}

function layer2c_boekenIncome(ctx: ClassifyContext): ClassifyResult | null {
  if (!matchesAny(ctx.combined, BOEKEN_KEYWORDS)) return null;
  return {
    classification: 'omzet_verlaagd_9',
    herkend: true,
    herkenningsbron: 'Herkend als boeken/tijdschriften (Tabel I, wettelijk verlaagd tarief 9%).',
    korte_toelichting_override: 'Verkoop van boeken/tijdschriften belast tegen het verlaagde BTW-tarief van 9% (art. 9 lid 2 jo. Tabel I Wet OB 1968).',
    bron: 'automatisch_omschrijving',
    zekerheid: 'hoog',
  };
}

function layer2b_explicietPercentage(ctx: ClassifyContext): ClassifyResult | null {
  if (matchesAny(ctx.combined, NIET_BTW_PERCENTAGE_CONTEXT)) return null;
  const match = ctx.combined.match(EXPLICIET_PERCENTAGE_PATROON);
  if (!match) return null;
  const pct = Number(match[2]) as 0 | 9 | 21;
  const classification = classificationFromPercentage(pct, ctx.type);
  const heeftBtwWoord = matchesAny(ctx.combined, BTW_CONTEXT_WOORDEN);
  return {
    classification,
    herkend: true,
    herkenningsbron: heeftBtwWoord
      ? `Expliciet BTW-percentage (${pct}%) genoemd in de omschrijving/mededeling — rechtstreeks overgenomen.`
      : `Percentage (${pct}%) genoemd in de omschrijving/mededeling, zonder expliciet "btw" erbij — waarschijnlijk het BTW-tarief, maar met iets minder zekerheid dan een expliciete BTW-vermelding.`,
    bron: 'automatisch_omschrijving',
    zekerheid: heeftBtwWoord ? 'hoog' : 'gemiddeld',
  };
}

// --- Laag 3B: ECHTE tegenstrijdigheid — Nederlandse rechtsvorm + buitenlands rekeningnummer + claim van verlegde BTW ---
const NL_ENTITY_SUFFIXES = ['b.v.', ' bv ', ' bv/', 'n.v.', ' nv ', 'v.o.f.', ' vof ', 'eenmanszaak'];
const REVERSE_CHARGE_CLAIM_KEYWORDS = ['btw verlegd', 'verlegde btw', 'reverse charge', 'vat reverse'];

function layer3b_conflictDetection(ctx: ClassifyContext): ClassifyResult | null {
  if (ctx.type !== 'expense') return null;
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
  if (ctx.type !== 'expense') return null;
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
  if (ctx.type !== 'expense') return null;
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
  const ctx: ClassifyContext = {
    description: description ?? '',
    memo: memo ?? '',
    combined: pad(`${description ?? ''} ${memo ?? ''}`),
    type,
    tegenrekening_iban,
  };

  // Laag 0 geldt voor beide richtingen: een privéopname/-storting is nooit omzet of kosten.
  const priv = layer0_privateTransaction(ctx);
  if (priv) return priv;

  if (type === 'expense') {
    const layers = [
      layer1_knownVendor,
      layer2_memoKeywords,
      layer2c_boekenExpense, // wettelijk vaststaand tarief -> vóór het kale-percentage-signaal
      layer2b_explicietPercentage,
      layer3b_conflictDetection,
      layer3_combinedSignals,
      layer4_broadCategories,
    ];
    for (const layer of layers) {
      const result = layer(ctx);
      if (result) return result;
    }
    // Alle lagen doorlopen zonder voldoende fiscale aanwijzing: dit is an
    // unresolved case. Do NOT invent a 21% classification. The placeholder
    // classification is retained only because ProcessedTransaction currently
    // requires a ClassificationKey; calculateVatReport excludes herkend=false
    // rows from all financial totals until a bookkeeper resolves them.
    return {
      classification: 'kosten_algemeen_21',
      herkend: false,
      herkenningsbron:
        'Onvoldoende fiscale informatie om deze uitgave betrouwbaar te classificeren. De engine gokt niet op 21%; deze transactie moet handmatig worden beoordeeld.',
      bron: 'twijfel_onvoldoende_informatie',
      zekerheid: 'laag',
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
  {
    // Wettelijk vaststaand tarief -> ook hier vóór het kale-percentage-signaal.
    const boeken = layer2c_boekenIncome(ctx);
    if (boeken) return boeken;
  }
  {
    const expliciet = layer2b_explicietPercentage(ctx);
    if (expliciet) return expliciet;
  }
  // Geen voldoende fiscale aanwijzing: markeer als twijfelgeval.
  // Een 21%-placeholder wordt nooit financieel meegerekend zolang herkend=false.
  return {
    classification: 'omzet_algemeen_21',
    herkend: false,
    herkenningsbron:
      'Onvoldoende fiscale informatie om deze ontvangst betrouwbaar te classificeren. De engine gokt niet op 21%; deze transactie moet handmatig worden beoordeeld.',
    bron: 'twijfel_onvoldoende_informatie',
    zekerheid: 'laag',
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

/**
 * Berekent de excl./BTW/incl.-opbouw van één transactie op VOLLE PRECISIE
 * (geen tussentijdse afronding). Wordt gebruikt voor twee doelen die elk hun
 * eigen precisie nodig hebben:
 *   - Weergave per transactie: hiervan wordt met `round2()` een nette
 *     centbedrag gemaakt (zo zou het ook op een echte factuur staan).
 *   - Optellen naar de 8 hoofdtotalen: hiervoor gebruikt de engine juist de
 *     ONAFGERONDE waarden uit deze functie, opgeteld over alle transacties,
 *     en pas HELEMAAL AAN HET EIND afgerond. Dat voorkomt dat honderden of
 *     duizenden kleine per-regel afrondingen (elk tot €0,005) zich opstapelen
 *     tot een merkbare afwijking bij grote bestanden — cruciaal voor de
 *     nauwkeurigheidsdoelen bij 5.000-10.000+ transacties.
 */
function exacteSplit(amountIncl: number, rate: 0 | 9 | 21, mode: 'incl_split' | 'exempt' | 'reverse_charge') {
  switch (mode) {
    case 'incl_split': {
      const excl = amountIncl / (1 + rate / 100);
      return { excl, btw: amountIncl - excl, incl: amountIncl };
    }
    case 'exempt':
      return { excl: amountIncl, btw: 0, incl: amountIncl };
    case 'reverse_charge': {
      const btw = amountIncl * (rate / 100);
      return { excl: amountIncl, btw, incl: amountIncl + btw };
    }
  }
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

  const precies = exacteSplit(tx.amount_incl, rule.rate, rule.mode);
  const bedrag_excl = round2(precies.excl);
  const btw_bedrag = round2(precies.btw);
  const bedrag_incl = round2(precies.incl);

  return {
    id: tx.id,
    date: tx.date,
    type: tx.type,
    description: tx.description,
    classification,
    rate: rule.rate,
    amount_incl_input: tx.amount_incl,
    bedrag_excl,
    btw_bedrag,
    bedrag_incl,
    _bedrag_excl_precisie: precies.excl,
    _btw_bedrag_precisie: precies.btw,
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
  if (type === 'income') {
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
// 4B. SAMENVATTINGSREGELS HERKENNEN EN NEGEREN — DE TRANSACTIES ZIJN DE ENIGE BRON
// ----------------------------------------------------------------------------
//
// Een document (Excel/CSV/PDF) bevat vaak niet alleen losse transacties, maar
// ook totaal-, subtotaal- of saldoregels. Die mogen NOOIT meetellen in de
// BTW-berekening — anders telt de engine bedragen dubbel, of rekent hij met
// een al-berekend (mogelijk fout of verouderd) klantcijfer in plaats van zelf
// te rekenen. Dit is een vangnet dat ONAFHANKELIJK van de documentextractie
// (Gemini/host-app) werkt: zelfs als de extractiestap een samenvattingsregel
// per ongeluk als transactie doorgeeft, filtert de engine 'm er hier alsnog
// uit, vóórdat er ook maar iets wordt geclassificeerd of opgeteld.

const SAMENVATTING_TREFWOORDEN = [
  'eindtotaal', 'subtotaal', 'totaalbedrag', 'eindsaldo', 'btw eindsaldo',
  'btw-eindsaldo', 'totale btw', 'btw totaal', 'btw-totaal', 'btw verschuldigd',
  'btw aftrekbaar', 'voorbelasting totaal', 'te betalen btw', 'terug te ontvangen btw',
  'terug te vorderen btw', 'saldo btw', 'jaaroverzicht', 'kwartaaltotaal',
  'maandtotaal', 'weektotaal', 'omzet totaal', 'totale omzet', 'kostentotaal',
  'totale kosten', 'samenvatting', 'totaal incl', 'totaal excl', 'grand total',
];

/** Losse "totaal"/"saldo" als eerste woord (dus niet binnen "totaalpakket" e.d.) telt ook mee als signaal. */
const SAMENVATTING_LOSSE_WOORDEN = ['totaal', 'saldo', 'eindtotaal'];

export interface GenegeerdeSamenvattingsregel {
  raw: RawTransaction;
  reden: string;
}

/**
 * Bepaalt of een regel een samenvattingsregel is in plaats van een
 * daadwerkelijke transactie. Gebruikt zowel trefwoorden in de omschrijving
 * als een structurele check: een bedrag dat (bijna) exact overeenkomt met de
 * som van alle andere transacties is een sterke aanwijzing voor een
 * totaalregel, ook zonder verdacht woord in de omschrijving.
 */
function isSamenvattingsregel(tx: RawTransaction, somAlleAnderen: number, aantalAndereRegels: number): { ja: boolean; reden?: string } {
  const tekst = pad(`${tx.description ?? ''} ${tx.memo ?? ''}`);
  if (matchesAny(tekst, SAMENVATTING_TREFWOORDEN)) {
    return { ja: true, reden: `Omschrijving/mededeling bevat een samenvattingstrefwoord ("${(tx.description ?? tx.memo ?? '').trim()}").` };
  }
  // Begint de omschrijving zelf met "totaal"/"saldo"? (bv. "Saldo 30-09-2026").
  // We kijken bewust alleen naar het EERSTE woord, zodat een echte transactie
  // als "Totaalpakket Verzekering" niet onterecht sneuvelt.
  const eersteWoord = (tx.description ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (SAMENVATTING_LOSSE_WOORDEN.includes(eersteWoord)) {
    return { ja: true, reden: `Omschrijving begint met een samenvattingswoord ("${tx.description}").` };
  }
  // Structurele check: bedrag komt (op 1 cent na) overeen met de som van
  // MEERDERE andere transacties -> vrijwel zeker een totaalregel. De eis
  // "minimaal 2 andere regels" is bewust: bij precies twee transacties met
  // hetzelfde bedrag (bv. twee identieke facturen) zou "som van de ander"
  // triviaal gelijk zijn aan het bedrag zelf — dat is dan een MOGELIJKE
  // DUBBELE TRANSACTIE (zie vindMogelijkeDubbeleTransacties), geen totaalregel,
  // en moet dus niet via dit filter verdwijnen.
  if (aantalAndereRegels >= 2 && somAlleAnderen > 0 && Math.abs(tx.amount_incl - somAlleAnderen) <= 0.01) {
    return { ja: true, reden: `Bedrag (€${tx.amount_incl.toFixed(2)}) komt exact overeen met de som van alle overige transacties — vrijwel zeker een totaalregel.` };
  }
  return { ja: false };
}

/**
 * Splitst de aangeleverde regels in échte transacties en genegeerde
 * samenvattingsregels. Wordt automatisch aan het begin van
 * `calculateVatReport` aangeroepen — de host-app hoeft dit niet apart te
 * doen, maar kan `report.genegeerde_samenvattingsregels` gebruiken om te
 * tonen wat er (en waarom) is uitgesloten.
 */
function filterSamenvattingsregels(rawTransactions: RawTransaction[]): {
  transacties: RawTransaction[];
  genegeerd: GenegeerdeSamenvattingsregel[];
} {
  const totaalAlles = rawTransactions.reduce((s, t) => s + t.amount_incl, 0);
  const transacties: RawTransaction[] = [];
  const genegeerd: GenegeerdeSamenvattingsregel[] = [];
  for (const tx of rawTransactions) {
    const somAnderen = totaalAlles - tx.amount_incl;
    const check = isSamenvattingsregel(tx, somAnderen, rawTransactions.length - 1);
    if (check.ja) {
      genegeerd.push({ raw: tx, reden: check.reden! });
    } else {
      transacties.push(tx);
    }
  }
  return { transacties, genegeerd };
}

// ----------------------------------------------------------------------------
// 4C. MOGELIJKE DUBBELE TRANSACTIES — SIGNALEREN, NIET AUTOMATISCH SAMENVOEGEN
// ----------------------------------------------------------------------------
//
// Zelfde datum + zelfde bedrag + zelfde omschrijving is een sterk signaal
// voor een dubbele import of dubbele betaling — maar de engine kan met
// zekerheid noch bevestigen dat het een fout is (bv. echt twee identieke
// facturen op dezelfde dag), noch dat het legitiem is. Daarom: BEIDE
// transacties blijven gewoon meetellen in de berekening (net als bij een
// echte bankmutatie — het geld is echt twee keer bewogen), maar de host-app
// krijgt een expliciete lijst om de gebruiker om bevestiging te vragen.

export interface MogelijkDubbeleGroep {
  datum?: string;
  omschrijving?: string;
  bedrag: number;
  transacties: RawTransaction[];
}

function vindMogelijkeDubbeleTransacties(rawTransactions: RawTransaction[]): MogelijkDubbeleGroep[] {
  const groepen = new Map<string, RawTransaction[]>();
  for (const tx of rawTransactions) {
    const sleutel = `${tx.date ?? ''}|${(tx.description ?? '').trim().toLowerCase()}|${tx.amount_incl.toFixed(2)}`;
    const lijst = groepen.get(sleutel) ?? [];
    lijst.push(tx);
    groepen.set(sleutel, lijst);
  }
  const resultaat: MogelijkDubbeleGroep[] = [];
  for (const lijst of groepen.values()) {
    if (lijst.length > 1) {
      resultaat.push({ datum: lijst[0].date, omschrijving: lijst[0].description, bedrag: lijst[0].amount_incl, transacties: lijst });
    }
  }
  return resultaat;
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

  // STAP 0, VÓÓR ALLES: samenvattingsregels eruit filteren. De rest van de
  // functie ziet deze regels nooit — ze kunnen dus onmogelijk meetellen.
  const { transacties: rawTransactionsSchoon, genegeerd: genegeerde_samenvattingsregels } =
    filterSamenvattingsregels(rawTransactions);
  rawTransactions = rawTransactionsSchoon;

  // Signaleren (niet blokkeren): mogelijke dubbele transacties op basis van
  // de overgebleven, echte transacties.
  const mogelijke_dubbele_transacties = vindMogelijkeDubbeleTransacties(rawTransactions);

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
      // CRITICAL SAFETY RULE: an unresolved classification is not a fiscal
      // conclusion. Its calculated placeholder must never enter totals.
      continue;
    }

    if (p.classification === 'verlegd_21') {
      verlegde_btw_rubriek_2a += p._btw_bedrag_precisie;
      continue; // geen incl./excl.-opbouw; zie toelichting in de moduledocs hierboven
    }

    if (p.rate === 21) {
      totaal_incl_21 += p.amount_incl_input;
      totaal_excl_21 += p._bedrag_excl_precisie;
      totale_btw_21 += p._btw_bedrag_precisie;
    } else if (p.rate === 9) {
      totaal_incl_9 += p.amount_incl_input;
      totaal_excl_9 += p._bedrag_excl_precisie;
      totale_btw_9 += p._btw_bedrag_precisie;
    }

    if (p.classification === 'horeca_bua_9') {
      niet_aftrekbare_btw += p._btw_bedrag_precisie;
    }

    if (p.type === 'income') {
      if (p.rate === 21) verschuldigde_btw_omzet_21 += p._btw_bedrag_precisie;
      if (p.rate === 9) verschuldigde_btw_omzet_9 += p._btw_bedrag_precisie;
    } else if (p.aftrekbaar) {
      if (p.rate === 21) aftrekbare_btw_kosten_21 += p._btw_bedrag_precisie;
      if (p.rate === 9) aftrekbare_btw_kosten_9 += p._btw_bedrag_precisie;
    }
  }

  const totaal_transacties = processed.length;
  const standaard_toegepast = totaal_transacties - automatisch_herkend;

  // De losse categoriewaarden (nog niet de totalen) — dit zijn de bedragen
  // die de gebruiker straks als aparte regels ziet.
  const breakdownRegels = {
    verschuldigde_btw_omzet_21: round2(verschuldigde_btw_omzet_21),
    verschuldigde_btw_omzet_9: round2(verschuldigde_btw_omzet_9),
    verlegde_btw_rubriek_2a: round2(verlegde_btw_rubriek_2a),
    aftrekbare_btw_kosten_21: round2(aftrekbare_btw_kosten_21),
    aftrekbare_btw_kosten_9: round2(aftrekbare_btw_kosten_9),
  };

  // `overzicht` is de ENIGE plek waar de totalen worden vastgesteld — als som
  // van de HIERBOVEN al-afgeronde regels, zodat de gebruiker ze zelf kan
  // narekenen. `breakdown.*_totaal` en `btw_eindsaldo` worden hier direct
  // VAN overzicht afgeleid (niet apart opnieuw berekend), zodat er nooit twee
  // verschillende "waarheden" in hetzelfde rapport kunnen ontstaan — precies
  // het euvel dat eerder een verschil van 1 cent opleverde tussen twee
  // schijnbaar onafhankelijke velden in ditzelfde object.
  const overzicht = bouwNettoBtwOverzicht({
    breakdown: { ...breakdownRegels, verschuldigde_btw_totaal: 0, aftrekbare_btw_totaal: 0 },
    niet_aftrekbare_btw: round2(niet_aftrekbare_btw),
  });
  const verschuldigde_btw_totaal = overzicht.verschuldigd.totaal;
  const aftrekbare_btw_totaal = overzicht.aftrekbaar.totaal;
  const btw_eindsaldo = overzicht.netto_btw;

  const breakdown = {
    ...breakdownRegels,
    verschuldigde_btw_totaal,
    aftrekbare_btw_totaal,
  };

  const audit = auditReport(
    processed,
    {
      totaal_incl_21: round2(totaal_incl_21),
      totaal_excl_21: round2(totaal_excl_21),
      totale_btw_21: round2(totale_btw_21),
      totaal_incl_9: round2(totaal_incl_9),
      totaal_excl_9: round2(totaal_excl_9),
      totale_btw_9: round2(totale_btw_9),
      verschuldigde_btw_totaal,
      aftrekbare_btw_totaal,
      btw_eindsaldo,
    },
    overzicht
  );

  return {
    totaal_incl_21: round2(totaal_incl_21),
    totaal_excl_21: round2(totaal_excl_21),
    totaal_incl_9: round2(totaal_incl_9),
    totaal_excl_9: round2(totaal_excl_9),
    totale_btw_21: round2(totale_btw_21),
    totale_btw_9: round2(totale_btw_9),
    niet_aftrekbare_btw: round2(niet_aftrekbare_btw),
    btw_eindsaldo,
    overzicht,
    breakdown,
    herkenning: {
      totaal_transacties,
      automatisch_herkend,
      standaard_toegepast,
      percentage_herkend: totaal_transacties === 0 ? 0 : round2((automatisch_herkend / totaal_transacties) * 100),
      controle_aanbevolen,
    },
    audit,
    genegeerde_samenvattingsregels,
    mogelijke_dubbele_transacties,
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
    totaal_excl_21: number;
    totale_btw_21: number;
    totaal_incl_9: number;
    totaal_excl_9: number;
    totale_btw_9: number;
    verschuldigde_btw_totaal: number;
    aftrekbare_btw_totaal: number;
    btw_eindsaldo: number;
  },
  overzicht: NettoBtwOverzicht
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

  // Regelaantal-controle: no silent disappearance or duplication.
  const meegenomen = processed.filter((t) => t.herkend).length;
  const twijfel = processed.filter((t) => !t.herkend).length;
  if (meegenomen + twijfel !== processed.length) {
    problemen.push(`Regelaantal-controle faalt: meegenomen (${meegenomen}) + twijfelgevallen (${twijfel}) != verwerkte transacties (${processed.length}).`);
  }

  // Controle 1 (aggregaat): Totaal incl. 21% − Totaal excl. 21% − Totale BTW 21% = 0.
  if (!approxEqual(totals.totaal_incl_21 - totals.totaal_excl_21 - totals.totale_btw_21, 0)) {
    problemen.push(
      `Controle 1 faalt: Totaal incl. 21% (${totals.totaal_incl_21}) − Totaal excl. 21% (${totals.totaal_excl_21}) − Totale BTW 21% (${totals.totale_btw_21}) is niet nul.`
    );
  }
  // Controle 2 (aggregaat): Totaal incl. 9% − Totaal excl. 9% − Totale BTW 9% = 0.
  if (!approxEqual(totals.totaal_incl_9 - totals.totaal_excl_9 - totals.totale_btw_9, 0)) {
    problemen.push(
      `Controle 2 faalt: Totaal incl. 9% (${totals.totaal_incl_9}) − Totaal excl. 9% (${totals.totaal_excl_9}) − Totale BTW 9% (${totals.totale_btw_9}) is niet nul.`
    );
  }

  // Check: onafhankelijke herberekening van totale_btw_21 / totale_btw_9 vanuit
  // de losse regels — met dezelfde precisiewaarden als de hoofdberekening
  // (niet de afgeronde weergavewaarden), anders meldt de audit een vals
  // "verschil" dat puur door de afrondingsmethode zelf komt.
  const herberekend_btw_21 = round2(
    processed
      .filter((t) => t.herkend && t.rate === 21 && t.classification !== 'verlegd_21')
      .reduce((sum, t) => sum + t._btw_bedrag_precisie, 0)
  );
  const herberekend_btw_9 = round2(
    processed.filter((t) => t.herkend && t.rate === 9).reduce((sum, t) => sum + t._btw_bedrag_precisie, 0)
  );

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

  // Controle 3 (FISCAAL CORRECTE variant — zie toelichting in de module-
  // documentatie hierboven over waarom "Totale BTW 21% + Totale BTW 9% −
  // Totaal aftrekbaar" NIET wordt gebruikt: die mengt verschuldigde en
  // aftrekbare BTW binnen hetzelfde tarief, wat op elk gemengd bedrijf een
  // verkeerd eindsaldo oplevert): verschuldigd − aftrekbaar − eindsaldo = 0.
  const herberekend_eindsaldo = round2(totals.verschuldigde_btw_totaal - totals.aftrekbare_btw_totaal);
  if (!approxEqual(herberekend_eindsaldo, totals.btw_eindsaldo)) {
    problemen.push(
      `Controle 3 (correcte variant) faalt: eindsaldo (${totals.btw_eindsaldo}) komt niet overeen met verschuldigd (${totals.verschuldigde_btw_totaal}) min aftrekbaar (${totals.aftrekbare_btw_totaal}).`
    );
  }

  // ── Nieuwe, expliciete controles op het LEIDENDE overzicht (verschuldigd/
  // aftrekbaar gescheiden) — dit zijn de controles die de gebruiker zelf ook
  // met de getoonde cijfers kan narekenen. ──────────────────────────────────

  // Controle A (verschuldigde BTW): inkomsten_21 + inkomsten_9 + verlegde_btw = verschuldigd.totaal.
  const herberekendVerschuldigd = round2(
    overzicht.verschuldigd.inkomsten_21 + overzicht.verschuldigd.inkomsten_9 + overzicht.verschuldigd.verlegde_btw
  );
  if (!approxEqual(herberekendVerschuldigd, overzicht.verschuldigd.totaal)) {
    problemen.push(
      `Controle A faalt: getoonde verschuldigd-regels (${overzicht.verschuldigd.inkomsten_21} + ${overzicht.verschuldigd.inkomsten_9} + ${overzicht.verschuldigd.verlegde_btw} = ${herberekendVerschuldigd}) tellen niet op tot het getoonde totaal (${overzicht.verschuldigd.totaal}).`
    );
  }

  // Controle B (aftrekbare voorbelasting): uitgaven_21 + uitgaven_9 + verlegde_btw = aftrekbaar.totaal.
  const herberekendAftrekbaar = round2(
    overzicht.aftrekbaar.uitgaven_21 + overzicht.aftrekbaar.uitgaven_9 + overzicht.aftrekbaar.verlegde_btw
  );
  if (!approxEqual(herberekendAftrekbaar, overzicht.aftrekbaar.totaal)) {
    problemen.push(
      `Controle B faalt: getoonde aftrekbaar-regels (${overzicht.aftrekbaar.uitgaven_21} + ${overzicht.aftrekbaar.uitgaven_9} + ${overzicht.aftrekbaar.verlegde_btw} = ${herberekendAftrekbaar}) tellen niet op tot het getoonde totaal (${overzicht.aftrekbaar.totaal}).`
    );
  }

  // Controle C (eindresultaat): verschuldigd.totaal − aftrekbaar.totaal = netto_btw,
  // en netto_btw moet exact overeenkomen met het bedrag dat als "af te dragen"/
  // "terug te vorderen" wordt getoond (in deze engine is dat letterlijk hetzelfde veld).
  const herberekendNetto = round2(overzicht.verschuldigd.totaal - overzicht.aftrekbaar.totaal);
  if (!approxEqual(herberekendNetto, overzicht.netto_btw)) {
    problemen.push(
      `Controle C faalt: verschuldigd (${overzicht.verschuldigd.totaal}) − aftrekbaar (${overzicht.aftrekbaar.totaal}) = ${herberekendNetto}, wijkt af van het getoonde netto_btw (${overzicht.netto_btw}).`
    );
  }
  const verwachteStatus = overzicht.netto_btw >= 0 ? 'af_te_dragen' : 'terug_te_vorderen';
  if (overzicht.status !== verwachteStatus) {
    problemen.push(`Controle C faalt: status "${overzicht.status}" komt niet overeen met het teken van netto_btw (${overzicht.netto_btw}), verwacht "${verwachteStatus}".`);
  }

  return { ok: problemen.length === 0, problemen };
}

// ----------------------------------------------------------------------------
// 7. ESCALATIE — WELKE TRANSACTIES VERDIENEN NOG EXTRA ZOEKWERK
// ----------------------------------------------------------------------------

export const MAX_AANBEVOLEN_ESCALATIE_RONDES = 3;

export interface EscalatieKandidaat {
  transactie: ProcessedTransaction;
  /** Concrete, uitvoerbare onderzoeksstappen — bedoeld voor een host-app met internettoegang (deze module heeft die zelf niet). */
  aanbevolen_zoekacties: string[];
}

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

export interface BoekhouderPercentageOptie {
  percentage: BtwPercentage;
  label: string;
}

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

export function toTransactionTable(report: VatReport): TransactionTableRow[] {
  return report.transactions.map(toRow);
}

export interface TweeKolommenWeergave {
  zeker: TransactionTableRow[];
  twijfelgevallen: TransactionTableRow[];
}

export function tweeKolommenWeergave(report: VatReport): TweeKolommenWeergave {
  const zeker: TransactionTableRow[] = [];
  const twijfelgevallen: TransactionTableRow[] = [];
  for (const t of report.transactions) {
    (isTwijfelgeval(t) ? twijfelgevallen : zeker).push(toRow(t));
  }
  return { zeker, twijfelgevallen };
}
