import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Shippori_Mincho, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Display: a mincho serif (Japanese editorial tradition). UI: a quiet kaku gothic.
// Mono only where the content is code-like: hashes and addresses.
const mincho = Shippori_Mincho({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--font-mincho", display: "swap" });
const gothic = Zen_Kaku_Gothic_New({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-gothic", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "Kakushi, the bridge with a hidden destination",
  description: "Pay a Maker directly; the last four digits of the amount say where it goes. If the Maker doesn't pay, a zero-knowledge proof takes their margin on Monad and gives it to you.",
  openGraph: { images: ["/art/og.jpg"] },
};

export const viewport: Viewport = { themeColor: "#0b1424", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mincho.variable} ${gothic.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
