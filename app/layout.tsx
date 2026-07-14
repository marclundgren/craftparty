import type { Metadata } from "next";
import { Pixelify_Sans, Nunito } from "next/font/google";
import "./globals.css";

const pixelify = Pixelify_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const nunito = Nunito({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Craftparty — host a private Minecraft world for your friends",
  description:
    "One download. No public servers, no port forwarding, no tech skills needed. Your world lives on your computer and only invited friends can get in.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${pixelify.variable} ${nunito.variable}`}>
      <body>{children}</body>
    </html>
  );
}
