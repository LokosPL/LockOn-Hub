# Code signing policy

LockOn ServiceOS is an open-source Windows desktop application built from this repository.

## Signing provider

**Free code signing provided by SignPath.io, certificate by SignPath Foundation.**

Status: the free SignPath Foundation Open Source application has been submitted and is awaiting review. The GitHub integration is prepared and will become active after approval. Until then, release binaries may remain unsigned and Windows Smart App Control can block them.

## Source and build origin

- Source repository: https://github.com/LokosPL/LockOn-Hub
- Release branch: `main`
- Build system: GitHub Actions on GitHub-hosted runners
- Official releases: https://github.com/LokosPL/LockOn-Hub/releases
- Release artifacts are generated from repository source and build scripts.
- SHA-256 checksums and GitHub Artifact Attestations are published with releases.

## Team roles

For the current one-maintainer project:

- Authors / committers: [@LokosPL](https://github.com/LokosPL)
- Reviewers: [@LokosPL](https://github.com/LokosPL)
- Signing approvers: [@LokosPL](https://github.com/LokosPL)

Every SignPath release signing request will require manual approval in SignPath, as required for the sponsored Open Source signing program.

## Security rules

- GitHub and SignPath accounts used for signing must have multi-factor authentication enabled.
- Secrets and signing credentials must never be committed to the repository.
- Release signing is restricted to artifacts built from this repository.
- Release artifacts must be produced on GitHub-hosted runners.
- Dependencies and GitHub Actions are reviewed through Dependabot, CI and CodeQL.
- Security reports must follow [SECURITY.md](SECURITY.md).

## Privacy

Privacy policy: https://lokospl.github.io/lockon-serviceos-site/privacy.html

LockOn ServiceOS only initiates network communication needed for features the user explicitly uses, such as Google authentication, update checks, the embedded browser and configured LockOn API access. It does not require Gmail or Google Drive content access for basic authentication.

## License

LockOn ServiceOS is licensed under the [MIT License](LICENSE). The project does not use a proprietary dual-license.
