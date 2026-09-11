/** Device measurements are dynamic layout data, not component style constants. */
export function initViewport(){
 const viewport=window.visualViewport;
 if(!viewport)return;
 let frame=0;
 const update=()=>{
  cancelAnimationFrame(frame);
  frame=requestAnimationFrame(()=>{
   if(viewport.height<=0)return;
   document.documentElement.style.setProperty('--viewport-block',`${viewport.height}px`);
   document.documentElement.style.setProperty('--viewport-offset',`${viewport.offsetTop}px`);
  });
 };
 viewport.addEventListener('resize',update);
 viewport.addEventListener('scroll',update);
 update();
}
