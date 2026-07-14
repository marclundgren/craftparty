"use client";

import { useEffect, useState } from "react";

const RELEASE_BASE =
  "https://github.com/marclundgren/craftparty/releases/latest";
export const RELEASES_URL = RELEASE_BASE;

const DIRECT: Record<string, string> = {
  Windows: `${RELEASE_BASE}/download/Craftparty-Setup.exe`,
  Mac: `${RELEASE_BASE}/download/Craftparty.dmg`,
};

export default function DownloadButton() {
  const [os, setOs] = useState<"Windows" | "Mac" | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) setOs("Windows");
    else if (/Mac/i.test(ua)) setOs("Mac");
  }, []);

  return (
    <a className="btn btn-primary" href={os ? DIRECT[os] : RELEASES_URL}>
      {os ? `Download for ${os}` : "Download Craftparty"}
    </a>
  );
}
