import { createServer } from 'node:http';
import { kakushiFromDisk } from '@kakushi/sdk/node';
import { currentNetwork } from '@kakushi/config';
import { scan } from './scanner.ts';
import { Store } from './store.ts';
import { createHandler } from './http.ts';
const store = new Store(process.env.INDEXER_DB ?? '.data/indexer.sqlite');
const k = kakushiFromDisk(currentNetwork());
let lastError: string | null = null;
let lastSuccessfulScan: number | null = null;
let stopping = false;
const server = createServer(createHandler(store,{
  health:()=>({network:k.network,lastSuccessfulScan,lastError,cursors:Object.values(k.d.chains).map(c=>({chainId:c.chainId,...store.cursor(c.chainId)}))}),
  chainIds:()=>Object.values(k.d.chains).map(c=>c.chainId),
  corsOrigin:process.env.INDEXER_CORS_ORIGIN || undefined,
}));
server.listen(Number(process.env.INDEXER_PORT??4201),process.env.INDEXER_HOST??'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{stopping=true;server.close();});
while(!stopping) {
  try {await scan(k,store);lastSuccessfulScan=Date.now();lastError=null;} catch(error) {lastError=error instanceof Error?error.message:String(error);console.error('Indexer scan failed:',lastError);}
  if(!stopping) await new Promise(resolve=>{const timer=setTimeout(resolve,2000);timer.unref();});
}
store.close();
