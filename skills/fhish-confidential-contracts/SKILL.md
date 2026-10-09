---
name: fhish-confidential-contracts
description: Write confidential Solidity on Monad with Fhish (fully homomorphic encryption). Use when making any contract keep balances, bids, votes, orders, salaries or other values encrypted on-chain, porting a Zama fhEVM/OpenZeppelin ERC-7984 contract to Monad, or reviewing FHE.sol code for ACL/decryption mistakes.
---

# Confidential contracts with Fhish on Monad

Fhish gives any Solidity contract encrypted types. Values are 32-byte *handles*; the ciphertexts live in
the Fhish coprocessor (real Zama tfhe-rs), and Monad only sees the computation graph. The API is
shaped like Zama's `FHE` library, so fhEVM code ports with an import change.

## The integration is two lines

```solidity
import {FHE} from "@fhish/lib/FHE.sol";
import {euint64, ebool, externalEuint64} from "@fhish/lib/FhishTypes.sol";
import {FhishConfig} from "@fhish/FhishConfig.sol";

contract MyApp is FhishConfig, MyBase { ... }   // FhishConfig FIRST
```

`FhishConfig` reads the deployment from FhishRegistry at `0x2152Ed4dD179fCDe7FE0c2F35e274Ce4D7b0BaF9`,
the same address on every chain (CREATE3). **List it first** in the inheritance list: base
constructors run left to right, and FHE calls in a later base's constructor need the config loaded.
Without the registry use `FhishConfigManual(FhishConfigStruct(...))`.

## Types and operations

| Type | Use |
|---|---|
| `ebool` | encrypted flag (votes, "crossed", "ok") |
| `euint32` | counters, indexes, small amounts |
| `euint64` | money (token amounts, prices) |
| `externalEbool/Euint32/Euint64` | client-encrypted inputs, bound with `FHE.fromExternal(input, proof)` |

Arithmetic `add sub mul min max and or xor`; comparisons `eq ne lt le gt ge` (return `ebool`); every
op also takes a plaintext right-hand side (`FHE.add(x, 5)`) which is cheaper. `FHE.select(c, a, b)`
is the only branch. `FHE.asEuint64(v)` encrypts a public constant. `FHE.randEuint32(bound)`.

## Rules that prevent real bugs

1. **Never `require` on encrypted data.** You can't read it. Compute both outcomes and `select`:
   ```solidity
   ebool ok = FHE.ge(balance, amount);
   euint64 sent = FHE.select(ok, amount, FHE.asEuint64(0));   // a failed transfer silently moves 0
   ```
2. **ACL after every assignment you keep.** A new handle is usable by your contract only for the
   current transaction (transient, EIP-1153). If you store it, call `FHE.allowThis(x)`. If a user
   must decrypt it later, `FHE.allow(x, user)`. Forgetting `allowThis` makes the next transaction
   revert with `NotAllowed`. Re-grant after every update (each op produces a new handle).
3. **Inputs are bound to (user, contract).** `FHE.fromExternal` uses `msg.sender` as the user. A
   relayer or another contract calling on the user's behalf needs the input encrypted for *that*
   caller.
4. **Initialize encrypted state you might reveal.** An uninitialized handle is `0`; operations treat
   it as encrypted 0, but `requestDecryption` of a zero handle reverts. Set
   `x = FHE.allowThis(FHE.asEuint32(0))` in the constructor.
5. **Public reveal = request + callback.** Fhish delivers it automatically (k-of-n KMS signatures,
   optionally through Chainlink CRE):
   ```solidity
   bytes32[] memory hs = new bytes32[](1);
   hs[0] = FHE.toBytes32(highest);
   uint256 id = FHE.requestDecryption(hs, this.onRevealed.selector);

   function onRevealed(uint256 id, uint256[] calldata clear) external {
       require(msg.sender == FHE.oracle(), "only oracle");   // ALWAYS check
       ...
   }
   ```
   Reveal the minimum: the auction reveals the winning price and index, never losing bids.
6. **Monad gas is charged on the gas LIMIT.** FHE calls are external calls plus events; estimate and
   send a tight limit (the SDK and e2e use explicit limits).

## Patterns (see `contracts/src/apps/`)

- **ConfidentialToken** (ERC-7984-shaped): `confidentialBalanceOf`, `confidentialTransfer(to, externalEuint64, proof)`.
- **ConfidentialERC20Wrapper**: wrap ANY ERC-20 (USDC, AUSD) into encrypted balances; unwrap reveals only the unwrapped amount.
- **SealedBidAuction**: running max with `gt` + `select` over bids and the winner index.
- **ConfidentialVoting**: `ebool` ballots, `select(choice, 1, 0)` into tallies.
- **DarkOTC**: encrypted limit prices; `ge(bid, ask)` decides a cross; a miss reveals nothing.

## Testing

Foundry: deploy `FhishInputVerifier`, `FhishExecutor` (deploys the ACL), `FhishDecryptionOracle`,
put `FhishRegistry` at the registry address with `deployCodeTo`, sign input attestations and
decryption results with `vm.sign` (see `contracts/test/Fhish.t.sol`). Real ciphertexts: run the local
e2e (`node scripts/e2e-local.ts`).
