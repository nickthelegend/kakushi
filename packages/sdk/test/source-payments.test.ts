import { describe,it,expect } from 'vitest';
import { encodeEventTopics,encodeAbiParameters,zeroAddress } from 'viem';
import { CHAINS } from '@kakushi/config';
import { findSourcePayment,findSourcePayments,srcRefOf,erc20Abi,sourceRouterAbi,type Kakushi } from '../src/index.ts';
import { NATIVE_LOG_INDEX } from '@kakushi/attest-core';
const maker='0x00000000000000000000000000000000000000aa' as const;
const user='0x00000000000000000000000000000000000000bb' as const;
const router='0x00000000000000000000000000000000000000cc' as const;
const other='0x00000000000000000000000000000000000000dd' as const;
const hash=`0x${'12'.repeat(32)}` as const;
const usdc=CHAINS.sepolia.usdc.address;
const transfer=(from:typeof user|string,to:string,value:bigint,logIndex:number)=>({address:usdc,logIndex,removed:false,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from:from as typeof user,to:to as typeof user}}),data:encodeAbiParameters([{type:'uint256'}],[value])});
const routed=(token:string,gross:bigint,recipient:string,logIndex:number)=>({address:router,logIndex,removed:false,topics:encodeEventTopics({abi:sourceRouterAbi,eventName:'PaymentEncoded',args:{sender:user,maker}}),data:encodeAbiParameters([{type:'address'},{type:'uint256'},{type:'uint16'},{type:'address'}],[token as typeof user,gross,9001,recipient as typeof user])});
function fixture(logs:unknown[],tx:Record<string,unknown>={},status='success') {
 const client={getTransaction:async()=>({from:user,to:other,input:'0xab',value:0n,...tx}),getTransactionReceipt:async()=>({status,blockNumber:10n,logs}),getBlock:async()=>({timestamp:100n})};
 return {clientById:()=>client,makers:async()=>[maker],d:{chains:{11155111:{sourceRouter:router}}}} as unknown as Kakushi;
}
describe('complete mined source recognition',()=>{
 it('retains two raw USDC payments and their unique refs; singular helper stays first',async()=>{const k=fixture([transfer(user,maker,5009001n,2),transfer(user,maker,6009001n,5)]);const ps=await findSourcePayments(k,11155111,hash);expect(ps.map(p=>[p.logIndex,p.gross,p.via])).toEqual([[2,5009001n,'raw-erc20'],[5,6009001n,'raw-erc20']]);expect(srcRefOf(ps[0]!)).not.toBe(srcRefOf(ps[1]!));expect(await findSourcePayment(k,11155111,hash)).toEqual(ps[0]);});
 it('router batches retain custom recipients without double counting underlying token transfers',async()=>{const ps=await findSourcePayments(fixture([transfer(user,router,5009001n,0),transfer(router,maker,5009001n,1),routed(usdc,5009001n,other,2),transfer(router,maker,6009001n,3),routed(usdc,6009001n,user,4)]),11155111,hash);expect(ps.map(p=>[p.logIndex,p.recipient,p.via])).toEqual([[2,other,'source-router'],[4,user,'source-router']]);});
 it('native router event and payable tx are one source, direct native gets sentinel',async()=>{const ps=await findSourcePayments(fixture([routed(zeroAddress,1009001n,other,0)],{to:router,input:'0x12',value:1009001n}),11155111,hash);expect(ps).toHaveLength(1);expect(ps[0]?.via).toBe('source-router');const direct=await findSourcePayments(fixture([],{to:maker,input:'0x',value:1009001n}),11155111,hash);expect(direct[0]).toMatchObject({via:'raw-native',logIndex:NATIVE_LOG_INDEX,token:zeroAddress});});
 it('ignores reverted, removed, unsupported and maker-sent transfers',async()=>{expect(await findSourcePayments(fixture([transfer(user,maker,1n,0)],{},'reverted'),11155111,hash)).toEqual([]);const log=transfer(user,maker,1n,0);expect(await findSourcePayments(fixture([{...log,removed:true},{...log,address:other},transfer(maker,maker,1n,1),transfer(user,other,1n,2)]),11155111,hash)).toEqual([]);});
});
