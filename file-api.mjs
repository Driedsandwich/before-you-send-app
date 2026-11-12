// Local I/O adapters only. All inspection, removal and verification live in core.mjs.
import {open,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import photoCore from './core.mjs';
const LIMIT=12*1024*1024;
export class InputError extends Error{constructor(message){super(message);this.code='INVALID_ARGUMENT';}}
export function validateOptions(action,args){
  if(!args||typeof args!=='object'||Array.isArray(args))throw new InputError('Arguments must be an object.');
  const allowed=action==='inspect'?['path']:['path','outputPath','mode','keep'];
  if(Object.keys(args).some(k=>!allowed.includes(k)))throw new InputError('Unexpected argument.');
  for(const key of action==='inspect'?['path']:['path','outputPath'])if(typeof args[key]!=='string'||!args[key].length||args[key].includes('\0'))throw new InputError(key+' must be a nonempty local path.');
  if(args.mode!==undefined&&!['selective','all'].includes(args.mode))throw new InputError('mode must be selective or all.');
  if(args.keep!==undefined&&(!Array.isArray(args.keep)||args.keep.some(k=>!['date','device'].includes(k))||new Set(args.keep).size!==args.keep.length))throw new InputError('keep must contain unique date and/or device values.');
  if(args.mode==='all'&&args.keep!==undefined)throw new InputError('All-data removal cannot be combined with keep.');
}
export function failure(error,report){return {ok:false,status:'unknown',error:{code:error.code||'IO_ERROR',message:error.message},...(report?{report}:{})};}
async function readInput(path,stdin){
  let file;
  try{
    let stream;
    if(path==='-'&&stdin)stream=stdin;
    else{
      file=await open(path,constants.O_RDONLY|constants.O_NONBLOCK);
      const stat=await file.stat();
      if(!stat.isFile())throw new InputError('Input must be a regular file.');
      if(stat.size>LIMIT)throw Object.assign(new Error('File exceeds the 12 MiB limit.'),{code:'FILE_TOO_LARGE'});
      stream=file.createReadStream({autoClose:false,highWaterMark:65536});
    }
    let length=0;const chunks=[];
    for await(const chunk of stream){length+=chunk.length;if(length>LIMIT)throw Object.assign(new Error('File exceeds the 12 MiB limit.'),{code:'FILE_TOO_LARGE'});chunks.push(chunk);}
    return new Uint8Array(Buffer.concat(chunks));
  }finally{await file?.close();}
}
export async function execute(action,args,{stdin}={}){
  try{
    validateOptions(action,args);
    if(action==='clean'&&resolve(args.path)===resolve(args.outputPath))throw new InputError('Output must be a new file, separate from the original.');
    const bytes=await readInput(args.path,stdin);
    const request={action,bytes};
    if(action==='clean'){
      request.mode=args.mode||'selective';
      if(request.mode==='selective')request.remove=['gps','date','device','thumbnail'].filter(k=>!args.keep?.includes(k));
    }
    const result=photoCore(request);
    if(result.status!=='complete')return failure({code:'UNKNOWN',message:result.error||'Unknown: the check found unsupported hidden data.'},result);
    if(action==='inspect')return {ok:true,report:result};
    // Exclusive creation also rejects existing symlinks and hard links.
    const outputPath=resolve(args.outputPath);let file,created=false;
    try{file=await open(outputPath,'wx',0o600);created=true;await file.writeFile(result.bytes);await file.sync();}
    catch(error){if(file)await file.close();file=null;if(created)await unlink(outputPath).catch(()=>{});throw error;}
    finally{await file?.close();}
    return {ok:true,mode:request.mode,before:result.before,after:result.after,outputPath,bytesWritten:result.bytes.length,warnings:result.warnings||[]};
  }catch(error){return failure(error);}
}
