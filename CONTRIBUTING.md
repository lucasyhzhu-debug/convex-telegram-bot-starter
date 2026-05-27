# Contributing

## Filing issues

Use the templates in `.github/ISSUE_TEMPLATE/`. Labels:
- `good-first-issue` — small, well-scoped
- `bug` — reproducer required
- `enhancement` — design proposal helpful

## Pull requests

1. Branch from `main`.
2. Run before opening: `npm run type-check && npm run test && npm run verify-secrets`. All three must pass.
3. Add tests for new behavior. Match the existing TDD-style structure (red → green → commit).
4. If you change schema, run `npx convex codegen` and commit `convex/_generated/`.
5. Update docs (`SETUP.md` / `RUNBOOK.md` / `LESSONS.md`) when behavior or setup changes.

## Optional: advanced practice

For non-trivial changes, consider running the plan-stage + impl-stage review pattern that produced this starter. See `LESSONS.md` lesson 4 for context.

## Code of conduct

Be civil. Assume good intent.
