"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { getInvitationLoginUrl } from "@/lib/auth-url";

const errorMessageByCode: Record<string, string> = {
  "invitation-required": "Naru는 초대 기반으로 가입할 수 있습니다.",
  "invalid-referral-code": "추천 코드를 다시 확인해주세요.",
};

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  );
}

function JoinForm() {
  const searchParams = useSearchParams();
  const initialReferralCode = searchParams.get("ref")?.toUpperCase() ?? "";
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const errorCode = searchParams.get("error");
  const hasInvitationLink = /^[A-Z0-9]{6}$/.test(initialReferralCode);

  useEffect(() => {
    if (!hasInvitationLink) {
      return;
    }

    window.location.replace(getInvitationLoginUrl(initialReferralCode));
  }, [hasInvitationLink, initialReferralCode]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!/^[A-Z0-9]{6}$/.test(referralCode)) {
      return;
    }

    window.location.assign(getInvitationLoginUrl(referralCode));
  }

  const validationMessage = errorCode
    ? errorMessageByCode[errorCode]
    : undefined;
  const hasValidReferralCode = /^[A-Z0-9]{6}$/.test(referralCode);

  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-8 text-[var(--foreground)] sm:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-md items-center">
        <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_24px_64px_rgba(20,80,54,0.12)] sm:p-8">
          <Link
            href="/"
            aria-label="Naru 홈으로 이동"
            className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--primary-soft)] text-lg font-black text-[var(--primary-strong)] transition hover:brightness-95"
          >
            N
          </Link>

          <p className="mt-7 text-sm font-bold text-[var(--primary-strong)]">
            NaruWorks
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight">
            초대로 시작하세요
          </h1>
          <p className="mt-4 leading-7 text-[var(--muted)]">
            초대 링크에서 받은 추천 코드를 입력하면 Google 계정으로 가입을
            이어갈 수 있습니다.
          </p>

          {validationMessage && (
            <p
              role="alert"
              className="mt-6 rounded-md border border-[#e7b7ad] bg-[#fff3f0] px-4 py-3 text-sm font-medium text-[#9f3420] dark:border-[#743b32] dark:bg-[#351b18] dark:text-[#ffc5b9]"
            >
              {validationMessage}
            </p>
          )}

          <form className="mt-7" onSubmit={handleSubmit}>
            <label
              htmlFor="referral-code"
              className="text-sm font-bold text-[var(--foreground)]"
            >
              추천 코드
            </label>
            <input
              id="referral-code"
              value={referralCode}
              onChange={(event) =>
                setReferralCode(
                  event.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, "")
                    .slice(0, 6),
                )
              }
              placeholder="AB12CD"
              autoComplete="off"
              inputMode="text"
              maxLength={6}
              className="mt-2 h-12 w-full rounded-lg border border-[var(--border)] bg-transparent px-4 font-mono text-base font-bold tracking-[0.2em] outline-none transition placeholder:font-sans placeholder:font-normal placeholder:tracking-normal focus:border-[var(--primary-strong)] focus:ring-2 focus:ring-[var(--primary-soft)]"
            />
            <button
              type="submit"
              disabled={!hasValidReferralCode || hasInvitationLink}
              className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20] shadow-[0_14px_32px_rgba(32,185,119,0.2)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {hasInvitationLink ? "Google 로그인으로 이동 중" : "Google로 계속하기"}
            </button>
          </form>

          <p className="mt-6 text-sm leading-6 text-[var(--muted)]">
            이미 회원이라면 홈 화면의 로그인 버튼으로 들어갈 수 있습니다.
          </p>
        </div>
      </section>
    </main>
  );
}
