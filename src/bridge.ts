import { calculateFiscalVatReport, tweeKolommenWeergave, berekenBetrouwbaarheidsscore, type FiscalReport } from "./lib/btwFiscalSafeNormalized";
import { parseCsvToRawTransactions } from "./utils/vatCsvParser";

export type ReviewItem = { description:string; amountIncl:number; direction:string; reviewReason?:string; legalBasis:string };
export type AuditItem = { description:string; amountIncl:number; effectiveDirection:string; direction:string; vatRate:number|null; legalBasis:string };
export type EngineResult = {
  transactions: Record<string,unknown>[]; items:Record<string,unknown>[]; adjustments:Record<string,unknown>[];
  metrics:{totaal_incl_21:number;totaal_excl_21:number;totaal_incl_9:number;totaal_excl_9:number;totale_btw_21:number;totale_btw_9:number;niet_aftrekbare_btw:number;btw_eindsaldo:number;vatReport?:FiscalReport;totalRevenueIncl:number;totalRevenueExcl:number;outputVat21:number;outputVat9:number;totalOutputVat:number;deductibleInputVat21:number;deductibleInputVat9:number;totalDeductibleInputVat:number;nonDeductibleVatBUA:number;euVerlegdVat:number;netVatResult:number;totalRowsProcessed:number;rowsRequiringReview:number};
  validation:{status:string;validation_runs:number}; reviewQueue:ReviewItem[]; auditTrail:AuditItem[];
};
const round2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
function toLegacyMetrics(report:FiscalReport):EngineResult['metrics']{
  const tx=report.transactions;
  const income21=tx.filter(t=>t.section==='1a'),income9=tx.filter(t=>t.section==='1b');
  const totalRevenueIncl=round2(tx.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount_incl_input,0));
  const totalRevenueExcl=round2(tx.filter(t=>t.type==='income').reduce((s,t)=>s+(t.amount_excl??0),0));
  return {totaal_incl_21:round2(income21.reduce((s,t)=>s+t.amount_incl_input,0)),totaal_excl_21:round2(income21.reduce((s,t)=>s+(t.amount_excl??0),0)),totaal_incl_9:round2(income9.reduce((s,t)=>s+t.amount_incl_input,0)),totaal_excl_9:round2(income9.reduce((s,t)=>s+(t.amount_excl??0),0)),totale_btw_21:report.overzicht.output.domestic21,totale_btw_9:report.overzicht.output.domestic9,niet_aftrekbare_btw:report.nonDeductible,btw_eindsaldo:report.netto,vatReport:report,totalRevenueIncl,totalRevenueExcl,outputVat21:report.overzicht.output.domestic21,outputVat9:report.overzicht.output.domestic9,totalOutputVat:report.overzicht.output.total,deductibleInputVat21:report.overzicht.input.domestic21,deductibleInputVat9:report.overzicht.input.domestic9,totalDeductibleInputVat:report.overzicht.input.total,nonDeductibleVatBUA:report.nonDeductible,euVerlegdVat:report.overzicht.output.euReverse+report.overzicht.output.nonEuReverse,netVatResult:report.netto,totalRowsProcessed:report.audit.input,rowsRequiringReview:report.audit.unresolved};
}
export async function processFile(file:File):Promise<EngineResult>{
  const raw=parseCsvToRawTransactions(await file.text()); if(!raw.length)throw new Error('Geen transacties uit het CSV-bestand kunnen worden gelezen.');
  const report=calculateFiscalVatReport(raw); const escalation=tweeKolommenWeergave(report).twijfelgevallen;
  const reviewQueue:ReviewItem[]=escalation.map(t=>({description:t.description??'',amountIncl:t.amount_incl_input,direction:t.type==='income'?'INKOMST':'UITGAVE',reviewReason:t.reason,legalBasis:t.rule.explanation}));
  const auditTrail:AuditItem[]=report.transactions.map(t=>({description:t.description??'',amountIncl:t.amount_incl_input,effectiveDirection:t.type==='income'?'INKOMST':'UITGAVE',direction:t.type==='income'?'INKOMST':'UITGAVE',vatRate:t.vat.status==='known'?t.vat.rate:null,legalBasis:t.rule.explanation}));
  return {transactions:report.transactions as unknown as Record<string,unknown>[],items:[],adjustments:[],metrics:toLegacyMetrics(report),validation:{status:report.audit.ok?'SUCCESS_SAFE_BOUNDARY':'REVIEW_REQUIRED',validation_runs:1},reviewQueue,auditTrail};
}
export async function processFiles(files:File[]):Promise<EngineResult>{
  if(files.length===0)return {transactions:[],items:[],adjustments:[],metrics:{totaal_incl_21:0,totaal_excl_21:0,totaal_incl_9:0,totaal_excl_9:0,totale_btw_21:0,totale_btw_9:0,niet_aftrekbare_btw:0,btw_eindsaldo:0,totalRevenueIncl:0,totalRevenueExcl:0,outputVat21:0,outputVat9:0,totalOutputVat:0,deductibleInputVat21:0,deductibleInputVat9:0,totalDeductibleInputVat:0,nonDeductibleVatBUA:0,euVerlegdVat:0,netVatResult:0,totalRowsProcessed:0,rowsRequiringReview:0},validation:{status:'EMPTY_INPUT',validation_runs:0},reviewQueue:[],auditTrail:[]};
  const texts=await Promise.all(files.map(f=>f.text())); return processFile(new File([texts.join('\n')],'combined.csv',{type:'text/csv'}));
}
