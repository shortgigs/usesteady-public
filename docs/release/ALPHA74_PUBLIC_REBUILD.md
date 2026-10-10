# Public rebuild of unpublished 0.1.0-alpha.74 candidate bytes

This is assembly/build documentation for a later authorized public export.
It is not npm publication. It is not a new runtime gate.

Do not pack inside the mixed public home tree (historical `dist/` plus
`package.json` `0.1.0-alpha.72`). Do not look up a private git commit.

## Inputs on the public export checkout

| File | Identity class |
|---|---|
| `docs/release/ALPHA74_TARBALL_REPRO_INPUTS.tsv` (760 pack paths) | content-addressed SHA-256 `6faaefd3f808cd5b327020c13b12cfacb56bca1c78d97e07a61bb9d71cba9811` |
| `docs/release/ALPHA74_EXPORT_UNION.tsv` (927 source paths) | content-addressed SHA-256 `2a41647c0c0abedd1dbcf567f58fbb5d9c704caf6000c04210c6c3ede77e5753` |
| `docs/release/ALPHA74_PUBLIC_EXPORT_INCLUDE.tsv` (926 NOTICE-source paths) | content-addressed SHA-256 `138e4cb8faa533c22bed1e0b8fbd7e5d559d61b732436a603ca407d74c06e6b9` |
| `docs/release/ALPHA74_EXPORT_DESTINATION_ACTIONS.tsv` | planned export; own identity `BOUND_BY_EXPORT_COMMIT` |
| `docs/release/ALPHA74_PUBLIC_SUPPORT_FILES.tsv` | planned export; own identity `BOUND_BY_EXPORT_COMMIT` |
| `docs/release/ALPHA74_MANIFEST_CONVENTION.md` | content-addressed; explains the sentinel |
| `docs/release/canonical-build-inputs/package.json` | SHA-256 `f7305aef9e4f78dbca680a1503c98fe70a086f21a1f4d6aa4e6597cdc631caa1` |
| `docs/release/canonical-build-inputs/README.md` | SHA-256 `c5e008c5668613856e87eb63032ff85264bafc798ac8a13484dd8f7ff4e06f34` |
| `docs/release/canonical-build-inputs/CHANGELOG.md` | SHA-256 `30d20c466d51393a8076f55ac94d0de0853254b57c914d512eefdc71f14880c7` |
| `docs/release/canonical-build-inputs/bin/use-steady.js` | SHA-256 `8d938eb05890f998f0b0ca48c47e194b78602c4cca2c6fe39103c987aa792239` |

Manifest rows that list themselves use `BOUND_BY_EXPORT_COMMIT` instead
of a self-hash. See `docs/release/ALPHA74_MANIFEST_CONVENTION.md`.
Public verifiers bind those two TSV files to `git rev-parse HEAD:<path>`
on the export commit. A private envelope on the preview branch records
the same bytes for review; it is not a public support file.

Exact dest/blob/role rows for content-addressed support files:
`docs/release/ALPHA74_PUBLIC_SUPPORT_FILES.tsv`.

## Command

```bash
bash docs/release/rebuild-alpha74-candidate.sh /path/to/public-export-checkout /path/to/empty-build-dir
```

The script copies the 760 Layer 2 paths from the export checkout into the
empty build directory, applies each Layer 2 TSV mode (`100644` / `100755`),
overlays the four canonical pack inputs as mode `0644` (not `install`'s
default `0755`), verifies manifest and overlay SHA-256 identities, then
verifies all 760 assembled file Git-blob identities against the Layer 2
TSV by local `git hash-object --no-filters` (raw bytes; no
private-commit lookup). Only after
that check does it run `npm ci --ignore-scripts`, `npx tsc -p
tsconfig.build.json` (stops without packing if `tsc` is non-zero),
`scripts/sanitize-package.mjs`, `npm pack`, and compare
`usesteady-0.1.0-alpha.74.tgz` to

`4143b843bd6862b6b6f25dbe11076d7e1ea5ef88ad0aaa50444a201f63b864b3`.

Any mismatch is a FAIL. `ui/` is not required to emit those bytes.
