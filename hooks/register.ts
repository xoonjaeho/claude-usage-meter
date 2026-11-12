import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Crossed } from '../types'

const CONTEXT_BANDS: [number, string][] = [
  [75, 'stop at a clean point, then /handoff'],
  [50, '/compact after the current task'],
  [25, 'protect: delegate reads, tighten output caps'],
]
const LIMIT_BANDS: [number, string][] = [
  [90, 'orchestrator only, delegate execution'],
  [70, 'prefer engines on another pool'],
]
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'wk' }

// Stored so a hot reload does not repeat toasts already shown this session.
const crossed = atom({ plugin: 'usage-meter', key: 'crossed' } as const, { context: 0, limits: {} })

const band = (percent: number, bands: [number, string][]) =>
  bands.find(([at]) => percent >= at) ?? [0, '']

// Relative, not a clock time: the model has no reliable clock of its own.
export const until = (iso: string | undefined, now: number) => {
  const left = (iso ? Date.parse(iso) : NaN) - now
  if (Number.isNaN(left)) return ''
  // The figures are from the last API response: a window past its reset shows a stale percent.
  if (left <= 0) return ' (reset: passed)'
  const min = Math.round(left / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  return ` (reset: ${d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`})`
}

export const line = (context: SessionContextUsage, limits: SessionRateLimit[], now: number) => {
  const ctx =
    context.tokens === undefined
      ? `ctx unknown (window ${context.window.toLocaleString('en-US')})`
      : `ctx ${((context.tokens / context.window) * 100).toFixed(1)}% (${context.tokens.toLocaleString('en-US')} / ${context.window.toLocaleString('en-US')})`
  const quota = limits
    .map(l => `${LABELS[l.kind] ?? l.kind} ${l.percentUsed}%${until(l.resetsAt, now)}`)
    .join(' ')

  return quota ? `${ctx} | ${quota}` : ctx
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    // A failed read still yields `ctx unknown`, which the rules act on; a clock failure
    // only drops the reset suffix. A bug in `line` throws, so the engine reports it.
    const usage = await $.session.usage().catch(() => undefined)
    const now = await $.clock.now().catch(() => NaN)
    const text = usage ? line(usage.context, usage.rateLimits, now) : 'ctx unknown (usage error)'

    return next({ ...e, context: [...(e.context ?? []), text] })
  })

  on('session.measure', async ($, e, next) => {
    const seen = await read($, crossed)
    const toasts: string[] = []
    const now: Crossed = { context: seen.context, limits: { ...seen.limits } }

    if (e.changed.includes('context') && e.context.percent !== undefined) {
      const [at, advice] = band(e.context.percent, CONTEXT_BANDS)
      if (at > seen.context) toasts.push(`⚠ ctx ${e.context.percent}% crossed — ${advice}`)
      now.context = at
    }
    if (e.changed.includes('rateLimits')) {
      for (const limit of e.rateLimits) {
        const [at, advice] = band(limit.percentUsed, LIMIT_BANDS)
        if (at > (seen.limits[limit.kind] ?? 0)) {
          toasts.push(`⚠ Claude ${LABELS[limit.kind] ?? limit.kind} ${limit.percentUsed}% — ${advice}`)
        }
        now.limits[limit.kind] = at
      }
    }

    await update($, crossed, () => now)
    for (const text of toasts) $.ui.toast(text)

    return next(e)
  })
}
