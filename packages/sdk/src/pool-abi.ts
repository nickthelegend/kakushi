// KakushiPool: the interface the SDK (note scanning, Merkle tree rebuild) and the relayer expect
// from the shielded pool contract. This is the single definition; packages/relayer re-exports it.
//
//   function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient,
//                     address relayer, uint256 fee, uint256 refund) payable
//     Verifies the Noir withdraw proof against public inputs (root, nullifierHash, recipient,
//     relayer, fee, refund), requires `root` to be a known (recent) root and `nullifierHash`
//     unspent, marks it spent, pays `fee` to `relayer` and the rest to `recipient`.
//     msg.value must equal `refund` (native gas money forwarded to the recipient; 0 for native pools).
//   event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)
//     Emitted once per inserted leaf; leafIndex is 0,1,2,... in insertion order.
//   event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)
//
// Field elements (root, nullifierHash, commitment) are BN254 scalars encoded as big-endian
// uint256 in the bytes32.
import { parseAbi } from "viem";

export const kakushiPoolAbi = parseAbi([
  "function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund) payable",
  "event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)",
  "event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)",
]);
