import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "Kakushi · instant bridge, provable safety",
  description: "Pay a Maker, get paid in seconds. If they don't, a zero-knowledge proof slashes their margin back to you, on Monad.",
};

export const viewport: Viewport = { themeColor: "#0e0f12", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
