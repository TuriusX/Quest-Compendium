# Releasing the desktop app

The direct-download app updates itself from GitHub releases (electron/updater.cjs, electron-updater): it checks
shortly after launch and every 6 hours, downloads a new version in the background, shows "Version X is ready" with
Restart to update and Later, and installs on quit. After an update, the app shows a one-time "What's new in X" with
that release's line from the website's Recent updates (`/api/changelog`). The Microsoft Store package is updated by
the Store and skips all of this. Releases go to everyone at once (no staged rollout).

## Release

1. **Version.** `npm version 0.5.N --no-git-tag-version`; the homepage's "Version 0.5.N beta" line in
   `Marketing_Website_Files/index.html` and each language's copy; raise `APP_VERSION` in `src/hooks/useCloudSync.ts`
   only when older direct-download builds must be pushed to update (that number is what `config/desktop_client.minVersion`
   is compared with). Commit and push.
2. **Notes.** Player-facing, short, plain language; Noah approves them before anything is published.
3. **Build.** `npm run desktop:build` (unsigned until code signing is set up). It writes to `release/`:
   `Quest-Compendium-Setup-0.5.N.exe`, its `.blockmap`, `latest.yml`, and the Store package `Quest Compendium 0.5.N.appx`.
4. **GitHub release** `v0.5.N` on the release commit, titled "Quest Compendium v0.5.N beta", with the notes, and these
   assets (all four, or installed apps can't update or can't update in small pieces):
   - `Quest-Compendium-Setup-0.5.N.exe`
   - `Quest-Compendium-Setup-0.5.N.exe.blockmap`
   - `latest.yml`
   - `Quest-Compendium-Setup.exe` (the same installer, unversioned: the website's download button links to it)

   The release must be published (not a draft, not a pre-release): that's what installed apps and the website follow.
5. **Recent updates.** `npx tsx scripts/pipeline/changelog.ts --add 0.5.N --text "<one line>"` (translated; the
   app's "What's new" uses it too), then publish the site from the qc-deploy worktree.
6. **Pipeline.** Rebuild the guide-pipeline image and update both jobs (guide-pipeline, guide-flagship). Check no
   core run is publishing before publishing the site or rebuilding the image.
7. **Microsoft Store.** Submit `Quest Compendium 0.5.N.appx` in Partner Center. Raise `config/desktop_client.minVersion`
   only after Noah confirms the Store version is live.

## Rollback: pulling a bad release

Installed apps update to the newest published release, so pulling one stops any more installs from picking it up:

1. **Unpublish it:** `gh release edit v0.5.N --draft` (or delete the release; keep the tag). GitHub's "latest" is the
   previous release again, for installed apps and for the website's download button.
2. **Check:** `curl -sL https://github.com/TuriusX/Quest-Compendium/releases/latest/download/latest.yml | head -1`
   should say the previous version.
3. **Players who already updated** stay on the bad version (apps never downgrade). Fix them with a new, higher version
   (0.5.N+1) released the normal way; the Store package needs its own new submission.
4. If its Recent updates line was published, remove that entry from `system/changelog` and republish the site.

Tested on Oct 14, 2026 with a fake 0.5.7 on a local feed (below): 0.5.6 found 0.5.7, downloaded it and installed it on
restart; with 0.5.7 pulled from the feed, a fresh 0.5.6 reported "up to date" and downloaded nothing.

## Testing an update locally

Build two versions under a test name, so they never touch the real install or its settings (the internal name matters:
`extraMetadata.productName` and `extraMetadata.name`, or they share `%APPDATA%\Quest Compendium`):

```
npx -y --package electron-builder --package electron@30.0.0 electron-builder -c electron-builder.json -c.electronVersion=30.0.0 --publish never --win nsis -c.appId=com.questcompendium.updatetest "-c.productName=QC Update Test" "-c.extraMetadata.productName=QC Update Test" -c.extraMetadata.name=qc-update-test -c.extraMetadata.version=0.5.6 -c.directories.output=release-test/0.5.6
```

(and the same with `0.5.7`). Put the newer `latest.yml`, installer and `.blockmap` in a folder, serve it
(`python -m http.server 8093`), install the older one (`/S` for silent), and start it with `QC_UPDATE_FEED=http://localhost:8093/`
and `QC_UPDATE_DELAY_MS=3000` (`QC_UPDATE_TEST_INSTALL=1` installs as soon as it's downloaded). `ELECTRON_ENABLE_LOGGING=1`
shows the `[update]` lines. Uninstall the test app afterwards.
