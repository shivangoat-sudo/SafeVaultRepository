/**
 * Dutch VAT rule registry.
 *
 * This file is the policy source of truth for fiscal reasoning. Merchant names
 * and test fixtures are deliberately NOT tax rules; they are only signals
 * used elsewhere to extract transaction facts.
 *
 * Keep rules declarative and conservative. A rule may only produce an
 * automatic fiscal classification when all of its stated conditions can be
 * established from the available facts. Missing facts must yield unresolved.
 */
export type BtwRuleId =
  | 'NL_GENERAL_21'
  | 'NL_TABLE_I_9'
  | 'NL_ZERO_RATE'
  | 'NL_EXEMPT'
  | 'NL_DOMESTIC_REVERSE_CHARGE'
  | 'NL_EU_ACQUISITION'
  | 'NL_EU_SERVICE_REVERSE_CHARGE'
  | 'NL_NON_EU_SERVICE_REVERSE_CHARGE'
  | 'INPUT_VAT_BUSINESS_USE'
  | 'INPUT_VAT_EXEMPT_USE_BLOCKED'
  | 'INPUT_VAT_PRIVATE_USE_BLOCKED'
  | 'INPUT_VAT_HOSPITALITY_BLOCKED'
  | 'LOGIES_2026_21'
  | 'ALCOHOL_21'
  | 'FOOD_9'
  | 'PERSONAL_TRANSPORT_9'
  | 'CULTURE_SPORT_9'
  | 'DESIGNATED_REPAIR_9'
  | 'FLOWER_HORTICULTURE_9'
  | 'MEDICINES_AIDS_9'
  | 'BOOKS_PERIODICALS_9'
  | 'WATER_9'
  | 'HOUSING_WORK_9';

export type FiscalKnowledgeRequirement =
  | 'rate'
  | 'place_of_supply'
  | 'supplier_or_customer_status'
  | 'eu_status'
  | 'business_use'
  | 'invoice_or_equivalent_evidence'
  | 'private_use'
  | 'special_regime_conditions';

export interface BtwRule {
  id: BtwRuleId;
  title: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  result: string;
  legalBasis: string;
  requires: readonly FiscalKnowledgeRequirement[];
  notes: readonly string[];
}

export const BTW_RULE_REGISTRY: readonly BtwRule[] = [
  {
    id: 'NL_GENERAL_21',
    title: 'Algemeen Nederlands btw-tarief',
    result: '21%',
    legalBasis: 'Wet OB 1968, art. 9 lid 1',
    requires: ['rate', 'place_of_supply'],
    notes: ['Pas toe wanneer geen specifiek lager tarief, vrijstelling, 0%-tarief of verleggingsregel voorgaat.'],
  },
  {
    id: 'NL_TABLE_I_9',
    title: 'Verlaagd Nederlands btw-tarief',
    result: '9%',
    legalBasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I',
    requires: ['rate', 'place_of_supply', 'special_regime_conditions'],
    notes: ['9% geldt alleen voor prestaties die daadwerkelijk onder Tabel I vallen.'],
  },
  {
    id: 'NL_ZERO_RATE',
    title: 'Nederlands 0%-tarief',
    result: '0%',
    legalBasis: 'Wet OB 1968 en bijbehorende tabellen/uitvoeringsregels',
    requires: ['rate', 'place_of_supply', 'special_regime_conditions'],
    notes: ['Een generiek “buitenland”-signaal is onvoldoende om 0% vast te stellen.'],
  },
  {
    id: 'NL_EXEMPT',
    title: 'Vrijgestelde prestatie',
    result: 'vrijgesteld',
    legalBasis: 'Wet OB 1968, wettelijke btw-vrijstellingen',
    requires: ['place_of_supply', 'special_regime_conditions'],
    notes: ['Vrijstelling vereist dat de concrete prestatie aan de wettelijke voorwaarden voldoet.'],
  },
  {
    id: 'NL_DOMESTIC_REVERSE_CHARGE',
    title: 'Binnenlandse verleggingsregeling',
    result: 'verlegd naar afnemer',
    legalBasis: 'Wet OB 1968, art. 12 en toepasselijke verleggingsregelingen',
    requires: ['place_of_supply', 'supplier_or_customer_status', 'special_regime_conditions'],
    notes: ['Een buitenlandse rekening of losse tekst is niet zelfstandig voldoende.'],
  },
  {
    id: 'NL_EU_ACQUISITION',
    title: 'Intracommunautaire verwerving goederen',
    result: 'Nederlandse btw bij verwerving',
    legalBasis: 'Wet OB 1968, regels intracommunautaire verwervingen',
    requires: ['place_of_supply', 'eu_status', 'supplier_or_customer_status'],
    notes: ['De goederenstroom en status van partijen moeten uit de feiten blijken.'],
  },
  {
    id: 'NL_EU_SERVICE_REVERSE_CHARGE',
    title: 'Diensten uit andere EU-landen',
    result: 'meestal 4b, met aftrek in 5b voor zover toegestaan',
    legalBasis: 'Wet OB 1968, plaats-van-dienstregels voor B2B-diensten',
    requires: ['place_of_supply', 'eu_status', 'supplier_or_customer_status'],
    notes: ['Voor de hoofdregel moet vaststaan dat het om een relevante B2B-dienst gaat; uitzonderingen bestaan.'],
  },
  {
    id: 'NL_NON_EU_SERVICE_REVERSE_CHARGE',
    title: 'Diensten uit niet-EU-landen',
    result: 'meestal 4a, met aftrek in 5b voor zover toegestaan',
    legalBasis: 'Wet OB 1968, plaats-van-dienstregels voor diensten uit niet-EU-landen',
    requires: ['place_of_supply', 'supplier_or_customer_status'],
    notes: ['Een buitenlandse leverancier is niet op zichzelf bewijs voor verlegging; de aard/plaats van de dienst moet kloppen.'],
  },
  {
    id: 'INPUT_VAT_BUSINESS_USE',
    title: 'Voorbelasting: zakelijke belaste bestemming',
    result: 'aftrekbaar voor zover wettelijk toegestaan',
    legalBasis: 'Belastingdienst – Welke btw mag u aftrekken?',
    requires: ['business_use', 'invoice_or_equivalent_evidence'],
    notes: ['De banktransactie kan de berekening starten, maar sluit het vereiste bewijs niet uit.'],
  },
  {
    id: 'INPUT_VAT_EXEMPT_USE_BLOCKED',
    title: 'Voorbelasting bij vrijgestelde omzet',
    result: 'niet aftrekbaar of slechts gedeeltelijk aftrekbaar',
    legalBasis: 'Belastingdienst – Btw aftrekken bij belaste en vrijgestelde omzet',
    requires: ['business_use'],
    notes: ['Bij gemengd gebruik is slechts het belaste deel aftrekbaar.'],
  },
  {
    id: 'INPUT_VAT_PRIVATE_USE_BLOCKED',
    title: 'Privégebruik',
    result: 'privédeel niet als gewone voorbelasting aftrekken',
    legalBasis: 'Belastingdienst – Btw aftrekken bij gemengd gebruik / privégebruik',
    requires: ['private_use'],
    notes: ['Bij gemengd gebruik kan een latere herziening/correctie spelen.'],
  },
  {
    id: 'INPUT_VAT_HOSPITALITY_BLOCKED',
    title: 'Eten en drinken in horeca',
    result: 'btw niet aftrekbaar als voorbelasting',
    legalBasis: 'Belastingdienst – Welke btw mag u niet aftrekken?',
    requires: ['business_use'],
    notes: ['De tariefclassificatie en de aftrekbaarheid zijn afzonderlijke beslissingen.'],
  },
  {
    id: 'LOGIES_2026_21',
    title: 'Kortdurend logies vanaf 1 januari 2026',
    effectiveFrom: '2026-01-01',
    result: '21%',
    legalBasis: 'Belastingdienst – Btw-tarief logies',
    requires: ['rate', 'place_of_supply', 'special_regime_conditions'],
    notes: ['Voor kortdurend logies in hotels, pensions en vakantiebestedingsbedrijven geldt vanaf 1 januari 2026 21%.'],
  },
  {
    id: 'ALCOHOL_21',
    title: 'Alcoholhoudende dranken',
    result: '21%',
    legalBasis: 'Belastingdienst – Btw-tarief dranken',
    requires: ['rate', 'special_regime_conditions'],
    notes: ['Alcoholhoudende dranken vallen niet onder het 9%-tarief voor niet-alcoholhoudende dranken.'],
  },
  {
    id: 'FOOD_9',
    title: 'Voedingsmiddelen',
    result: '9%',
    legalBasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I',
    requires: ['rate', 'special_regime_conditions'],
    notes: ['Niet elk product dat bij een supermarkt wordt gekocht is automatisch een 9%-product.'],
  },
  {
    id: 'PERSONAL_TRANSPORT_9',
    title: 'Personenvervoer',
    result: '9%',
    legalBasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I',
    requires: ['rate', 'special_regime_conditions'],
    notes: ['De aard van het vervoer moet vaststaan.'],
  },
  {
    id: 'CULTURE_SPORT_9',
    title: 'Aangewezen culturele/recreatieve/sportprestaties',
    result: '9%',
    legalBasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I',
    requires: ['rate', 'special_regime_conditions'],
    notes: ['Alleen aangewezen prestaties vallen hieronder; een merknaam is geen zelfstandige fiscale conclusie.'],
  },
  {
    id: 'DESIGNATED_REPAIR_9',
    title: 'Aangewezen reparatiediensten',
    result: '9%',
    legalBasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I',
    requires: ['rate', 'special_regime_conditions'],
    notes: ['Alleen de wettelijk aangewezen reparaties vallen hieronder.'],
  },
  {
    id: 'FLOWER_HORTICULTURE_9',
    title: 'Aangewezen sierteeltproducten',
    result: '9%',
    legalBasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I',
    requires: ['rate', 'special_regime_conditions'],
    notes: ['Productcategorie en wettelijke voorwaarden moeten vaststaan.'],
  },
  {
    id: 'MEDICINES_AIDS_9',
    title: 'Geneesmiddelen en aangewezen hulpmiddelen',
    result: '9%',
    legalBasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I',
    requires: ['rate', 'special_regime_conditions'],
    notes: ['Alleen aangewezen middelen/hulpmiddelen; een algemene term “medisch” is onvoldoende.'],
  },
  {
    id: 'BOOKS_PERIODICALS_9',
    title: 'Boeken en periodieken',
    result: '9%',
    legalBasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I',
    requires: ['rate', 'special_regime_conditions'],
    notes: ['De concrete drager/publicatie moet onder de wettelijke categorie vallen.'],
  },
  {
    id: 'WATER_9',
    title: 'Water',
    result: '9%',
    legalBasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I',
    requires: ['rate', 'special_regime_conditions'],
    notes: ['Het moet gaan om water dat onder de wettelijke categorie valt.'],
  },
  {
    id: 'HOUSING_WORK_9',
    title: 'Aangewezen werkzaamheden aan woningen',
    result: '9%',
    legalBasis: 'Wet OB 1968, art. 9 lid 2 jo. Tabel I',
    requires: ['rate', 'special_regime_conditions'],
    notes: ['Onder meer ouderdom en aard van de woning/werkzaamheid kunnen voorwaarden zijn.'],
  },
];

export function getBtwRule(id: BtwRuleId): BtwRule {
  const rule = BTW_RULE_REGISTRY.find((item) => item.id === id);
  if (!rule) throw new Error(`Onbekende btw-regel: ${id}`);
  return rule;
}
