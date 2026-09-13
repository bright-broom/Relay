import {UserRound,CalendarDays,Copy,Search,NotebookPen,ChevronDown,TriangleAlert,Clock,Check,Download,Info,House,Folder,ClipboardCheck,Upload,ArrowRight,ArrowLeft,X,Calculator,RefreshCw,LogOut,Unlink,Languages,Eye,Pencil,RotateCcw,FileText,SlidersHorizontal,Hourglass,Circle,type IconNode} from 'lucide';
import type {MessageKey} from '../i18n/messages';
import type {UiContext} from '../i18n/context';
export const escapeHtml=(value:string|number)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const icons:Record<string,IconNode>={user:UserRound,calendar:CalendarDays,copy:Copy,search:Search,note:NotebookPen,chevron:ChevronDown,alert:TriangleAlert,clock:Clock,check:Check,install:Download,info:Info,home:House,cases:Folder,reviews:ClipboardCheck,imports:Upload,arrow:ArrowRight,back:ArrowLeft,close:X,calculator:Calculator,refresh:RefreshCw,logout:LogOut,unlink:Unlink,language:Languages,present:Eye,edit:Pencil,reset:RotateCcw,file:FileText,options:SlidersHorizontal,waiting:Hourglass,todo:Circle};
export function icon(name:string){
 const node=icons[name];if(!node)throw new Error(`Unknown icon: ${name}`);
 return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${name==='arrow'||name==='back'?'class="directional-icon"':''}>${node.map(([tag,attrs])=>`<${tag} ${Object.entries(attrs).map(([key,value])=>`${key}="${escapeHtml(String(value))}"`).join(' ')}></${tag}>`).join('')}</svg>`;
}
const iconOnly:Partial<Record<MessageKey,string>>={signOut:'logout',refreshConnections:'refresh',copyLinkCode:'copy',lineRemove:'unlink',calendarDisconnect:'unlink',mcpCopy:'copy',mcpRevoke:'unlink',pricingEdit:'edit',copy:'copy',close:'close',resetFilters:'reset',handoff:'note'};
const labeled:Partial<Record<MessageKey,string>>={pricingPresent:'present',scheduleFind:'search',scheduleBook:'calendar',calendarConnect:'calendar',lineConnect:'user',lineConfirm:'check',lineTest:'info',mcpIssue:'user',saveRecord:'note',saveComplete:'check',approve:'check',reject:'close',sample:'imports',sampleShown:'check',reviewOpen:'reviews',installNow:'install'};
export function actionContent(ui:UiContext,key:MessageKey){
 const symbol=iconOnly[key]??labeled[key];
 return symbol?`${icon(symbol)}${iconOnly[key]?'':`<span>${escapeHtml(ui.t(key))}</span>`}`:escapeHtml(ui.t(key));
}
export const actionClass=(key:MessageKey)=>iconOnly[key]?'icon-button tip':'button';
export const actionLabel=(ui:UiContext,key:MessageKey)=>`aria-label="${escapeHtml(ui.t(key))}" data-tooltip="${escapeHtml(ui.t(key))}" title="${escapeHtml(ui.t(key))}"`;
