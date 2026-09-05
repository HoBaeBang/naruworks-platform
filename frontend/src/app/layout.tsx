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
      <body className="min-h-full flex flex-col">
        <GlobalHeader />
        {children}
      </body>
    </html>
  );
}
