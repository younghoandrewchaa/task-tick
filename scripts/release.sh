#!/usr/bin/env bash
# Build a signed, notarised app locally, upload it to a draft, then publish the version on GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'Releases must be built on an Apple Silicon Mac.' >&2
  exit 1
fi
command -v gh >/dev/null
gh auth status
if [ -n "$(git status --porcelain)" ]; then
  echo 'Commit or stash changes before releasing.' >&2
  exit 1
fi

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
RELEASE_NOTE="${1:-}"

if IS_DRAFT=$(gh release view "$TAG" --json isDraft -q '.isDraft' 2>/dev/null); then
  if [ "$IS_DRAFT" != true ]; then
    echo "Release $TAG is already public; bump package.json's version first." >&2
    exit 1
  fi
else
  IS_DRAFT=false
fi
if TAG_COMMIT=$(git rev-parse -q --verify "refs/tags/${TAG}^{commit}"); then
  if [ "$TAG_COMMIT" != "$(git rev-parse HEAD)" ]; then
    echo "Tag $TAG points to another commit; bump the version first." >&2
    exit 1
  fi
fi
if [ -z "$RELEASE_NOTE" ]; then
  if [ ! -t 0 ]; then
    echo 'Usage: npm run release -- "Release notes"' >&2
    exit 1
  fi
  read -rp 'Release statement: ' RELEASE_NOTE
fi
if [ -z "$RELEASE_NOTE" ]; then
  echo 'Release notes must not be empty.' >&2
  exit 1
fi

npm test
npm run typecheck

APP_PATH="out/TaskTick-darwin-arm64/TaskTick.app"
ZIP_PATH="out/make/TaskTick-darwin-arm64-${VERSION}.zip"
MANIFEST_PATH="out/make/update-darwin-arm64.json"
# Remove old artefacts so they cannot satisfy this release.
rm -rf "$APP_PATH" "$ZIP_PATH" "$MANIFEST_PATH"
mkdir -p out/make
TASKTICK_RELEASE=1 npm run package

# The packager signs, notarises and staples the app; check all three.
codesign --verify --deep --strict "$APP_PATH"
xcrun stapler validate "$APP_PATH"
spctl --assess --type execute "$APP_PATH"

# ditto keeps the bundle's symlinks and metadata, which Squirrel.Mac needs.
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"
node scripts/update-manifest.mjs "$ZIP_PATH" "$MANIFEST_PATH" "$RELEASE_NOTE"

if [ -z "${TAG_COMMIT:-}" ]; then
  git tag -a "$TAG" -m "$RELEASE_NOTE"
fi
git push origin "refs/tags/$TAG"
if [ "$IS_DRAFT" != true ]; then
  gh release create "$TAG" --draft --verify-tag --title "$TAG" --notes "$RELEASE_NOTE"
fi
gh release upload "$TAG" "$ZIP_PATH" "$MANIFEST_PATH" --clobber
gh release edit "$TAG" --draft=false --latest --notes "$RELEASE_NOTE"
echo "Released $TAG"
