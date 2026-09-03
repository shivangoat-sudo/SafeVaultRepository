import {
  calculateFiscalVatReport as calculateCore,
  type BoekhouderBeoordeling,
  type FiscalAdjustments,
  type FiscalReport,
} from './btwFiscalSafeCore';
import type { RawTransaction } from './btwSafeTypes';

/**
 * Dutch VAT policy layer.
 *
 * Goal: classify ordinary Dutch bank transactions automatically. The engine
 * recognizes statutory 9% categories from transaction text, merchant/business
 * context, explicit exemptions/zero-rate/reverse-charge signals, and applies
 * the Dutch general 21% rate only when the transaction context actually
 * supports a taxable 21% treatment. A bare/insufficient bank description is
 * never silently converted into 21%.
 *
 * Merchant recognition is deliberately performed before literal product-word
 * matching. A bank line such as "GALL & GALL" therefore does not need to
 * contain the word "wijn" or "drank" to reach the alcohol 21% rule.
 *
 * This is intentionally transaction-driven: imported spreadsheet VAT columns
 * never override the rule engine.
 */
export const NEDERLANDS_OVERIG_TARIEF_1C = 13 as const;

type DutchVatRule = {
  id: string;
  pattern: RegExp;
  rate: 9 | 21;
  wetsbasis: string;
  label: string;
};

type SpecialHit = {
  classification: 'exempt_output' | 'exempt_input' | 'zero_rated_output' | 'zero_rated_input';
  reason: string;
  wetsbasis: string;
};

const TABLE_I = 'Wet OB 1968, art. 9 lid 2 jo. Tabel I';
const GENERAL_21 = 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief)';

const RULE_9_GOODS: DutchVatRule[] = [
  { id:'food', pattern:/\b(voedingsmiddel(?:en)?|eetwaren|eten|brood(?:je|jes)?|kaas|melk|yoghurt|kwark|boter|margarine|eieren|ei|fruit|groente(?:n)?|aardappelen|vlees|vis|kip|vleeswaren|snoep(?:goed)?|chocolade|koek(?:jes)?|gebak|taart|chips|pasta|rijst|meel|granen|peulvruchten|noten|pinda(?:'s|s)?|jam|honing|ijsje|ijsjes|voedingspreparaat|voedingssupplement|vitaminen|vitamines|mineralen)\b/i, rate:9, wetsbasis:`${TABLE_I} (voedingsmiddelen).`, label:'Voedingsmiddel/-supplement: 9%-tarief.' },
  { id:'water', pattern:/\b(drinkwater|kraanwater|mineraalwater|bronwater|waterfles|waterflessen)\b/i, rate:9, wetsbasis:`${TABLE_I} (water).`, label:'Water: 9%-tarief.' },
  { id:'non_alcoholic_drinks', pattern:/\b(frisdrank(?:en)?|limonade|cola|sinas|sap|vruchtensap|groentesap|smoothie|koffie|thee|chocomelk|alcoholvrij bier|alcoholarme drank)\b/i, rate:9, wetsbasis:`${TABLE_I} (niet-alcoholhoudende dranken).`, label:'Niet-alcoholhoudende drank: 9%-tarief.' },
  { id:'horticulture', pattern:/\b(bloembol(?:len)?|dahliaknollen?|bloem(?:en)?|bloemboeket(?:ten)?|orchidee(?:ën|en)?|anthurium(?:s)?|plant(?:en)?|stekmateriaal|graszoden|plantenmat(?:ten)?|kerstboom|kerstbomen|boomkwekerijproducten?|bomen|struiken|sierteelt)\b/i, rate:9, wetsbasis:`${TABLE_I} (sierteeltproducten).`, label:'Sierteeltproduct: 9%-tarief.' },
  { id:'medicines_aids', pattern:/\b(geneesmiddel(?:en)?|medicijn(?:en)?|verbandmiddel(?:en)?|pleister(?:s)?|prothese(?:n)?|orthese(?:n)?|braille(?:artikel|artikelen)?|medisch hulpmiddel(?:en)?)\b/i, rate:9, wetsbasis:`${TABLE_I} (geneesmiddelen en aangewezen hulpmiddelen).`, label:'Geneesmiddel/hulpmiddel: 9%-tarief.' },
  { id:'books_periodicals', pattern:/\b(boek|boeken|schoolboek|schoolboeken|roman|stripboek|stripboeken|kookboek|kookboeken|woordenboek|woordenboeken|brochure|brochures|dagblad|dagbladen|weekblad|weekbladen|krant|kranten|tijdschrift|tijdschriften|periodiek|periodieken|e-boek|e-book|luisterboek)\b/i, rate:9, wetsbasis:`${TABLE_I} (boeken en periodieken).`, label:'Boek/periodiek: 9%-tarief.' },
  { id:'art_collectibles', pattern:/\b(kunstwerk|kunstvoorwerp|verzamelvoorwerp|antiek)\b/i, rate:9, wetsbasis:`${TABLE_I} (aangewezen kunst, verzamelvoorwerpen en antiek; voorwaarden gelden).`, label:'Aangewezen kunst/verzamelobject/antiek: 9%-tarief als voorwaarden zijn vervuld.' },
];

const RULE_9_SERVICES: DutchVatRule[] = [
  { id:'hairdresser', pattern:/\b(kapper|kappers|kapsalon|knipbeurt|haarknippen|haar knippen|haarverzorging kapper)\b/i, rate:9, wetsbasis:`${TABLE_I} (diensten van kappers).`, label:'Kappersdienst: 9%-tarief.' },
  { id:'repairs', pattern:/\b(fietsreparatie|fiets reparatie|fietsenmaker|reparatie fiets|schoenenreparatie|schoenmaker|reparatie schoenen|lederwarenreparatie|reparatie lederwaren|kledingreparatie|kleding reparatie|reparatie kleding|reparatie huishoudlinnen)\b/i, rate:9, wetsbasis:`${TABLE_I} (repareren van fietsen, schoenen/lederwaren en kleding/huishoudlinnen).`, label:'Aangewezen reparatiedienst: 9%-tarief.' },
  { id:'passenger_transport', pattern:/\b(personenvervoer|taxirit|taxivervoer|taxi rit|treinreis|treinticket|treinkaartje|busreis|busticket|tramreis|tramkaartje|metroreis|metrokaartje|ov-chipkaart|ns zakelijk|nederlandse spoorwegen|arriva|ret|gvb|connexxion|openbaar vervoer)\b/i, rate:9, wetsbasis:`${TABLE_I} (personenvervoer).`, label:'Personenvervoer: 9%-tarief.' },
  { id:'camping', pattern:/\b(camping|kampeerplaats|kampeergelegenheid|camperplaats|tentplaats|caravanplaats)\b/i, rate:9, wetsbasis:`${TABLE_I} (aanbieden van kampeergelegenheid).`, label:'Kampeergelegenheid: 9%-tarief.' },
  { id:'culture_recreation', pattern:/\b(bioscoop|bioscoopkaart|bioscoopkaartje|theaterticket|theaterkaart|theaterkaartje|concertticket|concertkaart|concertkaartje|museumticket|museumkaart|museumkaartje|dierentuin|attractiepark|pretpark|speeltuin|siertuin|circus|kermis|kermisattractie)\b/i, rate:9, wetsbasis:`${TABLE_I} (aangewezen culturele en recreatieve evenementen/voorzieningen).`, label:'Culturele/recreatieve toegang: 9%-tarief.' },
  { id:'performing_artist', pattern:/\b(optreden|podiumoptreden|uitvoerend kunstenaar|uitvoerende kunstenaar|muzikant optreden|artiest optreden|theateroptreden)\b/i, rate:9, wetsbasis:`${TABLE_I} (optreden van uitvoerende kunstenaars).`, label:'Optreden uitvoerend kunstenaar: 9%-tarief.' },
  { id:'sport_bathing', pattern:/\b(fitnessabonnement|sportschool|fitnesscentrum|sportaccommodatie|zwembad|zwemmen|zwembadabonnement|badhuis|sauna|saunabezoek|sportwedstrijdticket|sportwedstrijdkaartje)\b/i, rate:9, wetsbasis:`${TABLE_I} (gelegenheid tot sportbeoefening en baden, waaronder zwembaden en sauna's; wettelijke voorwaarden gelden).`, label:'Sport/baden: 9%-tarief.' },
  { id:'housing_work', pattern:/\b(schilderwerk woning|schilderen woning|schilderwerk huis|schilderen huis|stukadoor woning|stukadoren woning|stukadoorswerk woning|isolatiewerk woning|isoleren woning|schoonmaak woning|schoonmaakwerk woning|schoonmaak binnen woning)\b/i, rate:9, wetsbasis:`${TABLE_I} (aangewezen werkzaamheden aan woningen; ouderdoms- en overige voorwaarden gelden).`, label:'Aangewezen woningwerkzaamheid: 9%-tarief als voorwaarden zijn vervuld.' },
  { id:'digital_books_news', pattern:/\b(e-boek|e-book|luisterboek|abonnement nieuwswebsite|nieuwswebsite|nieuwsapp|krant digitaal|tijdschrift digitaal)\b/i, rate:9, wetsbasis:`${TABLE_I} (e-boeken/nieuwswebsites onder wettelijke voorwaarden).`, label:'Digitaal boek/nieuws: 9%-tarief als voorwaarden zijn vervuld.' },
];

const RULE_21: DutchVatRule[] = [
  { id:'alcohol', pattern:/\b(bier|wijn|champagne|prosecco|whisky|whiskey|wodka|vodka|rum|gin|likeur|sterke drank|alcoholische drank|alcoholhoudende drank|mixdrank|advocaat|kruidenwijn)\b/i, rate:21, wetsbasis:`${GENERAL_21}; alcoholhoudende dranken vallen niet onder het 9%-tarief.`, label:'Alcoholhoudende drank: 21%-tarief.' },
  { id:'electronics', pattern:/\b(laptop|computer|pc|desktop|monitor|beeldscherm|telefoon|smartphone|iphone|tablet|printer|scanner|camera|televisie|tv|koptelefoon|oortjes|headset|toetsenbord|muis|usb-stick|harddisk|ssd|router|modem)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Elektronica: 21%-tarief.' },
  { id:'clothing', pattern:/\b(kleding|broek|jeans|shirt|t-shirt|overhemd|trui|coltrui|quarterzip|polo|jas|jasje|jurk|rok|schoenen|schoen|sneakers|laarzen|riem|ondergoed|sokken|pet|hoed)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Kleding/schoeisel: 21%-tarief.' },
  { id:'office_goods', pattern:/\b(kantoorartikel(?:en)?|kantoorbenodigdheden|printerpapier|papierwaren|ordner|ringband|nietmachine|nietjes|pen|pennen|potlood|potloden|bureau|bureaustoel|kantoormeubilair)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Kantoorartikel: 21%-tarief.' },
  { id:'software_it', pattern:/\b(software|softwarelicentie|software licentie|licentie|applicatie|app|hosting|webhosting|cloud|saas|ict-dienst|ict dienst|it-dienst|it dienst|domeinnaam|websiteontwikkeling|website ontwikkeling|webdesign|programmeerwerk|programmeerdienst|cybersecuritydienst)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Software/IT-dienst: 21%-tarief bij een Nederlandse belastbare prestatie.' },
  { id:'professional_services', pattern:/\b(consultancy|consultant|adviesbureau|adviesdienst|advieswerk|accountancy|accountant|administratiekantoor|boekhouding|boekhouder|belastingadvies|belastingadviseur|juridisch advies|advocaat|notaris|marketing|reclame|advertising|communicatiebureau|uitzendbureau|detachering)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Professionele zakelijke dienst: 21%-tarief.' },
  { id:'telecom', pattern:/\b(kpn|vodafone|odido|ziggo|telecom|internetabonnement|internet abonnement|telefoonabonnement|telefoon abonnement|mobiel abonnement|glasvezel|telefonie)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Telecom/internet: 21%-tarief.' },
  { id:'fuel', pattern:/\b(tankstation|benzine|diesel|e10|e5|brandstof|motorbrandstof|adblue|laadpaal|snellader|laadsessie|elektrisch laden)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Brandstof/laaddienst: 21%-tarief.' },
  { id:'lodging_2026', pattern:/\b(hotel|hotels|pension|overnachting|overnachtingen|vakantiehuis|vakantiewoning|stacaravan|pipowagen|logies|short-stay|shortstay)\b/i, rate:21, wetsbasis:`${GENERAL_21}; voor logies geldt vanaf 1 januari 2026 het 21%-tarief.`, label:'Logies vanaf 2026: 21%-tarief.' },
  { id:'household_goods', pattern:/\b(meubel|meubels|kast|tafel|stoel|bankstel|bed|matras|lamp|verlichting|huishoudelijk apparaat|stofzuiger|wasmachine|vaatwasser|koelkast|oven|magnetron|kookplaat)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Algemeen gebruiks-/huishoudelijk goed: 21%-tarief.' },
  { id:'construction', pattern:/\b(aannemer|bouwbedrijf|bouwmateriaal|metselwerk|timmerwerk|dakdekker|loodgieter|elektricien|installateur|installatiewerk|airco|cv-ketel|verwarming|tuinaanleg|tuinonderhoud|hovenier)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Algemene bouw-/installatie-/hoveniersprestatie: 21%-tarief.' },
  { id:'vehicle_services', pattern:/\b(autogarage|garage|apk|autowas|carwash|autowassen|autoreparatie|reparatie auto|banden|autoband|motorfiets|scooter|onderhoud auto|onderhoud voertuig|lease auto|autolease|parkeergarage|parkeerkosten|parkeren)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Voertuig-/parkeerdienst: 21%-tarief.' },
  { id:'space_services', pattern:/\b(zaalhuur|vergaderruimte|kantoorruimte|werkruimte|opslagruimte|self-storage)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Ruimte/dienst: 21%-tarief tenzij een specifieke vrijstelling geldt.' },
];

const MERCHANT_RULES: DutchVatRule[] = [
  { id:'merchant_gall_gall', pattern:/\b(gall\s*(?:&|and)\s*gall|gallengall)\b/i, rate:21, wetsbasis:`${GENERAL_21}; alcoholhoudende dranken vallen niet onder het 9%-tarief.`, label:'Gall & Gall/slijterij: alcoholhoudende dranken, 21%-tarief.' },
  { id:'merchant_kpn', pattern:/\b(kpn)\b/i, rate:21, wetsbasis:GENERAL_21, label:'KPN: telecom/internetdienst, 21%-tarief.' },
  { id:'merchant_vodafone', pattern:/\b(vodafone|vodafoneziggo)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Vodafone: telecomdienst, 21%-tarief.' },
  { id:'merchant_odido', pattern:/\b(odido|tele2)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Odido/Tele2: telecomdienst, 21%-tarief.' },
  { id:'merchant_ziggo', pattern:/\b(ziggo)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Ziggo: telecom/internetdienst, 21%-tarief.' },
  { id:'merchant_ns', pattern:/\b(ns\s*(?:zakelijk|reizen|reis)?|nederlandse spoorwegen)\b/i, rate:9, wetsbasis:`${TABLE_I} (personenvervoer).`, label:'NS/personenvervoer: 9%-tarief.' },
  { id:'merchant_arriva', pattern:/\b(arriva)\b/i, rate:9, wetsbasis:`${TABLE_I} (personenvervoer).`, label:'Arriva/personenvervoer: 9%-tarief.' },
  { id:'merchant_ret', pattern:/\b(ret)\b/i, rate:9, wetsbasis:`${TABLE_I} (personenvervoer).`, label:'RET/personenvervoer: 9%-tarief.' },
  { id:'merchant_gvb', pattern:/\b(gvb)\b/i, rate:9, wetsbasis:`${TABLE_I} (personenvervoer).`, label:'GVB/personenvervoer: 9%-tarief.' },
  { id:'merchant_connexxion', pattern:/\b(connexxion)\b/i, rate:9, wetsbasis:`${TABLE_I} (personenvervoer).`, label:'Connexxion/personenvervoer: 9%-tarief.' },
  { id:'merchant_pathe', pattern:/\b(path[ée]|pathe)\b/i, rate:9, wetsbasis:`${TABLE_I} (toegang tot culturele en recreatieve voorzieningen).`, label:'Pathé/bioscoop: 9%-tarief.' },
  { id:'merchant_basic_fit', pattern:/\b(basic[-\s]?fit)\b/i, rate:9, wetsbasis:`${TABLE_I} (gelegenheid tot sportbeoefening).`, label:'Basic-Fit/sportbeoefening: 9%-tarief.' },
  { id:'merchant_fit_for_free', pattern:/\b(fit\s*for\s*free)\b/i, rate:9, wetsbasis:`${TABLE_I} (gelegenheid tot sportbeoefening).`, label:'Fit For Free/sportbeoefening: 9%-tarief.' },
  { id:'merchant_ikea', pattern:/\b(ikea)\b/i, rate:21, wetsbasis:GENERAL_21, label:'IKEA/algemene goederen: 21%-tarief.' },
  { id:'merchant_coolblue', pattern:/\b(coolblue)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Coolblue/algemene goederen: 21%-tarief.' },
  { id:'merchant_gamma', pattern:/\b(gamma)\b/i, rate:21, wetsbasis:GENERAL_21, label:'GAMMA/algemene bouw- en klusgoederen: 21%-tarief.' },
  { id:'merchant_karwei', pattern:/\b(karwei)\b/i, rate:21, wetsbasis:GENERAL_21, label:'KARWEI/algemene bouw- en klusgoederen: 21%-tarief.' },
  { id:'merchant_praxis', pattern:/\b(praxis)\b/i, rate:21, wetsbasis:GENERAL_21, label:'Praxis/algemene bouw- en klusgoederen: 21%-tarief.' },
];

function normalizedCountry(row: RawTransaction): string {
  return String(row.tegenrekening_iban ?? '').replace(/\s/g, '').toUpperCase().slice(0, 2);
}

function isDomestic(row: RawTransaction): boolean {
  const country = normalizedCountry(row);
  return !country || country === 'NL';
}

function normalizedText(row: RawTransaction): string {
  return `${row.description ?? ''} ${row.memo ?? ''}`.replace(/\s+/g, ' ').trim();
}

function hasExplicitRate(text: string): boolean {
  return /(?:^|[^0-9])(?:0|9|21)\s*%(?:[^0-9]|$)/i.test(text);
}

function hasExplicitReverseCharge(text: string): boolean {
  return /\b(btw\s*verlegd|btw-verlegd|verlegde btw|reverse\s*charge)\b/i.test(text);
}

function hasExplicitExemption(text: string): boolean {
  return /\b(vrijgesteld|vrijstelling|btw-vrij|zonder btw wegens vrijstelling)\b/i.test(text);
}

function findExplicitExemption(row: RawTransaction, text: string): SpecialHit | null {
  const output = row.type === 'income';
  if (hasExplicitExemption(text)) {
    return { classification:output?'exempt_output':'exempt_input', reason:'Expliciete vermelding van een btw-vrijstelling in de transactie.', wetsbasis:'Wet OB 1968, toepasselijke vrijstellingsbepaling; voorwaarden van de specifieke vrijstelling controleren.' };
  }
  const exemptPatterns = [
    /\b(bancaire rente|rentevergoeding|betaalrekening|betaaldienst|bankkosten|bank fee|verzekeringspremie|levensverzekering)\b/i,
    /\b(kinderopvang|onderwijs|schoolgeld|collegegeld|medische zorg|huisarts|tandarts|tandheelkundige behandeling|fysiotherapie|ziekenhuis|uitvaartdienst|begrafenis|crematie)\b/i,
  ];
  if (exemptPatterns.some(p => p.test(text))) {
    return { classification:output?'exempt_output':'exempt_input', reason:'De transactieomschrijving wijst op een activiteit die onder een btw-vrijstelling kan vallen.', wetsbasis:'Wet OB 1968, toepasselijke vrijstellingsbepaling; voorwaarden van de specifieke vrijstelling controleren.' };
  }
  return null;
}

function findExplicitZeroRate(row: RawTransaction, text: string): SpecialHit | null {
  if (!/(?:^|[^0-9])0\s*%(?:[^0-9]|$)/i.test(text)) return null;
  return { classification:row.type==='income'?'zero_rated_output':'zero_rated_input', reason:'Expliciet 0%-tarief in de transactie; wettelijke bewijsvoorwaarden blijven van toepassing.', wetsbasis:'Wet OB 1968, art. 9 lid 2 jo. Tabel II / toepasselijke 0%-regeling.' };
}

function findDutchRule(row: RawTransaction): DutchVatRule | null {
  if (!isDomestic(row)) return null;
  const text = normalizedText(row);
  if (!text || hasExplicitRate(text) || hasExplicitReverseCharge(text) || hasExplicitExemption(text)) return null;

  const merchantHits = MERCHANT_RULES.filter(rule => rule.pattern.test(text));
  const nine = RULE_9_GOODS.concat(RULE_9_SERVICES).filter(rule => rule.pattern.test(text));
  const twentyOne = RULE_21.filter(rule => rule.pattern.test(text));

  if (merchantHits.length > 0) return merchantHits[0];

  // If both 9% and 21% signals occur, use the explicit bank-line policy
  // requested for this project: resolve the row to 21% rather than review.
  if (nine.length > 0 && twentyOne.length > 0) return twentyOne[0];
  if (nine.length > 0) return nine[0];
  if (twentyOne.length > 0) return twentyOne[0];
  return null;
}

function applyDutchVatRules(rows: RawTransaction[]): { rows: RawTransaction[]; matched: Map<string, DutchVatRule> } {
  const matched = new Map<string, DutchVatRule>();
  const transformed = rows.map(row => {
    const rule = findDutchRule(row);
    if (rule) {
      matched.set(row.id, rule);
      return { ...row, description:`${String(row.description ?? '').trim()} [SafeVault btw-regel ${rule.rate}%]` };
    }

    // Fail closed. The statutory 21% residual does not mean that a bank line
    // by itself proves that a taxable Dutch 21% transaction occurred. If no
    // specific merchant/category/evidence signal exists, the transaction must
    // remain unresolved for review instead of being silently included.
    return row;
  });
  return { rows:transformed, matched };
}

function protectLegitimateMerchantNames(rows: RawTransaction[]): RawTransaction[] {
  return rows.map(row => {
    const description = String(row.description ?? '').trim();
    const first = description.toLowerCase().split(/\s+/)[0] ?? '';
    const exact = description.toLowerCase();
    if ((first === 'totaal' || first === 'saldo') && exact !== first) return { ...row, description:`\u2063${row.description ?? ''}` };
    return row;
  });
}

function attachRuleMetadata(report: FiscalReport, matched: Map<string, DutchVatRule>): FiscalReport {
  return {
    ...report,
    transactions: report.transactions.map(tx => {
      const rule = matched.get(tx.id);
      if (!rule) return tx;
      return {
        ...tx,
        reason:`${rule.label} ${rule.wetsbasis}`,
        toegepaste_regel:`${rule.label} ${rule.wetsbasis}`,
        rule:{ ...tx.rule, wetsbasis:rule.wetsbasis, explanation:`${rule.label} ${rule.wetsbasis}`, requiresEvidence:false },
      };
    }),
  };
}

export function calculateFiscalVatReport(rows: RawTransaction[], overrides: Record<string, BoekhouderBeoordeling> = {}, adjustments: FiscalAdjustments = {}): FiscalReport {
  for (const [id, review] of Object.entries(overrides)) {
    if (review.classificatie === 'other_rate_output' && review.percentage !== NEDERLANDS_OVERIG_TARIEF_1C) {
      throw new Error(`BTW safety: rubriek 1c ondersteunt alleen het expliciet vastgelegde 13%-forfait (${id}).`);
    }
  }

  const protectedRows = protectLegitimateMerchantNames(rows);
  const prepared = protectedRows.map(row => {
    const text = normalizedText(row);
    const exemption = findExplicitExemption(row, text);
    if (exemption && !hasExplicitExemption(text)) return { ...row, description:`${String(row.description ?? '').trim()} [SafeVault vrijstelling]` };
    return row;
  });

  const { rows:ruleAppliedRows, matched } = applyDutchVatRules(prepared);
  const report = calculateCore(ruleAppliedRows, overrides, adjustments);
  return attachRuleMetadata(report, matched);
}

export type {
  BtwPercentage,
  BoekhouderBeoordeling,
  FiscalAdjustments,
  FiscalClassification,
  FiscalReport,
  FiscalRule,
  FiscalSection,
  FiscalTransaction,
} from './btwFiscalSafeCore';

export { BOEKHOUDER_PERCENTAGE_OPTIES } from './btwFiscalSafeCore';
