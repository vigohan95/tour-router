import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tour Router - routes a tour inside the promoter's own rules, and shows what the taste data changed",
  description: "Routes a tour inside the promoter's own rules, and shows what the taste data changed. A policy-gated agent over Qloo's Taste AI: heatmap-ranked markets, a tour opener and co-bill markets, and two counterfactuals (the obvious route, and the same brief under policy B).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
