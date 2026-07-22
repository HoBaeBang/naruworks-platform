import type { ServiceCatalogItem } from "@/types/catalog";
import { formatStatus, getServiceIcon } from "./status-label";

export function ServiceCard({ service }: { service: ServiceCatalogItem }) {
  const isFeatured = service.slug === "naru-calendar";
  const actionLabel = isFeatured ? "첫 서비스" : "준비 예정";

  return (
    <article
      className={[
        "flex min-h-44 flex-col justify-between rounded-lg border p-5 transition hover:-translate-y-0.5 hover:shadow-lg",
        isFeatured
          ? "border-[var(--primary)] bg-[linear-gradient(135deg,var(--primary-soft),rgba(255,255,255,0.62))] shadow-[inset_0_0_0_1px_rgba(32,185,119,0.18)] dark:bg-[linear-gradient(135deg,rgba(87,223,154,0.16),rgba(255,255,255,0.055))]"
          : "border-[var(--border)] bg-[var(--surface)]",
      ].join(" ")}
    >
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--mint-highlight)] text-sm font-black text-[#087a5f]">
            {getServiceIcon(service.slug)}
          </div>
          <span className="rounded-full px-3 py-1 text-xs font-bold text-[var(--primary-strong)]">
            {formatStatus(service.status)}
          </span>
        </div>

        <h3 className="mt-5 text-lg font-semibold">{service.name}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {service.description}
        </p>
      </div>

      <div
        className={[
          "mt-6 flex items-center justify-between text-sm font-bold",
          isFeatured ? "text-[var(--primary-strong)]" : "text-[var(--muted)]",
        ].join(" ")}
      >
        <span>{actionLabel}</span>
        <span aria-hidden="true">-&gt;</span>
      </div>
    </article>
  );
}
