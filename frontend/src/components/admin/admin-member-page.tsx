"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MemberMenu } from "@/components/auth/member-menu";
import {
  AdminMemberApiError,
  getAdminMembers,
  updateAdminMemberStatus,
  type AdminMember,
} from "@/lib/admin-member-api";
import { getLoginUrl } from "@/lib/auth-url";

const statusLabel: Record<AdminMember["status"], string> = {
  APPROVED: "이용 중",
  PENDING: "대기",
  REJECTED: "거절",
  SUSPENDED: "정지",
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AdminMemberPage() {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingMemberId, setUpdatingMemberId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);

  const loadMembers = useCallback(async () => {
    try {
      setError(null);
      setIsForbidden(false);
      setMembers(await getAdminMembers());
    } catch (caughtError) {
      if (
        caughtError instanceof AdminMemberApiError &&
        (caughtError.status === 401 || caughtError.status === 403)
      ) {
        setIsForbidden(true);
        return;
      }

      setError("회원 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadMembers);
  }, [loadMembers]);

  async function handleStatusChange(
    memberId: number,
    status: "APPROVED" | "SUSPENDED",
  ) {
    try {
      setUpdatingMemberId(memberId);
      setError(null);
      const updatedMember = await updateAdminMemberStatus(memberId, status);
      setMembers((currentMembers) =>
        currentMembers.map((member) =>
          member.id === updatedMember.id ? updatedMember : member,
        ),
      );
    } catch (caughtError) {
      if (
        caughtError instanceof AdminMemberApiError &&
        (caughtError.status === 401 || caughtError.status === 403)
      ) {
        setIsForbidden(true);
        return;
      }

      setError("회원 상태를 변경하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setUpdatingMemberId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex items-baseline gap-3">
            <Link href="/" className="text-lg font-black tracking-wide text-[var(--primary-strong)]">
              NaruWorks
            </Link>
            <span className="text-sm font-bold text-[var(--muted)]">회원 관리</span>
          </div>
          <MemberMenu />
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--border)] pb-6">
          <div>
            <p className="text-sm font-bold text-[var(--primary-strong)]">운영</p>
            <h1 className="mt-2 text-3xl font-black">회원 관리</h1>
            <p className="mt-2 text-sm font-medium text-[var(--muted)]">
              가입한 회원의 이용 상태를 확인하고 운영 상태를 변경합니다.
            </p>
          </div>
          {!isLoading && !isForbidden && (
            <p className="text-sm font-bold text-[var(--muted)]">
              전체 {members.length}명
            </p>
          )}
        </div>

        {isLoading && (
          <p className="py-16 text-sm font-bold text-[var(--muted)]">
            회원 정보를 불러오는 중입니다.
          </p>
        )}

        {isForbidden && (
          <div className="py-16">
            <h2 className="text-xl font-black">관리자 권한이 필요합니다.</h2>
            <p className="mt-2 text-sm font-medium text-[var(--muted)]">
              로그인한 관리자 계정으로 다시 접근해주세요.
            </p>
            <a
              href={getLoginUrl()}
              className="mt-6 inline-flex h-10 items-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#06251a] transition hover:bg-[var(--mint-highlight)]"
            >
              로그인하기
            </a>
          </div>
        )}

        {!isLoading && !isForbidden && (
          <div className="pt-6">
            {error && (
              <p className="mb-4 border-l-2 border-red-500 py-2 pl-3 text-sm font-bold text-red-700 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="overflow-x-auto border-y border-[var(--border)]">
              <table className="min-w-[900px] w-full border-collapse text-left">
                <thead className="border-b border-[var(--border)] text-xs font-bold text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3">회원</th>
                    <th className="px-4 py-3">권한</th>
                    <th className="px-4 py-3">상태</th>
                    <th className="px-4 py-3">추천인</th>
                    <th className="px-4 py-3">가입일</th>
                    <th className="px-4 py-3 text-right">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="px-4 py-4">
                        <p className="font-bold">{member.displayName}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{member.email}</p>
                      </td>
                      <td className="px-4 py-4 text-sm font-bold">
                        {member.role === "ADMIN" ? "관리자" : "일반 회원"}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={
                            member.status === "APPROVED"
                              ? "text-sm font-bold text-[var(--primary-strong)]"
                              : "text-sm font-bold text-red-600 dark:text-red-300"
                          }
                        >
                          {statusLabel[member.status]}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm font-medium text-[var(--muted)]">
                        {member.referrer ? (
                          <>
                            <p className="font-bold text-[var(--foreground)]">
                              {member.referrer.displayName}
                            </p>
                            <p className="mt-1 text-xs">{member.referrer.email}</p>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm font-medium text-[var(--muted)]">
                        {formatDateTime(member.createdAt)}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {member.role === "USER" && member.status === "APPROVED" && (
                          <button
                            type="button"
                            onClick={() => void handleStatusChange(member.id, "SUSPENDED")}
                            disabled={updatingMemberId === member.id}
                            className="h-9 rounded-lg border border-red-500/40 px-3 text-sm font-bold text-red-600 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
                          >
                            {updatingMemberId === member.id ? "처리 중" : "회원 정지"}
                          </button>
                        )}
                        {member.role === "USER" && member.status === "SUSPENDED" && (
                          <button
                            type="button"
                            onClick={() => void handleStatusChange(member.id, "APPROVED")}
                            disabled={updatingMemberId === member.id}
                            className="h-9 rounded-lg bg-[var(--primary)] px-3 text-sm font-bold text-[#06251a] transition hover:bg-[var(--mint-highlight)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {updatingMemberId === member.id ? "처리 중" : "이용 복구"}
                          </button>
                        )}
                        {member.role === "ADMIN" && (
                          <span className="text-sm font-medium text-[var(--muted)]">변경 불가</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
