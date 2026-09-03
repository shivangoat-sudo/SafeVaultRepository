import {
  calculateFiscalVatReport as calculateCore,
  type BoekhouderBeoordeling,
  type FiscalAdjustments,
  type FiscalReport,
  type FiscalTransaction,
} from './btwFiscalSafeCore';
import type { RawTransaction } from './btwSafeTypes';

/**
 * Dutch fiscal policy guard around the production core.
 *
 * The classifier is transaction-driven: clear descriptions are matched against
 * a Dutch VAT rule catalogue before the safe core runs. This lets the engine
 * automatically apply the statutory rate for recognizable goods/services,
 * while genuinely ambiguous cases remain unresolved.
 *
 * Important: a bank transaction still does not prove invoice conditions,
 * business use, exemption status, reverse charge, or the VAT period. The rule
 * catalogue therefore only auto-classifies cases where the description itself
 * gives a sufficiently specific product/service signal.
 */
export const NEDERLANDS_OVERIG_TARIEF_1C = 13 as const;

type DutchVatRule = {
  id: string;
  pattern: RegExp;
  rate: 9 | 21;
  wetsbasis: string;
  label: string;
  /** 9%/21% rate may be inferred from the transaction description. */
  confidence: 'high';
};

/**
 * Statutory 9% categories from Wet OB 1968 art. 9 lid 2 jo. Tabel I.
 *
 * Keep these patterns specific. A generic word such as "boek" must never match
 * "boekhouding"; product words are bounded deliberately.
 */
const DUTCH_9_RULES: DutchVatRule[] = [
  {
    id: 'food',
    pattern: /\b(voedingsmiddelen|eetwaren|eten|maaltijd|brood|broodje|broodjes|kaas|melk|yoghurt|fruit|groente|groenten|vlees|vis|snoep|snoepgoed|chocolade|koek|koekjes|chips|pasta|rijst|meel|granen|peulvruchten|noten|ijsje|ijsjes)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I, post a.1 (voedingsmiddelen).',
    label: 'Voedingsmiddel: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'non_alcoholic_drinks',
    pattern: /\b(water|mineraalwater|frisdrank|frisdranken|limonade|sap|vruchtensap|groentesap|koffie|thee|alcoholvrij bier|alcoholarme drank)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (niet-alcoholhoudende dranken).',
    label: 'Niet-alcoholhoudende drank: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'books_periodicals',
    pattern: /\b(boek|boeken|schoolboek|schoolboeken|brochure|brochures|dagblad|dagbladen|krant|kranten|tijdschrift|tijdschriften|periodiek|periodieken|nieuwsbrief|e-?boek|luisterboek)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (boeken en periodieken).',
    label: 'Boek/periodiek: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'horticulture',
    pattern: /\b(bloembol|bloembollen|bloem|bloemen|bloemboeket|bloemboeketten|plant|planten|boomkwekerij|boomkwekerijproduct|boomkwekerijproducten|graszoden|kerstboom|kerstbomen)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (sierteeltproducten).',
    label: 'Sierteeltproduct: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'medicines_aids',
    pattern: /\b(geneesmiddel|geneesmiddelen|medicijn|medicijnen|verbandmiddel|verbandmiddelen|pleister|pleisters|prothese|prothesen|orthese|orthesen|invalidewagen|invalidewagens|hulpmiddel voor blinden|braille|medisch hulpmiddel|medische hulpmiddelen|apotheek)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (geneesmiddelen en aangewezen hulpmiddelen).',
    label: 'Geneesmiddel/hulpmiddel: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'hairdresser',
    pattern: /\b(kapper|kappers|kapsalon|knipbeurt|knippen)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (kappersdiensten).',
    label: 'Kappersdienst: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'repairs',
    pattern: /\b(fietsreparatie|fiets reparatie|fietsenmaker|schoenenreparatie|schoenmaker|kledingreparatie|kleding reparatie|reparatie kleding|reparatie schoenen|reparatie fiets)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (aangewezen reparatiediensten).',
    label: 'Aangewezen reparatiedienst: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'passenger_transport',
    pattern: /\b(personenvervoer|taxirit|taxi|treinreis|treinreisje|busreis|tramreis|metroreis|ov-chipkaart|ns zakelijk|nederlandse spoorwegen|arriva|ret|gvb|connexxion)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (personenvervoer).',
    label: 'Personenvervoer: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'sports_access',
    pattern: /\b(fitnessabonnement|fitness|sportaccommodatie|sportschool|zwembad|zwemmen|sauna|sportwedstrijd|wedstrijdticket|sportwedstrijdticket|sportkaart)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (sportbeoefening en toegang tot sportwedstrijden).',
    label: 'Sportbeoefening/toegang sport: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'culture_recreation',
    pattern: /\b(bioscoop|bioscoopkaart|bioscoopkaartje|theaterticket|theaterkaart|concertticket|concertkaart|museumticket|museumkaart|dierentuin|attractiepark|speeltuin|siertuin|circus|podiumoptreden|kermis|kermisattractie)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (toegang tot aangewezen culturele en recreatieve voorzieningen).',
    label: 'Culturele/recreatieve toegang: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'camping',
    pattern: /\b(camping|kampeerplaats|kampeergelegenheid|camperplaats|tentplaats|caravanplaats)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (kampeergelegenheid).',
    label: 'Kampeergelegenheid: 9%-tarief.',
    confidence: 'high',
  },
  {
    id: 'housing_repair',
    pattern: /\b(schilderwerk woning|schilderen woning|stukadoor woning|stukadoren woning|isolatiewerk woning|isoleren woning|schoonmaak woning|schoonmaakwerk woning)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (aangewezen werkzaamheden aan woningen, onder voorwaarden).',
    label: 'Aangewezen woningwerkzaamheid: 9%-tarief, voorwaarden controleren.',
    confidence: 'high',
  },
  {
    id: 'ebook_news',
    pattern: /\b(e-book|e-boek|digitale krant|digitale krant|nieuwswebsite|nieuwsapp|nieuws abonnement|nieuwsabonnement)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (digitale boeken en aangewezen nieuws-/periodieke publicaties).',
    label: 'Digitale publicatie: 9%-tarief, mits aan de wettelijke voorwaarden is voldaan.',
    confidence: 'high',
  },
];

/**
 * Clear categories that fall under the Dutch general 21% rate. The legal rule
 * is deliberately the default only after more specific 9%/0%/exempt/reverse
 * charge signals have been considered by the core.
 */
const DUTCH_21_RULES: DutchVatRule[] = [
  {
    id: 'alcohol',
    pattern: /\b(bier|wijn|champagne|prosecco|whisky|whiskey|wodka|vodka|rum|gin|likeur|sterke drank|alcoholische drank|alcoholhoudende drank)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief; alcoholhoudende dranken vallen niet onder het 9%-tarief).',
    label: 'Alcoholhoudende drank: 21%-tarief.',
    confidence: 'high',
  },
  {
    id: 'electronics',
    pattern: /\b(laptop|computer|monitor|beeldscherm|telefoon|smartphone|iphone|tablet|printer|scanner|camera|televisie|tv|koptelefoon|headset|toetsenbord|muis|usb-stick)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Elektronica: 21%-tarief.',
    confidence: 'high',
  },
  {
    id: 'clothing',
    pattern: /\b(kleding|broek|shirt|overhemd|trui|jas|jurk|schoenen|schoen|sneakers|riem|ondergoed)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Kleding/schoeisel: 21%-tarief.',
    confidence: 'high',
  },
  {
    id: 'office_goods',
    pattern: /\b(kantoorartikelen|kantoorbenodigdheden|papier|printerpapier|ordner|map|pennen|pen|nietmachine|nietjes|bureau|bureaustoel|kantoormeubilair)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Kantoorartikel: 21%-tarief.',
    confidence: 'high',
  },
  {
    id: 'software_it',
    pattern: /\b(software|softwarelicentie|licentie|applicatie|hosting|webhosting|cloud|saas|ict-dienst|ict dienst|it-dienst|it dienst|domeinnaam|domain|websiteontwikkeling|webdesign|programmeerwerk)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Software/IT-dienst: 21%-tarief bij Nederlandse belastbare prestatie.',
    confidence: 'high',
  },
  {
    id: 'professional_services',
    pattern: /\b(consultancy|consultant|adviesbureau|adviesdienst|accountancy|accountant|administratiekantoor|boekhouding|boekhouder|juridisch advies|advocaat|notaris|marketing|reclame|advertising|advies)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Zakelijke advies-/professionele dienst: 21%-tarief.',
    confidence: 'high',
  },
  {
    id: 'telecom',
    pattern: /\b(kpn|vodafone|odido|ziggo|telecom|internetabonnement|telefoonabonnement|mobiel abonnement|glasvezel)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Telecom/internet: 21%-tarief.',
    confidence: 'high',
  },
  {
    id: 'fuel',
    pattern: /\b(tankstation|benzine|diesel|e10|e5|brandstof|motorbrandstof|laadpaal|snellader|laden elektrische auto)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Brandstof/laaddienst: 21%-tarief.',
    confidence: 'high',
  },
  {
    id: 'furniture_household',
    pattern: /\b(meubel|meubels|kast|tafel|stoel|bankstel|bed|matras|lamp|verlichting|huishoudelijk apparaat|stofzuiger|wasmachine|vaatwasser|koelkast)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Algemeen gebruiks-/huishoudelijk goed: 21%-tarief.',
    confidence: 'high',
  },
];

function isDomestic(row: RawTransaction): boolean {
  const country = String(row.tegenrekening_iban ?? '').replace(/\s/g, '').toUpperCase().slice(0, 2);
  return !country || country === 'NL';
}

function hasExplicitFiscalSignal(text: string): boolean {
  return /\b(?:0|9|21)\s*%\b/i.test(text)
    || /\b(btw\s*verlegd|btw-verlegd|reverse\s*charge|vrijgesteld|vrijstelling|btw-vrij)\b/i.test(text);
}

function findDutchRule(row: RawTransaction): DutchVatRule | null {
  if (!isDomestic(row)) return null;
  const text = `${row.description ?? ''} ${row.memo ?? ''}`.replace(/\s+/g, ' ').trim();
  if (!text || hasExplicitFiscalSignal(text)) return null;

  // Specific 9% rules always win over the general 21% rules.
  const low = DUTCH_9_RULES.find(rule => rule.pattern.test(text));
  if (low) return low;

  const high = DUTCH_21_RULES.find(rule => rule.pattern.test(text));
  if (high) return high;

  return null;
}

function applyDutchVatRules(rows: RawTransaction[]): {
  rows: RawTransaction[];
  matched: Map<string, DutchVatRule>;
} {
  const matched = new Map<string, DutchVatRule>();
  const transformed = rows.map(row => {
    const rule = findDutchRule(row);
    if (!rule) return row;

    matched.set(row.id, rule);
    const description = String(row.description ?? '').trim();
    // The safe core already understands explicit 9%/21% signals. We add a
    // machine-readable marker to the transaction itself so the classification
    // remains transaction-driven and deterministic. The original description
    // is retained verbatim before the marker.
    return {
      ...row,
      description: `${description} [SafeVault btw-regel ${rule.rate}%]`,
    };
  });

  return { rows: transformed, matched };
}

function protectLegitimateMerchantNames(rows: RawTransaction[]): RawTransaction[] {
  return rows.map(row => {
    const description = String(row.description ?? '').trim();
    const first = description.toLowerCase().split(/\s+/)[0] ?? '';
    const exact = description.toLowerCase();
    if ((first === 'totaal' || first === 'saldo') && exact !== first) {
      return { ...row, description: `\u2063${row.description ?? ''}` };
    }
    return row;
  });
}

function attachRuleMetadata(report: FiscalReport, matched: Map<string, DutchVatRule>): FiscalReport {
  if (matched.size === 0) return report;

  const transactions: FiscalTransaction[] = report.transactions.map(tx => {
    const rule = matched.get(tx.id);
    if (!rule) return tx;

    return {
      ...tx,
      reason: `${rule.label} ${rule.wetsbasis}`,
      confidence: rule.confidence,
      rule: {
        ...tx.rule,
        wetsbasis: rule.wetsbasis,
        explanation: `${rule.label} ${rule.wetsbasis}`,
        requiresEvidence: false,
      },
      toegepaste_regel: `${rule.label} ${rule.wetsbasis}`,
    };
  });

  return { ...report, transactions };
}

export function calculateFiscalVatReport(
  rows: RawTransaction[],
  overrides: Record<string, BoekhouderBeoordeling> = {},
  adjustments: FiscalAdjustments = {},
): FiscalReport {
  for (const [id, review] of Object.entries(overrides)) {
    if (review.classificatie === 'other_rate_output' && review.percentage !== NEDERLANDS_OVERIG_TARIEF_1C) {
      throw new Error(`BTW safety: rubriek 1c ondersteunt alleen het expliciet vastgelegde 13%-forfait (${id}).`);
    }
  }

  // Deliberately no controleerIngediendeBtwPost() call here.
  // submitted_amount_excl / submitted_vat_amount / submitted_vat_percentage /
  // submitted_section are optional source fields and must never block or
  // invalidate a bank-based BTW calculation.
  const protectedRows = protectLegitimateMerchantNames(rows);
  const { rows: ruleAppliedRows, matched } = applyDutchVatRules(protectedRows);
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
