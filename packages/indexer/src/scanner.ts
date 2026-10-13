import { decodeEventLog, zeroAddress, type Hex } from 'viem';
import { CHAIN_LIST } from '@kakushi/config';
import { Kakushi, findSourcePayments, srcRefOf, sourceRouterAbi, payoutRouterAbi, disputeModuleAbi, mdcAbi, attestationOracleAbi, ebcAbi } from '@kakushi/sdk';
import { toHex32 } from '@kakushi/attest-core';
import { Store, type ObservedEvent } from './store.ts';

/** Chains where some Maker accepts the native coin. Only there can a payment be a bare value transfer
 *  (no log), so only there is every block read in full; elsewhere only blocks with logs are read.
 *  The local forks are always read in full. Refreshed every minute. */
let native: { at: number; chains: Set<number> } | null = null;
async function nativeSourceChains(k: Kakushi): Promise<Set<number> | 'all'> {
  if (k.network === 'local') return 'all';
  if (native && Date.now() - native.at < 60_000) return native.chains;
  const chains = new Set<number>();
  for (const m of await k.makers()) for (const p of await k.pairs(m)) if (p.srcToken.toLowerCase() === zeroAddress) chains.add(p.srcChainId);
  native = { at: Date.now(), chains };
  return chains;
}

/** One pass of up to 100 blocks per chain. Resolves true while some chain is still behind its head. */
export async function scan(k: Kakushi, store: Store): Promise<boolean> {
  const nativeChains = await nativeSourceChains(k);
  let behind = false;
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
    if(end<head.number!) behind=true;
    const fullBlocks = nativeChains === 'all' || nativeChains.has(chain.chainId);
    const addresses: Hex[] = [dep.sourceRouter, dep.payoutRouter, chain.usdc.address];
    const abiByAddress = new Map<string, typeof sourceRouterAbi | typeof payoutRouterAbi | typeof disputeModuleAbi | typeof mdcAbi | typeof attestationOracleAbi | typeof ebcAbi>([[dep.sourceRouter.toLowerCase(),sourceRouterAbi],[dep.payoutRouter.toLowerCase(),payoutRouterAbi]]);
    if (chain.isHub) for (const [address,abi] of [[k.d.hub.disputeModule,disputeModuleAbi],[k.d.hub.mdc,mdcAbi],[k.d.hub.attestationOracle,attestationOracleAbi],[k.d.hub.ebc,ebcAbi]] as const) {addresses.push(address);abiByAddress.set(address.toLowerCase(),abi);}
    const logs = await client.getLogs({address:addresses,fromBlock:start,toBlock:end});
    const candidates = new Set(logs.filter(l=>l.address.toLowerCase()===chain.usdc.address.toLowerCase() || l.address.toLowerCase()===dep.sourceRouter.toLowerCase()).map(l=>l.transactionHash));
    const logBlocks = new Set(logs.map(l=>l.blockNumber));
    for(let number=start;number<=end;number++) {
      // without native lanes a block with no logs holds nothing to record: skip it (the cursor still lands on `end`)
      if(!fullBlocks && !logBlocks.has(number) && number!==end) continue;
      const block = await client.getBlock({blockNumber:number,includeTransactions:fullBlocks});
      const events: ObservedEvent[]=[];
      for(const log of logs.filter(l=>l.blockNumber===number)) {
        const abi=abiByAddress.get(log.address.toLowerCase());
        if(log.blockHash!==block.hash) throw new Error(`Chain ${chain.chainId} log/block hash mismatch; retry scan`);
        if(!abi || log.removed) continue;
        let decoded;
        try {decoded=decodeEventLog({abi,data:log.data,topics:log.topics});} catch {continue;}
        events.push({chainId:chain.chainId,blockNumber:Number(number),blockHash:block.hash!,timestamp:Number(block.timestamp),txHash:log.transactionHash!,logIndex:log.logIndex!,name:decoded.eventName,args:decoded.args as unknown as Record<string,unknown>});
      }
      const txs = fullBlocks
        ? (block.transactions as { hash: Hex; value: bigint; input: Hex }[]).filter(tx=>candidates.has(tx.hash) || (tx.value>0n && tx.input==='0x')).map(tx=>tx.hash)
        : [...new Set(logs.filter(l=>l.blockNumber===number && candidates.has(l.transactionHash!)).map(l=>l.transactionHash!))];
      for(const txHash of txs) {
        const sources=await findSourcePayments(k,chain.chainId,txHash);
        for(const source of sources) events.push({chainId:chain.chainId,blockNumber:Number(number),blockHash:block.hash!,timestamp:Number(block.timestamp),txHash,logIndex:source.logIndex,name:'SourcePayment',args:{...source,srcRef:toHex32(srcRefOf(source))}});
      }
      store.commit(chain.chainId,Number(number),block.hash!,events);
    }
  }
  return behind;
}
