"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCalendarEvent } from "@/lib/calendar-api";
import { CalendarRecurrenceFields } from "@/components/calendar/calendar-recurrence-fields";
import { CalendarEventAllDayToggle } from "@/components/calendar/calendar-event-all-day-toggle";
import { CalendarEventColorPicker } from "@/components/calendar/calendar-event-color-picker";
import { CalendarDateField, CalendarDateTimeField } from "@/components/calendar/calendar-event-date-time-fields";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06140f]/45 p-3 backdrop-blur-sm sm:p-8">
      <section className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 shadow-[0_28px_80px_rgba(0,0,0,0.28)] sm:max-h-[calc(100dvh-4rem)] sm:p-5">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] pb-3 sm:pb-4">
          <div>
            <p className="text-sm font-bold text-[var(--primary-strong)]">
              새 일정
            </p>
            <h2 className="mt-1 text-xl font-semibold sm:mt-2 sm:text-2xl">기간 일정</h2>
          </div>

          <Link
            href={closeHref}
            aria-label="새 일정 모달 닫기"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-lg font-bold text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary-strong)] sm:h-10 sm:w-10"
          >
            ×
          </Link>
        </header>

        <form onSubmit={handleSubmit} className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1 sm:mt-5">
          <div className="flex flex-col gap-3 sm:gap-4">
          <label className="flex flex-col gap-1.5 sm:gap-2">
            <span className="text-sm font-bold text-[var(--muted)]">제목</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="일정 제목"
              className="h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] sm:h-12 sm:px-4"
            />
          </label>

          <label className="flex flex-col gap-1.5 sm:gap-2">
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

          <div className="grid items-end gap-2 sm:gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <CalendarEventAllDayToggle
              checked={allDay}
              onChange={setAllDay}
              className="h-12"
            />
            <CalendarRecurrenceFields
              recurrenceRule={recurrenceRule}
              recurrenceEndDate={recurrenceEndDate}
              onRecurrenceRuleChange={(nextRecurrenceRule) => {
                setRecurrenceRule(nextRecurrenceRule);
                if (nextRecurrenceRule === "NONE") setRecurrenceEndDate("");
              }}
              onRecurrenceEndDateChange={setRecurrenceEndDate}
            />
          </div>

          <div className="grid min-w-0 gap-2 sm:gap-3 sm:grid-cols-2">
          {allDay && <>
            <CalendarDateField label="시작일" value={startDate} onChange={setStartDate} />
            <CalendarDateField label="종료일" value={endDate} onChange={setEndDate} />
          </>}
          {!allDay && <>
            <CalendarDateTimeField label="시작 일시" date={startDate} time={startTime} onDateChange={setStartDate} onTimeChange={setStartTime} />
            <CalendarDateTimeField label="종료 일시" date={endDate} time={endTime} onDateChange={setEndDate} onTimeChange={setEndTime} />
          </>}
          </div>

          <label className="flex flex-col gap-1.5 sm:gap-2">
            <span className="text-sm font-bold text-[var(--muted)]">장소</span>
            <input
              type="text"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="장소를 입력하세요"
              className="h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] sm:h-12 sm:px-4"
            />
          </label>

          <label className="flex flex-col gap-1.5 sm:gap-2">
            <span className="text-sm font-bold text-[var(--muted)]">설명</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="일정 메모"
              rows={3}
              className="min-h-[4.5rem] resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--primary)] sm:px-4 sm:py-3"
            />
          </label>

          <CalendarEventColorPicker color={color} onChange={setColor} />

          {errorMessage && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-500">
                {errorMessage}
              </p>
          )}
          </div>

          <div className="sticky bottom-0 mt-3 flex shrink-0 flex-col gap-2 border-t border-[var(--border)] bg-[var(--background)] pt-3 sm:mt-4 sm:flex-row sm:justify-end sm:gap-3 sm:pt-4">
            <Link
              href={closeHref}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--foreground)] sm:h-11"
            >
              취소
            </Link>
            <button
                type="submit"
                disabled={isSaving || !calendarId || calendars.find((calendar) => calendar.id === calendarId)?.role === "VIEWER"}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20] shadow-[0_14px_32px_rgba(32,185,119,0.20)] disabled:cursor-not-allowed disabled:opacity-60 sm:h-11"
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
