import { parseAbi } from "viem";

export const oracleAbi = parseAbi([
  "function lastPayoutToBlock(uint64 chainId) view returns (uint64)",
  "function windowCount() view returns (uint256)",
]);
export const ebcAbi = parseAbi(["function allMakers() view returns (address[])"]);
