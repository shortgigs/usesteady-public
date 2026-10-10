# Alpha.74 public-verifier manifest convention

This file is proposed public support. It does not contain its own
content identity. Identity of this file is an ordinary Git blob and
SHA-256 in the destination map and support table.

This is assembly documentation. It is not a runtime gate.

## Two identity classes

1. **Content-addressed files.** Destination `export_blob` and support
   `git_blob` / `sha256` / `bytes` are the Git blob and SHA-256 of the
   file bytes. Rebuild instructions and the rebuild script are in this
   class.

2. **Self-listing manifest files.** Two tables list verifier materials
   and also list themselves and each other:

   - `docs/release/ALPHA74_EXPORT_DESTINATION_ACTIONS.tsv`
   - `docs/release/ALPHA74_PUBLIC_SUPPORT_FILES.tsv`

   A file cannot contain a correct hash of its own current bytes.
   Those rows use the sentinel `BOUND_BY_EXPORT_COMMIT` in identity
   columns (`export_blob`, `git_blob`, `sha256`, `bytes`).

Do not invent a fixed-point self-hash. Do not omit these two files
from the planned export.

## Binding

Identities of the two manifest files are bound by:

1. The Git blob of that path in the authorized **export commit**
   (public verifiers: `git rev-parse HEAD:docs/release/<file>` after
   clone of the export checkout).
2. A **private envelope** on the preview branch:
   `docs/release/ALPHA74_MANIFEST_ENVELOPE.md`.

The private envelope is not a public support file and is not a
`SUPPORT_ADD` destination. Public verifiers do not look up a private
commit SHA.

Layer 1 / Layer 2 / union TSVs remain content-addressed. Their
SHA-256 values are frozen accepted-list identities and are checked
by `rebuild-alpha74-candidate.sh`.
