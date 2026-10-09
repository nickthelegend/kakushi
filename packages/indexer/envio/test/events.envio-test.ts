import {it,expect} from 'vitest';
import {createTestIndexer} from 'envio';
import {computeSrcRef,toHex32} from '@kakushi/attest-core';
import {sourceRef} from '../src/srcRef.ts';
const maker='0x00000000000000000000000000000000000000aa';
const user='0x00000000000000000000000000000000000000bb';
const recipient='0x00000000000000000000000000000000000000cc';
const token='0x00000000000000000000000000000000000000dd';
const hex=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`;
it('real Envio handlers join router batches with payout-first arrival and track disputes/margin/windows',async()=>{
 const i=createTestIndexer();const hub=i.chains[10143].startBlock;const src=i.chains[11155111].startBlock;const dst=i.chains[84532].startBlock;
 await i.process({chains:{10143:{simulate:[{contract:'EBC',event:'PairRegistered',block:{number:hub+1,timestamp:100},params:{pairId:hex(1),maker,srcChainId:11155111n,srcToken:token,dstChainId:84532n,dstToken:token,identCode:9003n}},{contract:'MDC',event:'MarginDeposited',block:{number:hub+2,timestamp:101},transaction:{hash:hex(2)},params:{maker,token,amount:100n,total:100n}}]}}});
 const refs=[0,1,2].map(idx=>toHex32(computeSrcRef(11155111,hex(3) as `0x${string}`,idx)));
 await i.process({chains:{84532:{simulate:[{contract:'PayoutRouter',event:'Payout',block:{number:dst+1,timestamp:106},transaction:{hash:hex(4)},params:{srcRef:refs[0],maker,recipient,token,amount:99n,kind:2n}}]}}});
 expect(await i.MakerStats.getOrThrow(maker)).toMatchObject({observedSources:0,filled:1,latencySamples:0,p50LatencyMs:undefined,observedFillRateBps:undefined});
 await i.process({chains:{11155111:{simulate:[0,1,2].map(logIndex=>({contract:'SourceRouter',event:'PaymentEncoded',logIndex,block:{number:src+1,timestamp:103},transaction:{hash:hex(3)},params:{sender:user,maker,token,gross:1009003n,code:9003n,recipient}}))}}});
 expect(await i.Transfer.getOrThrow(refs[0]!)).toMatchObject({status:'filled',latencyMs:3000});
 expect(await i.Transfer.getOrThrow(refs[1]!)).toMatchObject({status:'pending',sourceId:refs[1]});
 expect(await i.MakerStats.getOrThrow(maker)).toMatchObject({observedSources:3,filled:1,pending:2,latencySamples:1,p50LatencyMs:3000,observedFillRateBps:3333});
 await i.process({chains:{11155111:{simulate:[{contract:'PayoutRouter',event:'Payout',block:{number:src+2,timestamp:107},transaction:{hash:hex(15)},params:{srcRef:refs[2],maker,recipient:user,token,amount:80n,kind:3n}}]}}});
 await i.process({chains:{10143:{simulate:[{contract:'DisputeModule',event:'DisputeOpened',block:{number:hub+3,timestamp:110},params:{disputeKey:hex(5),srcRef:refs[1],maker,opener:user,srcChainId:11155111n,srcTxHash:hex(3),logIndex:1n}},{contract:'DisputeModule',event:'DisputeSlashed',block:{number:hub+4,timestamp:111},params:{disputeKey:hex(5),maker,sender:user,marginToken:token,compensation:20n,paid:20n,reward:1n}},{contract:'MDC',event:'MarginSlashed',block:{number:hub+4,timestamp:111},transaction:{hash:hex(6)},params:{maker,token,to:user,requested:20n,paid:20n,disputeKey:hex(5)}},{contract:'AttestationOracle',event:'WindowAttested',block:{number:hub+5,timestamp:112},params:{id:1n,chainId:84532n,kind:2n,fromBlock:BigInt(dst),toBlock:BigInt(dst+1),fromTime:100n,toTime:106n,root:123n,leafCount:1n}}]}}});
 expect(await i.Transfer.getOrThrow(refs[1]!)).toMatchObject({status:'slashed'});
 expect(await i.Margin.getOrThrow(`${maker}:${token}`)).toMatchObject({balance:80n});
 expect(await i.AttestationWindow.getOrThrow('10143:1')).toMatchObject({sourceChainId:84532n,kind:2,leafCount:1n});
 const expected={observedSources:3,filled:1,refunded:1,pending:0,disputed:1,slashed:1,latencySamples:1,p50LatencyMs:3000,p95LatencyMs:3000,observedFillRateBps:3333};
 expect(await i.MakerStats.getOrThrow(maker)).toMatchObject(expected);
 expect(await i.MakerStats.getOrThrow(maker)).toMatchObject({sourceVolumeByToken:JSON.stringify({[`11155111:${token}`]:'3027009'}),fillVolumeByToken:JSON.stringify({[`84532:${token}`]:'99'}),refundVolumeByToken:JSON.stringify({[`11155111:${token}`]:'80'})});
 expect(await i.RouteStats.getOrThrow(hex(1))).toMatchObject({...expected,sourceVolumeRaw:3027009n,fillVolumeRaw:99n});
});
it('raw USDC batches are recognized; router forwarding and maker-sent payouts are excluded',async()=>{
 const i=createTestIndexer();const hub=i.chains[10143].startBlock;const block=i.chains[11155111].startBlock+1;
 await i.process({chains:{10143:{simulate:[{contract:'EBC',event:'PairRegistered',block:{number:hub+1,timestamp:100},params:{pairId:hex(1),maker,srcChainId:11155111n,srcToken:token,dstChainId:84532n,dstToken:token,identCode:9003n}}]}}});
 const router=i.chains[11155111].SourceRouter.addresses[0]!;
 await i.process({chains:{11155111:{simulate:[user,user,router,maker].map((from,logIndex)=>({contract:'USDC',event:'Transfer',logIndex,block:{number:block,timestamp:101},transaction:{hash:hex(10)},params:{from:from as `0x${string}`,to:maker,value:1009003n}}))}}});
 for(const idx of [0,1])expect(await i.SourcePayment.getOrThrow(toHex32(computeSrcRef(11155111,hex(10) as `0x${string}`,idx)))).toMatchObject({via:'raw-erc20'});
 for(const idx of [2,3])expect(await i.SourcePayment.get(toHex32(computeSrcRef(11155111,hex(10) as `0x${string}`,idx)))).toBeUndefined();
 expect(await i.MakerStats.getOrThrow(maker)).toMatchObject({observedSources:2,filled:0,latencySamples:0,p50LatencyMs:undefined,observedFillRateBps:0});
 // The registered route names a different token, so these real USDC observations are not assigned to it.
 expect(await i.RouteStats.getOrThrow(hex(1))).toMatchObject({observedSources:0,sourceVolumeRaw:0n,observedFillRateBps:undefined});
});

it('independent Envio source ref matches the canonical SDK encoding',()=>{for(const chain of [10143,11155111,84532])for(const idx of [0,5,0xffffffff])expect(sourceRef(chain,hex(99) as `0x${string}`,idx)).toBe(toHex32(computeSrcRef(chain,hex(99) as `0x${string}`,idx)));});
it('preserves refunds and distinct maker-proven/expired dispute outcomes',async()=>{
 const i=createTestIndexer();const hub=i.chains[10143].startBlock;const dst=i.chains[84532].startBlock;
 await i.process({chains:{84532:{simulate:[{contract:'PayoutRouter',event:'Payout',block:{number:dst+1,timestamp:100},transaction:{hash:hex(20)},params:{srcRef:hex(21),maker,recipient:user,token,amount:90n,kind:3n}}]}}});
 expect(await i.Transfer.getOrThrow(hex(21))).toMatchObject({status:'refunded',sourceId:undefined,latencyMs:undefined});
 await i.process({chains:{10143:{simulate:[{contract:'DisputeModule',event:'DisputeOpened',block:{number:hub+1,timestamp:101},params:{disputeKey:hex(22),srcRef:hex(21),maker,opener:user,srcChainId:11155111n,srcTxHash:hex(20),logIndex:0n}},{contract:'DisputeModule',event:'DisputeMakerProven',block:{number:hub+2,timestamp:102},params:{disputeKey:hex(22),maker}},{contract:'DisputeModule',event:'DisputeOpened',block:{number:hub+3,timestamp:103},params:{disputeKey:hex(23),srcRef:hex(24),maker,opener:user,srcChainId:11155111n,srcTxHash:hex(20),logIndex:1n}},{contract:'DisputeModule',event:'DisputeExpired',block:{number:hub+4,timestamp:104},params:{disputeKey:hex(23),maker}}]}}});
 expect(await i.Transfer.getOrThrow(hex(21))).toMatchObject({status:'maker-proven'});
 expect(await i.Transfer.getOrThrow(hex(24))).toMatchObject({status:'expired'});
});

it('replaying identical observed sources and payouts does not inflate derived totals',async()=>{
 const i=createTestIndexer();const hub=i.chains[10143].startBlock;const src=i.chains[11155111].startBlock;const dst=i.chains[84532].startBlock;
 await i.process({chains:{10143:{simulate:[{contract:'EBC',event:'PairRegistered',block:{number:hub+1,timestamp:100},params:{pairId:hex(1),maker,srcChainId:11155111n,srcToken:token,dstChainId:84532n,dstToken:token,identCode:9003n}}]}}});
 const ref=sourceRef(11155111,hex(30) as `0x${string}`,0);
 const sources:Parameters<typeof i.process>[0]={chains:{11155111:{simulate:[{contract:'SourceRouter' as const,event:'PaymentEncoded' as const,block:{number:src+1,timestamp:101},transaction:{hash:hex(30)},params:{sender:user,maker,token,gross:1009003n,code:9003n,recipient}}]}}};
 const payouts:Parameters<typeof i.process>[0]={chains:{84532:{simulate:[{contract:'PayoutRouter' as const,event:'Payout' as const,block:{number:dst+1,timestamp:101},transaction:{hash:hex(31)},params:{srcRef:ref,maker,recipient,token,amount:50n,kind:2n}}]}}};
 await i.process(sources);await i.process(payouts);
 const before=await i.MakerStats.getOrThrow(maker);const route=await i.RouteStats.getOrThrow(hex(1));
 await expect(i.process(sources)).rejects.toThrow('never reached a handler');
 expect(await i.MakerStats.getOrThrow(maker)).toEqual(before);expect(await i.RouteStats.getOrThrow(hex(1))).toEqual(route);
 expect(before).toMatchObject({observedSources:1,filled:1,latencySamples:1,p50LatencyMs:0,p95LatencyMs:0});
 const replay=createTestIndexer();
 await replay.process({chains:{10143:{simulate:[{contract:'EBC',event:'PairRegistered',block:{number:hub+1,timestamp:100},params:{pairId:hex(1),maker,srcChainId:11155111n,srcToken:token,dstChainId:84532n,dstToken:token,identCode:9003n}}]}}});
 await replay.process(payouts);await replay.process(sources);
 expect(await replay.MakerStats.getOrThrow(maker)).toEqual(before);expect(await replay.RouteStats.getOrThrow(hex(1))).toEqual(route);
});
