// Source and VM checks only; no browser or visual rendering.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import photoCore from '../core.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ui=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].at(-1)[2];
const empty=html.match(/<section class="empty"[^>]*>([\s\S]*?)<\/section>/)[1];

function setup(){
  class Element {
    hidden=false;disabled=false;textContent='';children=[];listeners={};classList={add(){},remove(){}};
    append(...xs){this.children.push(...xs);}replaceChildren(...xs){this.children=xs;}
    setAttribute(k,v){this[k]=v;}removeAttribute(k){delete this[k];}
    addEventListener(k,v){this.listeners[k]=v;}querySelectorAll(){return [];}focus(){}
  }
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  get('sample-data').textContent=html.match(/<script id="sample-data"[^>]*>([\s\S]*?)<\/script>/)[1];
  const context=vm.createContext({document:{getElementById:get,querySelectorAll:()=>[],createElement:()=>new Element()},window:{addEventListener(){}},URL:{revokeObjectURL(){},createObjectURL:()=> 'blob:local'},Blob,Uint8Array,atob,photoCore});
  vm.runInContext(ui,context);
  const run=code=>vm.runInContext(code,context);
  run('runCore=async request=>photoCore(request);checkImage=async()=>{};');
  return {get,run};
}

test('Initial report preview contains three fictional rows with values, reasons and example selections',()=>{
  const preview=empty.match(/<aside[^>]*class="report-preview"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
  assert.ok(preview,'Preview belongs inside the initial section, so it hides with that section');
  assert.match(preview,/Report preview • Fictional data/);
  const headers=[...preview.matchAll(/<th scope="col">(.*?)<\/th>/g)].map(m=>m[1]);
  assert.deepEqual(headers,['Hidden data','Found in file','What this can reveal','Remove']);
  const rows=[...preview.matchAll(/<tr><th scope="row">([\s\S]*?)<\/tr>/g)];
  assert.equal(rows.length,3);
  for(const row of rows){assert.equal([...row[1].matchAll(/<td[ >]/g)].length,3);assert.match(row[1],/Can (reveal|identify)/);assert.match(row[1],/Remove/);}
  assert.match(preview,/12\.3456, 65\.4321 \(fictional\)/);
  assert.match(preview,/2026-04-18 09:41 \(fictional\)/);
  assert.match(preview,/Demo Camera 01/);
  assert.match(preview,/Example selections/);
  assert.doesNotMatch(preview,/<input/);
  assert.match(preview,/<button type="button" id="preview-sample">Try sample photo<\/button>/);
});

test('Preview layout fills desktop width while leaving original and 390px styles unchanged',()=>{
  const originalCSS=html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.equal(createHash('sha256').update(originalCSS).digest('hex'),'8a004715ebe6228925935d965a9e0c681e747a4d74c5a11af190aa4742440c3c');
  const css=html.match(/<style id="initial-preview-styles">([\s\S]*?)<\/style>/)?.[1];
  assert.ok(css,'Dedicated desktop-only preview styles exist');
  const [base,desktop]=css.split(/@media\s*\(min-width:\s*1001px\)\s*\{/);
  assert.equal(base.trim(),'.report-preview{display:none}');
  assert.match(desktop,/\.empty\s*\{[^}]*display:grid/);
  assert.match(desktop,/\.empty\s*\{[^}]*max-width:none/);
  assert.match(desktop,/\.empty\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.7fr\)/);
  assert.match(desktop,/\.report-preview\s*\{[^}]*display:block/);
  assert.match(html,/<p class="privacy">Nothing leaves your device\. No sign-up\. No cost\.<\/p>/);
  assert.match(html,/<button type="button" id="sample">Try sample photo<\/button>/);
});

test('Both sample buttons load the same fictional photo and hide the initial preview',async()=>{
  for(const id of ['sample','preview-sample']){
    const h=setup();assert.equal(typeof h.get(id).listeners.click,'function');
    await h.get(id).listeners.click();
    assert.equal(h.run('report.count'),4);
    assert.equal(h.get('file-name').textContent,'room-bike.jpg');
    assert.equal(h.get('empty').hidden,true);
    assert.equal(h.get('report').hidden,false);
    assert.equal(h.get('rows').children.length,4);
    h.get('reset').listeners.click();
    assert.equal(h.get('empty').hidden,false);
    assert.equal(h.get('report').hidden,true);
  }
});

test('Additional sample action disables during processing and recovers on cancellation',async()=>{
  const h=setup();assert.equal(typeof h.get('preview-sample').listeners.click,'function');
  h.run('runCore=()=>new Promise(resolve=>{globalThis.finish=resolve;});');
  const pending=h.get('preview-sample').listeners.click();
  assert.equal(h.get('sample').disabled,true);
  assert.equal(h.get('preview-sample').disabled,true);
  h.get('cancel').listeners.click();
  assert.equal(h.get('preview-sample').disabled,false);
  h.run('finish({status:"complete",count:0});');await pending;
  assert.equal(h.get('empty').hidden,false);
  assert.equal(h.get('report').hidden,true);
});
