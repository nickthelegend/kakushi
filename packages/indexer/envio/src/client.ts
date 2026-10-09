import type {MakerStats,RouteStats} from 'envio';
type WireValue<T> = T extends bigint ? string : T extends undefined ? null : T;
export type GraphQLRow<T> = {[K in keyof T]-?: WireValue<T[K]>};
export type MakerStatsRow=GraphQLRow<MakerStats>;
export type RouteStatsRow=GraphQLRow<RouteStats>;
const counts='observedSources filled refunded pending disputed slashed latencySamples p50LatencyMs p95LatencyMs observedFillRateBps';
/** Read-only Hasura client. BigInt columns remain decimal strings; absent observations remain null. */
export class EnvioStatsClient {
 readonly endpoint:string;
 readonly fetcher:typeof fetch;
 constructor(endpoint:string,fetcher:typeof fetch=fetch){this.endpoint=endpoint;this.fetcher=fetcher;}
 private async query<T>(query:string,variables:Record<string,unknown>):Promise<T>{
  const response=await this.fetcher(this.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`Envio GraphQL HTTP ${response.status}`);
  const result=await response.json() as {data?:T;errors?:{message:string}[]};
  if(result.errors?.length)throw new Error(result.errors.map(e=>e.message).join('; '));
  if(!result.data)throw new Error('Envio GraphQL returned no data');
  return result.data;
 }
 async makers(maker?:string,limit=50):Promise<MakerStatsRow[]>{
  const result=await this.query<{MakerStats:MakerStatsRow[]}>(`query MakerStats($where: MakerStats_bool_exp!, $limit: Int!) { MakerStats(where: $where, order_by: {id: asc}, limit: $limit) { id ${counts} sourceVolumeByToken fillVolumeByToken refundVolumeByToken } }`,{where:maker?{id:{_eq:maker.toLowerCase()}}:{},limit:Math.min(200,Math.max(1,Math.trunc(limit)||50))});
  return result.MakerStats;
 }
 async routes(maker?:string,limit=50):Promise<RouteStatsRow[]>{
  const result=await this.query<{RouteStats:RouteStatsRow[]}>(`query RouteStats($where: RouteStats_bool_exp!, $limit: Int!) { RouteStats(where: $where, order_by: {id: asc}, limit: $limit) { id maker srcChainId srcToken dstChainId dstToken ${counts} sourceVolumeRaw fillVolumeRaw refundVolumeByToken } }`,{where:maker?{maker:{_eq:maker.toLowerCase()}}:{},limit:Math.min(200,Math.max(1,Math.trunc(limit)||50))});
  return result.RouteStats;
 }
}
