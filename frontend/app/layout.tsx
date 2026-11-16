import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Outfit } from "next/font/google";
import { Toaster } from "sonner";
import { ClientPreferences } from "@/components/ClientPreferences";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NKMZ Chat — Local AI",
  description: "Your local AI workspace powered by Ollama",
  // Installed-app metadata; the manifest itself comes from app/manifest.ts.
  appleWebApp: { capable: true, title: "NKMZ Chat", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="mn" className="dark" suppressHydrationWarning>
      <body
        className={`${sans.variable} ${display.variable} font-sans antialiased`}
      >
        <ClientPreferences />
        {children}
        <Toaster richColors position="top-center" theme="dark" />
      </body>
    </html>
  );
}

