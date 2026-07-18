#!/usr/bin/env bash
# Build the marketplace addon jars and (optionally) publish them.
#
#   scripts/addons-build.sh            # build only
#   scripts/addons-build.sh publish    # build + create the GitHub release
#
# Needs a JDK 21+ and gradle 9+ on PATH (or set JAVA_HOME/GRADLE).
# Publishing needs gh authenticated with push access.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(grep addons_version "$HERE/addons/gradle.properties" | cut -d= -f2)"
GRADLE="${GRADLE:-gradle}"

(cd "$HERE/addons" && "$GRADLE" build)

JARS=(
  "$HERE/addons/stay-hydrated/build/libs/stay-hydrated-${VERSION}.jar"
  "$HERE/addons/welcome-party/build/libs/welcome-party-${VERSION}.jar"
)
sha256sum "${JARS[@]}"

if [ "${1:-}" = "publish" ]; then
  gh release create "addons-v${VERSION}" --repo marclundgren/craftparty \
    --prerelease --title "Marketplace addons v${VERSION}" \
    --notes "Server-side Fabric mods for Craftparty worlds. Source in addons/." \
    "${JARS[@]}"
fi
