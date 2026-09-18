import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
await mkdir('.vercel/check-pricing',{recursive:true});
await build({entryPoints:['src/pricing/comparison.ts'],bundle:true,platform:'node',format:'esm',outfile:'.vercel/check-pricing/comparison.mjs'});
const {compareCosts,comparisonSchema}=await import(pathToFileURL(process.cwd()+'/.vercel/check-pricing/comparison.mjs').href) as typeof import('../src/pricing/comparison');
const input={currency:'JPY',currentMonthly:'20000',proposedMonthly:'8000',upfront:'100000',installmentMonthly:'5000',installmentMonths:60,horizonMonths:120};
const r=compareCosts(input);
assert.equal(r.currentTotal,'2400000');assert.equal(r.proposedTotal,'1360000');assert.equal(r.totalDifference,'1040000');
assert.equal(r.monthlyDuring,'13000');assert.equal(r.monthlyAfter,'8000');assert.equal(r.remainingInstallments,'0');
assert.deepEqual(r.timeline[0],{month:0,current:'0',proposed:'100000',difference:'-100000'});
assert.equal(BigInt(r.timeline[61].proposed)-BigInt(r.timeline[60].proposed),8000n);
const short=compareCosts({...input,horizonMonths:12});
assert.equal(short.proposedTotal,'256000');assert.equal(short.totalDifference,'-16000');assert.equal(short.remainingInstallments,'240000');
const cash=compareCosts({...input,installmentMonthly:'0',installmentMonths:0});assert.equal(cash.proposedTotal,'1060000');
const zero=compareCosts({...input,currentMonthly:'0',proposedMonthly:'0',upfront:'0',installmentMonthly:'0',installmentMonths:0});assert.equal(zero.totalDifference,'0');
assert.equal(compareCosts({...input,currentMonthly:'9999999999',horizonMonths:420}).currentTotal,'4199999999580');
for(const bad of ['',null,undefined,NaN,Infinity,-1,1,'-1','1.5','1e6',' 1','01','0x10','1,000','１２３','10000000000','9'.repeat(1000)])assert.equal(comparisonSchema.safeParse({...input,currentMonthly:bad}).success,false,String(bad));
for(const horizonMonths of [0,421,1.5,NaN,'12',Infinity])assert.throws(()=>compareCosts({...input,horizonMonths}));
for(const patch of [{currency:'USD'},{installmentMonths:0},{installmentMonthly:'0'},{installmentMonths:-1},{unknown:1}])assert.throws(()=>compareCosts({...input,...patch}));
// Independent whole-yen ledger oracle: add each monthly cash flow, not the production formula.
for(let i=0;i<500;i++){
 const term=i%421,horizon=1+(i*37)%420;
 const sample={currency:'JPY',currentMonthly:String(i*137),proposedMonthly:String(i*71),upfront:String(i*3457),installmentMonthly:term?String(i*59+1):'0',installmentMonths:term,horizonMonths:horizon};
 const out=compareCosts(sample);let before=0n,after=BigInt(sample.upfront),remaining=0n;
 for(let month=1;month<=Math.max(term,horizon);month++){
  if(month<=horizon){before+=BigInt(sample.currentMonthly);after+=BigInt(sample.proposedMonthly);if(month<=term)after+=BigInt(sample.installmentMonthly);assert.equal(out.timeline[month].proposed,String(after));}
  else if(month<=term)remaining+=BigInt(sample.installmentMonthly);
 }
 assert.equal(out.currentTotal,String(before));assert.equal(out.proposedTotal,String(after));assert.equal(out.totalDifference,String(before-after));assert.equal(out.remainingInstallments,String(remaining));
 const copy=structuredClone(sample);compareCosts(sample);assert.deepEqual(sample,copy);
}
console.log('Pricing: reference examples, 500 independent cash-flow ledgers, payment boundaries, precision, invalid inputs and immutability passed.');
