import type {MessageKey} from '../i18n/messages';

type LinkItem={kind:'page';id:'today'|'cases'|'reviews'|'imports';label:MessageKey;icon:string};
type DialogItem={kind:'dialog';id:'pricing'|'scheduling'|'account'|'install-info'|'preview-info';label:MessageKey;icon:string};
export const navigationItems=[
 {kind:'page',id:'today',label:'today',icon:'home'},
 {kind:'page',id:'cases',label:'cases',icon:'cases'},
 {kind:'page',id:'reviews',label:'reviews',icon:'reviews'},
 {kind:'page',id:'imports',label:'imports',icon:'imports'},
 {kind:'dialog',id:'pricing',label:'pricing',icon:'calculator'},
 {kind:'dialog',id:'scheduling',label:'scheduling',icon:'calendar'},
 {kind:'dialog',id:'account',label:'account',icon:'user'},
 {kind:'dialog',id:'install-info',label:'installTitle',icon:'install'},
 {kind:'dialog',id:'preview-info',label:'previewInfo',icon:'info'},
] as const satisfies readonly (LinkItem|DialogItem)[];
export type Page=LinkItem['id']|'detail';
export function visibleNavigation(installed:boolean){return navigationItems.filter(item=>!installed||item.id!=='install-info');}
export const activeNavigation=(page:Page)=>page==='detail'?'cases':page;
export function resolveRoute(hash:string,caseIds:readonly number[]):{page:Page;caseId?:number}|null{
 const value=hash.replace(/^#/,'');
 if(value==='main')return null;
 if(value.startsWith('case/')){
  const match=/^case\/([1-9]\d*)$/.exec(value),id=match?Number(match[1]):NaN;
  return Number.isSafeInteger(id)&&caseIds.includes(id)?{page:'detail',caseId:id}:{page:'cases'};
 }
 const item=navigationItems.find(item=>item.kind==='page'&&item.id===value);
 return {page:item?.kind==='page'?item.id:'today'};
}
