export function CalendarEventAllDayToggle({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={[
      "flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3",
      className ?? "",
    ].join(" ")}>
      <span className="text-sm font-bold text-[var(--foreground)]">종일</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-[var(--primary)]"
      />
    </label>
  );
}
