import {
  FeaturedService,
  Header,
  Hero,
  ProjectNote,
  UpcomingServices,
} from "@/components/home/home-section";
import { getProjects, getServices } from "@/lib/catalog-api";

export default async function Home() {
  const [projects, services] = await Promise.all([
    getProjects(),
    getServices(),
  ]);

  const featuredService = services.find(
    (service) => service.slug === "naru-calendar",
  );
  const upcomingServices = services.filter(
    (service) => service.slug !== "naru-calendar",
  );

  return (
    <main className="min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <Header />
      <Hero services={services} />
      <FeaturedService service={featuredService} />
      <UpcomingServices services={upcomingServices} />
      <ProjectNote projects={projects} />
    </main>
  );
}
