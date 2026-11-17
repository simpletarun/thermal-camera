import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ThermalVision — Thermal Camera in Your Browser",
  description: "Turn your webcam into a thermal-style vision camera with FLIR palettes, hot/cold tracking and Night Boost for near-total darkness. 100% local processing.",
  keywords: ["thermal camera", "thermal vision", "night vision", "webcam", "WebGL", "FLIR palette"],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "ThermalVision — Thermal Camera in Your Browser",
    description: "Thermal-style imaging from your webcam with Night Boost for darkness.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
