#!/usr/bin/env bash
# Compile both circuits, write their verification keys and regenerate the checked-in
# Solidity verifiers (UltraHonk, keccak transcript, ZK). CI runs this and fails on a diff.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"
OUT=../contracts/src/verifiers
nargo compile --workspace
for c in payment_compliance payout_inclusion; do
  name=$(echo "$c" | awk -F_ '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')Verifier
  mkdir -p "target/vk/$c"
  bb write_vk -b "target/$c.json" -o "target/vk/$c" -t evm >/dev/null
  bb write_solidity_verifier -k "target/vk/$c/vk" -o "$OUT/$name.sol" -t evm >/dev/null
  # one contract name per circuit so both can be imported side by side
  sed -i.bak "s/^contract HonkVerifier is/contract $name is/" "$OUT/$name.sol" && rm "$OUT/$name.sol.bak"
  echo "wrote $OUT/$name.sol ($(wc -c < "$OUT/$name.sol") bytes)"
done
mkdir -p ../attest-core/circuits
# keep only what noir_js needs (abi + bytecode): debug symbols carry machine-specific paths
for c in payment_compliance payout_inclusion fee_math; do
  node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1]));fs.writeFileSync(process.argv[2],JSON.stringify({noir_version:j.noir_version,hash:j.hash,abi:j.abi,bytecode:j.bytecode}))' "target/$c.json" "../attest-core/circuits/$c.json"
done
echo "copied circuit artifacts (abi + bytecode) to attest-core/circuits"
