"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCalendarEvent } from "@/lib/calendar-api";

export function CalendarEventCreateModal({
  selectedDate,
  year,
  month,
}: {
  selectedDate: string;
  year: number;
  month: number;
}) {
  const closeHref = `/calendar?year=${year}&month=${month}&date=${selectedDate}`;

  const router = useRouter();
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#20b977");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSaving(true);
    setErrorMessage(null);

    try {
      await createCalendarEvent({
        title,
        description,
        startAt: `${selectedDate}T${startTime}:00`,
        endAt: `${selectedDate}T${endTime}:00`,
        allDay: false,
        location,
        color,
        recurrenceRule: "NONE",
        recurrenceEndAt: null,
      });

      router.push(closeHref);
      router.refresh();
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
            <h2 className="mt-2 text-2xl font-semibold">{selectedDate}</h2>
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

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-[var(--muted)]">
                시작 시간
              </span>
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
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
                onChange={(event) => setEndTime(event.target.value)}
                className="h-12 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 outline-none transition focus:border-[var(--primary)]"
              />
            </label>
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

          <label className="flex flex-col gap-2">
            <span className="text-sm font-bold text-[var(--muted)]">색상</span>
            <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-12 w-20 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1"
            />
          </label>

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
                disabled={isSaving}
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
