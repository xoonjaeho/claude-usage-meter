# claude-usage-meter

A Claude Code mod that attaches one model-only line to every prompt with the engine's own context and quota figures, and toasts the person when a threshold is crossed.

```
ctx 8.9% (89,441 / 1,000,000) | 5h 14% (reset: 2h 10m) wk 22% (reset: 3d 4h)
```

- `ctx` comes from `$.session.usage()` (the status line's `context_window`). It reads `ctx unknown (window N)` before the first response of a fresh or just-compacted session, and `ctx unknown (usage error)` when the read fails.
- Quota is the Claude rate-limit windows from the last API response. `(reset: …)` is the time left in each window at the top of the turn; `(reset: passed)` means the window has reset since that response, so its percent is stale. A window without `resetsAt`, or a failed clock read, has no suffix.
- Toasts: on each upward band crossing of context (default 50/75/90%) and of each quota window (default 80/95%); a figure that drops below a band and crosses it again toasts again. Bands and messages are configurable, see Configure.

## Install

The plugin name in `.claude-plugin/plugin.json` stays `usage-meter`: `claude plugin validate` reserves names starting with `claude-`. The Codex counterpart is `codex-usage-meter`.

List the folder in `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (`;`-separated absolute paths on Windows). It loads in every new session.

## Configure

The model-facing line is fixed. The toasts are set through three `userConfig` fields. Edit them with `/config` (the change reloads the plugin at once), or write them to `pluginConfigs["usage-meter"].options` in `settings.json`. After `claude plugin configure` from outside a session, restart Claude Code.

| Field | Default |
|---|---|
| `toasts` | `on`; `off` turns every toast off. The line is still sent, and the crossed bands are still tracked, so turning toasts back on does not replay old crossings. |
| `context_toasts` | `50: ⚠ Context {pct}% — consider /compact after this task \|\| 75: ⚠ Context {pct}% — /compact or start a new session soon \|\| 90: ⚠ Context {pct}% — near the limit, /compact now` |
| `quota_toasts` | `80: ⚠ Claude {window} usage {pct}% — pace your usage (reset: {reset}) \|\| 95: ⚠ Claude {window} usage {pct}% — nearly used up (reset: {reset})` |

The `\|\|` above is only table escaping; write plain `||` in the field.

A toast field is a list of items separated by `||`. Each item is `<band>: <message>`, split at the first `:`, so a message may contain colons. Bands are percentages from 1 to 100 (decimals allowed), strictly ascending. A toast appears on each upward crossing of a band, per quota window for `quota_toasts`; a figure that drops below the band and crosses it again toasts again.

Placeholders:

- `{pct}`: the figure that crossed. For context it is the engine's whole-number percent (the line shows one decimal); for quota it is the window's `percentUsed`.
- `{band}`: the band that was crossed, an integer when it is one, otherwise up to 10 significant digits.
- `{window}`: quota only: `5h`, `wk`, or the raw kind such as `spend_limit`.
- `{reset}`: quota only: the time left, such as `2h 10m`; `passed` when the window has already reset; `unknown` when the engine gave no reset time or the clock read failed.

Unknown placeholders are left as written.

A toast field with any defect (an item without `:`, a band that is not a number from 1 to 100, bands that are equal or not ascending, an empty message, an empty field) is ignored as a whole and its defaults apply; the other field and the line are unaffected. The next measurement then shows one toast per ignored field, such as `usage-meter: context_toasts ignored (...) — using defaults`. It is shown once; fixing the field and breaking it again shows it again. With `toasts` off, no notice is shown.

A value of the wrong type (for example a number or boolean in a string field) makes the engine refuse to load the mod, so the line is lost too. A `toasts` value other than `on` or `off` counts as unset. Use `/config`, which only offers valid values.

## Develop

```
claude plugin validate .
claude plugin test .
```

`tsconfig.json` extends `.claude-plugin/types/`, an engine-generated folder that ignores itself. Neither `claude -p` nor `claude plugin test` creates it, so a fresh clone shows editor type errors until it exists; the tests run without it. Keep the `.catch` on `$.session.usage()`: a throw out of `prompt.submit` skips the hook and loses the line.
