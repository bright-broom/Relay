import Decimal from 'decimal.js';
import {z} from 'zod';

// Local precision cannot be changed by another feature's Decimal configuration.
const Money=Decimal.clone({precision:40,rounding:Decimal.ROUND_HALF_UP});
const yen=z.string().regex(/^(0|[1-9]\d{0,9})$/);
export const comparisonSchema=z.object({
 currency:z.literal('JPY'),currentMonthly:yen,proposedMonthly:yen,upfront:yen,
 installmentMonthly:yen,installmentMonths:z.number().int().min(0).max(420),
 horizonMonths:z.number().int().min(1).max(420),
}).strict().superRefine((value,ctx)=>{
 if((value.installmentMonthly==='0')!==(value.installmentMonths===0))
  ctx.addIssue({code:'custom',path:['installmentMonths'],message:'installmentMismatch'});
});
export type ComparisonInput=z.infer<typeof comparisonSchema>;
export const calculationVersion='fixed-cost-jpy/1.0.0';
export function compareCosts(raw:unknown){
 const input=comparisonSchema.parse(raw);
 const current=new Money(input.currentMonthly),running=new Money(input.proposedMonthly);
 const payment=new Money(input.installmentMonthly),upfront=new Money(input.upfront);
 const financedMonths=Math.min(input.installmentMonths,input.horizonMonths);
 const monthlyDuring=running.plus(payment);
 const currentTotal=current.times(input.horizonMonths);
 const runningTotal=running.times(input.horizonMonths);
 const installmentTotal=payment.times(financedMonths);
 const proposedTotal=upfront.plus(runningTotal).plus(installmentTotal);
 const remainingInstallments=payment.times(Math.max(0,input.installmentMonths-input.horizonMonths));
 // Explicit month 0 keeps upfront costs visible, instead of diluting them into a monthly average.
 const timeline=Array.from({length:input.horizonMonths+1},(_,month)=>{
  const before=current.times(month),after=upfront.plus(running.times(month)).plus(payment.times(Math.min(month,input.installmentMonths)));
  return {month,current:before.toFixed(0),proposed:after.toFixed(0),difference:before.minus(after).toFixed(0)};
 });
 return {version:calculationVersion,input,currentTotal:currentTotal.toFixed(0),runningTotal:runningTotal.toFixed(0),
 installmentTotal:installmentTotal.toFixed(0),proposedTotal:proposedTotal.toFixed(0),
 monthlyDuring:monthlyDuring.toFixed(0),monthlyAfter:running.toFixed(0),
 monthlyDifference:current.minus(monthlyDuring).toFixed(0),totalDifference:currentTotal.minus(proposedTotal).toFixed(0),
 remainingInstallments:remainingInstallments.toFixed(0),timeline};
}
export type ComparisonResult=ReturnType<typeof compareCosts>;
