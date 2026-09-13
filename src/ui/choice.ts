import type {UiContext} from '../i18n/context';
import type {MessageKey} from '../i18n/messages';
import {escapeHtml} from './icons';

type Choice={value:string;label:string};
type Config={id:string;label:MessageKey;choices:readonly Choice[];value:string;customValue?:string;description?:string;numeric?:boolean;maxLength?:number};
// Native select for common values, with an explicit custom value. Never infer an unknown value.
export function choiceField(ui:UiContext,config:Config){
 const {id,label,choices,value,numeric=false,maxLength=120}=config;
 const known=choices.some(choice=>choice.value===value);
 return `<div class="field"><label for="${id}">${ui.t(label)}</label><select id="${id}" ${config.description?`aria-describedby="${config.description}"`: ''}>${choices.map(choice=>`<option value="${escapeHtml(choice.value)}" ${choice.value===value?'selected':''}>${escapeHtml(choice.label)}</option>`).join('')}<option data-custom="true" value="__custom" ${known?'':'selected'}>${ui.t('customValue')}</option></select><div id="${id}-custom-field" ${known?'hidden':''}><label class="sr-only" for="${id}-custom">${ui.t('customFor',{field:ui.t(label)})}</label><input id="${id}-custom" type="text" ${numeric?'inputmode="numeric"':''} maxlength="${maxLength}" value="${escapeHtml(known?(config.customValue??''):value)}" ${config.description?`aria-describedby="${config.description}"`:''} ${known?'disabled':''} required></div></div>`;
}
export function readChoice(root:ParentNode,id:string):string {
 const select=root.querySelector<HTMLSelectElement>('#'+id)!;
 return select.selectedOptions[0]?.dataset.custom==='true'?root.querySelector<HTMLInputElement>('#'+id+'-custom')!.value:select.value;
}
export function bindChoice(root:ParentNode,id:string){
 const select=root.querySelector<HTMLSelectElement>('#'+id)!;
 const input=root.querySelector<HTMLInputElement>('#'+id+'-custom')!;
 const field=root.querySelector<HTMLElement>('#'+id+'-custom-field')!;
 select.addEventListener('change',()=>{
  const custom=select.selectedOptions[0]?.dataset.custom==='true';
  field.hidden=!custom;input.disabled=!custom;
  if(custom)input.focus();
 });
}
