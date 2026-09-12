"use client";

import {
    deleteCalendarEvent,
    deleteCalendarEventOccurrence,
    updateCalendarEvent,
    updateCalendarEventOccurrence,
} from "@/lib/calendar-api";
import { CalendarRecurrenceFields } from "@/components/calendar/calendar-recurrence-fields";
import { CalendarEventAllDayToggle } from "@/components/calendar/calendar-event-all-day-toggle";
import { CalendarEventColorPicker } from "@/components/calendar/calendar-event-color-picker";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CalendarMembership } from "@/lib/calendars-api";
import { NaruSelect } from "@/components/ui/naru-select";
import type { CalendarEvent, CalendarEventOccurrenceScope } from "@/types/calendar";

export function CalendarEventEditModal({
                                           event,
                                           calendars,
                                           closeHref,
                                           onEventChanged,
                                       }: {
    event: CalendarEvent;
    calendars: CalendarMembership[];
    closeHref: string;
    onEventChanged?: () => Promise<void> | void;
}) {
    const router = useRouter();

    const [title, setTitle] = useState(event.title);
    const [startDate, setStartDate] = useState(toDateValue(event.startAt));
    const [endDate, setEndDate] = useState(event.allDay ? toInclusiveEndDate(event.endAt) : toDateValue(event.endAt));
    const [startTime, setStartTime] = useState(toTimeValue(event.startAt));
    const [endTime, setEndTime] = useState(toTimeValue(event.endAt));
    const [allDay, setAllDay] = useState(event.allDay);
    const [location, setLocation] = useState(event.location ?? "");
    const [description, setDescription] = useState(event.description ?? "");
    const [color, setColor] = useState(event.color);
    const [calendarId, setCalendarId] = useState<number | undefined>(event.calendarId ?? undefined);
    const [recurrenceRule, setRecurrenceRule] = useState(event.recurrenceRule);
    const [recurrenceEndDate, setRecurrenceEndDate] = useState(
        toDateValue(event.recurrenceEndAt),
    );
    const [occurrenceScope, setOccurrenceScope] = useState<CalendarEventOccurrenceScope | null>(
        event.recurrenceRule === "NONE" ? "ALL" : null,
    );
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    async function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
        formEvent.preventDefault();

        const period = createEventPeriod(allDay, startDate, endDate, startTime, endTime);
        if (!period) {
            setErrorMessage("종료 일시를 시작 일시보다 늦게 설정해주세요.");
            return;
        }

        if (!confirmRecurrenceAdjustment(recurrenceRule, startDate)) {
            return;
        }
        if (event.recurrenceRule !== "NONE" && !occurrenceScope) {
            setErrorMessage("반복 일정에 적용할 범위를 선택해주세요.");
            return;
        }

        setIsSaving(true);
        setErrorMessage(null);

        try {
            const request = {
                title,
                calendarId,
                description,
                startAt: period.startAt,
                endAt: period.endAt,
                allDay,
                location,
                color,
                recurrenceRule,
                recurrenceEndAt: toRecurrenceEndAt(recurrenceRule, recurrenceEndDate),
            };

            if (event.recurrenceRule === "NONE") {
                await updateCalendarEvent(event.id, request);
            } else {
                await updateCalendarEventOccurrence(
                    event.id,
                    event.occurrenceStartAt,
                    occurrenceScope!,
                    request,
                );
            }

            await onEventChanged?.();
            router.push(closeHref);
        } catch {
            setErrorMessage("일정을 수정하지 못했습니다. 입력값을 확인해주세요.");
        } finally {
            setIsSaving(false);
        }
    }

    async function handleDelete() {
        if (event.recurrenceRule !== "NONE" && !occurrenceScope) {
            setErrorMessage("반복 일정에 적용할 범위를 선택해주세요.");
            return;
        }

        setIsDeleting(true);
        setErrorMessage(null);

        try {
            if (event.recurrenceRule === "NONE") {
                await deleteCalendarEvent(event.id);
            } else {
                await deleteCalendarEventOccurrence(
                    event.id,
                    event.occurrenceStartAt,
                    occurrenceScope!,
                );
            }

            await onEventChanged?.();
            router.push(closeHref);
        } catch {
            setErrorMessage("일정을 삭제하지 못했습니다.");
        } finally {
            setIsDeleting(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06140f]/45 px-4 py-8 backdrop-blur-sm">
            <section className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--background)] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)]">
                <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] pb-4">
                    <div>
                        <p className="text-sm font-bold text-[var(--primary-strong)]">
                            일정 수정
                        </p>
                        <h2 className="mt-2 text-2xl font-semibold">기간 일정</h2>
                    </div>

                    <Link
                        href={closeHref}
                        aria-label="일정 수정 모달 닫기"
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
                            onChange={(inputEvent) => setTitle(inputEvent.target.value)}
                            className="h-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-base outline-none transition focus:border-[var(--primary)]"
                        />
                    </label>

                    <label className="flex flex-col gap-2">
                        <span className="text-sm font-bold text-[var(--muted)]">저장된 캘린더</span>
                        <NaruSelect
                            value={String(calendarId ?? "")}
                            disabled={event.recurrenceRule !== "NONE" && occurrenceScope === "THIS"}
                            onChange={(value) => {
                                const nextCalendar = calendars.find((calendar) => calendar.id === Number(value));
                                setCalendarId(nextCalendar?.id);
                                if (nextCalendar) setColor(nextCalendar.displayColor);
                            }}
                            ariaLabel="저장된 캘린더"
                            options={calendars.map((calendar) => ({ value: String(calendar.id), label: `${calendar.name}${calendar.role === "VIEWER" ? " (보기 전용)" : ""}`, disabled: calendar.role === "VIEWER" }))}
                        />
                        {event.recurrenceRule !== "NONE" && occurrenceScope === "THIS" && <span className="text-xs leading-5 text-[var(--muted)]">한 회차만 수정할 때는 원래 캘린더에 유지됩니다.</span>}
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

                    {event.recurrenceRule !== "NONE" && (
                        <fieldset className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                            <legend className="px-1 text-sm font-bold text-[var(--muted)]">변경 범위</legend>
                            <div className="grid gap-2 sm:grid-cols-3">
                                <ScopeButton scope="THIS" label="이 일정만" selectedScope={occurrenceScope} onSelect={setOccurrenceScope} />
                                <ScopeButton scope="THIS_AND_FOLLOWING" label="이후 일정" selectedScope={occurrenceScope} onSelect={setOccurrenceScope} />
                                <ScopeButton scope="ALL" label="전체 일정" selectedScope={occurrenceScope} onSelect={setOccurrenceScope} />
                            </div>
                        </fieldset>
                    )}

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
                            onChange={(inputEvent) => setLocation(inputEvent.target.value)}
                            className="h-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 outline-none transition focus:border-[var(--primary)]"
                        />
                    </label>

                    <label className="flex flex-col gap-2">
                        <span className="text-sm font-bold text-[var(--muted)]">설명</span>
                        <textarea
                            value={description}
                            onChange={(inputEvent) => setDescription(inputEvent.target.value)}
                            rows={4}
                            className="resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none transition focus:border-[var(--primary)]"
                        />
                    </label>

                    <CalendarEventColorPicker color={color} onChange={setColor} />

                    {errorMessage && (
                        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-500">
                            {errorMessage}
                        </p>
                    )}

                    <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-between">
                        <div className="flex flex-col items-start gap-1"><button
                            type="button"
                            onClick={handleDelete}
                            disabled={isDeleting || isSaving}
                            className="inline-flex h-11 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 px-4 text-sm font-bold text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isDeleting ? "삭제 중" : "삭제"}
                        </button><span className="text-[11px] text-[var(--muted)]">삭제 대상: {calendars.find((calendar) => calendar.id === event.calendarId)?.name ?? "내 캘린더"}</span></div>

                        <div className="flex flex-col gap-3 sm:flex-row">
                            <Link
                                href={closeHref}
                                className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--foreground)]"
                            >
                                취소
                            </Link>
                            <button
                                type="submit"
                                disabled={isSaving || isDeleting}
                                className="inline-flex h-11 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20] shadow-[0_14px_32px_rgba(32,185,119,0.20)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isSaving ? "저장 중" : "저장"}
                            </button>
                        </div>
                    </div>
                </form>
            </section>
        </div>
    );
}

function ScopeButton({
    scope,
    label,
    selectedScope,
    onSelect,
}: {
    scope: CalendarEventOccurrenceScope;
    label: string;
    selectedScope: CalendarEventOccurrenceScope | null;
    onSelect: (scope: CalendarEventOccurrenceScope) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => onSelect(scope)}
            className={[
                "h-10 rounded-lg border px-3 text-sm font-bold transition",
                selectedScope === scope
                    ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-strong)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--primary)]",
            ].join(" ")}
        >
            {label}
        </button>
    );
}

function toTimeValue(value: string) {
    return value.slice(11, 16);
}

function toDateValue(value: string | null) {
    return value?.slice(0, 10) ?? "";
}

function toInclusiveEndDate(value: string) {
    const endDate = new Date(value);
    endDate.setDate(endDate.getDate() - 1);
    return `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
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
    return <div className="flex min-w-0 flex-col gap-2"><span className="text-sm font-bold text-[var(--muted)]">{label}</span><div className="grid grid-cols-[minmax(0,1fr)_6.25rem] gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"><input type="date" value={date} onChange={(inputEvent) => onDateChange(inputEvent.target.value)} className="naru-native-control h-9 min-w-0 border-0 bg-transparent px-2 text-sm text-[var(--foreground)] outline-none" /><div className="border-l border-[var(--border)] pl-1"><input type="time" step={600} value={time} onChange={(inputEvent) => onTimeChange(inputEvent.target.value)} className="naru-native-control h-9 w-full min-w-0 border-0 bg-transparent px-2 text-sm text-[var(--foreground)] outline-none" /></div></div></div>;
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
