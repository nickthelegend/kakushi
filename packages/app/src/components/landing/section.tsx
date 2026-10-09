"use client";

import { cn } from "@kakushi/ui";
import type { ReactNode } from "react";

import { BlurLines, BlurWords, Rise } from "@/components/motion";

/** A section's eyebrow, two-line heading and sub, revealed word by word. */
export function SectionIntro({
  id,
  eyebrow,
  heading,
  sub,
  align = "left",
  className,
  children,
}: {
  id: string;
  eyebrow: string;
  heading: readonly string[];
  sub?: string;
  align?: "left" | "center";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col", align === "center" ? "items-center text-center" : "items-start", className)}>
      <Rise y={10} blur={4} duration={0.6}>
        <p className="inline-flex h-7 items-center gap-2 rounded-full bg-ui-lime-chip px-3 text-[13px] font-medium text-ui-lime-active ring-1 ring-ui-hairline-strong">
          <span aria-hidden className="size-1.5 rounded-full bg-ui-lime" />
          {eyebrow}
        </p>
      </Rise>
      <BlurWords
        id={id}
        as="h2"
        text={heading}
        className="serif mt-5 text-[clamp(38px,5vw,72px)] leading-[1.04] text-balance"
      />
      {sub ? (
        <BlurLines
          text={sub}
          delay={0.25}
          className={cn("mt-5 max-w-[560px] text-[17px] leading-[1.5] text-ui-muted lg:text-[19px]", align === "center" && "mx-auto")}
        />
      ) : null}
      {children}
    </div>
  );
}

/** The page's content width and gutters. */
export function Shell({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}
