export const hosted=()=>location.protocol==='https:'||location.hostname==='localhost';
export function initPwa(){
 if(hosted()&&'serviceWorker' in navigator){
  window.addEventListener('load',()=>{navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>window.dispatchEvent(new Event('relay-offline-unavailable')))},{once:true});
 }
}
