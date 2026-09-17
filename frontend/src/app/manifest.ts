import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NaruWorks",
    short_name: "NaruWorks",
    description: "NaruWorks 개인 서비스 플랫폼",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fbf8",
    theme_color: "#20b977",
    icons: [
      {
        src: "/brand/naruworks-app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/naruworks-app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
