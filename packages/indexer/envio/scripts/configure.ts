import { writeFileSync } from 'node:fs';
import { loadDeployments } from '@kakushi/config/deployments';
import { deployedChains, rpcUrl, type Network } from '@kakushi/config';
import { sourceRouterAbi,payoutRouterAbi,disputeModuleAbi,mdcAbi,attestationOracleAbi,ebcAbi,erc20Abi } from '@kakushi/sdk';
const network=process.argv[2]??'local';
if(network!=='local' && network!=='testnet') throw new Error('Expected local or testnet');
const d=loadDeployments(network as Network);
const definitions=[['SourceRouter',sourceRouterAbi,['PaymentEncoded']],['PayoutRouter',payoutRouterAbi,['Payout']],['DisputeModule',disputeModuleAbi,['DisputeOpened','DisputeSlashed','DisputeMakerProven','DisputeExpired']],['MDC',mdcAbi,['MarginDeposited','MarginWithdrawn','MarginSlashed']],['AttestationOracle',attestationOracleAbi,['WindowAttested']],['EBC',ebcAbi,['PairRegistered','PairActiveSet']],['USDC',erc20Abi,['Transfer']]] as const;
let config='# Generated from current deployment files; rerun after every local redeploy.\nname: kakushi-envio\nhandlers: src/handlers\naddress_format: lowercase\nfield_selection:\n  transaction_fields: [hash]\ncontracts:\n';
for(const [name,abi,names] of definitions){config+=`  - name: ${name}\n    events:\n`;for(const e of abi)if(e.type==='event' && (names as readonly string[]).includes(e.name))config+=`      - event: ${JSON.stringify(`${e.name}(${e.inputs.map(input=>`${input.type}${input.indexed ? " indexed" : ""} ${input.name}`).join(", ")})`)}\n`;}
config+='chains:\n';
for(const c of deployedChains(d)){const dep=d.chains[c.chainId]!;config+=`  - id: ${c.chainId}\n    start_block: ${dep.deployBlock}\n`;config+=`    rpc:\n      - url: ${rpcUrl(c,network as Network)}\n        for: ${network==='local'?'sync':'fallback'}\n        initial_block_interval: 100\n        interval_ceiling: 100\n    contracts:\n`;
const entries:Record<string,string>={SourceRouter:dep.sourceRouter,PayoutRouter:dep.payoutRouter,USDC:c.usdc.address};if(c.isHub)Object.assign(entries,{DisputeModule:d.hub.disputeModule,MDC:d.hub.mdc,AttestationOracle:d.hub.attestationOracle,EBC:d.hub.ebc});for(const [name,address]of Object.entries(entries))config+=`      - name: ${name}\n        address: "${address}"\n`;}
writeFileSync('config.yaml',config);
