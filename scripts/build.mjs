import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('core.mjs',root),'utf8');
if(!source.startsWith('export default function photoCore(')||source.includes('</script'))throw Error('Unexpected core module format');
const htmlPath=new URL('index.html',root),html=await readFile(htmlPath,'utf8');
const start='<!-- core:start -->',end='<!-- core:end -->';
if(html.split(start).length!==2||html.split(end).length!==2||html.indexOf(end)<html.indexOf(start))throw Error('Expected exactly one ordered core marker pair');
const output=html.slice(0,html.indexOf(start))+start+'\n<script id="photo-core">\n'+source.replace(/^export default /,'').trim()+'\n</script>\n'+html.slice(html.indexOf(end));
if(process.argv.includes('--check')){if(output!==html)throw Error('Embedded core is stale; run npm run build');}
else if(output!==html)await writeFile(htmlPath,output);
