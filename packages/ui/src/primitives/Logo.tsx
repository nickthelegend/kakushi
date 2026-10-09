import { KakushiMark } from "../brand";
import { cn } from "../lib/cn";

/**
 * The Kakushi logotype: the seal mark and the word. The height is the size.
 *
 * ```tsx
 * <Logo height={30} />
 * ```
 */
export function Logo({ height = 30, className, alt = "Kakushi" }: { height?: number; className?: string; alt?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 select-none items-center", className)} style={{ height, gap: Math.round(height * 0.32) }} aria-label={alt} role="img">
      <KakushiMark title="" width={height} height={height} />
      <span className="font-satoshi font-bold tracking-[-0.04em] text-ui-text" style={{ fontSize: Math.round(height * 0.78), lineHeight: 1 }}>
        Kakushi
      </span>
    </span>
  );
}

/** The seal alone, where only a symbol fits. */
export function LogoMark({ size = 28, className, title = "Kakushi" }: { size?: number; className?: string; title?: string }) {
  return <KakushiMark title={title} width={size} height={size} focusable="false" className={cn("shrink-0", className)} />;
}
