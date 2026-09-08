import type { CalendarEvent } from "@/types/calendar";

type RecurrenceRule = CalendarEvent["recurrenceRule"];

const recurrenceLabel: Record<RecurrenceRule, string> = {
  NONE: "반복 안 함",
  WEEKLY: "매주",
  MONTHLY: "매월",
  YEARLY: "매년",
  LUNAR_YEARLY: "음력 매년",
};

export function CalendarRecurrenceFields({
  recurrenceRule,
  recurrenceEndDate,
  onRecurrenceRuleChange,
  onRecurrenceEndDateChange,
}: {
  recurrenceRule: RecurrenceRule;
  recurrenceEndDate: string;
  onRecurrenceRuleChange: (recurrenceRule: RecurrenceRule) => void;
  onRecurrenceEndDateChange: (recurrenceEndDate: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-2">
        <span className="text-sm font-bold text-[var(--muted)]">반복</span>
        <select
          value={recurrenceRule}
          onChange={(event) =>
            onRecurrenceRuleChange(event.target.value as RecurrenceRule)
          }
          className="h-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 outline-none transition focus:border-[var(--primary)]"
        >
          {Object.entries(recurrenceLabel).map(([rule, label]) => (
            <option key={rule} value={rule}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {recurrenceRule !== "NONE" && (
        <label className="flex flex-col gap-2">
          <span className="text-sm font-bold text-[var(--muted)]">
            반복 종료일
          </span>
          <input
            type="date"
            value={recurrenceEndDate}
            onChange={(event) => onRecurrenceEndDateChange(event.target.value)}
            className="h-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 outline-none transition focus:border-[var(--primary)]"
          />
        </label>
      )}

      {recurrenceRule === "LUNAR_YEARLY" && (
        <p className="sm:col-span-2 text-xs leading-5 text-[var(--muted)]">
          선택한 날짜의 음력 월·일을 기준으로 반복합니다. 윤달은 같은 평달로,
          음력 30일이 없는 달은 29일로 표시됩니다.
        </p>
      )}
    </div>
  );
}
