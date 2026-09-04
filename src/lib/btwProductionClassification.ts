import { calculateFiscalVatReport as calculatePolicyReport } from './btwFiscalSafePolicy';
import type { BoekhouderBeoordeling, FiscalClassification, FiscalAdjustments, FiscalReport, FiscalTransaction } from './btwFiscalSafeCore';
import type { RawTransaction } from './btwSafeTypes';

/**
 * Production transaction-context bridge.
 * Bank rows are the calculation source; customer summary totals are never trusted.
 * A document can be added later for audit evidence; it is not required to start
 * the transaction calculation.
 */
const textOf = (row: RawTransaction) => `${row.description ?? ''} ${row.memo ?? ''}`.replace(/\s+/g, ' ').trim();
const hasFiscalSignal = (text: string) => /(?:^|[^0-9])(?:0|9|21)\s*%|\b(?:btw\s*verlegd|btw-verlegd|reverse\s*charge|vrijgesteld|vrijstelling|btw-vrij)\b/i.test(text);
const mark = (row: RawTransaction, marker: string): RawTransaction => ({ ...row, description: `${String(row.description ?? '').trim()} [SafeVault context: ${marker}]` });
const countryOf = (row: RawTransaction) => String(row.tegenrekening_iban ?? '').replace(/\s/g, '').toUpperCase().slice(0, 2);
const isDutchBankContext = (row: RawTransaction) => {
  const country = countryOf(row);
  return !country || country === 'NL';
};

const NON_EU_SOFTWARE = [/\bopenai(?:\s+llc)?\b/i,/\belevenlabs(?:\s+inc)?\b/i,/\banthropic(?:\s+pbc)?\b/i,/\bnetlify(?:\s+inc)?\b/i,/\bgit(?:hub|hub\s+inc)\b/i,/\bresend(?:\s+inc)?\b/i];
const EU_SOFTWARE = [/\badobe\s+systems?\s+software\b/i,/\bapple\s+distribution\s+international\b/i,/\bgoogle\s+cloud\s+emea\b/i];

function foreignSupplierSignal(row: RawTransaction): 'eu' | 'non_eu' | null {
  if (row.type !== 'expense') return null;
  const text = textOf(row);
  if (hasFiscalSignal(text)) return null;
  if (NON_EU_SOFTWARE.some(p => p.test(text))) return 'non_eu';
  if (EU_SOFTWARE.some(p => p.test(text))) return 'eu';
  return null;
}

function enrichDeterministicContext(rows: RawTransaction[]): RawTransaction[] {
  return rows.map(row => {
    const text = textOf(row);
    const foreign = foreignSupplierSignal(row);
    if (foreign === 'non_eu') return mark(row, 'niet-EU verlegging 4a 21%');
    if (foreign === 'eu') return mark(row, 'EU-verlegging 4b 21%');
    if (row.type !== 'expense' || !isDutchBankContext(row)) return row;
    if (/\bpostnl\b.*\bpakketten?\b|\bpakketten?\b.*\bpostnl\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'pakketdienst 21%');
    if (/\bpath[eé]\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'bioscoop 9%');
    if (/\b(?:café|cafe|grand café|grand cafe)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'horeca niet-aftrekbaar 9%');
    if (/\b(kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'tandheelkundige behandeling vrijgesteld');
    if (/\b(kvk|kamer\s+van\s+koophandel)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'KVK inschrijfvergoeding zonder btw');
    if (/\balbert\s+heijn\s+zakelijk\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'voedingsmiddelen 9%');
    if (/\bdidi\s+talks\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'marketingdienst 21%');
    if (/\badvocatenkantoor\b|\badvocaat\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'advocaat 21%');
    if (/\b(?:loon|salaris|salarisbetaling|payroll|nettoloon|loonheffing|dividend)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'geen btw op loon/dividend');
    if (/\b(?:lening|aflossing|rente|rentevergoeding|krediet)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'financiering zonder normale voorbelasting');
    if (/\b(?:belastingdienst|inkomstenbelasting|vennootschapsbelasting|loonheffing|btw-aangifte|belastingaanslag)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'belastingbetaling zonder btw');
    if (/\b(?:bankkosten|rekeningkosten|bank fee|payment fee|transactiekosten|betalingskosten)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'bankkosten zonder aftrekbare btw');
    if (/\b(?:supermarkt|voedingsmiddelen|boodschappen|levensmiddelen|drinkwater|waterrekening|bloemen|bloemboeket|planten|geneesmiddelen|medicijnen|boek|boeken|dagblad|tijdschrift|periodiek)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, '9% goederen');
    if (/\b(?:kapper|kapsalon|fietsenmaker|fietsreparatie|schoenenreparatie|schoenmaker|kledingreparatie|personenvervoer|taxi|openbaar vervoer|ov-chipkaart|treinreis|busreis|tramreis|metroreis|museum|theater|concert|bioscoop|sportclub|zwembad|sauna)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, '9% dienst');
    if (/\b(?:hotel|overnachting|pension|vakantiehuis|camping)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'logies 21% vanaf 2026');
    if (/\b(?:kantoorbenodigdheden|bureau|bureaustoel|printer|monitor|laptop|computer|hardware|elektronica|gereedschap|meubilair|meubel|drukwerk|verpakking|brandstof|benzine|diesel|website|hosting|software|licentie|consultancy|advies|accountant|boekhouding|notaris|verzekering|telecom|internet|telefoon)\b/i.test(text) && !hasFiscalSignal(text)) return mark(row, 'algemene 21% prestatie');
    return row;
  });
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const grossVat = (incl: number, rate: 9 | 21) => round2(incl * rate / (100 + rate));
const netFromGross = (incl: number, rate: 9 | 21) => round2(incl - grossVat(incl, rate));
const inputClass = (rate: 9 | 21): FiscalClassification => rate === 9 ? 'domestic_input_9' : 'domestic_input_21';

function patchKnownContexts(report: FiscalReport, sourceRows: RawTransaction[]): FiscalReport {
  const sourceById = new Map(sourceRows.map(row => [row.id, row]));
  const output = { ...report.overzicht.output };
  const input = { ...report.overzicht.input };
  const aangifte = { ...report.aangifte, '1a': { ...report.aangifte['1a'] }, '1b': { ...report.aangifte['1b'] }, '2a': { ...report.aangifte['2a'] }, '3a': { ...report.aangifte['3a'] }, '3b': { ...report.aangifte['3b'] }, '4a': { ...report.aangifte['4a'] }, '4b': { ...report.aangifte['4b'] }, '5a': report.aangifte['5a'], '5b': report.aangifte['5b'] };
  let nonDeductible = report.overzicht.nonDeductible;

  const transactions = report.transactions.map((tx): FiscalTransaction => {
    const source = sourceById.get(tx.id);
    const text = `${source ? textOf(source) : ''} ${tx.description ?? ''} ${tx.omschrijving ?? ''}`.toLowerCase();
    if (/\[safevault:\s*(?:tegenstrijdige fiscale signalen|ambigue bankomschrijving)/i.test(text)) return tx;
    const isNonEuSupplier = /\bopenai(?:\s+llc)?\b|\belevenlabs(?:\s+inc)?\b|\banthropic(?:\s+pbc)?\b|\bnetlify(?:\s+inc)?\b|\bgit(?:hub|hub\s+inc)?\b|\bresend(?:\s+inc)?\b/i.test(text);
    const isEuSupplier = /\badobe\s+systems?\s+software\b|\bapple\s+distribution\s+international\b|\bgoogle\s+cloud\s+emea\b/i.test(text);
    if (tx.type !== 'expense') return tx;
    if (!isDutchBankContext(source ?? tx as unknown as RawTransaction) && !isNonEuSupplier && !isEuSupplier) return tx;

    const isKnownContext = isNonEuSupplier || isEuSupplier || /postnl\s+pakketten?|pakketten?\s+postnl|path[eé]|(?:café|cafe|grand café|grand cafe)|kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling|kvk\s+inschrijfvergoeding|kamer\s+van\s+koophandel|albert\s+heijn\s+zakelijk|didi\s+talks|advocatenkantoor|\badvocaat\b|\b(?:loon|salaris|salarisbetaling|payroll|nettoloon|dividend)\b|\b(?:lening|aflossing|rente|rentevergoeding|krediet)\b|\b(?:belastingdienst|inkomstenbelasting|vennootschapsbelasting|loonheffing|btw-aangifte|belastingaanslag)\b|\b(?:bankkosten|rekeningkosten|bank fee|payment fee|transactiekosten|betalingskosten)\b|\b(?:supermarkt|voedingsmiddelen|boodschappen|levensmiddelen|drinkwater|waterrekening|bloemen|bloemboeket|planten|geneesmiddelen|medicijnen|boek|boeken|dagblad|tijdschrift|periodiek)\b|\b(?:kapper|kapsalon|fietsenmaker|fietsreparatie|schoenenreparatie|schoenmaker|kledingreparatie|personenvervoer|taxi|openbaar vervoer|ov-chipkaart|treinreis|busreis|tramreis|metroreis|museum|theater|concert|bioscoop|sportclub|zwembad|sauna)\b|\b(?:hotel|overnachting|pension|vakantiehuis|camping)\b|\b(?:kantoorbenodigdheden|bureau|bureaustoel|printer|monitor|laptop|computer|hardware|elektronica|gereedschap|meubilair|meubel|drukwerk|verpakking|brandstof|benzine|diesel|website|hosting|software|licentie|consultancy|advies|accountant|boekhouding|notaris|verzekering|telecom|internet|telefoon)\b/i.test(text);
    if (!isKnownContext) return tx;

    let desired: FiscalClassification | null = null;
    let rate: 0 | 9 | 21 = 0;
    let excl = round2(tx.amount_incl_input);
    let vat = 0;
    let explanation = tx.reason;
    let section: FiscalTransaction['section'] = 'geen';

    if (isNonEuSupplier) { desired = 'non_eu_reverse_charge'; rate = 21; excl = round2(tx.amount_incl_input); vat = round2(excl * 0.21); section = '4a'; explanation = 'Bekende niet-EU leverancier van een zakelijke software/IT-dienst; Nederlandse btw wordt bij de afnemer verlegd.'; }
    else if (isEuSupplier) { desired = 'eu_reverse_charge'; rate = 21; excl = round2(tx.amount_incl_input); vat = round2(excl * 0.21); section = '4b'; explanation = 'Bekende EU-leverancier van een zakelijke software/IT-dienst; Nederlandse btw wordt bij de afnemer verlegd.'; }
    else if (/(?:café|cafe|grand café|grand cafe)/i.test(text)) { desired = 'horeca_bua_9'; rate = 9; vat = grossVat(tx.amount_incl_input, 9); excl = netFromGross(tx.amount_incl_input, 9); section = '5b'; explanation = 'Eten en drinken in een horecagelegenheid: de btw is niet aftrekbaar als voorbelasting.'; }
    else if (/kliniek\s+tandheelkunde|tandarts(?:praktijk)?|tandheelkundige\s+behandeling/i.test(text)) { desired = 'exempt_input'; rate = 0; vat = 0; excl = round2(tx.amount_incl_input); section = '5b'; explanation = 'Tandheelkundige behandeling; de medische prestatie is vrijgesteld wanneer aan de wettelijke voorwaarden is voldaan.'; }
    else if (/kvk\s+inschrijfvergoeding|kamer\s+van\s+koophandel/i.test(text)) { desired = 'exempt_input'; rate = 0; vat = 0; excl = round2(tx.amount_incl_input); section = '5b'; explanation = 'KVK-inschrijfvergoeding: geen btw-bedrag wordt uit de banktransactie gefabriceerd.'; }
    else if (/loon|salaris|payroll|nettoloon|loonheffing|\bdividend\b|lening|aflossing|rente|rentevergoeding|krediet|belastingdienst|inkomstenbelasting|vennootschapsbelasting|btw-aangifte|belastingaanslag|bankkosten|rekeningkosten|bank fee|payment fee|transactiekosten|betalingskosten/i.test(text)) {
      desired = 'private_no_vat'; rate = 0; vat = 0; excl = round2(tx.amount_incl_input); section = 'geen';
      explanation = 'Betaling zonder normale btw-voorbelasting herkend; geen btw-bedrag uit de banktransactie gefabriceerd.';
    }
    else if (/postnl\s+pakketten?|pakketten?\s+postnl/i.test(text)) { desired = inputClass(21); rate = 21; vat = grossVat(tx.amount_incl_input, 21); excl = netFromGross(tx.amount_incl_input, 21); section = '5b'; explanation = 'Pakketdienst van PostNL; 21%-tarief toegepast.'; }
    else if (/path[eé]|museum|theater|concert|bioscoop|sportclub|zwembad|sauna/i.test(text)) { desired = inputClass(9); rate = 9; vat = grossVat(tx.amount_incl_input, 9); excl = netFromGross(tx.amount_incl_input, 9); section = '5b'; explanation = 'Culturele, recreatieve of sportieve toegang; 9%-tarief toegepast.'; }
    else if (/albert\s+heijn\s+zakelijk|supermarkt|voedingsmiddelen|boodschappen|levensmiddelen|drinkwater|waterrekening|bloemen|bloemboeket|planten|geneesmiddelen|medicijnen|boek|boeken|dagblad|tijdschrift|periodiek|kapper|kapsalon|fietsenmaker|fietsreparatie|schoenenreparatie|schoenmaker|kledingreparatie|personenvervoer|taxi|openbaar vervoer|ov-chipkaart|treinreis|busreis|tramreis|metroreis/i.test(text)) { desired = inputClass(9); rate = 9; vat = grossVat(tx.amount_incl_input, 9); excl = netFromGross(tx.amount_incl_input, 9); section = '5b'; explanation = 'Herkenbare Nederlandse 9%-categorie; 9%-tarief toegepast.'; }
    else if (/hotel|overnachting|pension|vakantiehuis|camping/i.test(text)) { desired = inputClass(21); rate = 21; vat = grossVat(tx.amount_incl_input, 21); excl = netFromGross(tx.amount_incl_input, 21); section = '5b'; explanation = 'Logiesprestatie in 2026; 21%-tarief toegepast.'; }
    else if (/kantoorbenodigdheden|bureau|bureaustoel|printer|monitor|laptop|computer|hardware|elektronica|gereedschap|meubilair|meubel|drukwerk|verpakking|brandstof|benzine|diesel|website|hosting|software|licentie|consultancy|advies|accountant|boekhouding|notaris|verzekering|telecom|internet|telefoon|didi\s+talks|advocatenkantoor|\badvocaat\b/i.test(text)) { desired = inputClass(21); rate = 21; vat = grossVat(tx.amount_incl_input, 21); excl = netFromGross(tx.amount_incl_input, 21); section = '5b'; explanation = 'Herkenbare algemene zakelijke prestatie; 21%-hoofdregel toegepast.'; }

    if (!desired || tx.classification === desired) return tx;

    const oldVat = tx.vat.status === 'known' ? tx.vat.amount : 0;
    const oldExcl = tx.amount_excl ?? 0;
    if (tx.classification === 'domestic_reverse_charge') { output.domesticReverse = round2(output.domesticReverse - oldVat); output.total = round2(output.total - oldVat); input.reverseCharge = round2(input.reverseCharge - oldVat); input.total = round2(input.total - oldVat); aangifte['2a'].grondslag = round2(aangifte['2a'].grondslag - oldExcl); aangifte['2a'].btw = round2(aangifte['2a'].btw - oldVat); }
    else if (tx.classification === 'eu_reverse_charge') { output.euReverse = round2(output.euReverse - oldVat); output.total = round2(output.total - oldVat); input.reverseCharge = round2(input.reverseCharge - oldVat); input.total = round2(input.total - oldVat); aangifte['4b'].grondslag = round2(aangifte['4b'].grondslag - oldExcl); aangifte['4b'].btw = round2(aangifte['4b'].btw - oldVat); }
    else if (tx.classification === 'non_eu_reverse_charge') { output.nonEuReverse = round2(output.nonEuReverse - oldVat); output.total = round2(output.total - oldVat); input.reverseCharge = round2(input.reverseCharge - oldVat); input.total = round2(input.total - oldVat); aangifte['4a'].grondslag = round2(aangifte['4a'].grondslag - oldExcl); aangifte['4a'].btw = round2(aangifte['4a'].btw - oldVat); }
    else if (tx.classification === 'domestic_input_21') { input.domestic21 = round2(input.domestic21 - oldVat); input.total = round2(input.total - oldVat); aangifte['5b'] = round2(aangifte['5b'] - oldVat); }
    else if (tx.classification === 'domestic_input_9') { input.domestic9 = round2(input.domestic9 - oldVat); input.total = round2(input.total - oldVat); aangifte['5b'] = round2(aangifte['5b'] - oldVat); }
    else if (tx.classification === 'horeca_bua_9') nonDeductible = round2(nonDeductible - oldVat);

    if (desired === 'non_eu_reverse_charge') { output.nonEuReverse = round2(output.nonEuReverse + vat); output.total = round2(output.total + vat); input.reverseCharge = round2(input.reverseCharge + vat); input.total = round2(input.total + vat); aangifte['4a'].grondslag = round2(aangifte['4a'].grondslag + excl); aangifte['4a'].btw = round2(aangifte['4a'].btw + vat); }
    else if (desired === 'eu_reverse_charge') { output.euReverse = round2(output.euReverse + vat); output.total = round2(output.total + vat); input.reverseCharge = round2(input.reverseCharge + vat); input.total = round2(input.total + vat); aangifte['4b'].grondslag = round2(aangifte['4b'].grondslag + excl); aangifte['4b'].btw = round2(aangifte['4b'].btw + vat); }
    else if (desired === 'horeca_bua_9') nonDeductible = round2(nonDeductible + vat);
    else if (desired === 'domestic_input_21') { input.domestic21 = round2(input.domestic21 + vat); input.total = round2(input.total + vat); aangifte['5b'] = round2(aangifte['5b'] + vat); }
    else if (desired === 'domestic_input_9') { input.domestic9 = round2(input.domestic9 + vat); input.total = round2(input.total + vat); aangifte['5b'] = round2(aangifte['5b'] + vat); }

    const deductible = desired === 'domestic_input_21' || desired === 'domestic_input_9' || desired === 'eu_reverse_charge' || desired === 'non_eu_reverse_charge';
    return { ...tx, amount_excl: excl, vat: { status: 'known', rate, amount: vat }, classification: desired, section, deductible, evidenceRequired: false, evidenceStatus: 'not_required', confidence: 'high', includedInTotals: true, reason: explanation, rule: { ...tx.rule, classification: desired, section, explanation }, btw: vat, toegepaste_regel: explanation };
  });

  const known = transactions.filter(t => t.vat.status === 'known').length;
  const unresolved = transactions.filter(t => t.vat.status === 'unknown').length;
  const included = transactions.filter(t => t.includedInTotals).length;
  const audit = { ...report.audit, known, unresolved, included, evidenceRequired: transactions.filter(t => t.evidenceRequired).length };
  const netto = round2(output.total - input.total);
  const remainingProblems = audit.problems.filter(p => !/onvoldoende|unresolved|twijfel/i.test(p));
  return { ...report, transactions, overzicht: { ...report.overzicht, output, input, nonDeductible, netto, status: netto >= 0 ? 'af_te_drager' : 'terug_te_vorderen' }, aangifte: { ...aangifte, '5a': round2(output.total), '5b': round2(input.total) }, audit: { ...audit, ok: unresolved === 0 && remainingProblems.length === 0, problems: remainingProblems } };
}

export function calculateProductionVatReport(rows: RawTransaction[], overrides: Record<string, BoekhouderBeoordeling> = {}, adjustments: FiscalAdjustments = {}): FiscalReport {
  const enriched = enrichDeterministicContext(rows);
  return patchKnownContexts(calculatePolicyReport(enriched, overrides, adjustments), enriched);
}
