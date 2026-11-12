import {readFileSync} from 'node:fs';
export const join=(...parts)=>new Uint8Array(Buffer.concat(parts.map(p=>Buffer.from(p))));
export function segment(marker,payload){const n=payload.length+2;return join([255,marker,n>>8,n&255],payload);}
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const data=JSON.parse(html.match(/<script id="sample-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
export const sample=new Uint8Array(Buffer.from((Array.isArray(data)?data.join(''):data).split(',')[1],'base64'));
// A generated 1x1 grey baseline JPEG: one DC-zero code, one AC EOB code.
export const tiny=join([255,216],segment(219,[0,...Array(64).fill(1)]),segment(192,[8,0,1,0,1,1,1,17,0]),segment(196,[0,1,...Array(15).fill(0),0,16,1,...Array(15).fill(0),0]),segment(218,[1,1,0,0,63,0]),[63,255,217]);
const maker=join(Buffer.from('Exif\0\0'),[73,73,42,0,8,0,0,0,1,0,124,146,7,0,4,0,0,0,68,69,77,79,0,0,0,0]);
export const extras={APP13:segment(237,Buffer.from('Photoshop 3.0\0DEMO')),XMP:segment(225,Buffer.from('http://ns.adobe.com/xap/1.0/\0<xmp>fictional</xmp>')),ICC:segment(226,join(Buffer.from('ICC_PROFILE\0'),[1,1,0,0])),MakerNote:segment(225,maker),COM:segment(254,Buffer.from('fictional comment'))};
export const withExtra=extra=>join(tiny.slice(0,2),extra,tiny.slice(2));
// Independent walker including inter-scan metadata, escaped FF and restart markers.
export function parts(bytes){
  const out=[{marker:216,raw:bytes.slice(0,2)}];let p=2;
  while(p<bytes.length){const start=p++;if(bytes[start]!==255)throw Error('marker');while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===217){out.push({marker,raw:bytes.slice(start,p)});if(p!==bytes.length)throw Error('trailer');break;}const n=(bytes[p]<<8)|bytes[p+1];p+=n;out.push({marker,raw:bytes.slice(start,p)});if(marker===218){const s=p;while(p<bytes.length){if(bytes[p]!==255){p++;continue;}let q=p+1;while(bytes[q]===255)q++;if(bytes[q]===0||(bytes[q]>=208&&bytes[q]<=215)){p=q+1;continue;}break;}out.push({marker:null,raw:bytes.slice(s,p)});}}
  return out;
}
export const imageBody=b=>join(...parts(b).filter(p=>!(p.marker>=224&&p.marker<=239)&&p.marker!==254).map(p=>p.raw));
