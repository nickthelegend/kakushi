import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Unbounded } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const unbounded = Unbounded({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--font-unbounded", display: "swap" });
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Kakushi Pay: confidential payments on Monad",
  description: "Real stablecoins (Agora AUSD, Circle USDC) with every amount and balance encrypted end to end: private payroll, pay links and balances, settled with Monad finality. Built on Kakushi, fully homomorphic encryption for any Monad contract.",
  icons: { icon: "/kakushi-fin.png" },
};
export const viewport: Viewport = { themeColor: "#021a20", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${unbounded.variable} ${plex.variable} ${plexMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
