"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCalendarEvent } from "@/lib/calendar-api";
import { CalendarRecurrenceFields } from "@/components/calendar/calendar-recurrence-fields";
import { CalendarEventAllDayToggle } from "@/components/calendar/calendar-event-all-day-toggle";
import { CalendarEventColorPicker } from "@/components/calendar/calendar-event-color-picker";
import type { CalendarMembership } from "@/lib/calendars-api";
import { NaruSelect } from "@/components/ui/naru-select";
import type { CalendarEvent } from "@/types/calendar";

export function CalendarEventCreateModal({
  selectedDate,
  calendars,
  initialCalendarId,
  closeHref,
  onEventChanged,
}: {
  selectedDate: string;
  calendars: CalendarMembership[];
  initialCalendarId?: number;
  closeHref: string;
  onEventChanged?: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(selectedDate);
  const [endDate, setEndDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(
    calendars.find((calendar) => calendar.id === initialCalendarId)?.displayColor ?? "#20b977",
  );
  const [calendarId, setCalendarId] = useState<number | undefined>(initialCalendarId);
  const [recurrenceRule, setRecurrenceRule] = useState<CalendarEvent["recurrenceRule"]>("NONE");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const targetCalendar = calendars.find((calendar) => calendar.id === calendarId);
    if (!targetCalendar || targetCalendar.role === "VIEWER") {
      setErrorMessage("이 캘린더는 보기 전용입니다.");
      return;
    }

    const period = createEventPeriod(allDay, startDate, endDate, startTime, endTime);
    if (!period) {
      setErrorMessage("종료 일시를 시작 일시보다 늦게 설정해주세요.");
      return;
    }

    if (!confirmRecurrenceAdjustment(recurrenceRule, startDate)) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      await createCalendarEvent({
        calendarId,
        title,
        description,
        startAt: period.startAt,
        endAt: period.endAt,
        allDay,
        location,
        color,
        recurrenceRule,
        recurrenceEndAt: toRecurrenceEndAt(recurrenceRule, recurrenceEndDate),
      });

      await onEventChanged?.();
      router.push(closeHref);
    } catch {
      setErrorMessage("일정을 저장하지 못했습니다. 입력값을 확인해주세요.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06140f]/45 px-4 py-8 backdrop-blur-sm">
      <section className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--background)] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)]">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
          <div>
            <p className="text-sm font-bold text-[var(--primary-strong)]">
              새 일정
            </p>
            <h2 className="mt-2 text-2xl font-semibold">기간 일정</h2>
          </div>

          <Link
            href={closeHref}
            aria-label="새 일정 모달 닫기"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-lg font-bold text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary-strong)]"
          >
            ×
          </Link>
        </header>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-bold text-[var(--muted)]">제목</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="일정 제목"
              className="h-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-base outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-bold text-[var(--muted)]">저장할 캘린더</span>
            <NaruSelect value={String(calendarId ?? "")} onChange={(value) => {
              const nextCalendar = calendars.find((calendar) => calendar.id === Number(value));
              setCalendarId(nextCalendar?.id);
              if (nextCalendar) setColor(nextCalendar.displayColor);
            }} ariaLabel="저장할 캘린더" options={[
              { value: "", label: "캘린더를 선택하세요", disabled: true },
              ...calendars.map((calendar) => ({ value: String(calendar.id), label: `${calendar.name}${calendar.role === "VIEWER" ? " (보기 전용)" : ""}`, disabled: calendar.role === "VIEWER" })),
            ]} />
          </label>

          <CalendarRecurrenceFields
            recurrenceRule={recurrenceRule}
            recurrenceEndDate={recurrenceEndDate}
            onRecurrenceRuleChange={(nextRecurrenceRule) => {
              setRecurrenceRule(nextRecurrenceRule);
              if (nextRecurrenceRule === "NONE") {
                setRecurrenceEndDate("");
              }
            }}
            onRecurrenceEndDateChange={setRecurrenceEndDate}
          />

          <div className="flex flex-wrap items-end gap-3">
          <CalendarEventAllDayToggle
            checked={allDay}
            onChange={setAllDay}
            className="h-12 shrink-0"
          />
          {allDay && <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <DateField label="시작일" value={startDate} onChange={setStartDate} />
            <DateField label="종료일" value={endDate} onChange={setEndDate} />
          </div>}
          {!allDay && <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <DateTimeField label="시작 일시" date={startDate} time={startTime} onDateChange={setStartDate} onTimeChange={setStartTime} />
            <DateTimeField label="종료 일시" date={endDate} time={endTime} onDateChange={setEndDate} onTimeChange={setEndTime} />
          </div>}
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-bold text-[var(--muted)]">장소</span>
            <input
              type="text"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="장소를 입력하세요"
              className="h-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-bold text-[var(--muted)]">설명</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="일정 메모"
              rows={4}
              className="resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)]"
            />
          </label>

          <CalendarEventColorPicker color={color} onChange={setColor} />

          {errorMessage && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-500">
                {errorMessage}
              </p>
          )}

          <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
            <Link
              href={closeHref}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--foreground)]"
            >
              취소
            </Link>
            <button
                type="submit"
                disabled={isSaving || !calendarId || calendars.find((calendar) => calendar.id === calendarId)?.role === "VIEWER"}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20] shadow-[0_14px_32px_rgba(32,185,119,0.20)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "저장 중" : "저장"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function toRecurrenceEndAt(
  recurrenceRule: CalendarEvent["recurrenceRule"],
  recurrenceEndDate: string,
) {
  if (recurrenceRule === "NONE" || !recurrenceEndDate) {
    return null;
  }

  return `${recurrenceEndDate}T23:59:59`;
}

function confirmRecurrenceAdjustment(
  recurrenceRule: CalendarEvent["recurrenceRule"],
  startDate: string,
) {
  const [, month, day] = startDate.split("-").map(Number);

  if (recurrenceRule === "MONTHLY" && day >= 29) {
    return window.confirm(
      "날짜가 없는 달에는 해당 월의 마지막 날에 반복 일정이 표시됩니다. 계속 저장할까요?",
    );
  }

  if (recurrenceRule === "YEARLY" && month === 2 && day === 29) {
    window.alert("2월 29일 일정은 평년에는 2월 28일에 표시됩니다.");
  }

  if (recurrenceRule === "LUNAR_YEARLY") {
    window.alert("음력 기준으로 반복됩니다. 윤달은 같은 평달로, 음력 30일이 없는 달은 29일로 표시됩니다.");
  }

  return true;
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="flex flex-col gap-2"><span className="text-sm font-bold text-[var(--muted)]">{label}</span><input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="naru-native-control h-12 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-[var(--foreground)] outline-none transition focus:border-[var(--primary)]" /></label>;
}

function DateTimeField({ label, date, time, onDateChange, onTimeChange }: { label: string; date: string; time: string; onDateChange: (value: string) => void; onTimeChange: (value: string) => void }) {
  return <div className="flex min-w-0 flex-col gap-2"><span className="text-sm font-bold text-[var(--muted)]">{label}</span><div className="grid grid-cols-[minmax(0,1fr)_6.25rem] gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"><input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} className="naru-native-control h-9 min-w-0 border-0 bg-transparent px-2 text-sm text-[var(--foreground)] outline-none" /><div className="border-l border-[var(--border)] pl-1"><input type="time" step={600} value={time} onChange={(event) => onTimeChange(event.target.value)} className="naru-native-control h-9 w-full min-w-0 border-0 bg-transparent px-2 text-sm text-[var(--foreground)] outline-none" /></div></div></div>;
}

function createEventPeriod(allDay: boolean, startDate: string, endDate: string, startTime: string, endTime: string) {
  const startAt = allDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`;
  const endAt = allDay ? atStartOfNextDay(endDate) : `${endDate}T${endTime}:00`;

  return startAt < endAt ? { startAt, endAt } : null;
}

function atStartOfNextDay(date: string) {
  const nextDay = new Date(`${date}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);

  return `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}T00:00:00`;
}
