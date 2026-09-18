# SignPath GitHub integration template

This file is intentionally documentation, not an active workflow. Activate it only after SignPath Foundation approves the project and provides the required organization/project/signing-policy identifiers.

Required GitHub configuration:

- Secret: `SIGNPATH_API_TOKEN`
- Variable: `SIGNPATH_ORGANIZATION_ID`
- Variable: `SIGNPATH_PROJECT_SLUG`
- Variable: `SIGNPATH_SIGNING_POLICY_SLUG`

Recommended release flow:

```yaml
- name: Upload unsigned installer
  id: upload-unsigned
  uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
  with:
    name: lockon-unsigned-installer
    path: release/LockOn-ServiceOS-Setup.exe

- name: Submit SignPath signing request
  uses: signpath/github-action-submit-signing-request@f6d04783b4569d051e0c80105fe66e82819d0092 # v3
  with:
    api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
    organization-id: ${{ vars.SIGNPATH_ORGANIZATION_ID }}
    project-slug: ${{ vars.SIGNPATH_PROJECT_SLUG }}
    signing-policy-slug: ${{ vars.SIGNPATH_SIGNING_POLICY_SLUG }}
    github-artifact-id: ${{ steps.upload-unsigned.outputs.artifact-id }}
    wait-for-completion: true
    output-artifact-directory: signed

- name: Replace unsigned installer
  shell: pwsh
  run: |
    Copy-Item "signed/LockOn-ServiceOS-Setup.exe" "release/LockOn-ServiceOS-Setup.exe" -Force
```

The final active workflow must keep GitHub-hosted runners and must not publish the unsigned installer if SignPath signing is enabled but fails.
