# Cleanverse lane: implementation and external verification gate

Checked 2026-10-08. P8 / T8.2 is **not complete**.

The existing `PayoutRouter` already provides an optional, immutable compliant-token
configuration and calls `IComplianceValidator.complianceVerify(pool, recipient)`
before both fills and refunds. Its local router test checks rejection, acceptance,
one-time configuration, and native-token isolation. This is a local interface
contract, not evidence that the sponsor's deployed validator accepts that ABI.
`IComplianceValidator.sol` explicitly records that the signature came from earlier
hackathon teams rather than verified sponsor documentation.

The [official Cleanverse site](https://cleanverse.com/) describes eligibility checks
before value moves, but the public pages found on this date do not publish the
validator ABI, pool registration requirements, or Monad testnet contract interface.
The [official terms](https://cleanverse.com/terms-of-service) describe A-Pass issuance
after identity verification; possession of a wallet alone is not verified standing.
No named `CompliantPayoutRouter` adapter was added because that would duplicate the
existing gate while preserving the same unverified external interface assumption.

Before calling this lane integrated, obtain the sponsor's canonical validator ABI,
confirm the configured validator/CVA addresses and token decimals, register the
actual router pool, and provision A-Passes for the Maker and recipient. Then perform
read-only calls against the real validator for known eligible and ineligible
recipients. Record the chain, pool, addresses, block and returned results. A local
test validator cannot satisfy that verification step.

Only after that evidence should the Maker pre-check and UI badge be wired to the
verified interface, with unavailable/reverting reads reported as unknown rather
than compliant. A read-only pre-check cannot replace the router's check at payout
time. The standing no-public-write/deployment hold remains in force.
