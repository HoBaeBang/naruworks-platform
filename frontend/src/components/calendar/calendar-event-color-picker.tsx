const COLOR_PRESETS = [
  { name: "Grove Mint", value: "#20b977" },
  { name: "Sky", value: "#5bb6f9" },
  { name: "Lavender", value: "#a78bfa" },
  { name: "Coral", value: "#fb7185" },
  { name: "Amber", value: "#f5b942" },
  { name: "Slate", value: "#94a3b8" },
];

export function CalendarEventColorPicker({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold text-[var(--muted)]">색상</span>
      <div className="flex flex-wrap items-center gap-2">
        {COLOR_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            title={preset.name}
            aria-label={`${preset.name} 색상 선택`}
            onClick={() => onChange(preset.value)}
            className={[
              "grid h-9 w-9 place-items-center rounded-full border-2 transition",
              color.toLowerCase() === preset.value.toLowerCase()
                ? "border-[var(--foreground)]"
                : "border-transparent hover:border-[var(--muted)]",
            ].join(" ")}
          >
            <span className="h-5 w-5 rounded-full" style={{ backgroundColor: preset.value }} />
          </button>
        ))}
        <input
          type="color"
          value={color}
          onChange={(event) => onChange(event.target.value)}
          aria-label="직접 색상 선택"
          title="직접 색상 선택"
          className="h-9 w-9 rounded-full border border-[var(--border)] bg-transparent p-0.5"
        />
      </div>
    </div>
  );
}
