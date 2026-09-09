"use client";

import { useEffect, useState } from "react";

const RELEASE_BASE =
  "https://github.com/marclundgren/craftparty/releases/latest";
export const RELEASES_URL = RELEASE_BASE;

const API_LATEST =
  "https://api.github.com/repos/marclundgren/craftparty/releases/latest";

type Os = "Windows" | "Mac" | "Linux";

// Installer filenames carry the version (Craftparty-Setup-0.1.6.exe), so
// the exact asset name is discovered from the latest release. Until that
// resolves (or if it fails), the button links to the release page, which
// always works.
const ASSET_MATCH: Record<Os, RegExp> = {
  Windows: /^Craftparty-Setup-[\d.]+\.exe$/,
  Mac: /^Craftparty-[\d.]+\.dmg$/,
  // The .deb is the one that installs a desktop entry and icons, so
  // Craftparty shows up in the app drawer and updates itself in place.
  // Distros that can't take a .deb get the AppImage from the link below.
  Linux: /^Craftparty-[\d.]+\.deb$/,
};

const APPIMAGE_MATCH = /^Craftparty-[\d.]+\.AppImage$/;

export default function DownloadButton() {
  const [os, setOs] = useState<Os | null>(null);
  const [directUrl, setDirectUrl] = useState<string | null>(null);
  const [appImageUrl, setAppImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    // Android says "Linux" too, and there is no Android build to send it to.
    const detected: Os | null = /Windows/i.test(ua)
      ? "Windows"
      : /Mac/i.test(ua)
        ? "Mac"
        : /Linux|X11/i.test(ua) && !/Android/i.test(ua)
          ? "Linux"
          : null;
    setOs(detected);
    if (!detected) return;

    fetch(API_LATEST)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (release: {
          assets?: Array<{ name: string; browser_download_url: string }>;
        } | null) => {
          const assets = release?.assets ?? [];
          const asset = assets.find((a) => ASSET_MATCH[detected].test(a.name));
          if (asset) setDirectUrl(asset.browser_download_url);
          if (detected === "Linux") {
            const appImage = assets.find((a) => APPIMAGE_MATCH.test(a.name));
            if (appImage) setAppImageUrl(appImage.browser_download_url);
          }
        },
      )
      .catch(() => {});
  }, []);

  return (
    <>
      <a className="btn btn-primary" href={directUrl ?? RELEASES_URL}>
        {os ? `Download for ${os}` : "Download Craftparty"}
      </a>
      {os === "Linux" && (
        <a className="alt-download" href={appImageUrl ?? RELEASES_URL}>
          Not on Ubuntu or Debian? Get the AppImage
        </a>
      )}
    </>
  );
}
