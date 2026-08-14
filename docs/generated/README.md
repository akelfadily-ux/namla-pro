# docs/generated/

This directory is a **human-authored quarantine directory**. It exists so
that a future Namla capability has a single, pre-existing, tightly bounded
place it *could* target — it does **not** grant any capability today.

## Rules for this directory

- This is the **only** proposed initial directory for a future Capability
  C2 real write.
- Any future generated target must be a **direct-child, lowercase-ASCII
  Markdown file** (`*.md`) of this directory — no subdirectories, no
  nested paths.
- **No source code, executable content, configuration, secrets,
  credentials, or environment data** belongs here.
- **Namla cannot create directories.** This directory is created and
  committed by a human; the capability may never `mkdir`.
- **Capability C2-A performs no writes.** It adds contracts and boundaries
  only; no file in this directory is created by Namla.
- **Future C2-C execution requires separate, explicit human
  authorization.** No amendment or contract in place today activates a real
  write.
- **A failed future write may leave a residual artifact** (a zero-byte or
  partial file) in this directory. Removing such an artifact is a **manual
  human cleanup** task — Namla has no delete authority.
- **Existing files must never be overwritten.** A future create is
  exclusive-create only; if a target already exists, the attempt is
  refused, never overwritten.

This `README.md` is a **human-authored repository document**, not a
Namla-generated artifact.
