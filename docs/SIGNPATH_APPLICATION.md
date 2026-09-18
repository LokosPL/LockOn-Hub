# SignPath Foundation application — LockOn ServiceOS

This document contains the project information prepared for the free Open Source code signing application.

## Project

- Name: LockOn ServiceOS
- Repository: https://github.com/LokosPL/LockOn-Hub
- Download page: https://lokospl.github.io/lockon-serviceos-site/
- Releases: https://github.com/LokosPL/LockOn-Hub/releases
- Code signing policy: https://github.com/LokosPL/LockOn-Hub/blob/main/CODE_SIGNING.md
- Privacy policy: https://lokospl.github.io/lockon-serviceos-site/privacy.html
- License: MIT
- Primary platform: Windows x64
- Build system: GitHub Actions, GitHub-hosted runners

## Project description

LockOn ServiceOS is a Windows desktop application for organizing daily work in a phone repair/service environment. The current released functionality includes Google authentication, role-based access, point administration, revenue/settlement workflows, an isolated embedded browser, local help, and automatic updates through GitHub Releases.

## Maintainer and signing roles

- Maintainer / author / committer: LokosPL (Bartłomiej Motłoch)
- Reviewer: LokosPL
- Signing approver: LokosPL

The project uses GitHub Actions, CodeQL, Dependabot, npm audit, pinned GitHub Actions revisions, SHA-256 release checksums and GitHub Artifact Attestations.

## Why signing is needed

The application is distributed as a Windows NSIS installer. Unsigned releases can be blocked by Windows Smart App Control. The project wants to distribute binaries built directly from the public source repository and signed through SignPath Foundation with origin verification.

## Signing target

Primary artifact:

`LockOn-ServiceOS-Setup.exe`

The final integration should submit the GitHub Actions artifact to SignPath, wait for manual release approval, receive the signed installer, regenerate checksums for the signed binary, and only then publish the GitHub Release.

## Compliance notes

- Repository is public.
- Project is MIT licensed.
- No commercial dual-license is used.
- Project does not contain hacking/exploitation functionality.
- Security policy and vulnerability reporting instructions are public.
- Privacy policy is public.
- Project signing roles are documented.
- Signing workflow template is prepared at `docs/SIGNPATH_SETUP.md`.
- GitHub MFA and SignPath MFA must be enabled by the maintainer before signing is activated.
