import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Doom Flix",
    short_name: "Doom Flix",
    description: "A spoiler-safe MCU and X-Men release-order tracker for the road to Avengers: Doomsday.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#070b08",
    theme_color: "#070b08",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
