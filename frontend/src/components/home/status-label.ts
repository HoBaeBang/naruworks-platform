export function formatStatus(status: string) {
  const labels: Record<string, string> = {
    PLANNING: "준비 중",
    NEXT: "예정",
    PHASE_1: "Phase 1",
    EXTERNAL_MODULE: "외부 모듈",
  };

  return labels[status] ?? status;
}

export function getServiceIcon(slug: string) {
  const icons: Record<string, string> = {
    "naru-calendar": "C",
    "naru-drive": "D",
    "naru-docs": "W",
    "naru-sheets": "S",
    "naru-slides": "P",
  };

  return icons[slug] ?? "N";
}
