import type {MessageKey} from '../i18n/messages';
export const caseStages=['stageSchedule','stageContract','stageInstall'] as const satisfies readonly MessageKey[];
export const caseDueDates=['dueNow','dueDay','dueUnknown','overdueDate','futureDate'] as const satisfies readonly MessageKey[];
export const caseStatuses=['todo','doing','awaiting','done'] as const;
export const caseLevels=['today','overdue','unknown','upcoming'] as const;
export type CaseDue=typeof caseDueDates[number];
export interface CaseRecord {
  id:number; name:string; area:string; stage:typeof caseStages[number]; title:string; owner:string;
  waiting:string; due:CaseDue; level:typeof caseLevels[number];
  status:typeof caseStatuses[number]; reason:string; next:string; evidence:string;
  history:readonly (readonly [string,string])[]; notes:string[]; version:number;
}
// Fictional source records are shown in their original language, independent of UI locale.
export const sourceMessage='お客様に確認しました。9月18日15時の現調で大丈夫です。工事会社への確定連絡はこれからです。';
export const initialCases:CaseRecord[]=[
  {id:1,name:'顧客A様',area:'大分市',stage:'stageInstall',title:'現調候補日をお客様に確認する',owner:'担当A',waiting:'顧客',due:'dueNow',level:'today',status:'doing',reason:'施工会社から日程候補を受領。お客様へ確認し、施工会社へ折り返します。',next:'9/18 15:00 · 現調候補',evidence:'9/10 16:30　施工会社より「9/18 15時でいかがでしょうか」。',history:[['9/08','現調の日程調整を開始。'],['9/10 16:30','施工会社から9/18 15時の候補を受領。'],['9/10 17:00','お客様に確認して折り返す予定を報告。']],notes:[],version:1},
  {id:2,name:'顧客B様',area:'宮崎市',stage:'stageSchedule',title:'変更後の日程で前確認をする',owner:'担当B',waiting:'—',due:'dueDay',level:'today',status:'todo',reason:'商談日が変更されています。前回の前確認は変更前の日程に対するものです。',next:'9/12 10:00 · 商談予定',evidence:'9/10 18:00　「商談は9/12 10時へ変更になりました」。',history:[['9/05','初回の日程で前確認済み。'],['9/10','9/12 10時へ変更。変更後の前確認は記録なし。']],notes:[],version:1},
  {id:3,name:'顧客C様',area:'別府市',stage:'stageContract',title:'不足書類の提出状況を確認する',owner:'担当A',waiting:'顧客',due:'futureDate',level:'upcoming',status:'awaiting',reason:'申込は受付済み。必要書類の提出が確認できるまで次の段階へ進めません。',next:'審査開始日 · 未定',evidence:'9/09 11:00　「受付は済んでいますが、書類の提出待ちです」。',history:[['9/07','申込を提出。'],['9/09','書類不足が判明。'],['9/10','お客様へ提出方法を案内。']],notes:[],version:1},
  {id:4,name:'顧客D様',area:'日向市',stage:'stageInstall',title:'再工事の候補日を複数確認する',owner:'担当C',waiting:'顧客',due:'overdueDate',level:'overdue',status:'doing',reason:'対応期限を過ぎています。電話で確認済みの場合は、その結果を記録してください。',next:'再工事日 · 未定',evidence:'9/08 14:00　「9/10までにお客様の休日を確認します」。',history:[['9/06','屋内作業が残り、再工事が必要に。'],['9/08','お客様の休日を9/10までに確認する予定を報告。']],notes:[],version:1},
  {id:5,name:'顧客E様',area:'鹿児島市',stage:'stageSchedule',title:'次回連絡の担当者と期限を決める',owner:'',waiting:'—',due:'dueUnknown',level:'unknown',status:'todo',reason:'日程未定でも案件を残します。次に連絡する人と期限を設定してください。',next:'商談日 · 未定',evidence:'9/10 19:00　「来月以降の商談を希望。日程はこれから相談」。',history:[['9/10','来月以降の商談希望。担当と次回連絡期限は未設定。']],notes:[],version:1},
];

export const demoMembers = [...new Set(initialCases.map(c => c.owner).filter(Boolean))];
export const demoMeta = {messageTime:"9/11 10:20",referenceDate:"2026-09-11",fileName:"sample-history.txt"} as const;
