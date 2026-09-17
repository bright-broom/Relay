import {normalizeLocale} from './locale';
export {canonicalLocale,normalizeLocale} from './locale';
import {createInstance} from 'i18next';
import {ja} from './locales/ja';
import {en} from './locales/en';
/** @public Catalog parity is verified by scripts/check.mjs and tests/i18n.mjs through esbuild. */
export {ja,en};
export const brand='Relay';
export const catalogs={ja,en};
export type MessageKey=keyof typeof ja;
export type Locale=string;
const engine=createInstance();
// Bundled resources and synchronous initialization: no network or mutable active language.
void engine.init({initAsync:false,lng:'en',fallbackLng:'en',keySeparator:false,nsSeparator:false,
 resources:Object.fromEntries(Object.entries(catalogs).map(([key,translation])=>[key,{translation}])),
 interpolation:{prefix:'{',suffix:'}',escapeValue:false,skipOnVariables:true},returnEmptyString:false});
export function translationLanguage(locale:Locale):keyof typeof catalogs{
 const base=normalizeLocale(locale).split('-')[0];return base in catalogs?base as keyof typeof catalogs:'en';
}
export function direction(locale:Locale):'ltr'|'rtl'{return engine.dir(normalizeLocale(locale));}
export function translate(locale:Locale,key:MessageKey,params:Record<string,string|number>={}):string{
 return String(engine.t(key,{...params,lng:normalizeLocale(locale),interpolation:{alwaysFormat:true,format:(value:unknown)=>typeof value==='number'?new Intl.NumberFormat(normalizeLocale(locale)).format(value):String(value)}}));
}
