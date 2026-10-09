import { decodeEventLog, type Hex } from 'viem';
import { CHAIN_LIST } from '@kakushi/config';
import { Kakushi, findSourcePayments, srcRefOf, sourceRouterAbi, payoutRouterAbi, disputeModuleAbi, mdcAbi, attestationOracleAbi, ebcAbi } from '@kakushi/sdk';
import { toHex32 } from '@kakushi/attest-core';
import { Store, type ObservedEvent } from './store.ts';

export async function scan(k: Kakushi, store: Store): Promise<void> {
  for (const chain of CHAIN_LIST) {
    const dep = k.d.chains[chain.chainId];
    if (!dep) continue;
    const client = k.clientById(chain.chainId);
    const cursor = store.cursor(chain.chainId);
    if (cursor && (await client.getBlock({ blockNumber: BigInt(cursor.block) })).hash !== cursor.hash) throw new Error(`Chain ${chain.chainId} cursor hash changed; stop and rebuild database after confirming fork/reorg`);
    const head = chain.finality === 'monad' && k.network !== 'local'
      ? await client.getBlock({ blockTag: 'finalized' })
      : await client.getBlock({ blockNumber: (await client.getBlockNumber()) - BigInt(k.network === 'local' ? 0 : chain.attestConfirmations) });
    store.observeHead(chain.chainId,Number(head.number!),Number(head.timestamp));
    const start = cursor ? BigInt(cursor.block)+1n : BigInt(dep.deployBlock);
    const end = head.number! < start+99n ? head.number! : start+99n;
    if(start>end) continue;
    const addresses: Hex[] = [dep.sourceRouter, dep.payoutRouter, chain.usdc.address];
    const abiByAddress = new Map<string, typeof sourceRouterAbi | typeof payoutRouterAbi | typeof disputeModuleAbi | typeof mdcAbi | typeof attestationOracleAbi | typeof ebcAbi>([[dep.sourceRouter.toLowerCase(),sourceRouterAbi],[dep.payoutRouter.toLowerCase(),payoutRouterAbi]]);
    if (chain.isHub) for (const [address,abi] of [[k.d.hub.disputeModule,disputeModuleAbi],[k.d.hub.mdc,mdcAbi],[k.d.hub.attestationOracle,attestationOracleAbi],[k.d.hub.ebc,ebcAbi]] as const) {addresses.push(address);abiByAddress.set(address.toLowerCase(),abi);}
    const logs = await client.getLogs({address:addresses,fromBlock:start,toBlock:end});
    const candidates = new Set(logs.filter(l=>l.address.toLowerCase()===chain.usdc.address.toLowerCase() || l.address.toLowerCase()===dep.sourceRouter.toLowerCase()).map(l=>l.transactionHash));
    for(let number=start;number<=end;number++) {
      const block = await client.getBlock({blockNumber:number,includeTransactions:true});
      const events: ObservedEvent[]=[];
      for(const log of logs.filter(l=>l.blockNumber===number)) {
        const abi=abiByAddress.get(log.address.toLowerCase());
        if(log.blockHash!==block.hash) throw new Error(`Chain ${chain.chainId} log/block hash mismatch; retry scan`);
        if(!abi || log.removed) continue;
        let decoded;
        try {decoded=decodeEventLog({abi,data:log.data,topics:log.topics});} catch {continue;}
        events.push({chainId:chain.chainId,blockNumber:Number(number),blockHash:block.hash!,timestamp:Number(block.timestamp),txHash:log.transactionHash!,logIndex:log.logIndex!,name:decoded.eventName,args:decoded.args as unknown as Record<string,unknown>});
      }
      for(const tx of block.transactions) {
        if(!candidates.has(tx.hash) && !(tx.value>0n && tx.input==='0x')) continue;
        const sources=await findSourcePayments(k,chain.chainId,tx.hash);
        for(const source of sources) events.push({chainId:chain.chainId,blockNumber:Number(number),blockHash:block.hash!,timestamp:Number(block.timestamp),txHash:tx.hash,logIndex:source.logIndex,name:'SourcePayment',args:{...source,srcRef:toHex32(srcRefOf(source))}});
      }
      store.commit(chain.chainId,Number(number),block.hash!,events);
    }
  }
}
