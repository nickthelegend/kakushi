// KakushiPool: the interface the SDK (note scanning, Merkle tree rebuild) and the relayer expect
// from the shielded pool contract. This is the single definition; packages/relayer re-exports it.
//
//   function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient,
//                     address relayer, uint256 fee, uint256 refund) payable
//     Verifies the Noir withdraw proof against public inputs (root, nullifierHash, recipient,
//     relayer, fee, refund, chainId, pool, extDataHash = 0), requires `root` to be a known
//     (recent) root and `nullifierHash` unspent, marks it spent, pays `fee` to `relayer` and the
//     rest to `recipient`. msg.value must equal `refund` (native gas money forwarded to the
//     recipient; 0 for native pools). recipient must not be the pool's executor.
//   function withdrawAndCall(bytes proof, bytes32 root, bytes32 nullifierHash, address relayer,
//                     uint256 fee, address target, bytes data, address refundTo)
//     "Any contract call -> private": the same proof with recipient = executor(), refund = 0 and
//     extDataHash = uint256(keccak256(abi.encode(target, data, refundTo, chainId, pool))) mod p.
//     Pays `fee` to `relayer`; the executor calls target(data) with denomination - fee (msg.value
//     for native pools, an allowance reset to 0 afterwards for ERC-20 pools) and sends every
//     leftover of the pool asset and of the native coin to `refundTo`. Reverts entirely if the
//     call reverts. target must be a contract other than the pool, its executor and the token.
//   function extDataHash(address target, bytes data, address refundTo) view returns (uint256)
//   function executor() view returns (address)    = CREATE(pool, nonce 1)
//   event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)
//     Emitted once per inserted leaf; leafIndex is 0,1,2,... in insertion order.
//   event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)
//     (to = executor for withdrawAndCall)
//   event PrivateCall(bytes32 indexed nullifierHash, address indexed target, address refundTo,
//                     uint256 amount, uint256 refundedToken, uint256 refundedNative)
//
// Field elements (root, nullifierHash, commitment) are BN254 scalars encoded as big-endian
// uint256 in the bytes32.
import { parseAbi } from "viem";

export const kakushiPoolAbi = parseAbi([
  "function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund) payable",
  "function withdrawAndCall(bytes proof, bytes32 root, bytes32 nullifierHash, address relayer, uint256 fee, address target, bytes data, address refundTo)",
  "function extDataHash(address target, bytes data, address refundTo) view returns (uint256)",
  "function executor() view returns (address)",
  "function token() view returns (address)",
  "function denomination() view returns (uint256)",
  "function isSpent(bytes32 nullifierHash) view returns (bool)",
  "function getLastRoot() view returns (bytes32)",
  "event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)",
  "event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)",
  "event PrivateCall(bytes32 indexed nullifierHash, address indexed target, address refundTo, uint256 amount, uint256 refundedToken, uint256 refundedNative)",
]);

// KakushiPoolFactory ("any token -> private"): permissionless, one pool per (token, denomination)
// at CREATE2(factory, keccak256(abi.encode(token, denomination)), pool init code).
export const kakushiPoolFactoryAbi = parseAbi([
  "function createPool(address token, uint256 denomination) returns (address pool)",
  "function poolOf(address token, uint256 denomination) view returns (address)",
  "function predictPool(address token, uint256 denomination) view returns (address)",
  "function allPools() view returns (address[])",
  "function poolCount() view returns (uint256)",
  "function verifier() view returns (address)",
  "event PoolCreated(address indexed token, uint256 indexed denomination, address pool, address indexed creator)",
]);
