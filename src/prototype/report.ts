import {translate, type Locale, type MessageKey} from '../i18n/messages';
import type {CaseRecord} from './data';
export const channels = ['channelPhone','channelEmail','channelChat','channelMeeting','channelOther'] as const;
export const outcomes = ['resultAgreed','resultNoAnswer','resultFollowup','resultCompleted','resultOther'] as const;
export interface ReportDraft {channel:typeof channels[number]|'';outcome:typeof outcomes[number]|'';note:string;mode:'record'|'complete'}
export const emptyReport = ():ReportDraft => ({channel:'',outcome:'',note:'',mode:'record'});
export function validateReport(draft:ReportDraft):{key:MessageKey;field:string}|null {
 if(!channels.includes(draft.channel as typeof channels[number]))return {key:'chooseChannel',field:'report-channel'};
 if(!outcomes.includes(draft.outcome as typeof outcomes[number]))return {key:'chooseOutcome',field:'report-outcome'};
 if((draft.channel==='channelOther'||draft.outcome==='resultOther')&&draft.note.trim().length<5)return {key:'reportError',field:'report'};
 if(draft.mode==='complete'&&draft.outcome!=='resultCompleted')return {key:'completeMismatch',field:'report-mode'};
 return null;
}
export function saveReport(c:CaseRecord,draft:ReportDraft,locale:Locale):boolean {
 if(validateReport(draft))return false;
 if(c.status==='done'&&draft.mode==='complete')return false;
 const text=translate(locale,'structuredReport',{channel:translate(locale,draft.channel as MessageKey),outcome:translate(locale,draft.outcome as MessageKey)});
 c.notes.push(draft.note.trim()?translate(locale,'structuredReportNote',{report:text,note:draft.note.trim()}):text);
 c.version++;
 if(draft.mode==='complete')c.status='done';
 return true;
}
