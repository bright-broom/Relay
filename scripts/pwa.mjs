import {writeFile,mkdir,rm} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {build} from 'esbuild';

// Rasterize Relay's own vector mark. Opaque background and inset mark support OS masks.
function png(size,background,foreground){
 const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
 const bg=rgb(background),fg=rgb(foreground);
 const segments=[[[10,23],[10,10]],[[10,10],[16,10]],[[10,18],[16,18]],[[16,18],[22,24]],[[20,7],[25,7]],[[25,7],[25,16]]];
 let previous=[16,10];
 for(let i=1;i<=32;i++){const angle=-Math.PI/2+Math.PI*i/32;const next=[16+4*Math.cos(angle),14+4*Math.sin(angle)];segments.push([previous,next]);previous=next}
 const distance=(x,y,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1];const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)};
 const rows=Buffer.alloc((size*3+1)*size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const px=((x+.5)/size*32-16)/.78+16,py=((y+.5)/size*32-16)/.78+16;
  const d=Math.min(...segments.map(([a,b])=>distance(px,py,a,b)));
  const alpha=Math.max(0,Math.min(1,(1-d)*size*.78/32+.5));
  for(let c=0;c<3;c++)rows[y*(size*3+1)+1+x*3+c]=Math.round(bg[c]*(1-alpha)+fg[c]*alpha);
 }
 const crc=data=>{let value=0xffffffff;for(const byte of data){value^=byte;for(let k=0;k<8;k++)value=(value>>>1)^((value&1)?0xedb88320:0)}return (value^0xffffffff)>>>0};
 const chunk=(type,data)=>{const name=Buffer.from(type),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([length,name,data,sum])};
 const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
export async function buildPwa(palette,brand){
 await mkdir('prototype/icons',{recursive:true});
 for(const size of [180,192,512])await writeFile(`prototype/icons/icon-${size}.png`,png(size,palette.main,palette.sub));
 const manifest={id:'./',name:brand,short_name:brand,lang:'ja',start_url:'./',scope:'./',display:'standalone',background_color:palette.sub,theme_color:palette.sub,icons:[{src:'icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]};
 await writeFile('prototype/manifest.webmanifest',JSON.stringify(manifest,null,2)+'\n');
 await rm('prototype/docs',{recursive:true,force:true});
 await build({entryPoints:['src/pwa/worker.ts'],outfile:'prototype/sw.js',bundle:true,format:'iife',target:['safari16','chrome110'],minify:true});
}
