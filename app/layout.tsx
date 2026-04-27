import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { TenantProvider } from "@/src/providers/TenantProvider";
import CookieConsent from "@/src/components/shared/CookieConsent";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const url = new URL(
    (await headers()).get("x-url") || "http://localhost:3000",
  );
  try {
    const { default: Core } = await import("@/server/utils/Core");
    const systemSlug = url.searchParams.get("systemSlug") ||
      (url.pathname === "/" &&
        await Core.getInstance().getSetting("app.defaultSystem"));
    const system = systemSlug
      ? await Core.getInstance().getSystemBySlug(systemSlug)
      : null;

    if (system?.name) {
      return {
        title: system.name,
        ...(system.logoUri && {
          icons: {
            icon: `/api/files/download?uri=${
              encodeURIComponent(system.logoUri)
            }`,
          },
        }),
      };
    }
  } catch {
    // Core unavailable during first install
  }

  return { title: "Core" };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col bg-[var(--color-black)] text-white">
        <TenantProvider>
              {children}
              <Suspense fallback={null}>
                <CookieConsent />
              </Suspense>
        </TenantProvider>
      </body>
    </html>
  );
}
