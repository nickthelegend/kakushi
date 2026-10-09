import Image from "next/image";

import { cn } from "@kakushi/ui";

/**
 * Glass coin and card stills (from the Polaris design kit). Decorative.
 */
export type GlassArt = "coin-lime" | "coin-purple" | "card-lime";

export function Glass({
  art,
  size,
  className,
  priority = false,
  eager = false,
}: {
  art: GlassArt;
  size: number;
  className?: string;
  /** Above the fold: preload it (and load it eagerly). */
  priority?: boolean;
  /** Load eagerly without a preload: a large render that can become the page's LCP once scrolled to. */
  eager?: boolean;
}) {
  return (
    <Image
      src={`/assets/glass/${art}.png`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      sizes={`${size}px`}
      preload={priority}
      loading={priority || eager ? "eager" : "lazy"}
      draggable={false}
      className={cn("pointer-events-none select-none", className)}
    />
  );
}
