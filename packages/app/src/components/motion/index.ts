/**
 * Motion primitives for the landing and app (reveal-on-scroll, Lenis smooth scroll),
 * adapted from the Polaris landing. Every primitive shows its final state under reduced motion.
 */
export { BlurWords } from "./BlurWords";
export { BlurLines, type Segment } from "./BlurLines";
export { Rise } from "./Rise";
export { Marquee } from "./Marquee";
export { CountUp, useCountUp } from "./CountUp";
export { DrawLine } from "./DrawLine";
export { SmoothScroll } from "./SmoothScroll";
export { useReduced, useReveal, usePlay, useMounted } from "./hooks";
export * from "./tokens";
