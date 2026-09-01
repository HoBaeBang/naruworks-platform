"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { registerMember } from "@/lib/auth-api";

export default function JoinTermsPage() {
  const router = useRouter();
  const [termsOfServiceAgreed, setTermsOfServiceAgreed] = useState(false);
  const [privacyPolicyAgreed, setPrivacyPolicyAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const canSubmit = termsOfServiceAgreed && privacyPolicyAgreed && !isSubmitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(undefined);

    try {
      await registerMember({
        termsOfServiceAgreed,
        privacyPolicyAgreed,
      });
      router.replace("/calendar");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "가입을 완료하지 못했습니다.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-8 text-[var(--foreground)] sm:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-md items-center">
        <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_24px_64px_rgba(20,80,54,0.12)] sm:p-8">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--primary-soft)] text-lg font-black text-[var(--primary-strong)]">
            N
          </div>

          <p className="mt-7 text-sm font-bold text-[var(--primary-strong)]">
            NaruWorks
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight">
            약관 동의가 필요합니다
          </h1>
          <p className="mt-4 leading-7 text-[var(--muted)]">
            NaruWorks 이용을 위한 필수 약관에 동의하면 가입이 완료됩니다.
          </p>

          {errorMessage && (
            <p
              role="alert"
              className="mt-6 rounded-md border border-[#e7b7ad] bg-[#fff3f0] px-4 py-3 text-sm font-medium text-[#9f3420] dark:border-[#743b32] dark:bg-[#351b18] dark:text-[#ffc5b9]"
            >
              {errorMessage}
            </p>
          )}

          <form className="mt-7" onSubmit={handleSubmit}>
            <fieldset className="space-y-3">
              <legend className="sr-only">필수 약관 동의</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] px-4 py-4 transition hover:border-[var(--primary)]">
                <input
                  type="checkbox"
                  checked={termsOfServiceAgreed}
                  onChange={(event) =>
                    setTermsOfServiceAgreed(event.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 accent-[var(--primary-strong)]"
                />
                <span>
                  <span className="block text-sm font-bold">이용약관 동의</span>
                  <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">
                    NaruWorks 서비스 이용을 위한 필수 동의
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] px-4 py-4 transition hover:border-[var(--primary)]">
                <input
                  type="checkbox"
                  checked={privacyPolicyAgreed}
                  onChange={(event) =>
                    setPrivacyPolicyAgreed(event.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 accent-[var(--primary-strong)]"
                />
                <span>
                  <span className="block text-sm font-bold">
                    개인정보 처리방침 동의
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-[var(--muted)]">
                    Google 계정 정보와 서비스 데이터 처리에 관한 필수 동의
                  </span>
                </span>
              </label>
            </fieldset>

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20] shadow-[0_14px_32px_rgba(32,185,119,0.2)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isSubmitting ? "가입을 완료하는 중" : "동의하고 가입 완료"}
            </button>
          </form>

          <Link
            href="/"
            className="mt-5 inline-flex text-sm font-bold text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            홈으로 돌아가기
          </Link>
        </div>
      </section>
    </main>
  );
}
