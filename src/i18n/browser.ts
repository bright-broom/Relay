import {normalizeLocale} from './locale.js';
function localeCookie(){
 try{return document.cookie.split('; ').find(value=>value.startsWith('relay-locale='))?.slice(13);}catch{return undefined;}
}
export function hasLocalePreference(){return new URLSearchParams(location.search).has('lang')||Boolean(localeCookie());}
export function browserLocale(){
 return normalizeLocale(new URLSearchParams(location.search).get('lang')??localeCookie()??navigator.language);
}
export function persistLocale(locale:string){
 try{if(location.protocol==='https:')document.cookie=`relay-locale=${normalizeLocale(locale)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;}catch{/* A blocked preference cookie must not stop the UI. */}
}
