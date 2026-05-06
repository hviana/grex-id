import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { TenantProvider } from "@/src/providers/TenantProvider";
import CookieConsent from "@/src/components/shared/CookieConsent";
import "@/src/frontend-registry";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
          <Suspense
            fallback={
              <div className="flex justify-center items-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary-green)]" />
              </div>
            }
          >
            {children}
          </Suspense>
          <Suspense fallback={null}>
            <CookieConsent />
          </Suspense>
        </TenantProvider>
      </body>
    </html>
  );
}
