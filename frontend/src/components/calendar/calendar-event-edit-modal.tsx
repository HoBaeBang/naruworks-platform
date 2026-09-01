"use client";

import {
    deleteCalendarEvent,
    updateCalendarEvent,
} from "@/lib/calendar-api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CalendarEvent } from "@/types/calendar";

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
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    async function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
        formEvent.preventDefault();

        setIsSaving(true);
        setErrorMessage(null);

        try {
            await updateCalendarEvent(event.id, {
                title,
                description,
                startAt: `${selectedDate}T${startTime}:00`,
                endAt: `${selectedDate}T${endTime}:00`,
                allDay: event.allDay,
                location,
                color,
                recurrenceRule: event.recurrenceRule,
                recurrenceEndAt: event.recurrenceEndAt,
            });

            await onEventChanged?.();
            router.push(closeHref);
        } catch {
            setErrorMessage("일정을 수정하지 못했습니다. 입력값을 확인해주세요.");
        } finally {
            setIsSaving(false);
        }
    }

    async function handleDelete() {
        setIsDeleting(true);
        setErrorMessage(null);

        try {
            await deleteCalendarEvent(event.id);

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

function toTimeValue(value: string) {
    return value.slice(11, 16);
}
