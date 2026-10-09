// The KakushiPool interface the relayer calls. One definition lives in @kakushi/sdk
// (packages/sdk/src/pool-abi.ts) so the SDK's tree rebuild and the relayer cannot drift; it is
// re-exported here so the relayer has a single local import for it.
//
// Expected contract surface:
//   function withdraw(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient,
//                     address relayer, uint256 fee, uint256 refund) payable
//     - proof:          the Noir withdraw proof (UltraHonk bytes, as produced by bb.js)
//     - root:           a recent root of the pool's Poseidon2 tree (depth 20)
//     - nullifierHash:  Poseidon2([nullifier]); reverts if already spent
//     - recipient:      receives amount - fee (bound in the proof)
//     - relayer:        receives fee (bound in the proof, so a front-runner cannot steal it)
//     - fee, refund:    bound in the proof; msg.value must equal refund
//   function withdrawAndCall(bytes proof, bytes32 root, bytes32 nullifierHash, address relayer,
//                     uint256 fee, address target, bytes data, address refundTo)
//     - a private call: recipient = the pool's executor, refund = 0, and
//       extDataHash = keccak256(abi.encode(target, data, refundTo, chainId, pool)) mod p bound in
//       the proof, so the relayer can change none of target/data/refundTo
//   event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)
//   event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)
export { kakushiPoolAbi } from "@kakushi/sdk";

/** Argument order of KakushiPool.withdraw after `proof`. */
export const WITHDRAW_ARGS = ["root", "nullifierHash", "recipient", "relayer", "fee", "refund"] as const;

/** Argument order of KakushiPool.withdrawAndCall after `proof`. */
export const WITHDRAW_AND_CALL_ARGS = ["root", "nullifierHash", "relayer", "fee", "target", "data", "refundTo"] as const;
