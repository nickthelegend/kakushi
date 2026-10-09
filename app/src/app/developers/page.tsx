const STEPS: [string, string, string][] = [
  ["Make the contract confidential", "Inherit FhishConfig first, then use encrypted types. Keep every handle you store with FHE.allowThis, and FHE.allow it to whoever may read it.", `contract Vault is FhishConfig {
    mapping(address => euint64) balances;

    function deposit(externalEuint64 amount, bytes calldata proof) external {
        euint64 a = FHE.fromExternal(amount, proof);
        balances[msg.sender] = FHE.add(balances[msg.sender], a);
        FHE.allowThis(balances[msg.sender]);
        FHE.allow(balances[msg.sender], msg.sender);
    }
}`],
  ["Encrypt in the client", "The value is encrypted on the user's device. The gateway returns a proof bound to that user and that contract only.", `const fhish = new FhishClient({ gatewayUrl, chainId: 10143, encryptor: wasmEncryptor() });
const { handle, proof } = await fhish.encrypt("euint64", 250n, vault, user);
await wallet.writeContract({ address: vault, abi, functionName: "deposit", args: [handle, proof] });`],
  ["Read your own value", "One EIP-712 signature. The gateway checks the on-chain ACL and seals the value to a key that exists only in this tab.", `const h = await client.readContract({ address: vault, abi, functionName: "balances", args: [user] });
const { [h.toLowerCase()]: balance } = await fhish.userDecrypt([h], vault, wallet);`],
  ["Reveal something publicly", "Ask once; the KMS decrypts, signs k-of-n, and calls you back. No relayer to run, no second transaction.", `uint256 id = FHE.requestDecryption(handles, this.onRevealed.selector);

function onRevealed(uint256 id, uint256[] calldata clear) external {
    require(msg.sender == FHE.oracle());
    // use clear[0]...
}`],
];

export default function Developers() {
  return (
    <div className="mx-auto max-w-4xl px-5 pt-10">
      <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Developer guide</h1>
      <p className="mt-3 max-w-2xl text-tide">Four steps from a normal contract to a confidential one. The API follows Zama's fhEVM, so existing confidential contracts port by changing imports.</p>
      <ol className="mt-12 space-y-16">
        {STEPS.map(([t, b, code], i) => (
          <li key={t} className="grid gap-5 md:grid-cols-[220px_1fr]">
            <div>
              <span className="font-mono text-sm text-biolum">{String(i + 1).padStart(2, "0")}</span>
              <h2 className="mt-1 font-display text-lg font-bold">{t}</h2>
              <p className="mt-2 text-sm text-tide">{b}</p>
            </div>
            <pre className="overflow-x-auto rounded-[18px] border border-kelp bg-trench p-5 font-mono text-[13px] leading-relaxed"><code>{code}</code></pre>
          </li>
        ))}
      </ol>
      <section className="mt-20 border-t border-kelp pt-10">
        <h2 className="font-display text-2xl font-bold">Claude skills</h2>
        <p className="mt-3 max-w-2xl text-tide">The repository ships three skills so a coding agent writes Fhish correctly: <code className="font-mono text-biolum">fhish-confidential-contracts</code> (types, ACL rules, select-not-require, reveals), <code className="font-mono text-biolum">fhish-sdk</code> (encrypt, user decryption, browser setup) and <code className="font-mono text-biolum">fhish-operator</code> (engine, coprocessor, deployment, metrics). Copy <code className="font-mono">skills/</code> into <code className="font-mono">~/.claude/skills</code>.</p>
      </section>
    </div>
  );
}
