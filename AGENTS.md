# Repository Agent Instructions

Read and follow [`CLAUDE.md`](./CLAUDE.md) for the project-wide safety, testing, Git, and domain
rules. Those rules apply to every coding agent working in this repository.

## Deferred authenticated-persona test suite

When real authentication and account switching are available, proactively propose the replacement
for the temporary anonymous persona workflow. Follow
[`docs/testing/authenticated-persona-testing.md`](./docs/testing/authenticated-persona-testing.md).

Do not treat anonymous-user SQL swapping as final end-to-end coverage. The replacement must use
three non-anonymous test accounts, the real authentication flow, real backend requests, repeatable
tagged seed data, and a safe cleanup/reset process. Never commit credentials or target real users.
