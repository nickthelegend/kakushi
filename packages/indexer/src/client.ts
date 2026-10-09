import type { Store, Transfer, ObservedEvent } from './store.ts';
export interface Page<T> { total: number; items: T[] }
export class IndexerClient {
  readonly baseUrl: string;
  readonly fetcher: typeof fetch;
  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {this.baseUrl=baseUrl;this.fetcher=fetcher;}
  private async get<T>(path: string): Promise<T> {
    const response=await this.fetcher(new URL(path,this.baseUrl),{signal:AbortSignal.timeout(10_000)});
    if(!response.ok) throw new Error(`Indexer HTTP ${response.status}`);
    return await response.json() as T;
  }
  transfers(filters: {sender?:string;maker?:string;limit?:number;offset?:number} = {}): Promise<Page<Transfer>> {
    const query=new URLSearchParams(Object.entries(filters).map(([key,value])=>[key,String(value)]));
    return this.get(`/transfers?${query}`);
  }
  makers(): Promise<{items: ReturnType<Store['makers']>}> {return this.get('/makers');}
  routes(): Promise<{items: ReturnType<Store['routes']>}> {return this.get('/routes');}
  attestations(): Promise<{items: ReturnType<Store['attestations']>}> {return this.get('/attestations');}
  events(): Promise<{items:ObservedEvent[]}> {return this.get('/events');}
}
