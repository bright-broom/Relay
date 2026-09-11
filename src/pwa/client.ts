interface InstallPrompt extends Event {prompt():Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>}
let pending:InstallPrompt|null=null;
export const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator & {standalone?:boolean}).standalone);
export const hosted=()=>location.protocol==='https:'||location.hostname==='localhost';
export const canPrompt=()=>Boolean(pending)&&!standalone();
export async function installApp():Promise<boolean>{
 if(!pending)return false;
 const event=pending;pending=null;
 try{await event.prompt();return (await event.userChoice).outcome==='accepted'}catch{return false}
}
export function initPwa(){
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();pending=e as InstallPrompt});
 window.addEventListener('appinstalled',()=>{pending=null});
 if(hosted()&&'serviceWorker' in navigator){
  window.addEventListener('load',()=>{navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>window.dispatchEvent(new Event('relay-offline-unavailable')))},{once:true});
 }
}
