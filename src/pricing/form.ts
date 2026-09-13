// Form input adaptation only. Monetary arithmetic stays in comparison.ts.
export function monthInput(value:string):number {
 return /^\d+$/.test(value)?Number(value):NaN;
}
export class InstallmentDraft {
 private active=false;
 private previous='';
 setTerm(term:string,displayedMonthly:string):{active:boolean;monthly:string}{
  const active=term!=='0';
  let monthly=displayedMonthly;
  if(active!==this.active){
   if(active)monthly=this.previous;
   else{this.previous=displayedMonthly;monthly='0';}
  }
  this.active=active;
  return {active,monthly};
 }
}
