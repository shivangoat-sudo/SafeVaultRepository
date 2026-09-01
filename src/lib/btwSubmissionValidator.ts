export type AangifteRubriek = '1a'|'1b'|'1c'|'1d'|'1e'|'2a'|'3a'|'3b'|'4a'|'4b'|'5a'|'5b';

export interface IngediendeBtwPost {
  id: string;
  amount_incl?: number | null;
  amount_excl?: number | null;
  btw_bedrag?: number | null;
  btw_percentage?: number | null;
  rubriek?: AangifteRubriek | null;
  type?: 'income'|'expense'|null;
  omschrijving?: string | null;
}

export type BtwControleStatus = 'correct'|'afwijking'|'onvoldoende_gegevens';
export interface BtwControleResultaat {
  id: string; status: BtwControleStatus;
  ingediend: { amount_incl:number|null; amount_excl:number|null; btw_bedrag:number|null; btw_percentage:number|null; rubriek:AangifteRubriek|null };
  verwacht: { amount_excl:number|null; btw_bedrag:number|null; btw_percentage:number|null };
  afwijkingen: string[]; reden: string;
}

const money=(n:number|null|undefined)=>n==null?null:Math.round(n*100)/100;
const equalMoney=(a:number|null,b:number|null)=>a===null||b===null?a===b:Math.abs(a-b)<0.005;
const allowedRate=(n:number|null|undefined,rubriek:AangifteRubriek|null)=>n===0||n===9||n===21||(n===13&&rubriek==='1c');

/** Controleert de BTW die in het aangeleverde bestand staat. Een factuurbestand is hiervoor niet vereist. */
export function controleerIngediendeBtwPost(post:IngediendeBtwPost):BtwControleResultaat {
  const incl=money(post.amount_incl), excl=money(post.amount_excl), declaredVat=money(post.btw_bedrag);
  const rate=post.btw_percentage==null?null:Number(post.btw_percentage); const rubriek=post.rubriek??null; const afwijkingen:string[]=[];
  if(incl===null&&excl===null)afwijkingen.push('Geen bedrag inclusief of exclusief btw aangeleverd.');
  if(declaredVat!==null&&declaredVat<0)afwijkingen.push('Het opgegeven btw-bedrag mag niet negatief zijn.');
  if(rate!==null&&!allowedRate(rate,rubriek))afwijkingen.push(`Btw-tarief ${rate}% is voor deze rubriek niet toegestaan.`);
  if(rubriek==='1c'&&rate!==13)afwijkingen.push('Rubriek 1c moet in deze controle als het 13%-forfait worden aangeleverd.');
  if(rubriek==='1d')afwijkingen.push('Rubriek 1d is een expliciete correctie voor privégebruik en wordt niet als gewone transactieregel gevalideerd.');
  let expectedExcl:number|null=excl, expectedVat:number|null=declaredVat;
  if(incl!==null&&rate!==null&&allowedRate(rate,rubriek)){expectedVat=money(rate===0?0:incl*rate/(100+rate));expectedExcl=money(incl-expectedVat);}
  else if(excl!==null&&rate!==null&&allowedRate(rate,rubriek)){expectedVat=money(rate===0?0:excl*rate/100);expectedExcl=excl;}
  if(incl!==null&&expectedExcl!==null&&expectedVat!==null&&!equalMoney(incl,money(expectedExcl+expectedVat)))afwijkingen.push(`Grondslag + btw (${money(expectedExcl+expectedVat)}) sluit niet aan op inclusief bedrag (${incl}).`);
  if(declaredVat!==null&&expectedVat!==null&&!equalMoney(declaredVat,expectedVat))afwijkingen.push(`Aangegeven btw €${declaredVat.toFixed(2)} wijkt af van de berekende btw €${expectedVat.toFixed(2)}.`);
  if(excl!==null&&expectedExcl!==null&&!equalMoney(excl,expectedExcl))afwijkingen.push(`Aangegeven grondslag €${excl.toFixed(2)} wijkt af van de berekende grondslag €${expectedExcl.toFixed(2)}.`);
  if(rate===0&&declaredVat!==null&&!equalMoney(declaredVat,0))afwijkingen.push('Bij 0% btw hoort €0,00 btw.');
  if(rubriek==='1a'&&rate!==21)afwijkingen.push('Rubriek 1a hoort bij binnenlandse omzet tegen 21%.');
  if(rubriek==='1b'&&rate!==9)afwijkingen.push('Rubriek 1b hoort bij binnenlandse omzet tegen 9%.');
  if(rubriek==='1e'&&rate!==0)afwijkingen.push('Rubriek 1e moet zonder Nederlandse btw worden aangeleverd.');
  if((rubriek==='2a'||rubriek==='4a'||rubriek==='4b')&&rate!==21&&rate!==9&&rate!==0)afwijkingen.push(`${rubriek} heeft een ongeldig btw-tarief.`);
  if(rubriek==='5b'&&post.type==='income')afwijkingen.push('Rubriek 5b is voor aftrekbare voorbelasting, niet voor omzet.');
  if(rubriek==='5a'&&post.type==='expense')afwijkingen.push('Rubriek 5a is verschuldigde btw uit rubrieken 1 t/m 4, niet de gewone inkoop-voorbelasting.');
  const missingCore=(incl===null&&excl===null)||rate===null||declaredVat===null;
  const status:BtwControleStatus=missingCore?'onvoldoende_gegevens':afwijkingen.length?'afwijking':'correct';
  return {id:post.id,status,ingediend:{amount_incl:incl,amount_excl:excl,btw_bedrag:declaredVat,btw_percentage:rate,rubriek},verwacht:{amount_excl:expectedExcl,btw_bedrag:expectedVat,btw_percentage:allowedRate(rate,rubriek)?rate:null},afwijkingen,reden:missingCore?'Niet genoeg aangeleverde gegevens om de btw-post volledig te controleren.':afwijkingen.length?'De ingediende btw-behandeling wijkt af van de controleberekening of rubrieksregels.':'De ingediende btw-behandeling sluit aan op de controleberekening.'};
}

export function controleerIngediendeBtw(posts:IngediendeBtwPost[]){const resultaten=posts.map(controleerIngediendeBtwPost);return{resultaten,correct:resultaten.filter(r=>r.status==='correct'),afwijkingen:resultaten.filter(r=>r.status==='afwijking'),onvoldoendeGegevens:resultaten.filter(r=>r.status==='onvoldoende_gegevens'),aantal:resultaten.length,aantalCorrect:resultaten.filter(r=>r.status==='correct').length,aantalAfwijkingen:resultaten.filter(r=>r.status==='afwijking').length,aantalOnvoldoendeGegevens:resultaten.filter(r=>r.status==='onvoldoende_gegevens').length};}
