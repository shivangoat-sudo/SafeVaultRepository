import Papa from 'papaparse';
import { genereerStabielTransactieId, type RawTransaction } from '../lib/btwEngineSafe';

/** Parse bank CSV structure only; no fiscal classification occurs here. */
export function parseCsvToRawTransactions(csvContent: string): RawTransaction[] {
  const str = csvContent.replace(/^\uFEFF/, '').trim();
  if (!str) return [];
  const lines = str.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length <= 1) return [];
  const headerLine = lines[0];
  const semiCount = (headerLine.match(/;/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  const delimiter = semiCount >= commaCount ? ';' : ',';
  const parseResult = Papa.parse<string[]>(str, { delimiter, header: false, skipEmptyLines: true });
  if (parseResult.errors.length > 0) throw new Error(`CSV kon niet veilig worden gelezen: ${parseResult.errors[0].message}`);
  const rows = parseResult.data;
  if (!rows || rows.length <= 1) return [];
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const findIdx = (keywords: string[]) => { for (const kw of keywords) { const idx = headers.findIndex((h) => h.includes(kw)); if (idx !== -1) return idx; } return -1; };
  const datumIdx = findIdx(['datum', 'date']);
  const omschrijvingIdx = findIdx(['naam / omschrijving', 'omschrijving', 'naam', 'description', 'counterparty']);
  const tegenrekeningIdx = findIdx(['tegenrekening', 'iban']);
  const afBijIdx = findIdx(['af bij', 'af/bij', 'type', 'direction']);
  const bedragIdx = findIdx(['bedrag', 'amount']);
  const mededelingenIdx = findIdx(['mededelingen', 'memo', 'opmerking', 'notes']);
  if (bedragIdx === -1) throw new Error('CSV bevat geen herkenbare bedragkolom.');
  if (afBijIdx === -1) throw new Error('CSV bevat geen herkenbare richtingkolom (Af Bij/type/direction).');
  const rawTxList: RawTransaction[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const rawDatum = datumIdx !== -1 ? String(row[datumIdx] ?? '').trim() : '';
    const rawDescription = omschrijvingIdx !== -1 ? String(row[omschrijvingIdx] ?? '').trim() : '';
    const rawTegenrekening = tegenrekeningIdx !== -1 ? String(row[tegenrekeningIdx] ?? '').trim() : '';
    const rawAfBij = String(row[afBijIdx] ?? '').trim().toLowerCase();
    const rawBedrag = String(row[bedragIdx] ?? '').trim();
    const rawMemo = mededelingenIdx !== -1 ? String(row[mededelingenIdx] ?? '').trim() : '';
    if (!rawBedrag) continue;
    const cleanAmtStr = rawBedrag.replace('€', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const parsedAmount = Number(cleanAmtStr);
    if (!Number.isFinite(parsedAmount)) throw new Error(`Ongeldig bedrag op CSV-regel ${i + 1}: ${rawBedrag}`);
    if (parsedAmount === 0) continue;
    const isIncome = rawAfBij === 'bij' || rawAfBij === 'income' || rawAfBij === 'inkomsten' || rawAfBij === 'c' || rawAfBij === 'cr';
    const isExpense = rawAfBij === 'af' || rawAfBij === 'expense' || rawAfBij === 'uitgaven' || rawAfBij === 'd' || rawAfBij === 'dr';
    if (!isIncome && !isExpense) throw new Error(`Onbekende transactierichting op CSV-regel ${i + 1}: ${rawAfBij || '(leeg)'}`);
    const amount = Math.abs(parsedAmount);
    const stableId = genereerStabielTransactieId({ date: rawDatum, description: rawDescription || 'Transactie', amount_incl: amount, tegenrekening_iban: rawTegenrekening || undefined });
    rawTxList.push({ id: stableId, date: rawDatum || undefined, description: rawDescription || 'Transactie', amount_incl: amount, type: isIncome ? 'income' : 'expense', memo: rawMemo || undefined, tegenrekening_iban: rawTegenrekening || undefined });
  }
  return rawTxList;
}
