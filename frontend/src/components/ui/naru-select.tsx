"use client";

import { useEffect, useId, useRef, useState } from "react";

export type NaruSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function NaruSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  compact = false,
  className = "",
}: {
  value: string;
  options: NaruSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    function closeWhenOutside(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("pointerdown", closeWhenOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeWhenOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        id={selectId}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-left text-[var(--foreground)] outline-none transition hover:border-[var(--primary)] focus:border-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60 ${compact ? "h-9 px-2 text-xs" : "h-12 px-4 text-base"}`}
      >
        <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? "선택하세요"}</span>
        <span aria-hidden="true" className={`text-sm text-[var(--primary-strong)] transition ${isOpen ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {isOpen && <div role="listbox" aria-labelledby={selectId} className="absolute z-40 mt-2 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.24)]">
        {options.map((option) => <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          disabled={option.disabled}
          onClick={() => {
            onChange(option.value);
            setIsOpen(false);
          }}
          className={[
            "flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm transition",
            option.value === value ? "bg-[var(--primary-soft)] font-bold text-[var(--primary-strong)]" : "text-[var(--foreground)] hover:bg-[var(--primary-soft)]",
            option.disabled ? "cursor-not-allowed opacity-45" : "",
          ].join(" ")}
        >{option.label}</button>)}
      </div>}
    </div>
  );
}
