// VM-only UI wiring tests. No browser, extensions, rendering or screen automation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].at(-1)[2];
function setup(){
  class Element{
    hidden=true;disabled=false;textContent='';children=[];listeners={};attributes={};classList={add(){},remove(){}};
    append(...xs){this.children.push(...xs);}replaceChildren(...xs){this.children=xs;this.textContent='';}
    setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];delete this[k];}
    addEventListener(k,v){this.listeners[k]=v;}querySelectorAll(){return [];}focus(){}click(){}
  }
  const els=new Map(),get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id);};let urls=0;
  const context=vm.createContext({document:{getElementById:get,querySelectorAll:()=>[],createElement:()=>new Element()},window:{addEventListener(){}},URL:{revokeObjectURL(){},createObjectURL(){urls++;return 'blob:local-copy';}},Blob,crypto:{getRandomValues:a=>a.fill(1)},Uint8Array,console});
  vm.runInContext(ui,context);
  const run=code=>vm.runInContext(code,context);
  run("original=new Uint8Array([255,216]);report={status:'unknown',canRemoveAll:true};");
  const items={gps:{count:0},date:{count:0},device:{count:0},thumbnail:{count:0}};
  context.cleaned={status:'complete',bytes:new Uint8Array([255,216,255,217]),before:{status:'unknown',hiddenRegions:3,items},after:{status:'complete',hiddenRegions:0,count:0,items},warnings:['Orientation removed.','ICC removed.']};
  run('runCore=async request=>{globalThis.sent=request;return cleaned;};checkImage=async()=>{};');
  return {get,run,context,urlCount:()=>urls};
}
test('UI all-data action appears only for eligible Unknown, and disables while busy',()=>{const h=setup();h.run('updateChoices()');assert.equal(h.get('all-options').hidden,false);assert.equal(h.get('remove-all').disabled,false);h.run('busy=true;updateChoices()');assert.equal(h.get('remove-all').disabled,true);for(const value of ["{status:'complete',canRemoveAll:true}","{status:'unknown',canRemoveAll:false}",'null']){h.run('busy=false;report='+value+';updateChoices()');assert.equal(h.get('all-options').hidden,true);}});
test('UI all-data button calls shared core and displays verified region counts and warning',async()=>{const h=setup();await h.get('remove-all').listeners.click();assert.equal(h.context.sent.mode,'all');assert.equal(h.context.sent.remove,undefined);assert.equal(h.get('result').hidden,false);assert.equal(h.get('download').href,'blob:local-copy');const row=h.get('comparison-rows').children[0];assert.deepEqual(row.children.map(c=>c.textContent),['Hidden regions (APP / COM)','3','0']);assert.equal(h.get('all-result-note').hidden,false);assert.match(h.get('all-result-note').textContent,/Orientation/);});
test('UI blocks download if fresh verification is Unknown or regions remain',async()=>{for(const mutation of ["cleaned.status='unknown'",'cleaned.after.hiddenRegions=1']){const h=setup();h.run(mutation);await h.get('remove-all').listeners.click();assert.equal(h.urlCount(),0);assert.equal(h.get('download').href,undefined);assert.equal(h.get('result').hidden,true);}});
test('UI blocks download if the browser cannot decode the copy',async()=>{const h=setup();h.run("checkImage=async()=>{throw Error('Unknown: decode failed');}");await h.get('remove-all').listeners.click();assert.equal(h.urlCount(),0);assert.equal(h.get('result').hidden,true);});
test('UI cancellation ignores a late all-data result',async()=>{const h=setup();h.run('runCore=()=>new Promise(resolve=>{globalThis.finish=resolve;});');const pending=h.get('remove-all').listeners.click();h.get('cancel').listeners.click();h.context.finish(h.context.cleaned);await pending;assert.equal(h.urlCount(),0);assert.equal(h.get('result').hidden,true);});
test('UI undo restores the Unknown fallback so all-data cleaning can be retried',async()=>{const h=setup();await h.get('remove-all').listeners.click();assert.equal(h.get('notice').hidden,true);h.get('undo-removal').listeners.click();assert.equal(h.get('notice').hidden,false);assert.equal(h.get('all-options').hidden,false);assert.equal(h.get('result').hidden,true);assert.equal(h.get('download').href,undefined);await h.get('remove-all').listeners.click();assert.equal(h.get('result').hidden,false);});
