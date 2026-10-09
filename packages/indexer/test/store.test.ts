import { describe,it,expect } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store,type ObservedEvent } from '../src/store.ts';
import { IndexerClient } from '../src/client.ts';
const event=(name:string,args:Record<string,unknown>,timestamp=100,chainId=1):ObservedEvent=>({chainId,blockNumber:timestamp,blockHash:`hash${timestamp}`,timestamp,txHash:`tx${timestamp}${name}`,logIndex:0,name,args});
const source=event('SourcePayment',{srcRef:'ref',maker:'0xABC',sender:'0xDEF',gross:'1000'});
const payout=event('Payout',{srcRef:'ref',maker:'0xABC',kind:2,token:'0xTOKEN',amount:'999'},103,2);
function add(store:Store,...events:ObservedEvent[]) {for(const e of events) store.commit(e.chainId,e.blockNumber,e.blockHash,[e]);}
describe('persistent observed lifecycle',()=>{
 it('joins cross-chain events regardless of ingestion order; actual seconds to ms',()=>{const s=new Store(':memory:');add(s,payout,source);expect(s.transfers()[0]).toMatchObject({status:'filled',latencyMs:3000});expect(s.makers()[0]).toMatchObject({fills:1,p50LatencyMs:3000,p95LatencyMs:3000,observedFillRate:1,volumeByToken:{'2:0xtoken':'999'}});s.close();});
 it('keeps payout without source honest and refund kind separate',()=>{const s=new Store(':memory:');add(s,{...payout,args:{...payout.args,kind:3}});expect(s.transfers()[0]).toMatchObject({source:null,status:'refunded',latencyMs:null});expect(s.makers()[0]).toMatchObject({fills:0,refunds:1,observedFillRate:null});s.close();});
 it('joins dispute finalization through opened key, updates slash and margin',()=>{const s=new Store(':memory:');add(s,source,event('DisputeOpened',{srcRef:'ref',disputeKey:'key',maker:'0xABC'},105),event('DisputeSlashed',{disputeKey:'key',maker:'0xABC'},106),event('MarginDeposited',{maker:'0xABC',token:'0xTOKEN',total:100n},101),event('MarginSlashed',{maker:'0xABC',token:'0xTOKEN',paid:20n},106));expect(s.transfers()[0]?.status).toBe('slashed');expect(s.makers()[0]).toMatchObject({disputesLost:1,marginByToken:{'0xtoken':'80'}});s.close();});
 it('restart/replay is idempotent with durable cursor',()=>{const dir=mkdtempSync(join(tmpdir(),'kakushi-indexer-'));const path=join(dir,'db');let s=new Store(path);add(s,source);s.close();s=new Store(path);add(s,source);expect(s.events()).toHaveLength(1);expect(s.cursor(1)).toEqual({block:100,hash:'hash100'});s.close();rmSync(dir,{recursive:true});});
 it('rolls back cursor and preceding events when block insertion fails',()=>{const s=new Store(':memory:');expect(()=>s.commit(1,100,'hash',[source,{...source,chainId:2}])).toThrow();expect(s.cursor(1)).toBeUndefined();expect(s.events()).toHaveLength(0);s.close();});
 it('typed client encodes filters and rejects failed HTTP',async()=>{let url='';const c=new IndexerClient('http://localhost:4201',async(input)=>{url=String(input);return new Response(JSON.stringify({total:0,items:[]}));});expect(await c.transfers({sender:'0xDEF',limit:5})).toEqual({total:0,items:[]});expect(url).toContain('sender=0xDEF&limit=5');const bad=new IndexerClient('http://localhost',async()=>new Response('',{status:503}));await expect(bad.makers()).rejects.toThrow('503');});
});
it('route projection joins registered amount codes and keeps token units separate',()=>{
 const s=new Store(':memory:');
 add(s,event('PairRegistered',{pairId:'pair',maker:'0xABC',srcChainId:1,srcToken:'0xSRC',dstChainId:2,dstToken:'0xTOKEN',identCode:9001},90),{...source,args:{...source.args,token:'0xSRC',gross:'1009001'}},payout,event('PairActiveSet',{pairId:'pair',active:false},110));
 expect(s.routes()[0]).toMatchObject({pairId:'pair',active:false,observedSources:1,fills:1,sourceVolumeRaw:'1009001',fillVolumeRaw:'999',p95LatencyMs:3000});
 add(s,{...source,txHash:'unmatched',args:{...source.args,srcRef:'unmatched',token:'0xSRC',gross:'1009002'}});
 expect(s.routes()[0]?.observedSources).toBe(1);s.close();
});
it('attestation lag compares distinct window kinds to observed confirmed heads and leaves absent coverage null',()=>{
 const s=new Store(':memory:');s.observeHead(2,120,200,1234);
 add(s,event('WindowAttested',{id:1,chainId:2,kind:2,toBlock:100,toTime:180},185),event('WindowAttested',{id:2,chainId:2,kind:2,toBlock:110,toTime:190},195));
 expect(s.attestations().find(a=>a.kind===2)).toMatchObject({windowId:'2',windowCount:2,coveredToBlock:110,confirmedLagBlocks:10,confirmedLagSeconds:10,confirmedHead:{observedAt:1234}});
 expect(s.attestations().find(a=>a.kind===1)).toMatchObject({windowId:null,confirmedLagBlocks:null});s.close();
});
