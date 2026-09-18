import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

// Isolated device-event simulation. This is not a browser layout/visual test.
const compiled = await build({entryPoints:['src/prototype/viewport.ts'],bundle:true,write:false,format:'iife',globalName:'viewportModule'});
function setup(hasViewport = true) {
  const events = () => {
    const callbacks = new Map<string,()=>void>();
    return {
      addEventListener: (name:string, callback:()=>void) => callbacks.set(name, callback),
      removeEventListener: (name:string) => callbacks.delete(name),
      emit: (name:string) => callbacks.get(name)?.(),
    };
  };
  const viewport = Object.assign(events(), {height:844, offsetTop:0, scale:1});
  const properties = new Map<string,string>(), frames = new Map<number,()=>void>();
  let id = 0;
  class Element {
    body:Element|null=null;
    bounds!: {top:number;bottom:number;height:number};
    scrollBy!: (options:{top:number})=>void;
    closest() { return this.body ?? null; }
    getBoundingClientRect() { return this.bounds; }
  }
  const body = new Element(), input = new Element(), scrolls: number[] = [];
  body.bounds = {top:60, bottom:400, height:340};
  body.scrollBy = (options) => scrolls.push(options.top);
  input.body = body;
  input.bounds = {top:360, bottom:408, height:48};
  const document = {documentElement: {style: {
    setProperty: (key:string, value:string) => properties.set(key, value),
    removeProperty: (key:string) => properties.delete(key),
  }}, activeElement: input};
  const window = Object.assign(events(), {visualViewport: hasViewport ? viewport : null});
  const sandbox = {viewportModule:undefined as typeof import('../src/prototype/viewport') | undefined,window, document, HTMLElement:Element,
    getComputedStyle: () => ({scrollPaddingBlockStart:'16px'}),
    requestAnimationFrame: (callback:()=>void) => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: (key:number) => frames.delete(key),
  };
  runInNewContext(compiled.outputFiles[0].text, sandbox);
  const stop = sandbox.viewportModule!.initViewport();
  const flush = () => { for (const [key, callback] of frames) { frames.delete(key); callback(); } };
  return {viewport, window, input, document, properties, frames, scrolls, flush, stop};
}
const device = setup();
device.flush();
assert.equal(device.properties.get('--viewport-block'),'844px');
assert.deepEqual(device.scrolls,[24], 'Keyboard-hidden input should scroll inside its own body');
assert.equal(device.document.activeElement,device.input, 'Do not steal focus');
device.scrolls.length = 0;
device.input.bounds = {top:100,bottom:148,height:48};
for (const height of [700,500,320]) { device.viewport.height=height; device.viewport.emit('resize'); }
assert.equal(device.frames.size,1,'Coalesce rapid rotation/keyboard resize events');
device.viewport.offsetTop = 80;
device.viewport.emit('scroll');
device.flush();
assert.equal(device.properties.get('--viewport-block'),'320px');
assert.equal(device.properties.get('--viewport-offset'),'80px');
assert.deepEqual(device.scrolls,[], 'Do not scroll an already visible field');
device.input.bounds = {top:40,bottom:88,height:48};
device.window.emit('resize'); device.flush();
assert.deepEqual(device.scrolls,[-36], 'Reveal field obscured above the scrollport');
device.viewport.height = 0;
device.viewport.emit('resize'); device.flush();
assert.equal(device.properties.get('--viewport-block'),'320px','Ignore transient invalid viewport measurements');
device.viewport.scale=2;
device.viewport.emit('resize'); device.flush();
assert.equal(device.properties.size,0,'Pinch zoom must use CSS viewport dimensions without shrinking the UI');
device.viewport.scale=1;
device.viewport.height=390;
device.viewport.offsetTop=-5;
device.viewport.emit('resize'); device.flush();
assert.equal(device.properties.get('--viewport-offset'),'0px');
assert.equal(device.properties.get('--viewport-block'),'390px','Resume keyboard handling after pinch zoom');
device.scrolls.length=0;
device.input.body=null;
device.viewport.emit('resize'); device.flush();
assert.deepEqual(device.scrolls,[], 'Never scroll the background page');
device.viewport.emit('resize'); device.stop(); device.flush();
assert.equal(device.properties.size,0);
device.viewport.emit('resize'); device.window.emit('resize');
assert.equal(device.frames.size,0,'Dispose all viewport listeners and scheduled work');
const unsupported = setup(false); unsupported.flush(); unsupported.stop();
assert.equal(unsupported.properties.size,0,'Use CSS fallback without VisualViewport');

// Guard the scroll-container regression separately from visual verification.
const css = postcss.parse(await readFile('src/prototype/styles.css','utf8'));
const declarations = (selector:string) => {
  const result = new Map<string,string>();
  css.walkRules(selector, rule => {
    if (rule.parent?.type === 'atrule' && 'name' in rule.parent && rule.parent.name !== 'layer') return;
    rule.walkDecls(decl => {result.set(decl.prop,decl.value);});
  });
  return result;
};
assert.equal(declarations('.app').has('overflow-y'),false,'An unbounded overflow ancestor breaks the sticky sidebar');
assert.equal(declarations('.sidebar').get('overflow-y'),'auto','Short landscape rails must remain scrollable');
assert.equal(declarations('.dialog-body').get('overflow-y'),'auto');
assert.equal(declarations('.dialog-body').get('min-block-size'),'0');
assert.equal(declarations('.dialog-head').get('flex'),'none','Close action must stay outside the shrinking scroll body');
assert.ok(!/user-scalable=no|maximum-scale=1/.test(await readFile('src/prototype/index.html','utf8')));
console.log('Viewport: keyboard, rotation, panning, pinch zoom, focus retention, unavailable API, cleanup and scroll boundaries: OK (simulated).');
