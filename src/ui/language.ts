import {catalogs,canonicalLocale} from '../i18n/messages';
import type {UiContext} from '../i18n/context';
import {escapeHtml,icon} from './icons';
const suggestions=['ja','en','ko','zh-CN','zh-TW','fr','es','de','pt-BR','ar','he','hi','id','th','vi'];
export function languageForm(ui:UiContext){
 const names=new Intl.DisplayNames([ui.language],{type:'language'});
 const options=[...new Set([...Object.keys(catalogs),...suggestions,ui.locale])];
 const submit=`<button class="button primary" type="submit">${icon('check')}${ui.t('applyLanguage')}</button>`;
 // Separate GET forms preserve both paths on the server-rendered login page without JavaScript.
 return `<div class="stack"><form id="language-form" action="/" method="get" class="stack"><div class="field"><label for="language-tag">${ui.t('language')}</label><select id="language-tag" name="lang" aria-describedby="language-help">${options.map(tag=>`<option value="${escapeHtml(tag)}" ${tag===ui.locale?'selected':''}>${escapeHtml(names.of(tag)??tag)}</option>`).join('')}</select></div>${submit}</form><details class="disclosure"><summary>${ui.t('languageTag')}</summary><form id="language-custom-form" action="/" method="get" class="stack disclosure-body"><div class="field"><label for="language-custom-tag">${ui.t('languageTag')}</label><input id="language-custom-tag" name="lang" value="${escapeHtml(ui.locale)}" maxlength="100" required autocapitalize="none" spellcheck="false" aria-describedby="language-help language-error"></div><p id="language-error" role="alert"></p>${submit}</form></details><p id="language-help" class="meta">${ui.t('languageCoverage')}</p></div>`;
}
export function bindLanguageForm(ui:UiContext,apply:(locale:string)=>void){
 for(const [formId,fieldId] of [['language-form','language-tag'],['language-custom-form','language-custom-tag']]){
  const form=document.getElementById(formId) as HTMLFormElement;
  form.onsubmit=event=>{
   event.preventDefault();const field=document.getElementById(fieldId) as HTMLInputElement|HTMLSelectElement;
   const locale=canonicalLocale(field.value);
   field.setAttribute('aria-invalid',String(!locale));
   if(!locale){document.getElementById('language-error')!.textContent=ui.t('invalidLanguage');field.focus();return;}
   apply(locale);
  };
 }
}
