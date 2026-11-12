import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Crossed } from '../types'

type Band = { at: number; template: string }
type Parsed = { bands: Band[] } | { error: string }

const DEFAULT_CONTEXT_BANDS: Band[] = [
  { at: 50, template: '⚠ Context {pct}% — consider /compact after this task' },
  { at: 75, template: '⚠ Context {pct}% — /compact or start a new session soon' },
  { at: 90, template: '⚠ Context {pct}% — near the limit, /compact now' },
]
const DEFAULT_QUOTA_BANDS: Band[] = [
  { at: 80, template: '⚠ Claude {window} usage {pct}% — pace your usage (reset: {reset})' },
  { at: 95, template: '⚠ Claude {window} usage {pct}% — nearly used up (reset: {reset})' },
]
const ITEM_SEPARATOR = '||'
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'wk' }

// `rejected` names the fields last announced as ignored, so a hot reload does not repeat the notice.
const crossed = atom(
  { plugin: 'usage-meter', key: 'crossed' } as const,
  { context: 0, limits: {}, rejected: '' },
)

// "<band>: <message> || <band>: <message>", the one shape /config can edit. Split at the first
// colon only, so a message may hold colons. Any defect rejects the whole field.
const parseToasts = (text: unknown): Parsed => {
  if (typeof text !== 'string' || !text.trim()) return { error: 'empty' }
  const bands: Band[] = []
  for (const item of text.split(ITEM_SEPARATOR)) {
    const colon = item.indexOf(':')
    if (colon < 0) return { error: `no ":" in "${item.trim()}"` }
    const at = item.slice(0, colon).trim()
    const template = item.slice(colon + 1).trim()
    if (!/^\d+(\.\d+)?$/.test(at) || Number(at) < 1 || Number(at) > 100) {
      return { error: `band "${at}" is not a number from 1 to 100` }
    }
    if (bands.length && Number(at) <= bands[bands.length - 1]!.at) {
      return { error: `band ${at} is not above the one before it` }
    }
    if (!template) return { error: `band ${at} has no message` }
    bands.push({ at: Number(at), template })
  }

  return { bands }
}

// Highest band at or below the figure.
const band = (percent: number, bands: Band[]) => {
  for (let i = bands.length - 1; i >= 0; i--) if (percent >= bands[i]!.at) return bands[i]
  return undefined
}

const formatBand = (at: number) => String(Number(at.toPrecision(10)))

// Unknown placeholders stay as written.
const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  )

// Relative, not a clock time: the model has no reliable clock of its own.
const countdown = (iso: string | undefined, now: number) => {
  const left = (iso ? Date.parse(iso) : NaN) - now
  if (Number.isNaN(left)) return ''
  // The figures are from the last API response: a window past its reset shows a stale percent.
  if (left <= 0) return 'passed'
  const min = Math.round(left / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

export const until = (iso: string | undefined, now: number) => {
  const left = countdown(iso, now)
  return left ? ` (reset: ${left})` : ''
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

export const register: Register = (on, options) => {
  on('prompt.submit', async ($, e, next) => {
    // A failed read still yields `ctx unknown`, which the rules act on; a clock failure
    // only drops the reset suffix. A bug in `line` throws, so the engine reports it.
    const usage = await $.session.usage().catch(() => undefined)
    const now = await $.clock.now().catch(() => NaN)
    const text = usage ? line(usage.context, usage.rateLimits, now) : 'ctx unknown (usage error)'

    return next({ ...e, context: [...(e.context ?? []), text] })
  })

  const show = options.toasts !== 'off'
  const contextParsed = parseToasts(options.context_toasts)
  const quotaParsed = parseToasts(options.quota_toasts)
  const contextBands = 'bands' in contextParsed ? contextParsed.bands : DEFAULT_CONTEXT_BANDS
  const quotaBands = 'bands' in quotaParsed ? quotaParsed.bands : DEFAULT_QUOTA_BANDS
  const rejected = (
    [
      ['context_toasts', contextParsed],
      ['quota_toasts', quotaParsed],
    ] as const
  ).flatMap(([name, parsed]) => ('error' in parsed ? [{ name, error: parsed.error }] : []))
  const signature = rejected.map(({ name }) => name).join(',')
  const notices = rejected.map(
    ({ name, error }) => `usage-meter: ${name} ignored (${error}) — using defaults`,
  )

  on('session.measure', async ($, e, next) => {
    const seen = await read($, crossed)
    const toasts: string[] = show && signature !== (seen.rejected ?? '') ? [...notices] : []
    const now: Crossed = {
      context: seen.context,
      limits: { ...seen.limits },
      rejected: show ? signature : seen.rejected,
    }

    if (e.changed.includes('context') && e.context.percent !== undefined) {
      const hit = band(e.context.percent, contextBands)
      const at = hit?.at ?? 0
      if (hit && at > seen.context) {
        toasts.push(fill(hit.template, { pct: e.context.percent, band: formatBand(at) }))
      }
      now.context = at
    }
    if (e.changed.includes('rateLimits')) {
      const clock = await $.clock.now().catch(() => NaN)
      for (const limit of e.rateLimits) {
        const hit = band(limit.percentUsed, quotaBands)
        const at = hit?.at ?? 0
        if (hit && at > (seen.limits[limit.kind] ?? 0)) {
          toasts.push(
            fill(hit.template, {
              pct: limit.percentUsed,
              band: formatBand(at),
              window: LABELS[limit.kind] ?? limit.kind,
              reset: countdown(limit.resetsAt, clock) || 'unknown',
            }),
          )
        }
        now.limits[limit.kind] = at
      }
    }

    await update($, crossed, () => now)
    if (show) for (const text of toasts) $.ui.toast(text)

    return next(e)
  })
}
