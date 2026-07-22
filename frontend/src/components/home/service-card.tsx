import type { ServiceCatalogItem } from "@/types/catalog";
import { formatStatus, getServiceIcon } from "./status-label";

export function ServiceCard({ service }: { service: ServiceCatalogItem }) {
  const isFeatured = service.slug === "naru-calendar";

  return (
    <article
      className={[
        "rounded-lg border p-5 transition hover:-translate-y-0.5 hover:shadow-lg",
        isFeatured
          ? "border-[var(--primary)] bg-[var(--primary-soft)]"
          : "border-[var(--border)] bg-[var(--surface)]",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--mint-highlight)] text-sm font-bold text-[#087a5f]">
          {getServiceIcon(service.slug)}
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-semibold text-[var(--primary)]">
          {formatStatus(service.status)}
        </span>
      </div>

      <h3 className="mt-5 text-lg font-semibold">{service.name}</h3>
      <p className="mt-2 text-sm leading-6 opacity-70">{service.description}</p>
    </article>
  );
}
