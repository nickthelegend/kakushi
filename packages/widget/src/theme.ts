// Self-contained styling: CSS variables with Kakushi defaults, no Tailwind and no stylesheet to
// import. Override per instance with the `theme` prop, or globally by setting the variables
// (e.g. `.my-checkout { --kakushi-accent: #0a7 }`) on any ancestor.
import type { CSSProperties } from "react";

export interface KakushiTheme {
  /** surface behind the button: focus-ring gap and spinner track; default #0b0f1f */
  background?: string;
  /** button fill; default #2f47f5 */
  accent?: string;
  /** button fill on hover; default a lighter accent */
  accentHover?: string;
  /** button text; default #fff */
  text?: string;
  /** status line text; default #8d97c2 */
  muted?: string;
  /** error text; default #ff8a8a */
  error?: string;
  /** "paid" text; default #7ee2b8 */
  success?: string;
  /** button corner radius; default 999px (pill) */
  radius?: string;
  fontFamily?: string;
  /** button font size; default 15px */
  fontSize?: string;
  /** button height; default 44px */
  height?: string;
  /** button width; default auto (use "100%" to fill the container) */
  width?: string;
}

export const THEME_VARS: Record<keyof KakushiTheme, `--kakushi-${string}`> = {
  background: "--kakushi-bg",
  accent: "--kakushi-accent",
  accentHover: "--kakushi-accent-hover",
  text: "--kakushi-text",
  muted: "--kakushi-muted",
  error: "--kakushi-error",
  success: "--kakushi-success",
  radius: "--kakushi-radius",
  fontFamily: "--kakushi-font",
  fontSize: "--kakushi-font-size",
  height: "--kakushi-height",
  width: "--kakushi-width",
};

export const DEFAULT_THEME: Required<KakushiTheme> = {
  background: "#0b0f1f",
  accent: "#2f47f5",
  accentHover: "#4a5ff7",
  text: "#fff",
  muted: "#8d97c2",
  error: "#ff8a8a",
  success: "#7ee2b8",
  radius: "999px",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontSize: "15px",
  height: "44px",
  width: "auto",
};

/** Only the variables the theme sets, so ancestor overrides still apply to the rest. */
export function themeVars(theme: KakushiTheme | undefined): CSSProperties {
  const out: Record<string, string> = {};
  if (!theme) return out as CSSProperties;
  for (const k of Object.keys(THEME_VARS) as (keyof KakushiTheme)[]) {
    const v = theme[k];
    if (v !== undefined) out[THEME_VARS[k]] = v;
  }
  return out as CSSProperties;
}

const v = (k: keyof KakushiTheme) => `var(${THEME_VARS[k]}, ${DEFAULT_THEME[k]})`;

/** Scoped stylesheet, rendered once per document (React 19 dedupes <style href precedence>). */
export const STYLESHEET = `
.kakushi-pay{display:inline-flex;flex-direction:column;align-items:stretch;gap:8px;font-family:${v("fontFamily")};width:${v("width")};max-width:100%}
.kakushi-pay__button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:${v("height")};padding:0 22px;border-radius:${v("radius")};background:${v("accent")};color:${v("text")};font-family:inherit;font-size:${v("fontSize")};font-weight:600;letter-spacing:-0.01em;line-height:1;cursor:pointer;user-select:none;transition:background-color .15s ease,transform .1s ease,opacity .15s ease;-webkit-tap-highlight-color:transparent}
.kakushi-pay__button:hover:not(:disabled){background:${v("accentHover")}}
.kakushi-pay__button:active:not(:disabled){transform:scale(.98)}
.kakushi-pay__button:focus-visible{box-shadow:0 0 0 2px ${v("background")},0 0 0 4px ${v("accent")}}
.kakushi-pay__button:disabled{cursor:not-allowed;opacity:.55}
.kakushi-pay__button[aria-busy="true"]{cursor:progress;opacity:.85}
.kakushi-pay__icon{width:16px;height:16px;flex:none}
.kakushi-pay__spinner{width:14px;height:14px;flex:none;border-radius:50%;border:2px solid color-mix(in srgb,${v("text")} 30%,transparent);border-top-color:${v("text")};animation:kakushi-pay-spin .7s linear infinite}
.kakushi-pay__status{margin:0;min-height:1.2em;font-size:13px;line-height:1.35;color:${v("muted")};text-align:center;overflow-wrap:anywhere}
.kakushi-pay__status[data-tone="error"]{color:${v("error")}}
.kakushi-pay__status[data-tone="success"]{color:${v("success")}}
.kakushi-pay__status a{color:inherit;text-decoration:underline;text-underline-offset:2px}
@keyframes kakushi-pay-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.kakushi-pay__spinner{animation-duration:2s}.kakushi-pay__button{transition:none}}
`;
