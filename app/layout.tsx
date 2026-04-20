import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LocaleProvider } from "@/src/hooks/LocaleProvider";
import { AuthProvider } from "@/src/hooks/useAuth";
import { FrontCoreProvider } from "@/src/hooks/useFrontCore";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Core",
  description: "Multi-tenant platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col bg-[var(--color-black)] text-white">
        <LocaleProvider>
          <AuthProvider>
            <FrontCoreProvider>
              {children}
            </FrontCoreProvider>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
