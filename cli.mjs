#!/usr/bin/env node
import {execute,failure,InputError,validateOptions} from './file-api.mjs';
const argv=process.argv.slice(2),json=argv.includes('--json');
const usage='Usage: node cli.mjs inspect [photo.jpg|-] --json\n       node cli.mjs clean [photo.jpg|-] --out copy.jpg [--keep date,device | --all] --json';
let result;
try{
  if(argv.length===1&&['--help','-h'].includes(argv[0])){process.stdout.write(usage+'\n');process.exit(0);}
  const action=argv.shift();if(!['inspect','clean'].includes(action))throw new InputError(usage);
  const args={};const seen=new Set();
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(['--json','--all','--out','--keep'].includes(arg)){
      if(seen.has(arg))throw new InputError('Duplicate option: '+arg);seen.add(arg);
      if(arg==='--json')continue;
      if(action!=='clean')throw new InputError(arg+' applies only to clean.');
      if(arg==='--all'){args.mode='all';continue;}
      const value=argv[++i];if(!value||value.startsWith('--'))throw new InputError('Missing value for '+arg);
      if(arg==='--out')args.outputPath=value;else args.keep=value.split(',');
    }else if(arg.startsWith('-')&&arg!=='-')throw new InputError('Unknown option: '+arg);
    else if(args.path!==undefined)throw new InputError('Choose one input file.');
    else args.path=arg;
  }
  args.path??='-';validateOptions(action,args);
  result=await execute(action,args,{stdin:process.stdin});
}catch(error){result=failure(error);}
process.exitCode=result.ok?0:result.error.code==='INVALID_ARGUMENT'?1:2;
if(json||!result.ok)process.stdout.write(JSON.stringify(result)+'\n');
else process.stdout.write(JSON.stringify(result,null,2)+'\n');
