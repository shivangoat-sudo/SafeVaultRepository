import Papa from 'papaparse';
import { genereerStabielTransactieId, type RawTransaction } from '../lib/btwSafeTypes';

/** Parse bank CSV structure only; no fiscal classification occurs here. */
export function parseCsvToRawTransactions(csvContent: string): RawTransaction[] {
  const str = csvContent.replace(/^\uFEFF/, '').trim();
  if (!str) return [];
  const delimiter = detectDelimiter(str.slice(0, str.indexOf('\n') === -1 ? str.length : str.indexOf('\n')));
  const parseResult = Papa.parse<string[]>(str, { delimiter, header: false, skipEmptyLines: 'greedy', dynamicTyping: false });
  if (parseResult.errors.length > 0) throw new Error(`CSV kon niet veilig worden gelezen: ${parseResult.errors[0].message}`);
  const rows = parseResult.data;
  if (!rows || rows.length <= 1) return [];

  const headers = rows[0].map((h) => String(h ?? '').trim().toLowerCase());
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
  const seenIds = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]; if (!row || row.length === 0) continue;
    const rawDatum = datumIdx !== -1 ? String(row[datumIdx] ?? '').trim() : '';
    const rawDescription = omschrijvingIdx !== -1 ? String(row[omschrijvingIdx] ?? '').trim() : '';
    const rawTegenrekening = tegenrekeningIdx !== -1 ? String(row[tegenrekeningIdx] ?? '').trim() : '';
    const rawAfBij = String(row[afBijIdx] ?? '').trim().toLowerCase();
    const rawBedrag = String(row[bedragIdx] ?? '').trim();
    const rawMemo = mededelingenIdx !== -1 ? String(row[mededelingenIdx] ?? '').trim() : '';
    if (!rawBedrag) continue;
    const parsedAmount = parseDutchAmount(rawBedrag);
    if (parsedAmount === null) throw new Error(`Ongeldig bedrag op CSV-regel ${i + 1}: ${rawBedrag}`);
    if (parsedAmount === 0) continue;
    const isIncome = ['bij', 'income', 'inkomsten', 'c', 'cr'].includes(rawAfBij);
    const isExpense = ['af', 'expense', 'uitgaven', 'd', 'dr'].includes(rawAfBij);
    if (!isIncome && !isExpense) throw new Error(`Onbekende transactierichting op CSV-regel ${i + 1}: ${rawAfBij || '(leeg)'}`);
    const amount = Math.abs(parsedAmount);
    const baseId = genereerStabielTransactieId({ date: rawDatum, description: rawDescription || 'Transactie', amount_incl: amount, tegenrekening_iban: rawTegenrekening || undefined });
    const occurrence = (seenIds.get(baseId) ?? 0) + 1; seenIds.set(baseId, occurrence);
    const stableId = occurrence === 1 ? baseId : `${baseId}_${occurrence}`;
    rawTxList.push({ id: stableId, date: rawDatum || undefined, description: rawDescription || 'Transactie', amount_incl: amount, type: isIncome ? 'income' : 'expense', memo: rawMemo || undefined, tegenrekening_iban: rawTegenrekening || undefined });
  }
  return rawTxList;
}

function detectDelimiter(headerLine: string): ',' | ';' { let inQuotes=false, semicolons=0, commas=0; for(let i=0;i<headerLine.length;i++){const ch=headerLine[i]; if(ch==='"'){if(inQuotes&&headerLine[i+1]==='"'){i++;continue;}inQuotes=!inQuotes;}else if(!inQuotes&&ch===';')semicolons++;else if(!inQuotes&&ch===',')commas++;}return semicolons>commas?';':','; }
function parseDutchAmount(input: string): number | null { let value=input.replace(/[€\s]/g,'').trim(); if(!value)return null; const negative=value.startsWith('-')||(value.startsWith('(')&&value.endsWith(')')); value=value.replace(/^[+-]/,'').replace(/^\(/,'').replace(/\)$/,''); if(!value||!/^\d[\d.,]*$/.test(value))return null; const comma=value.lastIndexOf(','),dot=value.lastIndexOf('.'); if(comma!==-1&&dot!==-1){const decimal=comma>dot?',':'.';const thousands=decimal===','?'.':',';value=value.split(thousands).join('').replace(decimal,'.');}else if(comma!==-1){const decimals=value.length-comma-1;value=decimals>=1&&decimals<=2?value.replace(',','.'):value.replace(/,/g,'');}else if(dot!==-1){const decimals=value.length-dot-1;value=decimals>=1&&decimals<=2?value:value.replace(/\./g,'');}const parsed=Number(value);if(!Number.isFinite(parsed))return null;return negative?-parsed:parsed;}
