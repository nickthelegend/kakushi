/** Chain and token coins with the real marks (SVGs from @web3icons/core, in public/logos). */

const CHAIN: Record<number, { logo: string; name: string; full?: boolean }> = {
  10143: { logo: "monad", name: "Monad" },
  11155111: { logo: "ethereum", name: "Sepolia" },
  84532: { logo: "base", name: "Base Sepolia" },
  421614: { logo: "arbitrum", name: "Arbitrum Sepolia", full: true },
  11155420: { logo: "optimism", name: "OP Sepolia", full: true },
};

function LogoCoin({ logo, label, size, full }: { logo: string; label: string; size: number; full?: boolean }) {
  return (
    <span role="img" aria-label={label} className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-white ring-1 ring-black/10" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs */}
      <img src={`/logos/${logo}.svg`} alt="" width={size} height={size} style={{ width: full ? "100%" : "68%", height: full ? "100%" : "68%" }} draggable={false} />
    </span>
  );
}

export function ChainCoin({ chainId, size = 42 }: { chainId: number; size?: number }) {
  const c = CHAIN[chainId] ?? { logo: "ethereum", name: `Chain ${chainId}` };
  return <LogoCoin logo={c.logo} label={c.name} size={size} full={c.full} />;
}

export function AssetCoin({ asset, size = 42 }: { asset: "USDC" | "ETH"; size?: number }) {
  return asset === "USDC" ? <LogoCoin logo="usdc" label="USDC" size={size} full /> : <LogoCoin logo="eth" label="ETH" size={size} full />;
}
