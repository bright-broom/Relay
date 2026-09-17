export function canonicalLocale(value:unknown):string|null{
 if(typeof value!=='string'||value.length>100||!value.trim())return null;
 try{return Intl.getCanonicalLocales(value.trim())[0]??null;}catch{return null;}
}
export const normalizeLocale=(value:unknown)=>canonicalLocale(value)??'ja';
