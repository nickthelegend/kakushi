// Fhish deep-sea palette. Rule: biolum (cyan) marks anything encrypted; lantern (amber) appears only
// on values that were just revealed to their owner. Everything else is foam on abyss.
export const C = {
  abyss: "#021a20",
  trench: "#03212a",
  surface: "#062a33",
  surfaceHi: "#0a3540",
  line: "rgba(52, 227, 255, 0.13)",
  lineStrong: "rgba(52, 227, 255, 0.32)",
  biolum: "#34e3ff",
  biolumDim: "rgba(52, 227, 255, 0.10)",
  biolumGlow: "rgba(52, 227, 255, 0.22)",
  lantern: "#ffb648",
  lanternDim: "rgba(255, 182, 72, 0.12)",
  foam: "#e6f6f5",
  mist: "#9cbcbf",
  faint: "#5d8489",
  danger: "#ff7a7a",
  dangerDim: "rgba(255, 122, 122, 0.10)",
  ok: "#6ff0c0",
} as const;

export const F = {
  display: "Unbounded_600SemiBold",
  displayLight: "Unbounded_400Regular",
  sans: "IBMPlexSans_400Regular",
  sansMed: "IBMPlexSans_500Medium",
  sansBold: "IBMPlexSans_600SemiBold",
  mono: "IBMPlexMono_400Regular",
  monoMed: "IBMPlexMono_500Medium",
} as const;

export const R = { sm: 10, md: 16, lg: 22, pill: 999 } as const;
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
