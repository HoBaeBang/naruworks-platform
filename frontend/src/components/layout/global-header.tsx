"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MemberMenu } from "@/components/auth/member-menu";

const pageLabelByPath: Record<string, string> = {
  "/calendar": "Naru Calendar",
  "/admin/members": "회원 관리",
};

export function GlobalHeader() {
  const pathname = usePathname();

  if (pathname.startsWith("/join")) {
    return null;
  }

  const pageLabel = pageLabelByPath[pathname];

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color:color-mix(in_srgb,var(--background)_88%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6 sm:px-8 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-3 text-lg font-bold text-[var(--foreground)]"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--primary)] text-sm font-black text-[#062b20]">
              N
            </span>
            NaruWorks
          </Link>
          {pageLabel && (
            <span className="truncate border-l border-[var(--border)] pl-3 text-sm font-bold text-[var(--muted)]">
              {pageLabel}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm sm:gap-5">
          {pathname === "/" ? (
            <nav className="hidden items-center gap-4 text-[var(--muted)] sm:flex sm:gap-5">
              <a href="#services">서비스</a>
              <a href="#calendar">캘린더</a>
              <a href="#about">소개</a>
            </nav>
          ) : (
            <nav className="hidden items-center gap-4 text-[var(--muted)] sm:flex">
              <Link href="/calendar">캘린더</Link>
            </nav>
          )}
          <MemberMenu />
        </div>
      </div>
    </header>
  );
}
