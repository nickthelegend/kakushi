import { it,expect } from 'vitest';
import { encodeEventTopics,encodeAbiParameters } from 'viem';
import { payoutRouterAbi,type Kakushi } from '@kakushi/sdk';
import { scan } from '../src/scanner.ts';
import { Store } from '../src/store.ts';
const address='0x1111111111111111111111111111111111111111';
const hash=`0x${'ab'.repeat(32)}` as const;
const ref=`0x${'cd'.repeat(32)}` as const;
function fixture(changed=false) {
 const client={getBlockNumber:async()=>1n,getBlock:async()=>({number:1n,hash:changed?'different':hash,timestamp:101n,transactions:[]}),getLogs:async()=>[{address,blockNumber:1n,blockHash:hash,transactionHash:hash,logIndex:0,removed:false,topics:encodeEventTopics({abi:payoutRouterAbi,eventName:'Payout',args:{srcRef:ref,maker:address,recipient:address}}),data:encodeAbiParameters([{type:'address'},{type:'uint256'},{type:'uint8'}],[address,99n,2])}]};
 return {network:'local',d:{chains:{11155111:{chainId:11155111,deployBlock:1,sourceRouter:'0x2222222222222222222222222222222222222222',payoutRouter:address}}},clientById:()=>client} as unknown as Kakushi;
}
it('decodes a real ABI log and commits a restart cursor',async()=>{const s=new Store(':memory:');await scan(fixture(),s);expect(s.transfers()[0]).toMatchObject({srcRef:ref,status:'filled',source:null,payout:{args:{amount:'99',kind:2}}});expect(s.cursor(11155111)).toEqual({block:1,hash});await scan(fixture(),s);expect(s.events()).toHaveLength(1);s.close();});
it('stops before ingesting when a persisted cursor is orphaned',async()=>{const s=new Store(':memory:');s.commit(11155111,1,hash,[]);await expect(scan(fixture(true),s)).rejects.toThrow('cursor hash changed');expect(s.events()).toEqual([]);expect(s.cursor(11155111)?.hash).toBe(hash);s.close();});
it('ingests every raw payment in a transaction, not only the compatibility first',async()=>{
 const usdc='0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
 const sender='0x2222222222222222222222222222222222222222';
 const logs=[0,1].map(logIndex=>({address:usdc,blockNumber:1n,blockHash:hash,transactionHash:hash,logIndex,removed:false,topics:[`0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`,`0x${sender.slice(2).padStart(64,'0')}`,`0x${address.slice(2).padStart(64,'0')}`] as [`0x${string}`,`0x${string}`,`0x${string}`],data:encodeAbiParameters([{type:'uint256'}],[BigInt(logIndex)*10000n+9001n])}));
 const tx={hash,from:sender,to:usdc,input:'0xab',value:0n};
 const client={getBlockNumber:async()=>1n,getBlock:async()=>({number:1n,hash,timestamp:101n,transactions:[tx]}),getLogs:async()=>logs,getTransaction:async()=>tx,getTransactionReceipt:async()=>({status:'success',blockNumber:1n,logs})};
 const k={network:'local',d:{chains:{11155111:{chainId:11155111,deployBlock:1,sourceRouter:'0x3333333333333333333333333333333333333333',payoutRouter:address}}},clientById:()=>client,makers:async()=>[address]} as unknown as Kakushi;
 const s=new Store(':memory:');await scan(k,s);expect(s.transfers()).toHaveLength(2);expect(new Set(s.transfers().map(t=>t.srcRef)).size).toBe(2);s.close();
});
