import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { IBM_Plex_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const satoshi = localFont({
  src: "../../../ui/fonts/Satoshi-Variable.woff2",
  weight: "300 900",
  style: "normal",
  display: "swap",
  variable: "--font-satoshi-next",
  adjustFontFallback: "Arial",
});
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
const serif = IBM_Plex_Serif({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-serif", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3710"),
  title: { default: "Kakushi: bridge in a second, backed by proof", template: "%s · Kakushi" },
  description: "Pay a Maker directly; the last four digits of the amount say where it goes. If the Maker doesn't pay, a zero-knowledge proof takes its margin on Monad and gives it to you.",
  applicationName: "Kakushi",
  openGraph: { images: ["/art/og.jpg"] },
};

export const viewport: Viewport = { themeColor: "#04060f", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="ref-e" className={`${satoshi.variable} ${mono.variable} ${serif.variable}`}>
      <body className="ui-root">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
