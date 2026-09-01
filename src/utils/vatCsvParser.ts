import Papa from 'papaparse';
import { genereerStabielTransactieId, type BtwPercentage, type RawTransaction } from '../lib/btwSafeTypes';

export function parseCsvToRawTransactions(csvContent: string): RawTransaction[] {
  if (typeof csvContent !== 'string') throw new Error('CSV kan niet veilig worden gelezen: ongeldige invoer.');
  const str = csvContent.replace(/^\uFEFF/, '').trim();
  if (!str) return [];
  const firstLineEnd = str.indexOf('\n');
  const headerLine = firstLineEnd === -1 ? str : str.slice(0, firstLineEnd);
  const delimiter = detectDelimiter(headerLine);
  const result = Papa.parse<string[]>(str, { delimiter, header: false, skipEmptyLines: 'greedy', dynamicTyping: false });
  if (result.errors.length) throw new Error(`CSV kon niet veilig worden gelezen: ${result.errors[0].message}`);
  const rows = result.data;
  if (rows.length <= 1) return [];
  const headers = rows[0].map(h => String(h ?? '').replace(/^\uFEFF/, '').trim().toLowerCase());
  const findIdx = (keywords: string[]) => keywords.map(k => headers.findIndex(h => h === k || h.includes(k))).find(i => i !== -1) ?? -1;
  const datumIdx=findIdx(['datum','date']);
  const descriptionIdx=findIdx(['naam / omschrijving','omschrijving','description','counterparty','naam']);
  const counterpartyIdx=findIdx(['tegenrekening','iban']);
  const directionIdx=findIdx(['af bij','af/bij','direction','type']);
  const amountIdx=findIdx(['bedrag','amount']);
  const memoIdx=findIdx(['mededelingen','memo','opmerking','notes']);
  const submittedExclIdx=findIdx(['bedrag excl btw','bedrag exclusief btw','amount excl vat','netto bedrag','grondslag']);
  const submittedVatIdx=findIdx(['btw bedrag','btw-bedrag','vat amount','omzetbelasting']);
  const submittedRateIdx=findIdx(['btw percentage','btw-percentage','btw tarief','btw-tarief','vat rate','vat percentage']);
  const submittedSectionIdx=findIdx(['btw rubriek','btw-rubriek','aangifterubriek','aangifte rubriek','rubriek']);
  if(amountIdx===-1) throw new Error('CSV bevat geen herkenbare bedragkolom.');
  if(directionIdx===-1) throw new Error('CSV bevat geen herkenbare richtingkolom (Af Bij/type/direction).');
  const output: RawTransaction[]=[]; const seen=new Map<string,number>();
  for(let i=1;i<rows.length;i++){
    const row=rows[i]; if(!row?.length) continue;
    const date=datumIdx>=0?String(row[datumIdx]??'').trim():'';
    const description=descriptionIdx>=0?String(row[descriptionIdx]??'').trim():'Transactie';
    const iban=counterpartyIdx>=0?String(row[counterpartyIdx]??'').trim():'';
    const direction=String(row[directionIdx]??'').trim().toLowerCase();
    const rawAmount=String(row[amountIdx]??'').trim();
    const memo=memoIdx>=0?String(row[memoIdx]??'').trim():'';
    if(!rawAmount) continue;
    const parsed=parseDutchAmount(rawAmount);
    if(parsed===null) throw new Error(`Ongeldig bedrag op CSV-regel ${i+1}: ${rawAmount}`);
    if(parsed===0) continue;
    const income=['bij','income','inkomsten','credit','cr','c'].includes(direction);
    const expense=['af','expense','uitgaven','debit','dr','d'].includes(direction);
    if(!income&&!expense) throw new Error(`Onbekende transactierichting op CSV-regel ${i+1}: ${direction||'(leeg)'}`);
    const amount=Math.abs(parsed);
    const base=genereerStabielTransactieId({date,description:description||'Transactie',amount_incl:amount,tegenrekening_iban:iban||undefined});
    const occurrence=(seen.get(base)??0)+1; seen.set(base,occurrence);
    const rawExcl=submittedExclIdx>=0?String(row[submittedExclIdx]??'').trim():'';
    const rawVat=submittedVatIdx>=0?String(row[submittedVatIdx]??'').trim():'';
    const rawRate=submittedRateIdx>=0?String(row[submittedRateIdx]??'').trim().replace('%',''):'';
    const parsedExcl=rawExcl?parseDutchAmount(rawExcl):null;
    const parsedVat=rawVat?parseDutchAmount(rawVat):null;
    const parsedRate=rawRate?Number(rawRate):null;
    if(rawExcl&&parsedExcl===null) throw new Error(`Ongeldig exclusief btw-bedrag op CSV-regel ${i+1}: ${rawExcl}`);
    if(rawVat&&parsedVat===null) throw new Error(`Ongeldig btw-bedrag op CSV-regel ${i+1}: ${rawVat}`);
    if(rawRate&&![0,9,21].includes(parsedRate??-1)) throw new Error(`Ongeldig btw-tarief op CSV-regel ${i+1}: ${rawRate}%`);
    const submittedSection=submittedSectionIdx>=0?String(row[submittedSectionIdx]??'').trim()||undefined:undefined;
    output.push({id:occurrence===1?base:`${base}_${occurrence}`,date:date||undefined,description:description||'Transactie',memo:memo||undefined,amount_incl:amount,type:income?'income':'expense',tegenrekening_iban:iban||undefined,submitted_amount_excl:parsedExcl??undefined,submitted_vat_amount:parsedVat??undefined,submitted_vat_percentage:parsedRate as BtwPercentage|undefined,submitted_section:submittedSection});
  }
  return output;
}

function detectDelimiter(line:string):','|';'{let quoted=false,commas=0,semicolons=0;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){i++;continue;}quoted=!quoted;}else if(!quoted&&ch===',')commas++;else if(!quoted&&ch===';')semicolons++;}return semicolons>commas?';':',';}

export function parseDutchAmount(input:string):number|null{
 let v=input.replace(/[€\s\u00A0]/g,'').trim(); if(!v)return null;
 let negative=false; if(v.startsWith('(')&&v.endsWith(')')){negative=true;v=v.slice(1,-1);}else if(v.startsWith('-')){negative=true;v=v.slice(1);}else if(v.startsWith('+'))v=v.slice(1);
 if(!v||!/^[0-9][0-9.,]*$/.test(v))return null;
 const comma=v.lastIndexOf(','),dot=v.lastIndexOf('.');
 if(comma>=0&&dot>=0){const decimal=comma>dot?',':'.';const thousands=decimal===','?'.':',';v=v.split(thousands).join('').replace(decimal,'.');}
 else if(comma>=0){const digits=v.length-comma-1;v=digits>=1&&digits<=2?v.replace(',','.'):v.replace(/,/g,'');}
 else if(dot>=0){const digits=v.length-dot-1;v=digits===3?v.replace(/\./g,''):digits>=1&&digits<=2?v:v.replace(/\./g,'');}
 const n=Number(v); if(!Number.isFinite(n))return null; return negative?-n:n;
}
