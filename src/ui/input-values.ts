import {Temporal} from '@js-temporal/polyfill';
import type {UiContext} from '../i18n/context';

export const evidenceKinds=['quote','invoice','priceList','other'] as const;
type EvidenceKind=typeof evidenceKinds[number];
export const evidenceLabels={quote:'sourceQuote',invoice:'sourceInvoice',priceList:'sourcePriceList',other:'customValue'} as const;
export interface CostEvidence {kind:string;date:string;reference:string}
/** @public Invoked by tests/input-ux.ts; source is loaded through esbuild. */
export function validIsoDate(value:string):boolean {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
 try{return Temporal.PlainDate.from(value).toString()===value;}catch{return false;}
}
export function validCostEvidence(evidence:CostEvidence):boolean {
 return evidenceKinds.includes(evidence.kind as EvidenceKind)&&validIsoDate(evidence.date)&&evidence.reference.trim().length<=200&&(evidence.kind!=='other'||Boolean(evidence.reference.trim()));
}
export function costEvidenceText(ui:UiContext,evidence:CostEvidence):string {
 if(!validCostEvidence(evidence))return '';
 return [ui.t(evidenceLabels[evidence.kind as EvidenceKind]),ui.date(new Date(evidence.date+'T00:00:00Z'),{timeZone:'UTC',dateStyle:'medium'}),evidence.reference.trim()].filter(Boolean).join(' · ');
}
// Calendar days, not 24-hour instants: remains correct across DST and month/year changes.
export function relativeDate(timeZone:string,days:number,now=new Date()):string {
 return Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timeZone).toPlainDate().add({days}).toString();
}
