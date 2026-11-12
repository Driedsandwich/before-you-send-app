'use strict';
// No packages, network, browser, or copied production logic.
// Run: node --test tests/run.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const code=html.match(/<script id="photo-core">([\s\S]*?)<\/script>/)[1];
const core=vm.runInThisContext('('+code.trim()+')');
const uri=JSON.parse(html.match(/<script id="sample-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const sample=new Uint8Array(Buffer.from(uri.split(',')[1],'base64'));
const groups=['gps','date','device','thumbnail'];
const inspect=bytes=>core({action:'inspect',bytes});
const clean=(bytes,remove=groups)=>core({action:'clean',bytes,remove});
const join=(...parts)=>new Uint8Array(Buffer.concat(parts.map(p=>Buffer.from(p))));
function segment(marker,payload){const n=payload.length+2;return join([255,marker,n>>8,n&255],payload);}
// Independent JPEG segment reader; treats the complete scan stream as opaque.
function headParts(bytes){
  const parts=[];let p=2;
  while(p<bytes.length){const marker=bytes[p+1];if(marker===218){parts.push({marker,raw:bytes.slice(p)});break;}const n=(bytes[p+2]<<8)|bytes[p+3];parts.push({marker,raw:bytes.slice(p,p+n+2)});p+=n+2;}
  return parts;
}
const parts=headParts(sample);
const exif=parts.find(p=>p.marker===225).raw;
const base=join([255,216],...parts.filter(p=>p.marker!==225).map(p=>p.raw));
function fixture(entries,{le=true}={}){
  const size=8+2+entries.length*12+4;let cursor=size;
  const t=new Uint8Array(64000),v=new DataView(t.buffer);
  const w16=(p,n)=>v.setUint16(p,n,le),w32=(p,n)=>v.setUint32(p,n,le);
  t[0]=t[1]=le?73:77;w16(2,42);w32(4,8);w16(8,entries.length);
  entries.forEach((entry,i)=>{const p=10+i*12,{tag,type=2,data,count=data.length}=entry;w16(p,tag);w16(p+2,type);w32(p+4,count);if(data.length>4){w32(p+8,cursor);t.set(data,cursor);cursor+=data.length;if(cursor%2)cursor++;}else t.set(data,p+8);});
  return join(base.slice(0,2),segment(225,join(Buffer.from('Exif\0\0'),t.slice(0,cursor))),base.slice(2));
}
const txt=s=>new Uint8Array(Buffer.from(s+'\0'));
const unknown=r=>{assert.equal(r.status,'unknown');assert.ok(r.error||r.unknown?.length);assert.equal(r.bytes,undefined);assert.notEqual(r.count,0);};
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');

test('NORMAL: sample contains four real EXIF groups and fictional values',()=>{
  const r=inspect(sample);assert.equal(r.status,'complete');assert.equal(r.count,4);
  assert.deepEqual(r.items.gps.values,['12.3456, 65.4321']);
  assert.deepEqual(r.items.date.values,['2026:04:18 09:41:00']);
  assert.deepEqual(r.items.device.values,['Demo Camera 01']);
  assert.deepEqual(r.items.thumbnail.values,['1 preview']);assert.equal(r.width,480);assert.equal(r.height,240);
});
test('NORMAL: clean, re-read, preserve original and every non-EXIF byte',()=>{
  const hash=digest(sample),r=clean(sample);assert.equal(r.status,'complete');assert.equal(r.after.count,0);
  assert.equal(digest(sample),hash);assert.equal(digest(r.bytes),digest(base));
  assert.equal(inspect(new Uint8Array(r.bytes)).count,0);
  for(const text of ['Demo Camera 01','2026:04:18'])assert.equal(Buffer.from(r.bytes).includes(Buffer.from(text)),false);
});
for(let mask=1;mask<16;mask++){
  const selected=groups.filter((_,i)=>mask&(1<<i));
  test('NORMAL: selective removal '+selected.join(', '),()=>{
    const r=clean(sample,selected);assert.equal(r.status,'complete',r.error);assert.equal(r.after.count,4-selected.length);
    for(const k of groups){assert.equal(r.after.items[k].count,selected.includes(k)?0:1);if(!selected.includes(k))assert.deepEqual(r.after.items[k],r.before.items[k]);}
    // Image compression tables, frame and scan bytes must be byte-for-byte unchanged.
    const keep=b=>join(...headParts(b).filter(p=>p.marker!==225).map(p=>p.raw));
    assert.equal(digest(keep(r.bytes)),digest(keep(sample)));
  });
}
test('NORMAL: a JPEG with no metadata reports zero supported groups',()=>{assert.equal(inspect(base).status,'complete');assert.equal(inspect(base).count,0);});
test('NORMAL: big-endian EXIF is read and rebuilt correctly',()=>{
  const b=fixture([{tag:0x110,data:txt('Fictional Camera')},{tag:0x132,data:txt('2026:04:18 09:41:00')}],{le:false});
  const r=clean(b,['date']);assert.equal(r.status,'complete');assert.equal(r.after.items.device.values[0],'Fictional Camera');assert.equal(r.after.items.date.count,0);
});
test('NORMAL: multiple date tags are one group and all removed',()=>{
  const b=fixture([0x132,0x9003,0x9004].map(tag=>({tag,data:txt('2026:04:18 09:41:00')})));
  assert.equal(inspect(b).count,1);assert.equal(clean(b,['date']).after.count,0);
});
test('NORMAL: orientation remains when selected identifiers are erased',()=>{
  const b=fixture([{tag:0x110,data:txt('Demo Camera 01')},{tag:0x112,type:3,count:1,data:new Uint8Array([6,0])}]);
  const r=clean(b,['device']);assert.equal(r.status,'complete');assert.equal(r.after.count,0);
  assert.ok(headParts(r.bytes).some(p=>p.marker===225));
  assert.ok(Buffer.from(r.bytes).includes(Buffer.from([0x12,1,3,0,1,0,0,0,6,0,0,0])));
});
test('NORMAL: JFIF RGB thumbnail is genuinely removed',()=>{
  const b=join(base.slice(0,2),segment(224,join(Buffer.from('JFIF\0'),[1,1,0,0,1,0,1,1,1,12,34,56])),...headParts(base).filter(p=>p.marker!==224).map(p=>p.raw));
  assert.equal(inspect(b).items.thumbnail.count,1);const r=clean(b,['thumbnail']);assert.equal(r.status,'complete');assert.equal(r.after.count,0);assert.equal(r.bytes.length,b.length-3);
});

test('AMBIGUOUS: duplicate EXIF segments do not evade removal or inflate group counts',()=>{
  const b=join(sample.slice(0,2),exif,sample.slice(2));assert.equal(inspect(b).count,4);const r=clean(b);assert.equal(r.status,'complete');assert.equal(r.after.count,0);assert.equal(digest(r.bytes),digest(base));
});
test('AMBIGUOUS: multiple thumbnails are one group with an accurate preview count',()=>{
  const b=join(sample.slice(0,2),exif,sample.slice(2));const r=clean(b,['gps']);assert.equal(r.status,'complete');assert.equal(r.after.items.thumbnail.count,1);assert.deepEqual(r.after.items.thumbnail.values,['2 previews']);
});
test('AMBIGUOUS: GPS plus XMP gives Unknown, never a verified zero',()=>{
  const b=join(sample.slice(0,2),segment(225,Buffer.from('http://ns.adobe.com/xap/1.0/\0<xmp>GPS</xmp>')),sample.slice(2));
  const r=inspect(b);assert.equal(r.status,'unknown');assert.equal(r.items.gps.count,1);unknown(clean(b));
});
for(const [label,marker] of [['IPTC',237],['ICC',226],['comment',254]])test('AMBIGUOUS: '+label+' blocks verified download',()=>unknown(clean(join(base.slice(0,2),segment(marker,txt('unparsed')),base.slice(2)))));
test('AMBIGUOUS: MakerNote produces Unknown',()=>unknown(clean(fixture([{tag:0x927c,type:7,data:txt('private data')}]))));
test('AMBIGUOUS: invalid date text is not reported as fully understood',()=>unknown(clean(fixture([{tag:0x132,data:txt('not a date')}]))));
test('AMBIGUOUS: unrecognized or non-ASCII text is Unknown',()=>unknown(clean(fixture([{tag:0x110,data:new Uint8Array([255,254,0])}]))));
test('AMBIGUOUS: HTML-shaped device name remains inert text in the parser',()=>{
  const value='<img src=x onerror=alert(1)>';const r=inspect(fixture([{tag:0x110,data:txt(value)}]));assert.equal(r.items.device.values[0],value);
  assert.doesNotMatch(html,/\.innerHTML\s*=|insertAdjacentHTML|document\.write\s*\(/);
});
test('AMBIGUOUS: trailing bytes make the result Unknown',()=>unknown(clean(join(base,[1,2,3]))));
test('AMBIGUOUS: unmapped nonzero EXIF bytes are not silently ignored',()=>{
  const copy=exif.slice();const n=(copy[2]<<8)|copy[3];copy[2]=(n+4)>>8;copy[3]=(n+4)&255;
  unknown(clean(join(base.slice(0,2),copy,[83,69,67,82],base.slice(2))));
});
test('AMBIGUOUS: no selection does not silently remove anything',()=>unknown(clean(sample,[])));
test('AMBIGUOUS: zero GPS denominator is Unknown',()=>{
  const b=sample.slice(),v=new DataView(b.buffer),t=12,gps=v.getUint32(t+10+24+8,true);
  const count=v.getUint16(t+gps,true);let changed=false;
  for(let i=0;i<count;i++){const p=t+gps+2+i*12;if(v.getUint16(p,true)===2){const at=v.getUint32(p+8,true);v.setUint32(t+at+4,0,true);changed=true;}}
  assert.ok(changed);unknown(clean(b));
});
test('AMBIGUOUS: metadata inside a retained thumbnail blocks verification',()=>{
  const thumb=fixture([{tag:0x110,data:txt('Nested Camera')}]);
  const t=new Uint8Array(56+thumb.length),v=new DataView(t.buffer);
  t.set([73,73,42,0,8,0,0,0]);v.setUint32(10,14,true);v.setUint16(14,3,true);
  [[0x103,3,6],[0x201,4,56],[0x202,4,thumb.length]].forEach(([tag,type,value],i)=>{const p=16+i*12;v.setUint16(p,tag,true);v.setUint16(p+2,type,true);v.setUint32(p+4,1,true);v.setUint32(p+8,value,true);});
  t.set(thumb,56);const b=join(base.slice(0,2),segment(225,join(Buffer.from('Exif\0\0'),t)),base.slice(2));
  const r=clean(b,['thumbnail']);unknown(r);assert.match(r.unknown.join(' '),/thumbnail has additional metadata/);
});

test('FAILURE: unsupported PNG input gives Unknown',()=>unknown(clean(new Uint8Array([137,80,78,71,13,10,26,10]))));
test('FAILURE: empty, missing and truncated files give Unknown',()=>{for(const b of [undefined,new Uint8Array(),sample.slice(0,22),sample.slice(0,-2)])unknown(clean(b));});
test('FAILURE: bad JPEG segment length is rejected',()=>{const b=sample.slice();b[4]=255;b[5]=255;unknown(clean(b));});
test('FAILURE: out-of-bounds TIFF directory is rejected',()=>{const b=sample.slice();b.set([255,255,255,127],16);unknown(clean(b));});
test('FAILURE: cyclic TIFF directories are rejected',()=>{
  const b=sample.slice();const t=12,v=new DataView(b.buffer),count=v.getUint16(t+8,true);v.setUint32(t+8+2+count*12,8,true);unknown(clean(b));
});
test('FAILURE: TIFF directory entry limit is enforced',()=>{const b=sample.slice();b[20]=1;b[21]=1;unknown(clean(b));});
test('FAILURE: duplicate tag in a directory is rejected',()=>unknown(clean(fixture([{tag:0x110,data:txt('A')},{tag:0x110,data:txt('B')}]))));
test('FAILURE: unsupported TIFF field type is rejected',()=>unknown(clean(fixture([{tag:0x110,type:13,data:txt('A')}]))));
test('FAILURE: EXIF data overlapping an IFD is rejected',()=>{
  const b=fixture([{tag:0x110,data:txt('Long camera name')}]);new DataView(b.buffer).setUint32(12+10+8,8,true);unknown(clean(b));
});
test('FAILURE: file size limit is enforced',()=>unknown(clean(new Uint8Array(12*1024*1024+1))));
test('FAILURE: decoded dimension limit is checked before preview',()=>{
  const b=base.slice();let p=2;while(b[p+1]!==192){p+=2+((b[p+2]<<8)|b[p+3]);}b[p+5]=0x7f;b[p+6]=0xff;unknown(clean(b));
});
test('FAILURE: broken embedded thumbnail prevents cleaning',()=>{
  const b=sample.slice(),needle=Buffer.from([255,216,255,224]),at=Buffer.from(b).indexOf(needle,20);assert.ok(at>0);b[at]=0;unknown(clean(b));
});
test('FAILURE: malformed mutations cannot crash the pure function',()=>{
  let seed=71;for(let i=0;i<150;i++){const b=sample.slice();seed=(seed*1664525+1013904223)>>>0;b[seed%b.length]^=(seed>>>16)&255;const r=clean(b);assert.ok(['complete','unknown'].includes(r.status));if(r.status==='unknown')assert.equal(r.bytes,undefined);}
});
test('STATIC: scripts parse; assets and network policy are self-contained',()=>{
  for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){if(!match[1].includes('application/json'))new vm.Script(match[2]);}
  assert.doesNotMatch(html,/<(?:script|img|link)[^>]+(?:src|href)=["']https?:/i);
  assert.doesNotMatch(html,/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/);
  assert.match(html,/connect-src 'none'/);assert.match(html,/Nothing leaves your device\. No sign-up\. No cost\./);
  assert.match(html,/@media\(max-width:600px\)/);assert.match(html,/aria-live="polite"/);assert.match(html,/focus-visible/);
});
test('NORMAL: worker structured-clone round trip preserves byte input and output',async()=>{
  const {Worker}=require('node:worker_threads');
  const worker=new Worker('const {parentPort}=require("node:worker_threads");'+core.toString()+';parentPort.on("message",r=>parentPort.postMessage(photoCore(r)));',{eval:true});
  try{
    const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({action:'clean',bytes:sample,remove:groups});});
    assert.equal(result.status,'complete');assert.ok(result.bytes instanceof Uint8Array);assert.equal(inspect(result.bytes).count,0);
  }finally{await worker.terminate();}
});
