"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { acceptCalendarInvitation, getCalendarInvitationPreview, type CalendarInvitationPreview } from "@/lib/calendars-api";

export function CalendarInvitationJoinModal({ token, closeHref }: { token: string; closeHref: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<CalendarInvitationPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => { void getCalendarInvitationPreview(token).then(setPreview).catch(() => setMessage("유효하지 않거나 만료된 초대 링크입니다.")); }, [token]);

  async function accept() {
    setIsAccepting(true);
    try { await acceptCalendarInvitation(token); router.push(closeHref); router.refresh(); }
    catch { setMessage("공유 캘린더에 참여하지 못했습니다. 이미 참여 중인지 확인해주세요."); }
    finally { setIsAccepting(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#06140f]/45 p-4 backdrop-blur-sm"><section className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-6 shadow-xl"><p className="text-xs font-bold text-[var(--primary-strong)]">공유 캘린더 초대</p>{preview && <><h2 className="mt-2 text-2xl font-semibold">{preview.calendarName}</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{preview.ownerDisplayName}님이 공유한 캘린더입니다. 참여하면 <strong>{preview.role === "EDITOR" ? "일정을 함께 수정" : "일정을 조회"}</strong>할 수 있습니다.</p></>}{!preview && !message && <p className="mt-4 text-sm text-[var(--muted)]">초대 정보를 확인 중입니다.</p>}{message && <p className="mt-4 text-sm font-semibold text-[#d9363e]">{message}</p>}<div className="mt-6 flex justify-end gap-3"><Link href={closeHref} className="inline-flex h-10 items-center rounded-lg border border-[var(--border)] px-4 text-sm font-bold">닫기</Link>{preview && <button type="button" onClick={() => void accept()} disabled={isAccepting} className="inline-flex h-10 items-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20] disabled:opacity-60">{isAccepting ? "참여 중" : "공유 캘린더 참여"}</button>}</div></section></div>;
}
