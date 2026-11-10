# usage-meter

A Claude Code mod that attaches one model-only line to every prompt with the engine's own context and quota figures, and toasts the person when a threshold is crossed.

```
ctx 8.9% (89,441 / 1,000,000) | 5h 14% (reset: 2h 10m) wk 22% (reset: 3d 4h)
```

- `ctx` comes from `$.session.usage()` (the status line's `context_window`). It reads `ctx unknown (window N)` before the first response of a fresh or just-compacted session, and `ctx unknown (usage error)` when the read fails.
- Quota is the Claude rate-limit windows from the last API response. `(reset: …)` is the time left in each window at the top of the turn; `(reset: passed)` means the window has reset since that response, so its percent is stale. A window without `resetsAt`, or a failed clock read, has no suffix.
- Toasts: context 25/50/75%, each quota window 70/90%, on each upward band crossing; a figure that drops below a band and crosses it again toasts again.

## Install

List the folder in `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (`;`-separated absolute paths on Windows). It loads in every new session.

## Develop

```
claude plugin validate .
claude plugin test .
```

`tsconfig.json` extends `.claude-plugin/types/`, an engine-generated folder that ignores itself. Neither `claude -p` nor `claude plugin test` creates it, so a fresh clone shows editor type errors until it exists; the tests run without it. Keep the `.catch` on `$.session.usage()`: a throw out of `prompt.submit` skips the hook and loses the line.
