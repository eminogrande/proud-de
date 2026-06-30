# proud.de working agreement

This project is a public reading archive first, and an agent-ready archive at the protocol layer.

## Product direction

1. Keep visible pages minimal, calm, and magazine-like.
2. Optimize article pages for reading on desktop and mobile before adding more UI.
3. Keep technical labels out of the main reading flow; if useful, place source links at the end.
4. Keep `proud.de` lowercase in visible copy.
5. Preserve multilingual article routes only when the language version actually exists.
6. Keep agent, SEO, and sharing metadata available without making the browser UI feel technical.

## Engineering style

1. Prefer small, surgical changes that can be reviewed and tested quickly.
2. Keep generator code modular; avoid huge new blobs.
3. Make every deploy auditable with repeatable checks.
4. Document the reason for decisions in release notes and commit messages.
5. Review changes as if they were written by someone else before deploy.
6. Do not claim a score is 100% unless the live target has been tested.

## Release habit

Every meaningful deploy should include:

1. A short changelog entry.
2. The goal and decision behind the change.
3. Build output verification.
4. Live endpoint audit.
5. External score checks for agent readiness, PageSpeed, SEO, and GEO where available.
