# Contributing to LockOn ServiceOS

LockOn ServiceOS is maintained as an open-source project.

## Changes

1. Create a branch.
2. Make the smallest focused change possible.
3. Run the verification workflow locally where practical.
4. Open a pull request into `main`.
5. Do not commit passwords, OAuth secrets, API tokens, customer data, repair records or other personal data.

## Security-sensitive areas

Changes to these areas require extra review:

- `.github/workflows/`
- `electron/`
- `server/`
- authentication and session handling
- updater and release configuration
- dependency manifests and lockfiles

## Release integrity

Official Windows releases are produced only by GitHub Actions. Once the SignPath Foundation integration is approved, release binaries will be submitted for signing from the GitHub build artifact and require a signing approval before publication.

## License

By contributing, you agree that your contribution is provided under the repository's MIT License.
