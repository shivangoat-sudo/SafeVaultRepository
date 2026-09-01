import type { BoekhouderBeoordeling } from './btwFiscalSafeCore';

export interface FiscalUiOption {
  value: BoekhouderBeoordeling['classificatie'];
  label: string;
  sections: string;
  percentage?: 0 | 9 | 21;
}

export const FISCAL_CLASSIFICATION_OPTIONS: FiscalUiOption[] = [
 {value:'domestic_output_21',label:'Omzet binnenland — 21%',sections:'1a',percentage:21},
 {value:'domestic_output_9',label:'Omzet binnenland — 9%',sections:'1b',percentage:9},
 {value:'zero_rated_output',label:'Omzet — 0% / niet bij u belast',sections:'1e',percentage:0},
 {value:'eu_output_0',label:'Intracommunautaire levering/dienst',sections:'3b',percentage:0},
 {value:'non_eu_output_0',label:'Uitvoer buiten EU',sections:'3a',percentage:0},
 {value:'domestic_reverse_charge',label:'Binnenlandse verlegging — 21%',sections:'2a',percentage:21},
 {value:'domestic_reverse_charge',label:'Binnenlandse verlegging — 9%',sections:'2a',percentage:9},
 {value:'eu_reverse_charge',label:'Inkoop EU — verlegd — 21%',sections:'4b',percentage:21},
 {value:'eu_reverse_charge',label:'Inkoop EU — verlegd — 9%',sections:'4b',percentage:9},
 {value:'non_eu_reverse_charge',label:'Inkoop buiten EU — verlegd — 21%',sections:'4a',percentage:21},
 {value:'non_eu_reverse_charge',label:'Inkoop buiten EU — verlegd — 9%',sections:'4a',percentage:9},
 {value:'domestic_input_21',label:'Inkoop binnenland — 21% — 100% aftrekbaar',sections:'5b',percentage:21},
 {value:'domestic_input_9',label:'Inkoop binnenland — 9% — 100% aftrekbaar',sections:'5b',percentage:9},
 {value:'non_deductible_input_21',label:'Inkoop — 21% — niet aftrekbaar',sections:'geen',percentage:21},
 {value:'non_deductible_input_9',label:'Inkoop — 9% — niet aftrekbaar',sections:'geen',percentage:9},
 {value:'horeca_bua_9',label:'Horeca niet-aftrekbaar — 9%',sections:'geen',percentage:9},
 {value:'non_deductible_input_21',label:'Horeca niet-aftrekbaar — 21% (alcohol)',sections:'geen',percentage:21},
 {value:'zero_rated_input',label:'Inkoop — 0%',sections:'geen',percentage:0},
 {value:'exempt_output',label:'Vrijgestelde omzet',sections:'geen',percentage:0},
 {value:'exempt_input',label:'Vrijgestelde inkoop',sections:'geen',percentage:0},
 {value:'private_no_vat',label:'Privé-uitgave / opname — geen aftrek',sections:'geen',percentage:0}
];
