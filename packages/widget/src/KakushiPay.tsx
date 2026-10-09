import { type CSSProperties, type ReactNode, useId } from "react";
import type { KakushiPayStatus, KakushiPayStep, KakushiPaymentResult } from "./core.ts";
import { type UseKakushiPayOptions, useKakushiPay } from "./hook.ts";
import { type KakushiTheme, STYLESHEET, themeVars } from "./theme.ts";

export interface KakushiPayProps extends UseKakushiPayOptions {
  /** button text when idle; default "Pay privately" */
  label?: ReactNode;
  theme?: KakushiTheme;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  /** show the status line under the button; default true (screen readers get it either way) */
  showStatus?: boolean;
}

function buttonText(status: KakushiPayStatus, step: KakushiPayStep | undefined, label: ReactNode): ReactNode {
  switch (status) {
    case "resolving":
      return "Finding private address…";
    case "confirming":
      return step === "approve" ? "Approve in wallet…" : "Confirm in wallet…";
    case "sending":
      return step === "approve" ? "Approving…" : "Sending privately…";
    case "paid":
      return "Paid privately";
    case "error":
      return "Try again";
    default:
      return label;
  }
}

function statusText(status: KakushiPayStatus, step: KakushiPayStep | undefined): string {
  switch (status) {
    case "resolving":
      return "Looking up the recipient's private address.";
    case "confirming":
      return step === "approve" ? "Approve the token for StealthPay in your wallet (one time per payment)." : "Confirm the payment in your wallet.";
    case "sending":
      return step === "approve" ? "Waiting for the approval to confirm." : "Sending to a one-time stealth address.";
    default:
      return "";
  }
}

function TxLink({ result, explorer }: { result: KakushiPaymentResult; explorer: string | undefined }) {
  if (!explorer) return null;
  return (
    <>
      {" "}
      <a href={`${explorer.replace(/\/$/, "")}/tx/${result.txHash}`} target="_blank" rel="noreferrer noopener">
        View transaction
      </a>
    </>
  );
}

const ShieldIcon = () => (
  <svg className="kakushi-pay__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

/**
 * A pay button that pays privately: one click resolves the recipient, derives a fresh ERC-5564
 * stealth address and pays it through StealthPay (approving an ERC-20 first when needed).
 */
export function KakushiPay({ label = "Pay privately", theme, className, style, disabled, showStatus = true, ...opts }: KakushiPayProps) {
  const k = useKakushiPay(opts);
  const statusId = useId();
  const errorId = `${statusId}-error`;
  const busy = k.busy;
  const noWallet = !opts.walletClient;
  const recipientError = k.recipient.state === "error" ? k.recipient.error : null;

  let tone: "muted" | "error" | "success" = "muted";
  let line: ReactNode = statusText(k.status, k.step);
  if (k.status === "paid" && k.result) {
    tone = "success";
    line = (
      <>
        Paid privately. Only the recipient can link this payment to them.
        <TxLink result={k.result} explorer={opts.chain?.blockExplorers?.default.url} />
      </>
    );
  } else if (k.status === "error" && k.error) {
    tone = "error";
    line = k.error.message;
  } else if (k.status === "idle" && recipientError) {
    tone = "error";
    line = recipientError.message;
  } else if (k.status === "idle" && noWallet) {
    line = "Connect a wallet to pay.";
  } else if (k.status === "idle" && k.recipient.state === "checking") {
    line = "Checking the recipient…";
  }

  const isDisabled = disabled || !k.canPay;
  const isError = tone === "error";

  return (
    <div className={className ? `kakushi-pay ${className}` : "kakushi-pay"} style={{ ...themeVars(theme), ...style }} data-status={k.status}>
      <style href="kakushi-pay" precedence="default">
        {STYLESHEET}
      </style>
      <button
        type="button"
        className="kakushi-pay__button"
        disabled={isDisabled}
        aria-busy={busy}
        aria-describedby={isError ? errorId : statusId}
        onClick={() => {
          if (!isDisabled) void k.pay();
        }}
      >
        {busy ? <span className="kakushi-pay__spinner" aria-hidden="true" /> : <ShieldIcon />}
        <span>{buttonText(k.status, k.step, label)}</span>
      </button>
      {/* a stable polite region for progress, and an alert inserted on failure so it is announced */}
      <p id={statusId} className="kakushi-pay__status" data-tone={tone} role="status" aria-live="polite" aria-atomic="true" style={!showStatus || isError ? visuallyHidden : undefined}>
        {isError ? null : line}
      </p>
      {isError ? (
        <p id={errorId} className="kakushi-pay__status" data-tone="error" role="alert" style={showStatus ? undefined : visuallyHidden}>
          {line}
        </p>
      ) : null}
    </div>
  );
}

const visuallyHidden: CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 };
