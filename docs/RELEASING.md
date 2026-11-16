# Release guide for maintainers

This guide is for maintainers publishing official Free Games Watcher builds. Contributors can build and test the extension without publication access; see [Development](../README.md#development) and the [technical documentation](../TECHNICAL.md#development-checks).

Official GitHub releases contain a **Chrome ZIP** and a **Mozilla-signed Firefox XPI**. Local Firefox ZIPs are for development and AMO submission. The [Release workflow](../.github/workflows/release.yml) retrieves the approved XPI from AMO; it does not sign extensions or submit them to browser stores.

## Access and workflow requirements

- Publishing requires permission to push release tags and manage GitHub releases, plus access to the existing AMO add-on listing for submission.
- The current workflow requires the release or draft author to match GitHub's `repository_owner`. The repository owner must create the draft before the release workflow runs. General write access alone does not satisfy this check.
- GitHub CLI commands below require an authenticated account with the appropriate access. The workflow uses its built-in GitHub token; no personal access token or AMO signing credentials are needed in Actions.

## Prepare and verify the release commit

1. Update the version in `manifest.json`, `package.json` and the root package metadata in `package-lock.json`. Add the matching version section to `CHANGELOG.md` and update version-specific installation examples as needed. Public download instructions must identify the Chrome ZIP and Firefox XPI.
2. Run the [development checks](../TECHNICAL.md#development-checks), including applicable Chromium and Firefox browser scenarios. The basic package and release checks are:

   ```powershell
   npm ci
   npm test
   npm run test:release
   npm run pack
   npm run pack:firefox
   npm run lint:firefox
   pwsh -File scripts/get-release-notes.ps1
   ```

3. Commit and push the changes, then wait for all jobs in the `Tests` workflow to pass. Build the unsigned Firefox ZIP from a clean checkout of the reviewed commit. Preserve the LF endings specified in `.gitattributes`: signed production files must match the release build byte for byte.

## Obtain the approved Firefox build

Submit that Firefox ZIP as a new listed version of the existing AMO add-on. Include reviewer source and build instructions when requested. Wait until the exact version is approved and public in the AMO API. If production files change during review, commit those changes and obtain a matching approved AMO build before tagging.

From the clean release checkout, verify the signed file locally:

```powershell
$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
npm run pack:firefox
pwsh -File scripts/get-signed-firefox.ps1 -Version $version -UnsignedArchivePath "dist/Free-Games-Watcher-Firefox-$version.zip"
```

The downloader checks the public AMO status, size and SHA-256, then calls `scripts/verify-firefox-xpi.ps1` to check signature entries, extension ID, version, absence of a custom update URL and all production files against the unsigned build. Only manifest JSON formatting and key order may differ. Signature entries are checked structurally; the hash comes from AMO over HTTPS, and Firefox validates the actual signature on installation. The XPI is never repacked. A failed download or validation leaves any previously verified output intact. Older versions are located through AMO's public version list when necessary.

## Create the draft and publish the tag

From the reviewed commit, have the repository owner create a draft for the intended version before pushing its tag:

```powershell
$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$tag = "v$version"
$releaseCommit = git rev-parse HEAD
pwsh -File scripts/get-release-notes.ps1 -Version $version -OutputPath dist/release-notes.md
gh release create $tag --draft --target $releaseCommit --title "Free Games Watcher $tag" --notes-file dist/release-notes.md
```

Check that the draft targets the reviewed commit and that its notes describe the intended version. Then create and push the matching tag:

```powershell
git tag $tag $releaseCommit
git push origin $tag
```

Run these commands in order, stopping on any failure. If the tag or draft already exists, inspect it before continuing; do not recreate or move a published tag.

## Verify the workflow and publish the draft

The `Release` workflow checks the tag against the manifest version and checks the release author. It runs module and release-script tests, builds both local ZIPs, lints Firefox and downloads and verifies the exact version's signed XPI from AMO.

If AMO is not ready or the production files differ, the workflow stops before changing GitHub assets or notes. After approval, rerun `Release` for the same tag, or dispatch it with that tag. Investigate file mismatches instead of bypassing validation or substituting another version or an unsigned ZIP.

After validation, the workflow uploads:

- `Free-Games-Watcher-Chrome-VERSION.zip`
- `Free-Games-Watcher-Firefox-VERSION.xpi`

It compares the uploaded GitHub SHA-256 digests with the local files before removing any legacy Firefox ZIP for that version. Notes come from the matching `CHANGELOG.md` section. Drafts remain unpublished and retain their author; workflow uploads are attributed to the Actions bot.

Verify the workflow results, release notes and downloadable files. Install the signed XPI in an isolated Firefox profile and confirm that it remains installed after a restart. Then publish the draft and mark it latest:

```powershell
gh release edit $tag --draft=false --latest
```

## Reruns and browser-store publication

A branch push runs validation, not release publication. Manual dispatch requires an existing tag containing the signed-release scripts. Reruns can replace assets and notes on an existing release, so inspect the selected revision first. Published tags remain immutable.

The historical `v2.2.1` tag contains the earlier workflow. Do not rerun that workflow to update its assets; any maintenance of that release requires manually uploading files verified with the signed-download tooling.

Chrome Web Store publication and AMO submission are separate manual steps. Keep the existing store listings and extension IDs to preserve update continuity. The signed Firefox XPI uses the AMO extension ID and no custom `update_url`; see [Firefox installation and update behavior](FIREFOX.md#permanent-installation).
