import {normalizeLocale,translationLanguage,direction,translate,type MessageKey} from './messages';
export function createUiContext(requested:unknown){
 const locale=normalizeLocale(requested),language=translationLanguage(locale);
 const number=(value:number|bigint,options:Intl.NumberFormatOptions={})=>new Intl.NumberFormat(locale,options).format(value);
 const digits=new Map<string,string>();
 for(const tag of [locale,'ar-u-nu-arab','fa-u-nu-arabext','en-u-nu-fullwide'])for(let value=0;value<10;value++)digits.set(new Intl.NumberFormat(tag,{useGrouping:false}).format(value),String(value));
 const normalizeDigits=(value:string)=>[...value].map(char=>digits.get(char)??char).join('');
 return Object.freeze({normalizeDigits,locale,language,dir:direction(locale),fallback:locale.split('-')[0]!==language,
  t:(key:MessageKey,params:Record<string,string|number>={})=>translate(locale,key,params),
  number,
  money:(value:string,currency='JPY')=>number(BigInt(value),{style:'currency',currency,maximumFractionDigits:0}),
  date:(value:Date,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(locale,options).format(value),
  dateRange:(start:Date,end:Date,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(locale,options).formatRange(start,end),
 });
}
export type UiContext=ReturnType<typeof createUiContext>;
export {hasLocalePreference,browserLocale,persistLocale} from './browser';
