import type { Store, Transfer, ObservedEvent } from './store.ts';
import type { PointsView, QuestState, Ranked, ReferralView } from './points.ts';
import type { ChainStatsView, OverviewView } from './stats.ts';
export type { PointsView, QuestState, Ranked, ReferralView, ChainStatsView, OverviewView };
export interface Page<T> { total: number; items: T[] }
/** Non-2xx indexer response; `code` carries the referral rejection code when present. */
export class IndexerHttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string | undefined, code: string | undefined) {super(message ? `Indexer HTTP ${status}: ${message}` : `Indexer HTTP ${status}`);this.status=status;this.code=code;}
}
export class IndexerClient {
  readonly baseUrl: string;
  readonly fetcher: typeof fetch;
  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {this.baseUrl=baseUrl;this.fetcher=fetcher;}
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response=await this.fetcher(new URL(path,this.baseUrl),{...init,signal:AbortSignal.timeout(10_000)});
    if(!response.ok) {
      const body=await response.json().catch(()=>({})) as {error?:string;code?:string};
      throw new IndexerHttpError(response.status,body.error,body.code);
    }
    return await response.json() as T;
  }
  private get<T>(path: string): Promise<T> {return this.request(path);}
  transfers(filters: {sender?:string;maker?:string;limit?:number;offset?:number} = {}): Promise<Page<Transfer>> {
    const query=new URLSearchParams(Object.entries(filters).map(([key,value])=>[key,String(value)]));
    return this.get(`/transfers?${query}`);
  }
  makers(): Promise<{items: ReturnType<Store['makers']>}> {return this.get('/makers');}
  routes(): Promise<{items: ReturnType<Store['routes']>}> {return this.get('/routes');}
  attestations(): Promise<{items: ReturnType<Store['attestations']>}> {return this.get('/attestations');}
  events(): Promise<{items:ObservedEvent[]}> {return this.get('/events');}
  points(address: string): Promise<PointsView> {return this.get(`/points?${new URLSearchParams({address})}`);}
  quests(address?: string): Promise<{items: QuestState[]}> {return this.get(address ? `/quests?${new URLSearchParams({address})}` : '/quests');}
  leaderboard(page: {limit?:number;offset?:number} = {}): Promise<Page<Ranked>> {
    const query=new URLSearchParams(Object.entries(page).map(([key,value])=>[key,String(value)]));
    return this.get(`/leaderboard?${query}`);
  }
  chainStats(hours?: number): Promise<ChainStatsView> {return this.get(hours===undefined ? '/stats/chains' : `/stats/chains?hours=${hours}`);}
  overview(): Promise<OverviewView> {return this.get('/stats/overview');}
  referral(address: string): Promise<ReferralView> {return this.get(`/referral?${new URLSearchParams({address})}`);}
  /** Signature: personal_sign by `referee` over `Kakushi referral\nReferrer: ${referrer}\nAccount: ${referee}` (lowercase). */
  bindReferral(body: {referee:string;referrer:string;signature:string}): Promise<{ok:true}> {
    return this.request('/referral',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  }
}
