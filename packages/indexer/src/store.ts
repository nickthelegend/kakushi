import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ObservedEvent { chainId: number; blockNumber: number; blockHash: string; timestamp: number; txHash: string; logIndex: number; name: string; args: Record<string, unknown> }
export interface Transfer { srcRef: string; source: ObservedEvent | null; payout: ObservedEvent | null; dispute: ObservedEvent | null; status: 'pending' | 'filled' | 'refunded' | 'disputed' | 'slashed' | 'maker-proven' | 'expired' | 'source-unobserved'; latencyMs: number | null }
export interface ReferralBinding { referee: string; referrer: string; signature: string; boundAt: number }
export const json = (value: unknown): string => JSON.stringify(value, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v);
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS events(chain INTEGER, block INTEGER, hash TEXT, tx TEXT, idx INTEGER, name TEXT, data TEXT NOT NULL, PRIMARY KEY(chain,tx,idx,name));');
    this.db.exec('CREATE TABLE IF NOT EXISTS cursors(chain INTEGER PRIMARY KEY, block INTEGER NOT NULL, hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS heads(chain INTEGER PRIMARY KEY, block INTEGER NOT NULL, timestamp INTEGER NOT NULL, observedAt INTEGER NOT NULL)');
    // Signed referral bindings (not chain data, but replay-safe: scanning never touches this table and the referee key makes the first binding immutable).
    this.db.exec('CREATE TABLE IF NOT EXISTS referrals(referee TEXT PRIMARY KEY, referrer TEXT NOT NULL, signature TEXT NOT NULL, boundAt INTEGER NOT NULL)');
  }
  referral(referee: string): ReferralBinding | undefined {
    return this.db.prepare('SELECT referee,referrer,signature,boundAt FROM referrals WHERE referee=?').get(referee.toLowerCase()) as ReferralBinding | undefined;
  }
  referrals(): ReferralBinding[] {
    return this.db.prepare('SELECT referee,referrer,signature,boundAt FROM referrals ORDER BY boundAt, referee').all() as unknown as ReferralBinding[];
  }
  /** Inserts a binding unless the referee already has one; returns whether this call bound it. */
  bindReferral(binding: ReferralBinding): boolean {
    return Number(this.db.prepare('INSERT OR IGNORE INTO referrals VALUES(?,?,?,?)').run(binding.referee.toLowerCase(),binding.referrer.toLowerCase(),binding.signature,binding.boundAt).changes)===1;
  }
  cursor(chain: number): { block: number; hash: string } | undefined {
    return this.db.prepare('SELECT block,hash FROM cursors WHERE chain=?').get(chain) as { block: number; hash: string } | undefined;
  }
  commit(chain: number, block: number, hash: string, events: ObservedEvent[]): void {
    this.db.exec('BEGIN');
    try {
      for (const e of events) {
        if(e.chainId!==chain || e.blockNumber!==block || e.blockHash!==hash) throw new Error('Event does not belong to committed block');
        this.db.prepare('INSERT OR REPLACE INTO events VALUES(?,?,?,?,?,?,?)').run(e.chainId,e.blockNumber,e.blockHash,e.txHash,e.logIndex,e.name,json(e));
      }
      this.db.prepare('INSERT OR REPLACE INTO cursors VALUES(?,?,?)').run(chain,block,hash);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  events(): ObservedEvent[] {
    return this.db.prepare('SELECT data FROM events').all().map(row => JSON.parse(row.data as string) as ObservedEvent).sort((a,b)=>a.timestamp-b.timestamp || a.chainId-b.chainId || a.blockNumber-b.blockNumber || a.logIndex-b.logIndex);
  }
  transfers(): Transfer[] {
    const map = new Map<string, Transfer>();
    const keys = new Map<string,string>();
    const events = this.events();
    for (const e of events) if (e.name === 'DisputeOpened') keys.set(String(e.args.disputeKey), String(e.args.srcRef));
    for (const e of events) {
      const ref = e.args.srcRef ?? keys.get(String(e.args.disputeKey));
      if (!ref) continue;
      const t = map.get(String(ref)) ?? { srcRef: String(ref), source: null, payout: null, dispute: null, status: 'source-unobserved', latencyMs: null };
      if (e.name === 'SourcePayment') t.source = e;
      if (e.name === 'Payout') t.payout = e;
      if (e.name.startsWith('Dispute')) t.dispute = e;
      map.set(t.srcRef,t);
    }
    for (const t of map.values()) {
      t.status = t.payout ? (String(t.payout.args.kind) === '2' ? 'filled' : 'refunded') : t.source ? 'pending' : 'source-unobserved';
      if (t.dispute) t.status = ({ DisputeOpened:'disputed',DisputeSlashed:'slashed',DisputeMakerProven:'maker-proven',DisputeExpired:'expired' } as const)[t.dispute.name as 'DisputeOpened'] ?? t.status;
      if (t.source && t.payout) t.latencyMs = Math.max(0,(t.payout.timestamp-t.source.timestamp)*1000);
    }
    return [...map.values()].sort((a,b)=>(b.source?.timestamp ?? b.payout?.timestamp ?? 0)-(a.source?.timestamp ?? a.payout?.timestamp ?? 0));
  }
  makers() {
    const transfers = this.transfers();
    const addresses = new Set(this.events().map(e=>String(e.args.maker ?? '').toLowerCase()).filter(Boolean));
    return [...addresses].map(maker=>{
      const own = transfers.filter(t=>String((t.source ?? t.payout ?? t.dispute)?.args.maker).toLowerCase()===maker);
      const fills = own.filter(t=>t.payout && String(t.payout.args.kind)==='2');
      const latencies = fills.map(t=>t.latencyMs).filter((x): x is number=>x!==null).sort((a,b)=>a-b);
      const percentile = (p:number)=>latencies.length ? latencies[Math.ceil(latencies.length*p)-1] ?? null : null;
      const volumeByToken: Record<string,string> = {};
      for(const t of fills) { const e=t.payout!; const key=`${e.chainId}:${String(e.args.token).toLowerCase()}`; volumeByToken[key]=(BigInt(volumeByToken[key]??'0')+BigInt(String(e.args.amount))).toString(); }
      const marginByToken: Record<string,string> = {};
      for(const e of this.events()) if(String(e.args.maker).toLowerCase()===maker && e.name.startsWith('Margin')) {
        const token=String(e.args.token).toLowerCase();
        if(e.args.total!==undefined || e.args.remaining!==undefined) marginByToken[token]=String(e.args.total ?? e.args.remaining);
        else if(e.name==='MarginSlashed' && marginByToken[token]!==undefined) marginByToken[token]=(BigInt(marginByToken[token]!)-BigInt(String(e.args.paid))).toString();
      }
      return { maker, observedSources:own.filter(t=>t.source).length, fills:fills.length, observedFillRate: own.filter(t=>t.source).length ? own.filter(t=>t.source && t.payout && String(t.payout.args.kind)==='2').length/own.filter(t=>t.source).length : null, refunds:own.filter(t=>t.payout && String(t.payout.args.kind)==='3').length, disputesLost:own.filter(t=>t.dispute?.name==='DisputeSlashed').length, p50LatencyMs:percentile(.5),p95LatencyMs:percentile(.95),volumeByToken,marginByToken };
    });
  }
  observeHead(chain: number, block: number, timestamp: number, observedAt = Date.now()): void {
    this.db.prepare('INSERT OR REPLACE INTO heads VALUES(?,?,?,?)').run(chain,block,timestamp,observedAt);
  }
  routes() {
    const registrations = this.events().filter(e=>e.name==='PairRegistered');
    const transfers = this.transfers();
    return registrations.map(pair=>{
      const a=pair.args;
      const own=transfers.filter(t=>{
        const source=t.source;
        return source && source.timestamp>=pair.timestamp && source.chainId===Number(a.srcChainId)
          && String(source.args.maker).toLowerCase()===String(a.maker).toLowerCase()
          && String(source.args.token).toLowerCase()===String(a.srcToken).toLowerCase()
          && BigInt(String(source.args.gross))%10000n===BigInt(String(a.identCode));
      });
      const fills=own.filter(t=>t.payout && String(t.payout.args.kind)==='2' && t.payout.chainId===Number(a.dstChainId) && String(t.payout.args.token).toLowerCase()===String(a.dstToken).toLowerCase());
      const latencies=fills.map(t=>t.latencyMs).filter((x):x is number=>x!==null).sort((x,y)=>x-y);
      const percentile=(p:number)=>latencies.length ? latencies[Math.ceil(latencies.length*p)-1]??null:null;
      const changes=this.events().filter(e=>e.name==='PairActiveSet' && e.args.pairId===a.pairId);
      return {pairId:String(a.pairId),maker:String(a.maker),srcChainId:Number(a.srcChainId),srcToken:String(a.srcToken),dstChainId:Number(a.dstChainId),dstToken:String(a.dstToken),identCode:Number(a.identCode),active:changes.at(-1)?.args.active??true,observedSources:own.length,fills:fills.length,refunds:own.filter(t=>t.payout && String(t.payout.args.kind)==='3').length,pending:own.filter(t=>!t.payout && !t.dispute).length,disputesLost:own.filter(t=>t.dispute?.name==='DisputeSlashed').length,observedFillRate:own.length?fills.length/own.length:null,sourceVolumeRaw:own.reduce((sum,t)=>sum+BigInt(String(t.source!.args.gross)),0n).toString(),fillVolumeRaw:fills.reduce((sum,t)=>sum+BigInt(String(t.payout!.args.amount)),0n).toString(),p50LatencyMs:percentile(.5),p95LatencyMs:percentile(.95)};
    });
  }
  attestations() {
    const windows=this.events().filter(e=>e.name==='WindowAttested');
    const chains=new Set([...windows.map(e=>Number(e.args.chainId)),...this.db.prepare('SELECT chain FROM heads').all().map(row=>Number(row.chain))]);
    return [...chains].flatMap(chainId=>[1,2].map(kind=>{
      const own=windows.filter(e=>Number(e.args.chainId)===chainId && Number(e.args.kind)===kind);
      const latest=own.sort((a,b)=>Number(b.args.toBlock)-Number(a.args.toBlock)).at(0);
      const head=this.db.prepare('SELECT block,timestamp,observedAt FROM heads WHERE chain=?').get(chainId) as {block:number;timestamp:number;observedAt:number}|undefined;
      const coveredToBlock=latest?Number(latest.args.toBlock):null;
      const coveredToTime=latest?Number(latest.args.toTime):null;
      return {chainId,kind,windowId:latest?String(latest.args.id):null,windowCount:own.length,coveredToBlock,coveredToTime,confirmedHead:head??null,indexedBlock:this.cursor(chainId)?.block??null,confirmedLagBlocks:head && coveredToBlock!==null?Math.max(0,head.block-coveredToBlock):null,confirmedLagSeconds:head && coveredToTime!==null?Math.max(0,head.timestamp-coveredToTime):null};
    }));
  }
  close():void {this.db.close();}
}
