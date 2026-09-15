#!/usr/bin/env bash
# Public-verifier rebuild for unpublished usesteady@0.1.0-alpha.74 candidate bytes.
# Assembly/build documentation only. Not a new runtime gate. Not npm publish.
# Does not look up any private git commit SHA.
set -euo pipefail

EXPECTED_L2_TSV_SHA256="6faaefd3f808cd5b327020c13b12cfacb56bca1c78d97e07a61bb9d71cba9811"
EXPECTED_UNION_TSV_SHA256="2a41647c0c0abedd1dbcf567f58fbb5d9c704caf6000c04210c6c3ede77e5753"
EXPECTED_L1_TSV_SHA256="138e4cb8faa533c22bed1e0b8fbd7e5d559d61b732436a603ca407d74c06e6b9"
EXPECTED_TGZ_SHA256="4143b843bd6862b6b6f25dbe11076d7e1ea5ef88ad0aaa50444a201f63b864b3"
EXPECTED_TGZ_NAME="usesteady-0.1.0-alpha.74.tgz"

# sha256 of presentation-separated pack inputs under docs/release/canonical-build-inputs/
EXPECTED_OVERLAY_SHA256_package_json="f7305aef9e4f78dbca680a1503c98fe70a086f21a1f4d6aa4e6597cdc631caa1"
EXPECTED_OVERLAY_SHA256_README="c5e008c5668613856e87eb63032ff85264bafc798ac8a13484dd8f7ff4e06f34"
EXPECTED_OVERLAY_SHA256_CHANGELOG="30d20c466d51393a8076f55ac94d0de0853254b57c914d512eefdc71f14880c7"
EXPECTED_OVERLAY_SHA256_bin="8d938eb05890f998f0b0ca48c47e194b78602c4cca2c6fe39103c987aa792239"

usage() {
  cat <<'EOF'
Usage:
  rebuild-alpha74-candidate.sh <public-export-checkout> <empty-build-dir>

<public-export-checkout> is a checkout of the public export tree (future
usesteady-public commit after authorized export). It must contain:
  docs/release/ALPHA74_TARBALL_REPRO_INPUTS.tsv
  docs/release/ALPHA74_EXPORT_UNION.tsv
  docs/release/ALPHA74_PUBLIC_EXPORT_INCLUDE.tsv
  docs/release/ALPHA74_EXPORT_DESTINATION_ACTIONS.tsv
  docs/release/ALPHA74_PUBLIC_SUPPORT_FILES.tsv
  docs/release/ALPHA74_MANIFEST_CONVENTION.md
  docs/release/canonical-build-inputs/{package.json,README.md,CHANGELOG.md,bin/use-steady.js}
  and the Layer 2 paths listed in the Layer 2 TSV (public-home collision
  paths may still hold preserved public-home bytes).

<empty-build-dir> must not exist, or must be an empty directory. The script
never packs inside the export checkout.

After canonical overlays and before npm/build, the script checks all 760
assembled Layer 2 Git-blob identities by local content hashing
(git hash-object on the assembled file). It does not look up a private
commit. Destination-map and support-table identities use
BOUND_BY_EXPORT_COMMIT (see ALPHA74_MANIFEST_CONVENTION.md).

Stops on any manifest, overlay, assembled-blob, npm ci, tsc, sanitize,
pack, or hash failure. A pack after failed tsc is refused.
EOF
  exit 2
}

[[ $# -eq 2 ]] || usage

sha256_file() {
  sha256sum -- "$1" | awk '{print $1}'
}

# Local Git-blob identity of raw file bytes. --no-filters avoids
# clean/smudge rewriting (CRLF) so the hash matches the stored blob.
# Does not look up any commit.
git_blob_file() {
  git hash-object --no-filters -- "$1"
}

die() {
  echo "FAIL: $*" >&2
  exit 1
}

EXPORT_ROOT=$(cd -- "$1" && pwd) || die "export checkout not found: $1"
BUILD_DIR=$2

if [[ -e "$BUILD_DIR" ]]; then
  [[ -d "$BUILD_DIR" ]] || die "build dir exists and is not a directory: $BUILD_DIR"
  [[ -z "$(ls -A -- "$BUILD_DIR")" ]] || die "build dir is not empty: $BUILD_DIR"
else
  mkdir -p -- "$BUILD_DIR"
fi
BUILD_DIR=$(cd -- "$BUILD_DIR" && pwd)

# Refuse to use the export checkout as the build directory.
if [[ "$BUILD_DIR" == "$EXPORT_ROOT" || "$BUILD_DIR" == "$EXPORT_ROOT"/* ]]; then
  die "build dir must be outside the export checkout"
fi

L2_TSV="$EXPORT_ROOT/docs/release/ALPHA74_TARBALL_REPRO_INPUTS.tsv"
UNION_TSV="$EXPORT_ROOT/docs/release/ALPHA74_EXPORT_UNION.tsv"
L1_TSV="$EXPORT_ROOT/docs/release/ALPHA74_PUBLIC_EXPORT_INCLUDE.tsv"
DEST_TSV="$EXPORT_ROOT/docs/release/ALPHA74_EXPORT_DESTINATION_ACTIONS.tsv"
SUPPORT_TSV="$EXPORT_ROOT/docs/release/ALPHA74_PUBLIC_SUPPORT_FILES.tsv"
CONVENTION_MD="$EXPORT_ROOT/docs/release/ALPHA74_MANIFEST_CONVENTION.md"
CANON="$EXPORT_ROOT/docs/release/canonical-build-inputs"

[[ -f "$L2_TSV" ]] || die "missing Layer 2 TSV"
[[ -f "$UNION_TSV" ]] || die "missing union TSV"
[[ -f "$L1_TSV" ]] || die "missing Layer 1 TSV"
[[ -f "$DEST_TSV" ]] || die "missing destination actions TSV"
[[ -f "$SUPPORT_TSV" ]] || die "missing public support files TSV"
[[ -f "$CONVENTION_MD" ]] || die "missing manifest convention"

got=$(sha256_file "$L2_TSV")
[[ "$got" == "$EXPECTED_L2_TSV_SHA256" ]] || die "Layer 2 TSV sha256 $got != $EXPECTED_L2_TSV_SHA256"
got=$(sha256_file "$UNION_TSV")
[[ "$got" == "$EXPECTED_UNION_TSV_SHA256" ]] || die "union TSV sha256 $got != $EXPECTED_UNION_TSV_SHA256"
got=$(sha256_file "$L1_TSV")
[[ "$got" == "$EXPECTED_L1_TSV_SHA256" ]] || die "Layer 1 TSV sha256 $got != $EXPECTED_L1_TSV_SHA256"

overlay_ok() {
  local rel=$1 expected=$2
  local src="$CANON/$rel"
  [[ -f "$src" ]] || die "missing canonical overlay $rel"
  got=$(sha256_file "$src")
  [[ "$got" == "$expected" ]] || die "canonical $rel sha256 $got != $expected"
}

overlay_ok package.json "$EXPECTED_OVERLAY_SHA256_package_json"
overlay_ok README.md "$EXPECTED_OVERLAY_SHA256_README"
overlay_ok CHANGELOG.md "$EXPECTED_OVERLAY_SHA256_CHANGELOG"
overlay_ok bin/use-steady.js "$EXPECTED_OVERLAY_SHA256_bin"

# Copy every Layer 2 path from the export checkout (may be public-home bytes
# at collision paths). Then overlay the four pack-input canonical files.
copied=0
while IFS=$'\t' read -r rel _mode _blob; do
  [[ "$rel" == "path" || -z "${rel:-}" ]] && continue
  src="$EXPORT_ROOT/$rel"
  [[ -e "$src" ]] || die "Layer 2 path missing from export checkout: $rel"
  dest="$BUILD_DIR/$rel"
  mkdir -p -- "$(dirname -- "$dest")"
  # Content only. Do not copy execute bits from the export checkout.
  # Apply the Layer 2 TSV mode so npm pack headers match the retained tarball.
  cp -- "$src" "$dest"
  case "$_mode" in
    100755) chmod 0755 -- "$dest" ;;
    100644) chmod 0644 -- "$dest" ;;
    *) die "unexpected Layer 2 mode $_mode for $rel" ;;
  esac
  copied=$((copied + 1))
done < "$L2_TSV"
[[ "$copied" -eq 760 ]] || die "copied $copied Layer 2 paths, expected 760"

# install(1) defaults to 0755; that changes tar mode bits and the tgz hash.
install -D -m 0644 -- "$CANON/package.json" "$BUILD_DIR/package.json"
install -D -m 0644 -- "$CANON/README.md" "$BUILD_DIR/README.md"
install -D -m 0644 -- "$CANON/CHANGELOG.md" "$BUILD_DIR/CHANGELOG.md"
install -D -m 0644 -- "$CANON/bin/use-steady.js" "$BUILD_DIR/bin/use-steady.js"

# Re-check overlays landed in the build dir.
[[ "$(sha256_file "$BUILD_DIR/package.json")" == "$EXPECTED_OVERLAY_SHA256_package_json" ]] || die "build package.json overlay mismatch"
[[ "$(sha256_file "$BUILD_DIR/README.md")" == "$EXPECTED_OVERLAY_SHA256_README" ]] || die "build README overlay mismatch"
[[ "$(sha256_file "$BUILD_DIR/CHANGELOG.md")" == "$EXPECTED_OVERLAY_SHA256_CHANGELOG" ]] || die "build CHANGELOG overlay mismatch"
[[ "$(sha256_file "$BUILD_DIR/bin/use-steady.js")" == "$EXPECTED_OVERLAY_SHA256_bin" ]] || die "build bin overlay mismatch"

# After overlays: every assembled Layer 2 file must match the frozen
# Layer 2 Git-blob identity. Local content hashing only.
blob_checked=0
while IFS=$'\t' read -r rel _mode expected_blob; do
  [[ "$rel" == "path" || -z "${rel:-}" ]] && continue
  dest="$BUILD_DIR/$rel"
  [[ -f "$dest" ]] || die "assembled file missing before blob check: $rel"
  got_blob=$(git_blob_file "$dest")
  [[ "$got_blob" == "$expected_blob" ]] || die "assembled git blob mismatch $rel got $got_blob expected $expected_blob"
  blob_checked=$((blob_checked + 1))
done < "$L2_TSV"
[[ "$blob_checked" -eq 760 ]] || die "blob-checked $blob_checked files, expected 760"

cd -- "$BUILD_DIR"

if ! npm ci --ignore-scripts; then
  die "npm ci --ignore-scripts failed; refusing compile and pack"
fi

set +e
npx tsc -p tsconfig.build.json
tsc_rc=$?
set -e
if [[ "$tsc_rc" -ne 0 ]]; then
  die "tsc -p tsconfig.build.json exited $tsc_rc; refusing to pack"
fi

if ! node scripts/sanitize-package.mjs; then
  die "scripts/sanitize-package.mjs failed; refusing to pack"
fi

if ! npm pack; then
  die "npm pack failed"
fi

[[ -f "$EXPECTED_TGZ_NAME" ]] || die "packed file $EXPECTED_TGZ_NAME not found"
got=$(sha256_file "$EXPECTED_TGZ_NAME")
[[ "$got" == "$EXPECTED_TGZ_SHA256" ]] || die "tarball sha256 $got != $EXPECTED_TGZ_SHA256"

echo "PASS tarball $EXPECTED_TGZ_NAME sha256=$got"
exit 0
