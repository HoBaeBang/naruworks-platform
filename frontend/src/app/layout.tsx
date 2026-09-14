import type { Metadata } from "next";
import { GlobalHeader } from "@/components/layout/global-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "NaruWorks",
  description: "Personal service platform for NaruWorks.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var preference=localStorage.getItem('naruworks-theme-preference')||'system';var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=preference==='system'?(dark?'dark':'light'):preference;})();` }} />
      </head>
      <body className="min-h-full flex flex-col">
        <GlobalHeader />
        {children}
      </body>
    </html>
  );
}
