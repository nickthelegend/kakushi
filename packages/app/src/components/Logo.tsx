export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap ${className ?? ""}`}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#FF4D2E" />
        <path d="M9 9h14M16 9v14M10 16h12M12 23h8" stroke="#0E0F12" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <span className="text-[19px] font-semibold tracking-[-0.03em]">Kakushi</span>
      <span className="text-[13px] text-dim">隠し</span>
    </span>
  );
}
