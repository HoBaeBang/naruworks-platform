"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getLoginUrl } from "@/lib/auth-url";
import {
  getCurrentMember,
  logoutMember,
  type MemberProfile,
} from "@/lib/member-api";

export function MemberMenu() {
  const [member, setMember] = useState<MemberProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadMember = useCallback(async () => {
    try {
      setMember(await getCurrentMember());
    } catch {
      setMessage("회원 정보를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadMember);
  }, [loadMember]);

  async function handleCopyInvitationLink() {
    if (!member) {
      return;
    }

    const invitationUrl = new URL("/join", window.location.origin);
    invitationUrl.searchParams.set("ref", member.referralCode);

    try {
      await navigator.clipboard.writeText(invitationUrl.toString());
      setMessage("초대 링크를 복사했습니다.");
    } catch {
      setMessage("초대 링크를 복사하지 못했습니다.");
    }
  }

  async function handleLogout() {
    setMessage(null);

    try {
      await logoutMember();
      setMember(null);
      setIsOpen(false);
      window.location.assign("/");
    } catch {
      setMessage("로그아웃하지 못했습니다. 다시 시도해주세요.");
    }
  }

  if (isLoading) {
    return <span className="h-9 w-20" aria-hidden="true" />;
  }

  if (!member) {
    return (
      <a
        href={getLoginUrl()}
        className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary-strong)]"
      >
        로그인
      </a>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setIsOpen((current) => !current);
          setMessage(null);
        }}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="회원 메뉴"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm font-bold text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary-strong)]"
      >
        <span className="grid h-5 w-5 place-items-center rounded-md bg-[var(--primary-soft)] text-xs font-black text-[var(--primary-strong)]">
          {member.displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="max-w-24 truncate">{member.displayName}</span>
      </button>

      {isOpen && (
        <section
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 shadow-[0_20px_48px_rgba(10,35,25,0.18)]"
        >
          <div className="border-b border-[var(--border)] px-1 pb-3">
            <p className="truncate text-sm font-bold">{member.displayName}</p>
            <p className="mt-1 truncate text-xs text-[var(--muted)]">{member.email}</p>
          </div>

          <div className="px-1 py-3">
            <p className="text-xs font-bold text-[var(--muted)]">내 추천 코드</p>
            <p className="mt-1 font-mono text-sm font-bold tracking-widest text-[var(--primary-strong)]">
              {member.referralCode}
            </p>
          </div>

          {member.role === "ADMIN" && (
            <Link
              href="/admin/members"
              role="menuitem"
              onClick={() => setIsOpen(false)}
              className="flex h-10 w-full items-center rounded-lg px-3 text-left text-sm font-bold transition hover:bg-[var(--primary-soft)]"
            >
              회원 관리
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => void handleCopyInvitationLink()}
            className="flex h-10 w-full items-center rounded-lg px-3 text-left text-sm font-bold transition hover:bg-[var(--primary-soft)]"
          >
            초대 링크 복사
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleLogout()}
            className="mt-1 flex h-10 w-full items-center rounded-lg px-3 text-left text-sm font-bold text-red-600 transition hover:bg-red-500/10 dark:text-red-300"
          >
            로그아웃
          </button>

          {message && (
            <p className="mt-2 border-t border-[var(--border)] px-1 pt-3 text-xs font-bold text-[var(--muted)]">
              {message}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
