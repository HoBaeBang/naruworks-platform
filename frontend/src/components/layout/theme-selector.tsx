"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "naruworks-theme-preference";
const THEME_CHANGE_EVENT = "naruworks-theme-change";

export function ThemeSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const preference = useSyncExternalStore<ThemePreference>(
    subscribeToThemePreference,
    getStoredPreference,
    () => "system",
  );

  useEffect(() => {
    const resolved = preference === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : preference;
    document.documentElement.dataset.theme = resolved;
  }, [preference]);

  function changeTheme(next: ThemePreference) {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    setIsOpen(false);
  }

  return (
    <div className="px-1 py-1">
      <button
        type="button"
        role="menuitem"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-bold transition hover:bg-[var(--primary-soft)]"
      >
        <span>테마</span>
        <span className="flex items-center gap-2 text-xs font-semibold text-[var(--muted)]">
          {themeLabel(preference)}
          <span aria-hidden="true">{isOpen ? "⌃" : "⌄"}</span>
        </span>
      </button>
      {isOpen && (
        <div
          role="group"
          aria-label="테마 선택"
          className="mx-2 mb-2 grid grid-cols-3 gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.34)]"
        >
          {(["system", "light", "dark"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => changeTheme(option)}
              aria-pressed={preference === option}
              className={`h-8 rounded-md px-1 text-xs font-bold transition ${preference === option
                ? "bg-[var(--primary-soft)] text-[var(--primary-strong)]"
                : "text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"}`}
            >
              {themeLabel(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function themeLabel(preference: ThemePreference): string {
  return preference === "system" ? "시스템" : preference === "light" ? "라이트" : "다크";
}

function getStoredPreference(): ThemePreference {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}

function subscribeToThemePreference(onStoreChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
}
