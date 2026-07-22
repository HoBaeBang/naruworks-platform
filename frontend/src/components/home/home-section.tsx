import type { Project, ServiceCatalogItem } from "@/types/catalog";
import { ServiceCard } from "./service-card";

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 sm:px-8 lg:px-10">
      <div className="text-lg font-bold tracking-tight">Naru</div>
      <nav className="flex items-center gap-5 text-sm opacity-70">
        <span>서비스</span>
        <span>캘린더</span>
        <span>소개</span>
      </nav>
    </header>
  );
}

export function Hero({ services }: { services: ServiceCatalogItem[] }) {
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-10 px-6 pb-16 pt-10 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-10 lg:pb-24">
      <div className="flex flex-col justify-center">
        <span className="w-fit rounded-full bg-[var(--primary-soft)] px-3 py-1 text-sm font-semibold text-[var(--primary)]">
          Naru 서비스 홈
        </span>
        <h1 className="mt-6 text-4xl font-semibold leading-tight sm:text-6xl">
          매일 쓰는 도구를
          <br />
          조용하게 연결합니다.
        </h1>
        <p className="mt-6 max-w-xl text-base leading-8 opacity-75 sm:text-lg">
          Naru는 일정, 파일, 문서를 하나씩 직접 만들고 운영하는 개인 서비스
          공간입니다.
        </p>
      </div>

      <ServiceLauncher services={services} />
    </section>
  );
}

function ServiceLauncher({ services }: { services: ServiceCatalogItem[] }) {
  return (
    <section className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_24px_60px_rgba(20,80,54,0.08)] sm:grid-cols-2">
      {services.map((service) => (
        <ServiceCard key={service.slug} service={service} />
      ))}
    </section>
  );
}

export function FeaturedService({
  service,
}: {
  service?: ServiceCatalogItem;
}) {
  if (!service) {
    return null;
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-8 lg:px-10">
      <div className="grid gap-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8 lg:grid-cols-[0.7fr_1.3fr]">
        <div>
          <p className="text-sm font-semibold text-[var(--primary)]">
            첫 번째 서비스
          </p>
          <h2 className="mt-3 text-2xl font-semibold">{service.name}</h2>
        </div>

        <div>
          <p className="leading-7 opacity-75">{service.description}</p>
          <p className="mt-4 leading-7 opacity-75">
            자체 일정 관리 기능을 먼저 만들고, 이후 Google Calendar와 동기화할
            수 있는 개인 캘린더 서비스로 확장합니다.
          </p>
        </div>
      </div>
    </section>
  );
}

export function UpcomingServices({
  services,
}: {
  services: ServiceCatalogItem[];
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-8 lg:px-10">
      <h2 className="text-2xl font-semibold">다음에 열릴 서비스</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {services.map((service) => (
          <ServiceCard key={service.slug} service={service} />
        ))}
      </div>
    </section>
  );
}

export function ProjectNote({ projects }: { projects: Project[] }) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-8 lg:px-10">
      <h2 className="text-2xl font-semibold">플랫폼 노트</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {projects.map((project) => (
          <article
            key={project.slug}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
          >
            <h3 className="font-semibold">{project.name}</h3>
            <p className="mt-2 text-sm leading-6 opacity-70">
              {project.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
