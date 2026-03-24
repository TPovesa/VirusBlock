# Codex Working Rules for /root/fatalerror

## Default execution rules
- Always split substantial work into multiple workers when the task has separable parts.
- Keep the main thread for integration, risk control, and final verification.
- Do not duplicate worker work in the main thread unless a worker failed or returned incomplete results.

## Worker policy
- Prefer parallel workers for independent backend, frontend, Windows, Android, Linux, Telegram, and deployment subtasks.
- Give every worker a narrow scope and explicit file ownership.
- Reuse existing workers when the scope is related.

## Delivery policy
- At the end of each substantial task, send a short change announcement through `@fatalerrorbuild_bot`.
- The announcement should summarize what changed in user-facing terms.
- Do not leak sensitive internal routes or hidden admin paths in commit messages.

## Build policy
- Prefer GitHub Actions over local full builds.
- Lightweight inspection and syntax checks are allowed when they do not replace the release pipeline.

## Repo hygiene
- Never touch unrelated dirty files.
- Especially avoid unrelated tracked changes unless the task explicitly requires them.
