import {catalogs,canonicalLocale} from '../i18n/messages';
import type {UiContext} from '../i18n/context';
import {escapeHtml,icon} from './icons';
const suggestions=['ja','en','ko','zh-CN','zh-TW','fr','es','de','pt-BR','ar','he','hi','id','th','vi'];
export function languageForm(ui:UiContext){
 const names=new Intl.DisplayNames([ui.language],{type:'language'});
 const options=[...new Set([...Object.keys(catalogs),...suggestions,ui.locale])];
 return `<form id="language-form" action="/" method="get" class="stack"><div class="field"><label for="language-tag">${ui.t('language')}</label><input id="language-tag" name="lang" list="language-options" value="${escapeHtml(ui.locale)}" maxlength="100" required aria-describedby="language-help language-error"><datalist id="language-options">${options.map(tag=>`<option value="${escapeHtml(tag)}">${escapeHtml(names.of(tag)??tag)}</option>`).join('')}</datalist></div><p id="language-help" class="meta">${ui.t('languageCoverage')}</p><p id="language-error" role="alert"></p><button class="button primary" type="submit">${icon('check')}${ui.t('applyLanguage')}</button></form>`;
}
export function bindLanguageForm(ui:UiContext,apply:(locale:string)=>void){
 const form=document.getElementById('language-form') as HTMLFormElement;
 form.onsubmit=event=>{
  event.preventDefault();const field=document.getElementById('language-tag') as HTMLInputElement;
  const locale=canonicalLocale(field.value);
  field.setAttribute('aria-invalid',String(!locale));
  if(!locale){document.getElementById('language-error')!.textContent=ui.t('invalidLanguage');field.focus();return;}
  apply(locale);
 };
}
