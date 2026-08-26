import Link from "next/link";

export default function JoinPendingPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-8 text-[var(--foreground)] sm:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-xl items-center">
        <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_24px_64px_rgba(20,80,54,0.12)] sm:p-8">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--primary-soft)] text-lg font-black text-[var(--primary-strong)]">
            N
          </div>

          <p className="mt-7 text-sm font-bold text-[var(--primary-strong)]">
            NaruWorks
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight">
            가입 승인 대기 중입니다
          </h1>
          <p className="mt-4 leading-7 text-[var(--muted)]">
            NaruWorks는 초대 기반으로 운영됩니다. 관리자 승인 후 Naru
            Calendar를 포함한 서비스를 이용할 수 있습니다.
          </p>

          <Link
            href="/"
            className="mt-8 inline-flex h-11 items-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20] shadow-[0_14px_32px_rgba(32,185,119,0.2)] transition hover:brightness-95"
          >
            Naru Home으로 돌아가기
          </Link>
        </div>
      </section>
    </main>
  );
}
