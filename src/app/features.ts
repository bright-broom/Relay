import {lazy, type ComponentType, type ComponentProps} from 'react';

function feature<Props>(loader:()=>Promise<{default:ComponentType<Props>}>) {
  let pending: ReturnType<typeof loader> | undefined;
  const load = () => pending ??= loader().catch(error=>{pending=undefined;throw error;});
  return {Component:lazy(load),preload:()=>load().then(()=>undefined)};
}

export const pricingFeature = feature<ComponentProps<typeof import('./pricing').Pricing>>(()=>import('./pricing').then(module=>({default:module.Pricing})));
export const schedulingFeature = feature<ComponentProps<typeof import('./scheduling').Scheduling>>(()=>import('./scheduling').then(module=>({default:module.Scheduling})));
export const customersFeature = feature<ComponentProps<typeof import('./customers').Customers>>(()=>import('./customers').then(module=>({default:module.Customers})));
export const myPageFeature = feature<ComponentProps<typeof import('./my-page').MyPage>>(()=>import('./my-page').then(module=>({default:module.MyPage})));
export const adminFeature = feature<ComponentProps<typeof import('./admin').Admin>>(()=>import('./admin').then(module=>({default:module.Admin})));
const features = {pricing:pricingFeature,scheduling:schedulingFeature,customers:customersFeature,mypage:myPageFeature,admin:adminFeature};

/** Fetch code on intent; mounting the feature is the only trigger for its API effects. */
export function warmFeature(name:string) {
  const connection = (navigator as Navigator & {connection?:{saveData?:boolean;effectiveType?:string}}).connection;
  if (document.hidden || navigator.onLine === false || connection?.saveData || ['slow-2g','2g'].includes(connection?.effectiveType ?? '') ||
    document.getElementById('app')?.dataset.sessionBlocked === 'true') return;
  if (Object.hasOwn(features,name)) void features[name as keyof typeof features].preload().catch(()=>{});
}
