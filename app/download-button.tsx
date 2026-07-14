"use client";

import { useEffect, useState } from "react";

// The host app doesn't ship yet — point at the kit's releases page for now.
export const RELEASES_URL =
  "https://github.com/marclundgren/craftparty-kit/releases";

export default function DownloadButton() {
  const [os, setOs] = useState<"Windows" | "Mac" | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Windows/i.test(ua)) setOs("Windows");
    else if (/Mac/i.test(ua)) setOs("Mac");
  }, []);

  return (
    <a className="btn btn-primary" href={RELEASES_URL}>
      {os ? `Host a party — ${os}` : "Host a party"}
    </a>
  );
}
