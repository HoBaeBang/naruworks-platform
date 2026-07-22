export default function CalendarPage() {
    return (
        <main className="min-h-screen bg-[var(--background)] px-6 py-16 text-[var(--foreground)] sm:px-8 lg:px-10">
            <section className="mx-auto flex w-full max-w-4xl flex-col gap-8">
                <a
                    href="/"
                    className="w-fit text-sm font-bold text-[var(--primary-strong)]"
                >
                    ← Naru 홈으로
                </a>

                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8">
                    <p className="text-sm font-bold text-[var(--primary-strong)]">
                        첫 번째 서비스
                    </p>
                    <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-5xl">
                        Naru Calendar
                    </h1>
                    <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--muted)]">
                        일정관리 서비스 준비 중입니다. 자체 일정 CRUD를 먼저 만들고,
                        이후 Google Calendar 동기화까지 확장합니다.
                    </p>
                </div>

                <section className="grid gap-3 sm:grid-cols-3">
                    <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                        <h2 className="font-semibold">1단계</h2>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                            일정 생성, 조회, 수정, 삭제
                        </p>
                    </article>

                    <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                        <h2 className="font-semibold">2단계</h2>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                            월간/주간 캘린더 화면
                        </p>
                    </article>

                    <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
                        <h2 className="font-semibold">3단계</h2>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                            Google Calendar 동기화 검토
                        </p>
                    </article>
                </section>
            </section>
        </main>
    );
}
