/** The Kakushi mark: a cinnabar hanko with 隠 ("hidden"), the seal that also stands for the proof. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <span className="grid size-8 place-items-center rounded-[7px] border-2 border-accent font-display text-[17px] font-bold leading-none text-accent shadow-[inset_0_0_0_2px_rgba(232,69,44,0.18)]">
        隠
      </span>
      <span className="font-display text-[21px] font-bold tracking-[0.01em]">Kakushi</span>
    </span>
  );
}
