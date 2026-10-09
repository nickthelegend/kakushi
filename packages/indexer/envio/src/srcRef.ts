import {encodeAbiParameters,keccak256} from 'viem';
/** Normative SrcRef.sol encoding; kept dependency-light for independent Envio hosting. */
export function sourceRef(chainId:number,txHash:`0x${string}`,logIndex:number):`0x${string}` {
 const encoded=encodeAbiParameters([{type:'uint64'},{type:'bytes32'},{type:'uint32'}],[BigInt(chainId),txHash,logIndex]);
 return `0x${(BigInt(keccak256(encoded))>>8n).toString(16).padStart(64,'0')}`;
}
