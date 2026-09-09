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

const DESCRIPTION =
  "One download. No public servers, no port forwarding, no tech skills needed. Your world lives on your computer and only invited friends can get in.";

export const metadata: Metadata = {
  // Lets the opengraph-image file convention resolve to an absolute URL,
  // which is the only kind a link preview can fetch.
  metadataBase: new URL("https://craftparty-ten.vercel.app"),
  title: "Craftparty — host a private Minecraft world for your friends",
  description: DESCRIPTION,
  openGraph: {
    title: "Craftparty — host a private Minecraft world for your friends",
    description: DESCRIPTION,
    siteName: "Craftparty",
    url: "/",
    type: "website",
  },
  // The picture comes from app/opengraph-image.png either way; this only
  // asks for the card that shows it big rather than as a thumbnail.
  twitter: {
    card: "summary_large_image",
  },
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
