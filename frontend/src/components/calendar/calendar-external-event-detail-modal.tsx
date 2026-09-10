"use client";

import Link from "next/link";
import type { CalendarEvent } from "@/types/calendar";

export function CalendarExternalEventDetailModal({ event, closeHref }: { event: CalendarEvent; closeHref: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/30 p-4 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="external-event-title">
      <section className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-[var(--primary-strong)]">Google Calendar</p>
            <h2 id="external-event-title" className="mt-2 text-xl font-semibold">{event.title}</h2>
          </div>
          <Link href={closeHref} aria-label="상세 닫기" className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]">×</Link>
        </div>
        <dl className="mt-6 grid gap-4 text-sm">
          <div><dt className="font-bold text-[var(--muted)]">일정</dt><dd className="mt-1">{event.allDay ? formatDate(event.startAt) + " 종일" : `${formatDateTime(event.startAt)} - ${formatDateTime(event.endAt)}`}</dd></div>
          {event.location && <div><dt className="font-bold text-[var(--muted)]">장소</dt><dd className="mt-1">{event.location}</dd></div>}
          {event.description && <div><dt className="font-bold text-[var(--muted)]">설명</dt><dd className="mt-1 whitespace-pre-wrap">{event.description}</dd></div>}
        </dl>
        <p className="mt-6 border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--muted)]">Google Calendar에서 읽어 온 일정입니다. 수정 및 삭제는 Google Calendar에서 할 수 있습니다.</p>
      </section>
    </div>
  );
}

function formatDateTime(value: string) { return value.replace("T", " ").slice(0, 16); }
function formatDate(value: string) { return value.slice(0, 10); }
