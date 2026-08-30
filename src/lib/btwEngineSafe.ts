import {
  calculateVatReport as calculateLegacyVatReport,
  autoClassify,
  type VatReport,
  type RawTransaction,
  type ClassificationMap,
  type AiProposalMap,
  type CalculateVatReportOptions,
  type BoekhouderBeoordeling,
  type ClassificationKey,
  type ProcessedTransaction,
  type AppliedRule,
  type ClassificationSource,
  type Zekerheid,
  type BtwPercentage,
} from './btwEngine';

export type {
  VatReport,
  RawTransaction,
  ClassificationMap,
  AiProposalMap,
  CalculateVatReportOptions,
  BoekhouderBeoordeling,
  BtwPercentage,
};

export {
  tweeKolommenWeergave,
  genereerStabielTransactieId,
  BOEKHOUDER_PERCENTAGE_OPTIES,
  berekenBetrouwbaarheidsscore,
} from './btwEngine';

/**
 * Safety facade around the existing deterministic engine.
 *
 * The legacy engine historically treated an absent match as a confident 21%
 * result. This facade deliberately does NOT do that. A fiscal conclusion is
 * included in the financial totals only when there is a concrete rule match
 * or an explicit accountant override.
 *
 * AI proposals are evidence only here. A language model can suggest a
 * classification; it cannot prove the underlying tax facts from a bank
 * description alone.
 */
const STRONG_SOURCES = new Set<ClassificationSource>([
  'automatisch_regelgebaseerd',
  'automatisch_omschrijving',
]);

const TWIJFEL_CLASSIFICATION = 'twijfel_onvoldoende_informatie' as ClassificationKey;

function unresolvedTransaction(tx: RawTransaction, reason: string): ProcessedTransaction {
  const applied_rule: AppliedRule = {
    classification: TWIJFEL_CLASSIFICATION,
    wetsartikel: 'Niet automatisch vast te stellen op basis van beschikbare transactiegegevens',
    omschrijving: 'Onvoldoende informatie om de fiscale behandeling betrouwbaar vast te stellen. Deze regel wordt niet meegenomen in de BTW-totalen totdat een boekhouder de classificatie bevestigt.',
    korte_toelichting: reason,
    rubriek: 'Twijfelgeval — niet meegenomen in financiële BTW-totalen',
  };
  return {
    id: tx.id,
    date: tx.date,
    type: tx.type,
    description: tx.description,
    classification: TWIJFEL_CLASSIFICATION,
    rate: 0,
    amount_incl_input: tx.amount_incl,
    bedrag_excl: tx.amount_incl,
    btw_bedrag: 0,
    bedrag_incl: tx.amount_incl,
    _bedrag_excl_precisie: tx.amount_incl,
    _btw_bedrag_precisie: 0,
    aftrekbaar: false,
    applied_rule,
    herkend: false,
    herkenningsbron: reason,
    classificatie_bron: 'conflict_gedetecteerd',
    zekerheid: 'laag',
  };
}

function reasonForUnresolved(tx: RawTransaction, auto: ReturnType<typeof autoClassify>): string {
  if (auto.bron === 'conflict_gedetecteerd') return auto.herkenningsbron;
  if (auto.bron === 'automatisch_gecombineerd') {
    return 'De beschikbare signalen wijzen mogelijk op een bijzondere/buitenlandse behandeling, maar zijn onvoldoende om de fiscale behandeling zonder onderliggende factuur betrouwbaar vast te stellen.';
  }
  if (auto.bron === 'standaard_geen_uitzondering') {
    return 'Geen voldoende specifiek fiscaal signaal gevonden. De engine past daarom niet automatisch 21% toe; controle van de onderliggende factuur/omschrijving is vereist.';
  }
  return auto.herkenningsbron || `Onvoldoende fiscale informatie voor transactie ${tx.id}.`;
}

function isStrongAutomatic(auto: ReturnType<typeof autoClassify>): boolean {
  return auto.herkend && STRONG_SOURCES.has(auto.bron);
}

export function calculateVatReport(
  rawTransactions: RawTransaction[],
  options: CalculateVatReportOptions = {}
): VatReport {
  const classifications = options.classifications ?? {};
  const percentageOverrides = options.percentageOverrides ?? {};

  // Reuse the existing engine only to identify explicit summary rows. No
  // legacy financial total is trusted for unresolved transactions.
  const structural = calculateLegacyVatReport(rawTransactions, {
    classifications,
    aiProposals: {},
    percentageOverrides,
  });
  const ignoredIds = new Set(structural.genegeerde_samenvattingsregels.map((x) => x.raw.id));
  const candidates = rawTransactions.filter((tx) => !ignoredIds.has(tx.id));

  const trusted: RawTransaction[] = [];
  const unresolved: ProcessedTransaction[] = [];

  for (const tx of candidates) {
    if (classifications[tx.id] || percentageOverrides[tx.id]) {
      trusted.push(tx);
      continue;
    }
    const auto = autoClassify(tx.description, tx.type, tx.memo, tx.tegenrekening_iban);
    if (isStrongAutomatic(auto)) trusted.push(tx);
    else unresolved.push(unresolvedTransaction(tx, reasonForUnresolved(tx, auto)));
  }

  // Only trusted rows enter the financial engine. A fallback 21% classification
  // can therefore never influence totals for an unresolved transaction.
  const report = calculateLegacyVatReport(trusted, {
    classifications,
    aiProposals: {},
    percentageOverrides,
  });

  const transactions = [...report.transactions, ...unresolved];
  const totalInput = candidates.length;
  const trustedCount = report.transactions.length;
  const unresolvedCount = unresolved.length;
  const problemen = [...report.audit.problemen];

  if (trustedCount + unresolvedCount !== totalInput) {
    problemen.push(`Regelaantal-controle faalt: zeker (${trustedCount}) + twijfelgevallen (${unresolvedCount}) != aangeleverde fiscale transacties (${totalInput}).`);
  }

  const expectedNet = Math.round((report.overzicht.verschuldigd.totaal - report.overzicht.aftrekbaar.totaal + Number.EPSILON) * 100) / 100;
  if (expectedNet !== report.overzicht.netto_btw) {
    problemen.push(`Eindcontrole faalt: verschuldigd (${report.overzicht.verschuldigd.totaal}) - aftrekbaar (${report.overzicht.aftrekbaar.totaal}) != netto (${report.overzicht.netto_btw}).`);
  }

  if (unresolved.some((t) => t._btw_bedrag_precisie !== 0)) {
    problemen.push('Safety-controle faalt: een twijfelgeval bevat een niet-nul BTW-bedrag.');
  }

  return {
    ...report,
    transactions,
    herkenning: {
      ...report.herkenning,
      totaal_transacties: totalInput,
      automatisch_herkend: trustedCount,
      standaard_toegepast: unresolvedCount,
      percentage_herkend: totalInput === 0 ? 0 : Math.round((trustedCount / totalInput) * 10000) / 100,
      controle_aanbevolen: unresolved,
    },
    audit: { ok: problemen.length === 0, problemen },
  };
}

export function isTwijfelgeval(t: ProcessedTransaction): boolean {
  return t.herkend === false || t.zekerheid === 'laag';
}

export function vindEscalatieKandidaten(report: VatReport) {
  return report.transactions.filter(isTwijfelgeval).map((t) => ({
    transactie: t,
    aanbevolen_zoekacties: [
      `Controleer de onderliggende factuur/bon voor "${t.description ?? ''}".`,
      'Controleer of de factuur een BTW-tarief, BTW-bedrag, BTW-id en eventuele tekst "btw verlegd" bevat.',
      'Controleer bij buitenlandse prestaties de vestigingsplaats, B2B/B2C-status en de toepasselijke verleggingsregeling voordat de transactie definitief wordt geclassificeerd.',
    ],
  }));
}
