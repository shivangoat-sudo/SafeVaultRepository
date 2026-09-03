import {
  calculateFiscalVatReport as calculateCore,
  type BoekhouderBeoordeling,
  type FiscalAdjustments,
  type FiscalReport,
} from './btwFiscalSafeCore';
import type { RawTransaction } from './btwSafeTypes';

/**
 * Transaction-based Dutch VAT policy layer.
 *
 * The bank description is treated as the evidence source for the *type of
 * product/service*. Clear statutory categories are mapped automatically to
 * their Dutch VAT rate. The core still remains fail-closed for cases where the
 * description does not identify the fiscal treatment sufficiently.
 *
 * This is intentionally not a generic "everything is 21%" fallback. The
 * specific 9% Tabel-I categories win first; 21% is used only for explicitly
 * recognizable categories covered by the general rate.
 */
export const NEDERLANDS_OVERIG_TARIEF_1C = 13 as const;

type DutchVatRule = {
  id: string;
  pattern: RegExp;
  rate: 9 | 21;
  wetsbasis: string;
  label: string;
};

const RULE_9: DutchVatRule[] = [
  {
    id: 'food',
    pattern: /\b(voedingsmiddel|voedingsmiddelen|eetwaren|eten|maaltijd|brood|broodje|kaas|melk|yoghurt|fruit|groente|groenten|vlees|vis|snoep|snoepgoed|chocolade|koek|koekjes|chips|pasta|rijst|meel|granen|peulvruchten|noten|ijsje|ijsjes)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (voedingsmiddelen).',
    label: 'Voedingsmiddel: 9%-tarief.',
  },
  {
    id: 'drinks',
    pattern: /\b(water|mineraalwater|frisdrank|frisdranken|limonade|sap|vruchtensap|groentesap|koffie|thee|alcoholvrij bier|alcoholarme drank)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (niet-alcoholhoudende dranken).',
    label: 'Niet-alcoholhoudende drank: 9%-tarief.',
  },
  {
    id: 'books',
    pattern: /\b(boek|boeken|schoolboek|schoolboeken|brochure|brochures|dagblad|dagbladen|krant|kranten|tijdschrift|tijdschriften|periodiek|periodieken|e-boek|e-book|luisterboek)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (boeken en periodieken).',
    label: 'Boek/periodiek: 9%-tarief.',
  },
  {
    id: 'horticulture',
    pattern: /\b(bloembol|bloembollen|bloem|bloemen|bloemboeket|bloemboeketten|plant|planten|boomkwekerij|boomkwekerijproduct|boomkwekerijproducten|graszoden|kerstboom|kerstbomen)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (sierteeltproducten).',
    label: 'Sierteeltproduct: 9%-tarief.',
  },
  {
    id: 'medicines',
    pattern: /\b(geneesmiddel|geneesmiddelen|medicijn|medicijnen|verbandmiddel|verbandmiddelen|pleister|pleisters|prothese|prothesen|orthese|orthesen|braille|medisch hulpmiddel|medische hulpmiddelen|apotheek)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (geneesmiddelen en aangewezen hulpmiddelen).',
    label: 'Geneesmiddel/hulpmiddel: 9%-tarief.',
  },
  {
    id: 'hairdresser',
    pattern: /\b(kapper|kappers|kapsalon|knipbeurt)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (kappersdiensten).',
    label: 'Kappersdienst: 9%-tarief.',
  },
  {
    id: 'repairs',
    pattern: /\b(fietsreparatie|fiets reparatie|fietsenmaker|schoenenreparatie|schoenmaker|kledingreparatie|kleding reparatie|reparatie kleding|reparatie schoenen|reparatie fiets)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (aangewezen reparatiediensten).',
    label: 'Aangewezen reparatiedienst: 9%-tarief.',
  },
  {
    id: 'passenger_transport',
    pattern: /\b(personenvervoer|taxirit|taxi|treinreis|busreis|tramreis|metroreis|ov-chipkaart|ns zakelijk|nederlandse spoorwegen|arriva|ret|gvb|connexxion)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (personenvervoer).',
    label: 'Personenvervoer: 9%-tarief.',
  },
  {
    id: 'sports',
    pattern: /\b(fitnessabonnement|sportaccommodatie|sportschool|zwembad|zwemmen|sauna|sportwedstrijd|wedstrijdticket|sportwedstrijdticket)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (sportbeoefening/toegang sportwedstrijden).',
    label: 'Sportbeoefening/toegang sport: 9%-tarief.',
  },
  {
    id: 'culture',
    pattern: /\b(bioscoop|bioscoopkaart|theaterticket|theaterkaart|concertticket|concertkaart|museumticket|museumkaart|dierentuin|attractiepark|speeltuin|siertuin|circus|podiumoptreden|kermis|kermisattractie)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (aangewezen culturele en recreatieve voorzieningen).',
    label: 'Culturele/recreatieve toegang: 9%-tarief.',
  },
  {
    id: 'camping',
    pattern: /\b(camping|kampeerplaats|kampeergelegenheid|camperplaats|tentplaats|caravanplaats)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (kampeergelegenheid).',
    label: 'Kampeergelegenheid: 9%-tarief.',
  },
  {
    id: 'housing_work',
    pattern: /\b(schilderwerk woning|schilderen woning|stukadoor woning|stukadoren woning|isolatiewerk woning|isoleren woning|schoonmaak woning|schoonmaakwerk woning)\b/i,
    rate: 9,
    wetsbasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I (aangewezen werkzaamheden aan woningen, onder voorwaarden).',
    label: 'Aangewezen woningwerkzaamheid: 9%-tarief; wettelijke voorwaarden controleren.',
  },
];

const RULE_21: DutchVatRule[] = [
  {
    id: 'alcohol',
    pattern: /\b(bier|wijn|champagne|prosecco|whisky|whiskey|wodka|vodka|rum|gin|likeur|sterke drank|alcoholische drank|alcoholhoudende drank)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief; alcoholhoudende dranken vallen niet onder het 9%-tarief).',
    label: 'Alcoholhoudende drank: 21%-tarief.',
  },
  {
    id: 'electronics',
    pattern: /\b(laptop|computer|monitor|beeldscherm|telefoon|smartphone|iphone|tablet|printer|scanner|camera|televisie|tv|koptelefoon|headset|toetsenbord|muis|usb-stick)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Elektronica: 21%-tarief.',
  },
  {
    id: 'clothing',
    pattern: /\b(kleding|broek|shirt|overhemd|trui|jas|jurk|schoenen|schoen|sneakers|riem|ondergoed)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Kleding/schoeisel: 21%-tarief.',
  },
  {
    id: 'office_goods',
    pattern: /\b(kantoorartikelen|kantoorbenodigdheden|printerpapier|ordner|nietmachine|nietjes|bureau|bureaustoel|kantoormeubilair)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Kantoorartikel: 21%-tarief.',
  },
  {
    id: 'software_it',
    pattern: /\b(software|softwarelicentie|licentie|applicatie|hosting|webhosting|cloud|saas|ict-dienst|ict dienst|it-dienst|it dienst|domeinnaam|websiteontwikkeling|webdesign|programmeerwerk)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief voor belastbare diensten die niet onder een verlaagd tarief of vrijstelling vallen).',
    label: 'Software/IT-dienst: 21%-tarief bij Nederlandse belastbare prestatie.',
  },
  {
    id: 'professional_services',
    pattern: /\b(consultancy|consultant|adviesbureau|adviesdienst|accountancy|accountant|administratiekantoor|boekhouding|boekhouder|juridisch advies|advocaat|notaris|marketing|reclame|advertising)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Zakelijke professionele dienst: 21%-tarief.',
  },
  {
    id: 'telecom',
    pattern: /\b(kpn|vodafone|odido|ziggo|telecom|internetabonnement|telefoonabonnement|mobiel abonnement|glasvezel)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Telecom/internet: 21%-tarief.',
  },
  {
    id: 'fuel',
    pattern: /\b(tankstation|benzine|diesel|e10|e5|brandstof|motorbrandstof|laadpaal|snellader)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Brandstof/laaddienst: 21%-tarief.',
  },
  {
    id: 'lodging_2026',
    pattern: /\b(hotel|hotels|pension|overnachting|overnachtingen|vakantiehuis|stacaravan|pipowagen|logies|short-stay|shortstay)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1; vanaf 1 januari 2026 geldt voor logies het 21%-tarief.',
    label: 'Logies vanaf 2026: 21%-tarief.',
  },
  {
    id: 'furniture_household',
    pattern: /\b(meubel|meubels|kast|tafel|stoel|bankstel|bed|matras|lamp|verlichting|huishoudelijk apparaat|stofzuiger|wasmachine|vaatwasser|koelkast)\b/i,
    rate: 21,
    wetsbasis: 'Wet OB 1968, art. 9 lid 1 (algemeen 21%-tarief).',
    label: 'Algemeen gebruiks-/huishoudelijk goed: 21%-tarief.',
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

  // The 9% statutory categories must always be evaluated before the general 21% rule.
  return RULE_9.find(rule => rule.pattern.test(text)) ?? RULE_21.find(rule => rule.pattern.test(text)) ?? null;
}

function applyDutchVatRules(rows: RawTransaction[]): { rows: RawTransaction[]; matched: Map<string, DutchVatRule> } {
  const matched = new Map<string, DutchVatRule>();
  const transformed = rows.map(row => {
    const rule = findDutchRule(row);
    if (!rule) return row;
    matched.set(row.id, rule);
    return { ...row, description: `${String(row.description ?? '').trim()} [SafeVault btw-regel ${rule.rate}%]` };
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
  return {
    ...report,
    transactions: report.transactions.map(tx => {
      const rule = matched.get(tx.id);
      if (!rule) return tx;
      return {
        ...tx,
        reason: `${rule.label} ${rule.wetsbasis}`,
        toegepaste_regel: `${rule.label} ${rule.wetsbasis}`,
        rule: {
          ...tx.rule,
          wetsbasis: rule.wetsbasis,
          explanation: `${rule.label} ${rule.wetsbasis}`,
          requiresEvidence: false,
        },
      };
    }),
  };
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

  // Submitted VAT fields from an imported spreadsheet never override the transaction rule engine.
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
