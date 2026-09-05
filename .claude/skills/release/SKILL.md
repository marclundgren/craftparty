---
name: release
description: Cut a Craftparty release end to end — choose the version, write the changelog and release notes, tag, watch the build, and verify the published installers and update manifests. Use when the user says "release", "ship it", "cut a release", "publish a new version", or asks why a release has no installers on it.
---

# Releasing Craftparty

A release is one tag. Pushing `vX.Y.Z` runs
`.github/workflows/release.yml`, which builds on Windows, macOS and Linux
and publishes a GitHub release carrying the three installers **and** the
`latest*.yml` manifests the in-app updater reads.

Work through the steps in order. Do not skip the verification at the end:
a release that looks fine on the releases page can still be invisible to
everyone's updater.

## 1. Check the tree is releasable

```bash
git checkout main && git pull origin main && git status --short
```

Stop if anything is uncommitted or if `main` isn't what you mean to ship.
Then run what CI can't:

```bash
node --experimental-strip-types --test host-engine/src/worlds.test.ts
node --experimental-strip-types --test host-app/src/settings.test.ts
node --experimental-strip-types --experimental-test-module-mocks --test host-app/src/updater.test.ts
cd host-app && npm ci && npm run build      # the lockfile must resolve; CI runs npm ci
```

## 2. Choose the version

Read what actually landed since the last tag:

```bash
git log --oneline "$(git describe --tags --abbrev=0)"..HEAD
```

Pre-1.0, anything players will notice is a **minor** bump; fixes are a
**patch**. Say which you picked and why in one line. Ask the user only if
the call is genuinely ambiguous.

## 3. Write the changelog first

`CHANGELOG.md` is the source of the release notes, so write it for the
people who play, not for the diff. Move the `## Unreleased` items into a
new `## X.Y.Z — <headline>` section (headline: three or four words, the
one thing this release is about), adding anything from the log that
players would notice and dropping anything they wouldn't.

Then generate the release body — electron-builder reads
`host-app/build/release-notes.md` out of the build resources on its own
and posts it as the GitHub release body:

- The new section's bullets, verbatim.
- A `## Downloads` list: `Craftparty-Setup-X.Y.Z.exe`,
  `Craftparty-X.Y.Z.dmg`, `Craftparty-X.Y.Z.AppImage`.
- The standing `## Heads up: unsigned beta builds` note (SmartScreen →
  **More info → Run anyway**; macOS → **right-click → Open → Open**) and
  the `NOT AN OFFICIAL MINECRAFT PRODUCT…` line. Copy both from the
  previous release rather than rewording them.

## 4. Bump, commit, push

```bash
cd host-app && npm version X.Y.Z --no-git-tag-version   # updates the lockfile too
```

Also set `build.releaseInfo.releaseName` in `host-app/package.json` to
`Craftparty X.Y.Z — <headline>`; that is the release's title.

The version in `host-app/package.json` **is** the release — the tag must
match it exactly, and the updater compares against it.

```bash
git commit -am "Craftparty X.Y.Z: <headline>" && git push origin main
```

## 5. Tag

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

**In a Claude Code web session this fails with HTTP 403** — those
credentials can push branches but not `refs/tags/*`, and there is no MCP
tool that creates tags or releases. Don't fight it: give the user the
three commands above to run locally, then carry on from step 6 once they
say it's pushed.

## 6. Watch the build

Poll the workflow (`actions_list` with `release.yml`, or
`gh run watch`). It takes about two minutes for all three platforms.

If a job fails, the release may already exist with only some platforms'
assets — see the warning in step 7.

## 7. Verify what shipped

Do all four checks. Each has burned this project at least once:

1. **The release is published, not a draft.** `releaseType: "release"` in
   `host-app/package.json` handles this, but confirm: `list_releases` must
   show `draft: false` for the new tag. A draft shows up on the tags page
   with only "Source code" assets, and **electron-updater cannot see it**
   — so every existing install stays on the old version.
2. **All three installers are attached**, plus `latest.yml`,
   `latest-mac.yml` and `latest-linux.yml`.
3. **The manifests report the new version:**
   ```bash
   curl -sSL https://github.com/marclundgren/craftparty/releases/download/vX.Y.Z/latest.yml
   ```
   `version:` must be `X.Y.Z` and `path:` must name a file that exists on
   the release.
4. **The body and title look right** on the release page.

If a platform's job failed after the release went public, delete that
release *and* the tag, fix the build, and cut the same version again —
don't leave a published release with a missing platform, because those
users' updaters will fail against a manifest whose file isn't there.

## 8. Tell the user what happens next

Existing installs pick the update up on their next check (launch, or
within six hours) and install it when they close the app. Windows and
Linux install it themselves; **macOS users are pointed at the download
page**, because these builds are unsigned — see `host-app/README.md`.

Only people already running a version that has the updater (0.4.0 or
later) get it automatically. Anyone older has to download it by hand.
