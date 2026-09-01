import type { BoekhouderBeoordeling } from './btwFiscalSafeFinalV2';

export const FISCAL_CLASSIFICATION_OPTIONS: Array<{value: BoekhouderBeoordeling['classificatie'];label:string;sections:string}> = [
 {value:'domestic_output_21',label:'Omzet binnenland — 21%',sections:'1a'},
 {value:'domestic_output_9',label:'Omzet binnenland — 9%',sections:'1b'},
 {value:'zero_rated_output',label:'Omzet — 0% / niet bij u belast',sections:'1e'},
 {value:'eu_output_0',label:'Intracommunautaire levering/dienst',sections:'3b'},
 {value:'non_eu_output_0',label:'Uitvoer buiten EU',sections:'3a'},
 {value:'domestic_reverse_charge',label:'Binnenlandse verlegging — 21%',sections:'2a'},
 {value:'eu_reverse_charge',label:'Inkoop EU — verlegd — 21%',sections:'4b'},
 {value:'non_eu_reverse_charge',label:'Inkoop buiten EU — verlegd — 21%',sections:'4a'},
 {value:'domestic_input_21',label:'Inkoop binnenland — 21% aftrekbaar',sections:'5b'},
 {value:'domestic_input_9',label:'Inkoop binnenland — 9% aftrekbaar',sections:'5b'},
 {value:'non_deductible_input_21',label:'Inkoop — 21% niet aftrekbaar',sections:'geen'},
 {value:'non_deductible_input_9',label:'Inkoop — 9% niet aftrekbaar',sections:'geen'},
 {value:'horeca_bua_9',label:'Horeca — niet aftrekbaar',sections:'geen'},
 {value:'zero_rated_input',label:'Inkoop — 0%',sections:'geen'},
 {value:'exempt_output',label:'Vrijgestelde omzet',sections:'geen'},
 {value:'exempt_input',label:'Vrijgestelde inkoop',sections:'geen'},
 {value:'private_no_vat',label:'Privé-uitgave / opname',sections:'geen'}
];
