import type { SVGProps } from "react";

/**
 * The Kakushi mark: a hanko (seal) in the lime brand colour carrying 隠, "hidden": the
 * destination hidden in the amount, and the seal that stands for the proof.
 */
export function KakushiMark({ title = "Kakushi", mono = false, ...props }: SVGProps<SVGSVGElement> & { title?: string; mono?: boolean }) {
  const labelled = title !== "";
  return (
    <svg viewBox="0 0 64 64" role={labelled ? "img" : undefined} aria-hidden={labelled ? undefined : true} {...props}>
      {labelled ? <title>{title}</title> : null}
      <rect x="2" y="2" width="60" height="60" rx="16" fill={mono ? props.fill ?? "currentColor" : "#BFFA62"} />
      <text x="32" y="44" textAnchor="middle" fontSize="34" fontWeight="700" fontFamily="'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif" fill={mono ? "#0f1011" : "#0f1011"}>
        隠
      </text>
    </svg>
  );
}
