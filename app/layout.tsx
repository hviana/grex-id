import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { LocaleProvider } from "@/src/hooks/LocaleProvider";
import { AuthProvider } from "@/src/hooks/useAuth";
import { FrontCoreProvider } from "@/src/hooks/useFrontCore";
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

// generateMetadata runs server-side — safe to import server modules here (see AGENTS.md §2.1).
export async function generateMetadata(): Promise<Metadata> {
  const systemId = (await cookies()).get("core_system")?.value;

  if (systemId) {
    try {
      const { default: Core } = await import("@/server/utils/Core");
      const { normalizeRecordId } = await import("@/server/db/connection");
      const systems = await Core.getInstance().getAllSystems();
      const system = systems.find(
        (s) => normalizeRecordId(s.id) === systemId,
      );

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
        <LocaleProvider>
          <AuthProvider>
            <FrontCoreProvider>
              {children}
              <Suspense fallback={null}>
                <CookieConsent />
              </Suspense>
            </FrontCoreProvider>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
