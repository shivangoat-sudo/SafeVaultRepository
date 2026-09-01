export type BtwPercentage = 0 | 9 | 21;
export type TransactionType = 'income' | 'expense';

export interface RawTransaction {
  id: string;
  date?: string;
  description?: string;
  memo?: string;
  amount_incl: number;
  type: TransactionType;
  tegenrekening_iban?: string;
}

export function genereerStabielTransactieId(input: Pick<RawTransaction, 'date' | 'description' | 'amount_incl' | 'tegenrekening_iban'>): string {
  const normalized = [input.date ?? '', input.description ?? '', input.amount_incl.toFixed(2), input.tegenrekening_iban ?? '']
    .map(value => value.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `tx_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
