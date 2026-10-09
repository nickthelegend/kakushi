import { createServer } from 'node:http';
import { kakushiFromDisk } from '@kakushi/sdk/node';
import { currentNetwork } from '@kakushi/config';
import { scan } from './scanner.ts';
import { Store, json } from './store.ts';
const store = new Store(process.env.INDEXER_DB ?? '.data/indexer.sqlite');
const k = kakushiFromDisk(currentNetwork());
let lastError: string | null = null;
let lastSuccessfulScan: number | null = null;
let stopping = false;
const server = createServer((req,res)=>{
  const url = new URL(req.url ?? '/', 'http://localhost');
  res.setHeader('Content-Type','application/json');
  if(process.env.INDEXER_CORS_ORIGIN) res.setHeader('Access-Control-Allow-Origin',process.env.INDEXER_CORS_ORIGIN);
  if(req.method!=='GET') {res.statusCode=405;res.end(json({error:'GET required'}));return;}
  const limit = Math.min(200,Math.max(1,Number(url.searchParams.get('limit')??50)||50));
  const offset = Math.max(0,Number(url.searchParams.get('offset')??0)||0);
  let data:unknown;
  switch(url.pathname) {
    case '/health': data={network:k.network,lastSuccessfulScan,lastError,cursors:Object.values(k.d.chains).map(c=>({chainId:c.chainId,...store.cursor(c.chainId)}))};break;
    case '/transfers': {
      const maker=url.searchParams.get('maker')?.toLowerCase();
      const sender=url.searchParams.get('sender')?.toLowerCase();
      const transfers=store.transfers().filter(t=>(!maker || String((t.source??t.payout)?.args.maker).toLowerCase()===maker)&&(!sender || String(t.source?.args.sender).toLowerCase()===sender));
      data={total:transfers.length,items:transfers.slice(offset,offset+limit)};break;
    }
    case '/makers':data={items:store.makers()};break;
    case '/routes':data={items:store.routes()};break;
    case '/attestations':data={items:store.attestations()};break;
    case '/events':data={items:store.events().slice(offset,offset+limit)};break;
    default:res.statusCode=404;data={error:'Unknown endpoint'};
  }
  res.end(json(data));
});
server.listen(Number(process.env.INDEXER_PORT??4201),process.env.INDEXER_HOST??'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{stopping=true;server.close();});
while(!stopping) {
  try {await scan(k,store);lastSuccessfulScan=Date.now();lastError=null;} catch(error) {lastError=error instanceof Error?error.message:String(error);console.error('Indexer scan failed:',lastError);}
  if(!stopping) await new Promise(resolve=>{const timer=setTimeout(resolve,2000);timer.unref();});
}
store.close();
