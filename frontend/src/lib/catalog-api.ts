import type { Project, ServiceCatalogItem } from "@/types/catalog";

const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

async function fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`API request failed: ${path}`);
    }

    return response.json() as Promise<T>;
}

export async function getProjects(): Promise<Project[]> {
    return fetchJson<Project[]>("/api/projects");
}

export async function getServices(): Promise<ServiceCatalogItem[]> {
    return fetchJson<ServiceCatalogItem[]>("/api/services");
}
