export default function photoCore(request) {
  'use strict';
  // Pure byte-in / value-out boundary. No DOM, storage, network, or image decoder.
  const groups = ['gps', 'date', 'device', 'thumbnail'];
  const fail = message => { throw new Error(message); };
  const concat = parts => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0; for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  };
  const bytes = request?.bytes;
  const empty = () => Object.fromEntries(groups.map(k => [k, []]));
  const ascii = a => Array.from(a, n => n >= 32 && n < 127 ? String.fromCharCode(n) : n === 0 ? '' : '�').join('').trim();
  const starts = (a, s) => s.split('').every((v, i) => a[i] === v.charCodeAt(0));
  function exif(payload, found, unknown, jpegDepth) {
    const t = payload.slice(6), v = new DataView(t.buffer);
    if (t.length < 8) fail('Truncated EXIF header.');
    const le = t[0] === 73 && t[1] === 73;
    if (!le && !(t[0] === 77 && t[1] === 77)) fail('Unknown EXIF byte order.');
    const range = (o, n) => { if (!Number.isSafeInteger(o) || o < 0 || o + n > t.length) fail('EXIF points outside its segment.'); };
    const u16 = o => { range(o, 2); return v.getUint16(o, le); };
    const u32 = o => { range(o, 4); return v.getUint32(o, le); };
    if (u16(2) !== 42) fail('Invalid TIFF signature.');
    const sizes = {1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8};
    const occupied = [[0,8]], seen = new Set();
    const claim = (a, n) => {
      range(a,n); if (!n) return;
      if (occupied.some(([b,e]) => a < e && a+n > b)) fail('Overlapping EXIF fields are not supported.');
      occupied.push([a,a+n]);
    };
    const dateTags = [0x132,0x9003,0x9004,0x9010,0x9011,0x9012,0x9290,0x9291,0x9292];
    const deviceTags = [0x10f,0x110,0xa430,0xa431,0xa433,0xa434,0xa435];
    // Conservative allowlist: rendering, exposure, and encoding information.
    const neutral = new Set([0x100,0x101,0x102,0x103,0x106,0x112,0x115,0x11a,0x11b,0x11c,0x128,
      0x829a,0x829d,0x8822,0x8827,0x8830,0x9000,0x9101,0x9102,0x9201,0x9202,0x9203,0x9204,
      0x9205,0x9206,0x9207,0x9208,0x9209,0x920a,0xa000,0xa001,0xa002,0xa003,0xa20e,0xa20f,
      0xa210,0xa217,0xa300,0xa301,0xa401,0xa402,0xa403,0xa404,0xa405,0xa406,0xa407,0xa408,0xa409,0xa40a,0xa40c,0xa432]);
    function readIFD(offset, kind, depth) {
      if (!offset) return null;
      if (depth > 3 || seen.has(offset)) fail('Cyclic or excessively nested EXIF.');
      seen.add(offset);
      const count = u16(offset);
      if (count > 256) fail('EXIF entry limit exceeded.');
      claim(offset, 2 + count*12 + 4);
      const node = {kind, entries:[], child:null, gps:null, next:null, thumb:null};
      const tags = new Set();
      for (let i=0; i<count; i++) {
        const p=offset+2+i*12, tag=u16(p), type=u16(p+2), n=u32(p+4);
        if (tags.has(tag)) fail('Duplicate EXIF tag in one directory.');
        tags.add(tag);
        if (!sizes[type] || n > 65535) fail('Unsupported EXIF field type or count.');
        const len=n*sizes[type], dataAt=len>4 ? u32(p+8) : p+8;
        range(dataAt,len); if (len>4) claim(dataAt,len);
        const e={tag,type,n,data:t.slice(dataAt,dataAt+len),group:null};
        if ([0x8769,0x8825].includes(tag)) {
          if (kind !== 'main' || type!==4 || n!==1) fail('Unsupported EXIF directory link.');
          const target=u32(p+8);
          if (!target) fail('Empty EXIF directory link.');
          e.link=tag===0x8769 ? 'child':'gps'; e.target=target;
        } else if (kind==='thumb') {
          if (![0x100,0x101,0x103,0x11a,0x11b,0x128,0x201,0x202].includes(tag)) unknown.push('Unsupported thumbnail tag 0x'+tag.toString(16)+'.');
        } else if (kind==='gps') {
          e.group='gps';
          if (tag>31) unknown.push('Unsupported GPS tag.');
          if ([7,29].includes(tag)) unknown.push('GPS timestamps are outside the supported date handling.');
        } else if (dateTags.includes(tag)) {
          if (type!==2) fail('Date field has an unexpected type.');
          e.group='date'; found.date.push(ascii(e.data)||'Present; value unreadable');
        } else if (deviceTags.includes(tag)) {
          if (type!==2) fail('Device field has an unexpected type.');
          e.group='device'; found.device.push(ascii(e.data)||'Present; value unreadable');
        } else if (!neutral.has(tag)) unknown.push('Unsupported EXIF tag 0x'+tag.toString(16)+'.');
        if(e.group==='date'||e.group==='device') {
          if(!n||e.data[n-1]!==0||e.data.slice(0,-1).some(c=>c<32||c>126)) unknown.push('An EXIF text value could not be interpreted.');
          if(!ascii(e.data)) unknown.push('An EXIF text value is empty.');
          if([0x132,0x9003,0x9004].includes(tag)&&!/^\d{4}:(0[1-9]|1[0-2]):(0[1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(ascii(e.data))) unknown.push('An EXIF date has an unknown format.');
        }
        node.entries.push(e);
      }
      for (const e of node.entries.filter(e=>e.link)) node[e.link]=readIFD(e.target,e.link==='gps'?'gps':'exif',depth+1);
      const next=u32(offset+2+count*12);
      if (next) {
        if (kind!=='main') fail('Unsupported additional EXIF directory.');
        node.next=readIFD(next,'thumb',depth+1);
      }
      if (kind==='gps') {
        const get=tag=>node.entries.find(e=>e.tag===tag);
        const deg=e=>{
          if (!e || e.type!==5 || e.n!==3) return null;
          const d=new DataView(e.data.buffer); let out=0;
          for(let i=0;i<3;i++){const den=d.getUint32(i*8+4,le); if(!den) return null; const part=d.getUint32(i*8,le)/den;if(i>0&&part>=60)return null;out+=part/[1,60,3600][i];}
          return out;
        };
        const lat=deg(get(2)), lon=deg(get(4)), ns=get(1), ew=get(3);
        const a=ns&&ascii(ns.data), b=ew&&ascii(ew.data);
        if(lat!==null&&lon!==null&&lat<=90&&lon<=180&&['N','S'].includes(a)&&['E','W'].includes(b)) {
          found.gps.push(((a==='S'?-1:1)*lat).toFixed(4)+', '+((b==='W'?-1:1)*lon).toFixed(4));
        } else {
          found.gps.push('GPS fields present; coordinates Unknown');
          unknown.push('GPS coordinates could not be interpreted.');
        }
      }
      if(kind==='thumb') {
        const scalar=tag=>{
          const e=node.entries.find(x=>x.tag===tag);
          if(!e || ![3,4].includes(e.type)||e.n!==1) fail('Incomplete thumbnail directory.');
          return e.type===3?new DataView(e.data.buffer).getUint16(0,le):new DataView(e.data.buffer).getUint32(0,le);
        };
        if(scalar(0x103)!==6) fail('Only JPEG EXIF thumbnails are supported.');
        const at=scalar(0x201), len=scalar(0x202); claim(at,len);
        node.thumb=t.slice(at,at+len);
        if(len<4 || node.thumb[0]!==255 || node.thumb[1]!==216 || node.thumb[len-2]!==255 || node.thumb[len-1]!==217) fail('Invalid embedded thumbnail.');
        const inner=inspect(node.thumb,jpegDepth+1);
        if(inner.count||inner.unknown.length) unknown.push('Embedded thumbnail has additional metadata that cannot be checked completely.');
        found.thumbnail.push('1 preview');
      }
      return node;
    }
    const root=readIFD(u32(4),'main',0);
    if(!root) fail('Missing EXIF directory.');
    occupied.sort((a,b)=>a[0]-b[0]);
    let cursor=0;
    for(const [a,b] of [...occupied,[t.length,t.length]]) {
      if(t.subarray(cursor,a).some(n=>n!==0)) unknown.push('Unmapped EXIF bytes.');
      cursor=Math.max(cursor,b);
    }
    return {root,le};
  }
  function rebuild(tree, remove) {
    function filter(n) {
      if(!n || (n.kind==='gps'&&remove.has('gps')) || (n.kind==='thumb'&&remove.has('thumbnail'))) return null;
      const c={...n, child:filter(n.child),gps:filter(n.gps),next:filter(n.next)};
      c.entries=n.entries.filter(e=>!remove.has(e.group)&&(!e.link||c[e.link]));
      return c.entries.length || c.next ? c : null;
    }
    const root=filter(tree.root); if(!root) return null;
    const nodes=[];
    function flatten(n){if(!n)return;nodes.push(n);flatten(n.child);flatten(n.gps);flatten(n.next);}
    flatten(root);
    let at=8;
    for(const n of nodes){n.offset=at;at+=2+12*n.entries.length+4;}
    for(const n of nodes){
      n.places=new Map();
      for(const e of n.entries) if(e.data.length>4){n.places.set(e,at);at+=e.data.length; if(at%2)at++;}
      if(n.thumb){n.thumbAt=at;at+=n.thumb.length; if(at%2)at++;}
    }
    const out=new Uint8Array(at), d=new DataView(out.buffer), le=tree.le;
    const w16=(p,x)=>d.setUint16(p,x,le), w32=(p,x)=>d.setUint32(p,x,le);
    out[0]=out[1]=le?73:77;w16(2,42);w32(4,root.offset);
    for(const n of nodes){
      w16(n.offset,n.entries.length);
      n.entries.forEach((e,i)=>{
        const p=n.offset+2+i*12;w16(p,e.tag);w16(p+2,e.type);w32(p+4,e.n);
        if(e.link) w32(p+8,n[e.link].offset);
        else if(n.kind==='thumb'&&e.tag===0x201) {if(e.type===3)w16(p+8,n.thumbAt);else w32(p+8,n.thumbAt);}
        else if(e.data.length>4){w32(p+8,n.places.get(e));out.set(e.data,n.places.get(e));}
        else out.set(e.data,p+8);
      });
      w32(n.offset+2+12*n.entries.length,n.next?n.next.offset:0);
      if(n.thumb)out.set(n.thumb,n.thumbAt);
    }
    return concat([new Uint8Array([69,120,105,102,0,0]),out]);
  }
  function inspect(b, depth=0, structureOnly=false) {
    if(depth>1) fail('Nested metadata thumbnails are not supported.');
    if(!(b instanceof Uint8Array) || b.length<4) fail('Missing or truncated image.');
    if(b.length>12*1024*1024) fail('File exceeds the 12 MiB limit.');
    if(b[0]!==255 || b[1]!==216) fail('Unsupported format. Choose a JPEG file; PNG is not supported in this prototype.');
    const found=empty(),unknown=[],parts=[{raw:b.slice(0,2)}];
    let p=2, end=false, scans=0, width=0,height=0, segments=0, frames=0, hiddenRegions=0, structureSafe=true;
    const quant=new Set(),huffman=new Set(),components=new Map();let progressive=false;
    while(p<b.length) {
      if(++segments>2048) fail('JPEG segment limit exceeded.');
      const start=p;
      if(b[p++]!==255) fail('Invalid JPEG marker.');
      while(b[p]===255)p++;
      const marker=b[p++];
      if(marker===217){parts.push({raw:b.slice(start,p)});end=true;if(p!==b.length){structureSafe=false;unknown.push('Extra data after the JPEG end marker.');}break;}
      if(marker===216||marker===0||marker===1||(marker>=208&&marker<=215)) fail('Unexpected JPEG marker.');
      if(p+2>b.length)fail('Truncated JPEG segment.');
      const size=(b[p]<<8)|b[p+1];
      if(size<2||p+size>b.length) fail('Invalid JPEG segment length.');
      const payload=b.slice(p+2,p+size),part={raw:b.slice(start,p+size),marker,payload};
      p+=size;
      if((marker>=224&&marker<=239)||marker===254)hiddenRegions++;
      if(structureOnly&&((marker>=224&&marker<=239)||marker===254)){}
      else if(marker===225 && starts(payload,'Exif\0\0')) part.tree=exif(payload,found,unknown,depth);
      else if(marker===224 && starts(payload,'JFIF\0')) {
        if(payload.length<14)fail('Truncated JFIF header.');
        const len=3*payload[12]*payload[13];
        if(payload.length!==14+len) unknown.push('Unmapped JFIF data.');
        if(len){found.thumbnail.push('1 JFIF preview');part.jfifThumb=true;}
      } else if(marker>=224&&marker<=239) unknown.push('Unsupported JPEG APP'+(marker-224)+' block (may contain XMP, IPTC, ICC, or other data).');
      else if(marker===254) unknown.push('JPEG comment is outside the supported fields.');
      else if(![192,194,196,219,221,218].includes(marker)){structureSafe=false;unknown.push('Unsupported JPEG encoding marker.');}
      if(marker===219){
        let at=0;if(!payload.length)fail('Empty JPEG quantization table.');
        while(at<payload.length){const info=payload[at++],precision=info>>4,id=info&15;
          if(precision>1||id>3||at+64*(precision+1)>payload.length)fail('Invalid JPEG quantization table.');
          for(let i=0;i<64;i++){const n=precision?(payload[at]<<8)|payload[at+1]:payload[at];if(!n)fail('Zero JPEG quantization value.');at+=precision+1;}quant.add(id);
        }
      }
      if(marker===196){
        let at=0;if(!payload.length)fail('Empty JPEG Huffman table.');
        while(at<payload.length){const info=payload[at++];if((info>>4)>1||(info&15)>3||at+16>payload.length)fail('Invalid JPEG Huffman table.');
          let total=0,slots=1;for(let i=0;i<16;i++){const n=payload[at++];total+=n;slots=slots*2-n;if(slots<0)fail('Oversubscribed JPEG Huffman table.');}
          if(!total||total>256||at+total>payload.length)fail('Truncated JPEG Huffman symbols.');
          at+=total;huffman.add(info);
        }
      }
      if(marker===221&&payload.length!==2)fail('Invalid JPEG restart interval.');
      if(marker===192||marker===194){
        if(frames||scans)fail('Unexpected additional JPEG frame.');progressive=marker===194;
        if(payload.length<6)fail('Truncated JPEG frame.');
        height=(payload[1]<<8)|payload[2];width=(payload[3]<<8)|payload[4];frames++;
        if(payload[0]!==8 || ![1,3].includes(payload[5]) || payload.length!==6+3*payload[5]) fail('Unsupported JPEG frame layout.');
        if(!width||!height||width>12000||height>12000||width*height>24000000)fail('Image exceeds the 24 megapixel / 12,000 pixel edge limit.');
        for(let at=6;at<payload.length;at+=3){const id=payload[at],sampling=payload[at+1],q=payload[at+2];if(components.has(id)||!(sampling>>4)||!(sampling&15)||(sampling>>4)>4||(sampling&15)>4||q>3)fail('Invalid JPEG frame component.');components.set(id,q);}
      }
      parts.push(part);
      if(marker===218) {
        const n=payload[0];if(!frames||!n||n>components.size||payload.length!==4+2*n)fail('Invalid JPEG scan header.');
        const ss=payload[1+2*n],se=payload[2+2*n],approx=payload[3+2*n],ah=approx>>4,al=approx&15;
        if(!progressive&&(ss!==0||se!==63||approx!==0))fail('Invalid baseline JPEG scan.');
        if(progressive&&(ss>se||se>63||(ss===0&&se!==0)||(ss>0&&n!==1)||ah>13||al>13||(ah&&ah!==al+1)))fail('Invalid progressive JPEG scan.');
        const seen=new Set();for(let i=0;i<n;i++){const id=payload[1+2*i],sel=payload[2+2*i],dc=sel>>4,ac=sel&15;
          if(!components.has(id)||seen.has(id)||!quant.has(components.get(id))||dc>3||ac>3)fail('Invalid JPEG scan component or missing quantization table.');seen.add(id);
          if((!progressive||ss===0&&!ah)&&!huffman.has(dc))fail('Missing JPEG DC table.');
          if((!progressive||ss>0)&&!huffman.has(16+ac))fail('Missing JPEG AC table.');
        }
        scans++;const entropyStart=p;let next=false;
        while(p<b.length){
          if(b[p]!==255){p++;continue;}
          let q=p+1;while(b[q]===255)q++;
          if(b[q]===0||(b[q]>=208&&b[q]<=215)){p=q+1;continue;}
          next=true;break;
        }
        if(!next||p===entropyStart)fail('Truncated or empty JPEG image scan.');
        parts.push({raw:b.slice(entropyStart,p),entropy:true});
      }
    }
    if(!end||!scans||frames!==1)fail('Incomplete or unsupported JPEG structure.');
    const items=Object.fromEntries(groups.map(k=>[k,{count:found[k].length?1:0,values:k==='thumbnail'&&found[k].length?[found[k].length+' preview'+(found[k].length===1?'':'s')]:[...new Set(found[k])]}]));
    return {items,count:groups.filter(k=>items[k].count).length,unknown:[...new Set(unknown)],width,height,parts,hiddenRegions,structureSafe};
  }
  const publicReport=r=>({status:r.unknown.length?'unknown':'complete',items:r.items,count:r.unknown.length?null:r.count,unknown:r.unknown,width:r.width,height:r.height,hiddenRegions:r.hiddenRegions,canRemoveAll:r.structureSafe});
  try {
    if(!request||!['inspect','clean'].includes(request.action))fail('Unknown action.');
    if(request.mode!==undefined&&!['selective','all'].includes(request.mode))fail('Unknown cleaning mode.');
    if(request.action==='clean'&&request.mode==='all'){
      if(request.remove!==undefined)fail('All-data removal cannot keep or select individual fields.');
      const structure=inspect(bytes,0,true);
      if(!structure.structureSafe)fail('Unsupported or damaged JPEG structure prevents all-data removal.');
      let before;
      try{before=publicReport(inspect(bytes));}catch(error){before={...publicReport(structure),status:'unknown',count:null,unknown:[error.message],items:empty()};}
      // Drop every APPn and COM, even between scans; preserve image bytes exactly.
      const output=concat(structure.parts.filter(p=>!((p.marker>=224&&p.marker<=239)||p.marker===254)).map(p=>p.raw));
      // Fresh full inspection: never infer a zero from what was selected for removal.
      const after=inspect(output);
      if(after.hiddenRegions!==0||after.unknown.length||after.count!==0||!after.structureSafe)fail('Hidden regions remain after re-reading the copy.');
      return {status:'complete',mode:'all',before,after:publicReport(after),bytes:output,warnings:[
        'EXIF Orientation was removed. The photo may appear sideways or mirrored; pixels are not rotated.',
        'ICC color profiles were removed. Colors may look different.',
        'Zero APP/COM regions is not a safety guarantee. Visible content and encoded pixels are not checked.'
      ]};
    }
    const before=inspect(bytes);
    if(request.action!=='clean')return publicReport(before);
    if(before.unknown.length)return {...publicReport(before),error:'Unknown: unsupported data prevents a verified copy.'};
    const remove=new Set(request.remove||[]);
    if([...remove].some(k=>!groups.includes(k)))fail('Unknown removal selection.');
    if(!remove.size)fail('Select at least one detected field to remove.');
    const output=[];
    for(const part of before.parts){
      if(part.tree){
        const payload=rebuild(part.tree,remove);if(!payload)continue;
        if(payload.length+2>65535)fail('Rebuilt EXIF exceeds the JPEG segment limit.');
        output.push(new Uint8Array([255,225,(payload.length+2)>>8,(payload.length+2)&255]),payload);
      } else if(part.jfifThumb&&remove.has('thumbnail')){
        const h=part.payload.slice(0,14);h[12]=h[13]=0;output.push(new Uint8Array([255,224,0,16]),h);
      } else output.push(part.raw);
    }
    const clean=concat(output),after=inspect(clean);
    if(after.unknown.length)fail('The copy could not be fully re-read.');
    for(const key of groups){
      if(remove.has(key)&&after.items[key].count)fail('Selected fields remain after re-reading.');
      if(!remove.has(key)&&JSON.stringify(before.items[key])!==JSON.stringify(after.items[key]))fail('An unselected field changed.');
    }
    return {status:'complete',before:publicReport(before),after:publicReport(after),bytes:clean};
  } catch(error) {
    return {status:'unknown',count:null,items:empty(),unknown:[error.message],error:'Unknown: '+error.message};
  }
}
