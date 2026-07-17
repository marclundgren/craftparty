"use client";

import { useEffect, useState } from "react";

const RELEASE_BASE =
  "https://github.com/marclundgren/craftparty/releases/latest";
export const RELEASES_URL = RELEASE_BASE;

const API_LATEST =
  "https://api.github.com/repos/marclundgren/craftparty/releases/latest";

// Installer filenames carry the version (Craftparty-Setup-0.1.6.exe), so
// the exact asset name is discovered from the latest release. Until that
// resolves (or if it fails), the button links to the release page, which
// always works.
const ASSET_MATCH: Record<string, RegExp> = {
  Windows: /^Craftparty-Setup-[\d.]+\.exe$/,
  Mac: /^Craftparty-[\d.]+\.dmg$/,
};

export default function DownloadButton() {
  const [os, setOs] = useState<"Windows" | "Mac" | null>(null);
  const [directUrl, setDirectUrl] = useState<string | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const detected = /Windows/i.test(ua)
      ? "Windows"
      : /Mac/i.test(ua)
        ? "Mac"
        : null;
    setOs(detected);
    if (!detected) return;

    fetch(API_LATEST)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (release: {
          assets?: Array<{ name: string; browser_download_url: string }>;
        } | null) => {
          const asset = release?.assets?.find((a) =>
            ASSET_MATCH[detected].test(a.name),
          );
          if (asset) setDirectUrl(asset.browser_download_url);
        },
      )
      .catch(() => {});
  }, []);

  return (
    <a className="btn btn-primary" href={directUrl ?? RELEASES_URL}>
      {os ? `Download for ${os}` : "Download Craftparty"}
    </a>
  );
}
