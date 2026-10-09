import type {EvmOnEventContext,Transfer,Pair} from 'envio';
const isFill=(t:Transfer)=>t.payoutId!==undefined && t.payoutKind===2;
const isRefund=(t:Transfer)=>t.payoutId!==undefined && t.payoutKind===3;
function volume(rows:Transfer[],kind:'source'|'fill'|'refund'):string{
 const buckets:Record<string,bigint>={};
 for(const t of rows){
  const source=kind==='source';
  if(source?t.sourceId===undefined:kind==='fill'?!isFill(t):!isRefund(t))continue;
  const chain=source?t.sourceChainId:t.payoutChainId;
  const token=source?t.sourceToken:t.payoutToken;
  const amount=source?t.sourceGross:t.payoutAmount;
  if(chain===undefined || token===undefined || amount===undefined)continue;
  const key=`${chain}:${token.toLowerCase()}`;
  buckets[key]=(buckets[key]??0n)+amount;
 }
 return JSON.stringify(Object.fromEntries(Object.keys(buckets).sort().map(key=>[key,buckets[key]!.toString()])));
}
function counts(rows:Transfer[]){
 const sources=rows.filter(t=>t.sourceId!==undefined);
 const fills=rows.filter(isFill);
 const latencies=fills.map(t=>t.latencyMs).filter((value):value is number=>value!==undefined).sort((a,b)=>a-b);
 const percentile=(p:number)=>latencies.length?latencies[Math.ceil(latencies.length*p)-1]:undefined;
 return {observedSources:sources.length,filled:fills.length,refunded:rows.filter(isRefund).length,pending:rows.filter(t=>t.status==='pending').length,disputed:rows.filter(t=>t.disputeKey!==undefined).length,slashed:rows.filter(t=>t.status==='slashed').length,latencySamples:latencies.length,p50LatencyMs:percentile(.5),p95LatencyMs:percentile(.95),observedFillRateBps:sources.length?Math.floor(sources.filter(isFill).length*10000/sources.length):undefined};
}
export function makerStats(id:string,rows:Transfer[]){
 return {id:id.toLowerCase(),...counts(rows),sourceVolumeByToken:volume(rows,'source'),fillVolumeByToken:volume(rows,'fill'),refundVolumeByToken:volume(rows,'refund')};
}
export function routeStats(pair:Pair,rows:Transfer[]){
 // A payout to the wrong chain/token is retained in Transfer but does not count as a fill on this route.
 const matched=rows.map(t=>isFill(t) && (t.payoutChainId!==Number(pair.dstChainId) || t.payoutToken?.toLowerCase()!==pair.dstToken.toLowerCase())?{...t,payoutKind:undefined}:t);
 return {id:pair.id,maker:pair.maker.toLowerCase(),srcChainId:pair.srcChainId,srcToken:pair.srcToken.toLowerCase(),dstChainId:pair.dstChainId,dstToken:pair.dstToken.toLowerCase(),...counts(matched),sourceVolumeRaw:matched.reduce((sum,t)=>sum+(t.sourceGross??0n),0n),fillVolumeRaw:matched.filter(isFill).reduce((sum,t)=>sum+(t.payoutAmount??0n),0n),refundVolumeByToken:volume(matched,'refund')};
}
/** Replace the canonical transfer before aggregation: replay and arrival order cannot double-count it. */
export async function publishTransfer(context:EvmOnEventContext,next:Transfer):Promise<void>{
 const previous=await context.Transfer.getWhere({maker:{_eq:next.maker}});
 const pairs=await context.Pair.getWhere({maker:{_eq:next.maker}});
 const rows=[...previous.filter(t=>t.id!==next.id),next];
 context.Transfer.set(next);
 context.MakerStats.set(makerStats(next.maker,rows));
 for(const pair of pairs)context.RouteStats.set(routeStats(pair,rows.filter(t=>t.routeId===pair.id)));
}
