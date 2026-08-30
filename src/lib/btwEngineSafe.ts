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
  vindEscalatieKandidaten,
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
 * AI proposals are retained as evidence/metadata by the legacy engine, but
 * they are never accepted as an automatic fiscal conclusion here. A language
 * model can suggest a classification; it cannot prove the underlying tax
 * facts from a bank description alone.
 */

const STRONG_SOURCES = new Set<ClassificationSource>([
  'automatisch_regelgebaseerd',
  'automatisch_omschrijving',
]);

const TWijfEL_CLASSIFICATION = 'twijfel_onvoldoende_informatie' as ClassificationKey;

function unresolvedTransaction(tx: RawTransaction, reason: string): ProcessedTransaction {
  const applied_rule: AppliedRule = {
    classification: TWijfEL_CLASSIFICATION,
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
    classification: TWijfEL_CLASSIFICATION,
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
    zekerheid: 'laag' as Zekerheid,
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

  // Let the legacy engine identify explicit summary rows. We reuse only this
  // structural filtering; no legacy fiscal totals are trusted for unresolved
  // rows.
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
    const manual = classifications[tx.id];
    if (manual) {
      trusted.push(tx);
      continue;
    }

    const override = percentageOverrides[tx.id];
    if (override) {
      trusted.push(tx);
      continue;
    }

    const auto = autoClassify(tx.description, tx.type, tx.memo, tx.tegenrekening_iban);
    if (isStrongAutomatic(auto)) {
      trusted.push(tx);
    } else {
      unresolved.push(unresolvedTransaction(tx, reasonForUnresolved(tx, auto)));
    }
  }

  // Recalculate ONLY the trusted rows. This means unresolved transactions can
  // never alter a financial total, even if the legacy engine's fallback would
  // have classified them as 21%.
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
    problemen.push(
      `Regelaantal-controle faalt: zeker (${trustedCount}) + twijfelgevallen (${unresolvedCount}) != aangeleverde fiscale transacties (${totalInput}).`
    );
  }

  // The report returned by the legacy engine is the sole source for trusted
  // financial totals. Explicitly recompute the final identity from those
  // displayed totals so a future frontend cannot accidentally use a mixed
  // tariff total.
  const expectedNet = Math.round((report.overzicht.verschuldigd.totaal - report.overzicht.aftrekbaar.totaal + Number.EPSILON) * 100) / 100;
  if (expectedNet !== report.overzicht.netto_btw) {
    problemen.push(
      `Eindcontrole faalt: verschuldigd (${report.overzicht.verschuldigd.totaal}) - aftrekbaar (${report.overzicht.aftrekbaar.totaal}) != netto (${report.overzicht.netto_btw}).`
    );
  }

  // No unresolved row may appear in the financial totals. This is checked
  // structurally as well as through the fact that the legacy calculation only
  // received `trusted` rows.
  if (unresolved.some((t) => t._btw_bedrag_precisie !== 0)) {
    problemen.push('Safety-controle faalt: een twijfelgeval bevat een niet-nul BTW-bedrag en mag daarom niet als unresolved placeholder worden gebruikt.');
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
    audit: {
      ok: problemen.length === 0,
      problemen,
    },
  };
}

export function isTwijfelgeval(t: ProcessedTransaction): boolean {
  return t.herkend === false || t.zekerheid === 'laag';
}

export function vindEscalatieKandidaten(report: VatReport) {
  return report.transactions
    .filter(isTwijfelgeval)
    .map((t) => ({
      transactie: t,
      aanbevolen_zoekacties: [
        `Controleer de onderliggende factuur/bon voor "${t.description ?? ''}".`,
        'Controleer of de factuur een BTW-tarief, BTW-bedrag, BTW-id en eventuele tekst "btw verlegd" bevat.',
        'Controleer bij buitenlandse prestaties de vestigingsplaats, B2B/B2C-status en de toepasselijke verleggingsregeling voordat de transactie definitief wordt geclassificeerd.',
      ],
    }));
}
