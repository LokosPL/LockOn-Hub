# Security Policy — LockOn ServiceOS

## Supported version

Security fixes are prepared for the newest published version of LockOn ServiceOS. Users should keep automatic updates enabled and move to the latest GitHub Release.

## Reporting a vulnerability

Do **not** publish credentials, tokens, personal data, exploit details or screenshots containing sensitive information in a public issue.

Report security problems privately to:

**bartekmotloch@wp.pl**

Please include:
- affected version,
- clear reproduction steps,
- expected and actual behavior,
- impact you observed,
- minimal logs with secrets and personal data removed.

## Secrets

Secrets must never be committed to the repository. Google OAuth build credentials are supplied to the release workflow through GitHub Actions Secrets. Local development secrets belong in `.env` or ignored local credential files.

If a credential is ever exposed publicly, treat it as compromised and rotate it rather than only deleting it from the current branch.

## Build integrity

Official installers are produced only by the repository release workflow. Release artifacts include SHA-256 checksums and GitHub Artifact Attestations so their build provenance can be verified.
