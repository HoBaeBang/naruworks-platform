"use client";

import {
    deleteCalendarEvent,
    deleteCalendarEventOccurrence,
    updateCalendarEvent,
    updateCalendarEventOccurrence,
} from "@/lib/calendar-api";
import { CalendarRecurrenceFields } from "@/components/calendar/calendar-recurrence-fields";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CalendarEvent, CalendarEventOccurrenceScope } from "@/types/calendar";

export function CalendarEventEditModal({
                                           event,
                                           selectedDate,
                                           year,
                                           month,
                                           onEventChanged,
                                       }: {
    event: CalendarEvent;
    selectedDate: string;
    year: number;
    month: number;
    onEventChanged?: () => Promise<void> | void;
}) {
    const closeHref = `/calendar?year=${year}&month=${month}&date=${selectedDate}`;
    const router = useRouter();

    const [title, setTitle] = useState(event.title);
    const [startTime, setStartTime] = useState(toTimeValue(event.startAt));
    const [endTime, setEndTime] = useState(toTimeValue(event.endAt));
    const [location, setLocation] = useState(event.location ?? "");
    const [description, setDescription] = useState(event.description ?? "");
    const [color, setColor] = useState(event.color);
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

        if (!confirmRecurrenceAdjustment(recurrenceRule, selectedDate)) {
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
                description,
                startAt: `${selectedDate}T${startTime}:00`,
                endAt: `${selectedDate}T${endTime}:00`,
                allDay: event.allDay,
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
                        <h2 className="mt-2 text-2xl font-semibold">{selectedDate}</h2>
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

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-[var(--muted)]">
                시작 시간
              </span>
                            <input
                                type="time"
                                value={startTime}
                                onChange={(inputEvent) => setStartTime(inputEvent.target.value)}
                                className="h-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 outline-none transition focus:border-[var(--primary)]"
                            />
                        </label>

                        <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-[var(--muted)]">
                종료 시간
              </span>
                            <input
                                type="time"
                                value={endTime}
                                onChange={(inputEvent) => setEndTime(inputEvent.target.value)}
                                className="h-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 outline-none transition focus:border-[var(--primary)]"
                            />
                        </label>
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

                    <label className="flex flex-col gap-2">
                        <span className="text-sm font-bold text-[var(--muted)]">색상</span>
                        <input
                            type="color"
                            value={color}
                            onChange={(inputEvent) => setColor(inputEvent.target.value)}
                            className="h-12 w-20 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1"
                        />
                    </label>

                    {errorMessage && (
                        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-500">
                            {errorMessage}
                        </p>
                    )}

                    <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-between">
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={isDeleting || isSaving}
                            className="inline-flex h-11 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 px-4 text-sm font-bold text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isDeleting ? "삭제 중" : "삭제"}
                        </button>

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

    return true;
}
