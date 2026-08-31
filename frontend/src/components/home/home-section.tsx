import type { Project, ServiceCatalogItem } from "@/types/catalog";
import { getLoginUrl } from "@/lib/auth-url";
import { ServiceCard } from "./service-card";

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 sm:px-8 lg:px-10">
      <div className="flex items-center gap-3 text-lg font-bold tracking-tight">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--primary)] text-sm font-black text-[#062b20]">
          N
        </span>
        Naru
      </div>
      <div className="flex items-center gap-4 text-sm sm:gap-5">
        <nav className="hidden items-center gap-4 text-[var(--muted)] sm:flex sm:gap-5">
          <a href="#services">서비스</a>
          <a href="#calendar">캘린더</a>
          <a href="#about">소개</a>
        </nav>
        <a
          href={getLoginUrl()}
          className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)] transition hover:border-[var(--primary)] hover:text-[var(--primary-strong)]"
        >
          로그인
        </a>
      </div>
    </header>
  );
}

export function Hero({ services }: { services: ServiceCatalogItem[] }) {
  return (
    <section className="mx-auto grid min-h-[calc(100vh-96px)] w-full max-w-6xl items-center gap-12 px-6 pb-20 pt-8 sm:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:px-10 lg:pb-24">
      <div className="flex flex-col justify-center">
        <span className="w-fit rounded-full bg-[var(--primary-soft)] px-3 py-1.5 text-sm font-bold text-[var(--primary-strong)]">
          Naru 서비스 홈
        </span>
        <h1 className="mt-6 max-w-xl text-5xl font-semibold leading-[1.04] sm:text-6xl lg:text-7xl">
          매일 쓰는 도구를
          <br />
          조용하게 연결합니다.
        </h1>
        <p className="mt-6 max-w-xl text-base leading-8 text-[var(--muted)] sm:text-lg">
          Naru는 일정, 파일, 문서를 하나씩 직접 만들고 운영하는 개인 서비스
          공간입니다.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#calendar"
            className="inline-flex h-11 items-center rounded-lg bg-[var(--primary)] px-4 text-sm font-bold text-[#062b20] shadow-[0_16px_38px_rgba(32,185,119,0.22)]"
          >
            캘린더 준비 현황 보기
          </a>
          <a
            href="#services"
            className="inline-flex h-11 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold text-[var(--foreground)]"
          >
            서비스 둘러보기
          </a>
        </div>
      </div>

      <ServiceLauncher services={services} />
    </section>
  );
}

function ServiceLauncher({ services }: { services: ServiceCatalogItem[] }) {
  return (
    <section
      id="services"
      className="rounded-lg border border-[var(--border)] bg-white/40 p-3 shadow-[0_28px_80px_rgba(20,80,54,0.10)] backdrop-blur-xl dark:bg-white/[0.035]"
    >
      <div className="flex items-center justify-between px-2 pb-4 pt-2 text-sm font-bold text-[var(--muted)]">
        <span>Service Launcher</span>
        <span>{services.length} services</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {services.map((service) => (
          <ServiceCard key={service.slug} service={service} />
        ))}
      </div>
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
    <section
      id="calendar"
      className="mx-auto -mt-8 w-full max-w-6xl px-6 pb-16 pt-8 sm:px-8 lg:px-10"
    >
      <div className="grid gap-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8 lg:grid-cols-[0.7fr_1.3fr]">
        <div>
          <p className="text-sm font-bold text-[var(--primary-strong)]">
            첫 번째 서비스
          </p>
          <h2 className="mt-3 text-2xl font-semibold">{service.name}</h2>
        </div>

        <div>
          <p className="leading-7 text-[var(--muted)]">{service.description}</p>
          <p className="mt-4 leading-7 text-[var(--muted)]">
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
    <section id="about" className="mx-auto w-full max-w-6xl px-6 py-10 sm:px-8 lg:px-10">
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
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {project.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
