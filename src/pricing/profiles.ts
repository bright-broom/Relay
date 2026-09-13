import type {ComparisonInput} from './comparison';

// Industry adapters supply explicit, documented cash flows; they do not change the common engine.
export interface PricingProfile {
 id:string;
 version:string;
 currency:ComparisonInput['currency'];
 horizonOptions:readonly number[];
 installmentOptions:readonly number[];
}
export const fixedCostProfile:PricingProfile={
 id:'fixed-cost',version:'1.0.0',currency:'JPY',
 horizonOptions:[12,24,36,60,120,180,240,300,360,420],
 installmentOptions:[0,12,24,36,60,120,180,240,300,360,420],
};
