"use client";

import { NaruSelect, type NaruSelectOption } from "@/components/ui/naru-select";

const QUARTER_HOUR_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const hour = Math.floor(index / 4);
  const minute = (index % 4) * 15;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { value, label: formatTimeLabel(value) };
});

export function CalendarDateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2">
      <span className="whitespace-nowrap text-sm font-bold text-[var(--muted)]">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="naru-native-control h-12 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
      />
    </label>
  );
}

export function CalendarDateTimeField({
  label,
  date,
  time,
  onDateChange,
  onTimeChange,
}: {
  label: string;
  date: string;
  time: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="whitespace-nowrap text-sm font-bold text-[var(--muted)]">{label}</span>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_10.5rem] gap-2">
        <input
          type="date"
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
          className="naru-native-control h-12 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]"
        />
        <NaruSelect
          value={time}
          options={timeOptionsFor(time)}
          onChange={onTimeChange}
          ariaLabel={`${label} 시간`}
          className="min-w-0"
        />
      </div>
    </div>
  );
}

function timeOptionsFor(time: string): NaruSelectOption[] {
  if (QUARTER_HOUR_OPTIONS.some((option) => option.value === time)) {
    return QUARTER_HOUR_OPTIONS;
  }
  return [{ value: time, label: formatTimeLabel(time) }, ...QUARTER_HOUR_OPTIONS];
}

function formatTimeLabel(value: string): string {
  const [rawHour, minute] = value.split(":").map(Number);
  const period = rawHour < 12 ? "오전" : "오후";
  const hour = rawHour % 12 || 12;
  return `${period} ${hour}:${String(minute).padStart(2, "0")}`;
}
