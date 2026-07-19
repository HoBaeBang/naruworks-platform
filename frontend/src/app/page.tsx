const projects = [
  {
    name: "NaruWorks Platform",
    description: "개인 홈서버 위에서 여러 서비스를 운영하기 위한 플랫폼",
    status: "Phase 1",
  },
  {
    name: "StablePay Network",
    description: "결제, 원장, 정산 도메인을 검증하는 기준 구현",
    status: "External Module",
  },
];

const services = [
  {
    name: "Project Hub",
    description: "프로젝트와 포트폴리오를 한곳에서 보여주는 공개 허브",
    status: "Planning",
  },
  {
    name: "Service Request",
    description: "지인이나 사용자가 필요한 서비스를 요청하는 접수 흐름",
    status: "Next",
  },
  {
    name: "Admin Dashboard",
    description: "서비스 상태와 요청을 관리하는 관리자 화면",
    status: "Skeleton",
  },
];

export default function Home() {
  return (
      <main className="min-h-screen bg-zinc-950 text-zinc-50">
        <section className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-6 py-16 sm:px-8 lg:px-10">
          <header className="flex flex-col gap-6">
            <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">
              Personal Service Platform
            </p>

            <div className="flex max-w-4xl flex-col gap-5">
              <h1 className="text-4xl font-semibold leading-tight sm:text-6xl">
                NaruWorks
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-zinc-300">
                기획, 프론트엔드, 백엔드, 데이터베이스, CI/CD, 홈서버 운영까지
                직접 수행하는 end-to-end 개인 서비스 플랫폼입니다.
              </p>
            </div>
          </header>

          <section className="grid gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 sm:grid-cols-3">
            <div>
              <p className="text-sm text-zinc-400">Frontend</p>
              <p className="mt-1 font-medium">Next.js + TypeScript</p>
            </div>
            <div>
              <p className="text-sm text-zinc-400">Backend</p>
              <p className="mt-1 font-medium">Spring Boot + PostgreSQL</p>
            </div>
            <div>
              <p className="text-sm text-zinc-400">Runtime</p>
              <p className="mt-1 font-medium">Docker Compose + Caddy</p>
            </div>
          </section>

          <section className="grid gap-10 lg:grid-cols-2">
            <CatalogSection title="Projects" items={projects} />
            <CatalogSection title="Services" items={services} />
          </section>
        </section>
      </main>
  );
}

function CatalogSection({
                          title,
                          items,
                        }: {
  title: string;
  items: {
    name: string;
    description: string;
    status: string;
  }[];
}) {
  return (
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{title}</h2>

        <div className="grid gap-3">
          {items.map((item) => (
              <article
                  key={item.name}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-medium">{item.name}</h3>
                  <span className="shrink-0 rounded-full border border-cyan-400/30 px-3 py-1 text-xs text-cyan-200">
                {item.status}
              </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {item.description}
                </p>
              </article>
          ))}
        </div>
      </section>
  );
}
