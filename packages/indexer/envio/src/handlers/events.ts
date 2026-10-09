import { indexer,type EvmOnEventContext,type Transfer } from 'envio';
import { sourceRef } from '../srcRef.ts';
import {publishTransfer,routeStats} from '../stats.ts';

type Meta={chainId:number;logIndex:number;block:{number:number;timestamp:number};transaction:{hash:string}};
const logId=(e:Meta)=>`${e.chainId}:${e.transaction.hash}:${e.logIndex}`;
const fresh=(id:string,maker:string):Transfer=>({id,maker,sourceId:undefined,payoutId:undefined,sourceTime:undefined,payoutTime:undefined,status:'source-unobserved',latencyMs:undefined,disputeKey:undefined,routeId:undefined,sourceChainId:undefined,sourceToken:undefined,sourceGross:undefined,payoutChainId:undefined,payoutToken:undefined,payoutAmount:undefined,payoutKind:undefined});
const latency=(source:number|undefined,payout:number|undefined)=>source!==undefined && payout!==undefined && payout>=source?(payout-source)*1000:undefined;
async function source(context:EvmOnEventContext,e:Meta,p:{sender:string;maker:string;token:string;gross:bigint;recipient:string;via:string}){
 const id=sourceRef(e.chainId,e.transaction.hash as `0x${string}`,e.logIndex);
 const t=await context.Transfer.get(id)??fresh(id,p.maker);
 context.SourcePayment.set({id,...p,chainId:e.chainId,txHash:e.transaction.hash,logIndex:e.logIndex,blockNumber:e.block.number,timestamp:e.block.timestamp});
 const pairs=await context.Pair.getWhere({maker:{_eq:p.maker}});
 const routes=pairs.filter(pair=>Number(pair.srcChainId)===e.chainId && pair.srcToken.toLowerCase()===p.token.toLowerCase() && pair.identCode===p.gross%10000n && pair.registeredTime<=e.block.timestamp);
 const routeId=routes.length===1?routes[0]!.id:undefined;
 await publishTransfer(context,{...t,sourceId:id,sourceTime:e.block.timestamp,sourceChainId:e.chainId,sourceToken:p.token.toLowerCase(),sourceGross:p.gross,routeId,status:t.status==='source-unobserved'?'pending':t.status,latencyMs:latency(e.block.timestamp,t.payoutTime)});
}
indexer.onEvent({contract:'EBC',event:'PairRegistered'},async({event,context})=>{
 const p=event.params;
 context.Maker.set({id:p.maker,registered:true});
 const pair={id:p.pairId,...p,active:true,registeredTime:event.block.timestamp};
 const transfers=await context.Transfer.getWhere({routeId:{_eq:p.pairId}});
 context.Pair.set(pair);
 context.RouteStats.set(routeStats(pair,transfers));
});
indexer.onEvent({contract:'EBC',event:'PairActiveSet'},async({event,context})=>{
 const pair=await context.Pair.get(event.params.pairId);
 if(pair)context.Pair.set({...pair,active:event.params.active});
});
indexer.onEvent({contract:'SourceRouter',event:'PaymentEncoded'},async({event,context})=>{
 const p=event.params;
 const maker=await context.Maker.get(p.maker);
 if(!maker?.registered)return;
 await source(context,event,{sender:p.sender,maker:p.maker,token:p.token,gross:p.gross,recipient:p.recipient,via:'source-router'});
});
indexer.onEvent({contract:'USDC',event:'Transfer'},async({event,context})=>{
 const p=event.params;
 const [maker,sender]=await Promise.all([context.Maker.get(p.to),context.Maker.get(p.from)]);
 const routers=indexer.chains[event.chainId].SourceRouter.addresses;
 if(!maker?.registered || sender?.registered || routers.some(address=>address.toLowerCase()===p.from.toLowerCase()))return;
 await source(context,event,{sender:p.from,maker:p.to,token:event.srcAddress,gross:p.value,recipient:p.from,via:'raw-erc20'});
});
indexer.onEvent({contract:'PayoutRouter',event:'Payout'},async({event,context})=>{
 const p=event.params;
 const t=await context.Transfer.get(p.srcRef)??fresh(p.srcRef,p.maker);
 const id=logId(event);
 context.Payout.set({id,chainId:event.chainId,txHash:event.transaction.hash,timestamp:event.block.timestamp,maker:p.maker,recipient:p.recipient,token:p.token,amount:p.amount,kind:Number(p.kind)});
 await publishTransfer(context,{...t,payoutId:id,payoutTime:event.block.timestamp,payoutChainId:event.chainId,payoutToken:p.token.toLowerCase(),payoutAmount:p.amount,payoutKind:Number(p.kind),status:t.disputeKey?t.status:Number(p.kind)===2?'filled':'refunded',latencyMs:latency(t.sourceTime,event.block.timestamp)});
});
indexer.onEvent({contract:'DisputeModule',event:'DisputeOpened'},async({event,context})=>{
 const p=event.params;
 const t=await context.Transfer.get(p.srcRef)??fresh(p.srcRef,p.maker);
 context.Dispute.set({id:p.disputeKey,srcRef:p.srcRef,maker:p.maker,status:'disputed',compensation:undefined,paid:undefined,reward:undefined});
 await publishTransfer(context,{...t,status:'disputed',disputeKey:p.disputeKey});
});
async function settle(context:EvmOnEventContext,key:string,status:string,amounts:{compensation?:bigint;paid?:bigint;reward?:bigint}={}){
 const d=await context.Dispute.get(key);
 if(!d)return;
 const t=await context.Transfer.get(d.srcRef);
 context.Dispute.set({...d,...amounts,status});
 if(t)await publishTransfer(context,{...t,status});
}
indexer.onEvent({contract:'DisputeModule',event:'DisputeSlashed'},async({event,context})=>{const p=event.params;await settle(context,p.disputeKey,'slashed',{compensation:p.compensation,paid:p.paid,reward:p.reward});});
indexer.onEvent({contract:'DisputeModule',event:'DisputeMakerProven'},async({event,context})=>settle(context,event.params.disputeKey,'maker-proven'));
indexer.onEvent({contract:'DisputeModule',event:'DisputeExpired'},async({event,context})=>settle(context,event.params.disputeKey,'expired'));
indexer.onEvent({contract:'MDC',event:'MarginDeposited'},async({event,context})=>{
 const p=event.params;
 context.Margin.set({id:`${p.maker}:${p.token}`,maker:p.maker,token:p.token,balance:p.total});
 context.MarginEvent.set({id:logId(event),maker:p.maker,token:p.token,kind:'deposit',amount:p.amount,timestamp:event.block.timestamp});
});
indexer.onEvent({contract:'MDC',event:'MarginWithdrawn'},async({event,context})=>{
 const p=event.params;
 context.Margin.set({id:`${p.maker}:${p.token}`,maker:p.maker,token:p.token,balance:p.remaining});
 context.MarginEvent.set({id:logId(event),maker:p.maker,token:p.token,kind:'withdraw',amount:p.amount,timestamp:event.block.timestamp});
});
indexer.onEvent({contract:'MDC',event:'MarginSlashed'},async({event,context})=>{
 const p=event.params;const id=`${p.maker}:${p.token}`;
 const margin=await context.Margin.get(id);
 if(margin)context.Margin.set({...margin,balance:margin.balance-p.paid});
 context.MarginEvent.set({id:logId(event),maker:p.maker,token:p.token,kind:'slash',amount:p.paid,timestamp:event.block.timestamp});
});
indexer.onEvent({contract:'AttestationOracle',event:'WindowAttested'},async({event,context})=>{
 const p=event.params;
 context.AttestationWindow.set({id:`${event.chainId}:${p.id}`,windowId:p.id,sourceChainId:p.chainId,kind:Number(p.kind),fromBlock:p.fromBlock,toBlock:p.toBlock,fromTime:p.fromTime,toTime:p.toTime,root:p.root,leafCount:p.leafCount});
});
