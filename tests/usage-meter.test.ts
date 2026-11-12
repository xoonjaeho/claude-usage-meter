import { expect, test } from 'claude-code/testing'

import { line, until } from '../hooks/register'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const CONTEXT = { tokens: 72_140, window: 1_000_000, percent: 7 }
const LIMITS = [
  { kind: 'five_hour', percentUsed: 50, resetsAt: '2026-11-10T14:10:00Z' },
  { kind: 'seven_day', percentUsed: 5, resetsAt: '2026-11-13T16:00:00Z' },
]
const LINE = 'ctx 7.2% (72,140 / 1,000,000) | 5h 50% (reset: 2h 10m) wk 5% (reset: 3d 4h)'

test('line renders the engine figures', () => {
  expect(line(CONTEXT, LIMITS, NOW)).toBe(LINE)
  expect(line({ window: 200_000 }, [], NOW)).toBe('ctx unknown (window 200,000)')
})

test('reset is relative to now, and dropped when the engine gives none', () => {
  expect(until('2026-11-10T12:45:00Z', NOW)).toBe(' (reset: 45m)')
  expect(until('2026-11-10T11:00:00Z', NOW)).toBe(' (reset: passed)')
  expect(until('2026-11-10T12:00:00Z', NOW)).toBe(' (reset: passed)')
  expect(until('2026-11-10T12:59:40Z', NOW)).toBe(' (reset: 1h 0m)')
  expect(until('2026-11-11T12:00:00Z', NOW)).toBe(' (reset: 1d 0h)')
  expect(until(undefined, NOW)).toBe('')
  expect(until('not a date', NOW)).toBe('')
  expect(line(CONTEXT, [{ kind: 'spend_limit', percentUsed: 40 }], NOW)).toBe(
    'ctx 7.2% (72,140 / 1,000,000) | spend_limit 40%',
  )
})

test('a submitted prompt carries the line as model-only context', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: CONTEXT, rateLimits: LIMITS } }))
  on('clock.now', () => ({ value: NOW }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))

  const entered = await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })

  expect(entered.context).toEqual([LINE])
})

test('a failed usage read still carries a line the rules act on', async ($, on) => {
  on('session.usage', () => ({ deny: 'usage unavailable' }))
  on('clock.now', () => ({ value: NOW }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))

  const entered = await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })

  expect(entered.context).toEqual(['ctx unknown (usage error)'])
})

test('a failed clock drops only the reset suffix', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: CONTEXT, rateLimits: LIMITS } }))
  on('clock.now', () => ({ deny: 'clock unavailable' }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))

  const entered = await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })

  expect(entered.context).toEqual(['ctx 7.2% (72,140 / 1,000,000) | 5h 50% wk 5%'])
})

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

const measure = ($: any, change: { context?: number; limits?: Limit[] }) =>
  $.session.measure({
    context: { tokens: (change.context ?? 0) * 10_000, window: 1_000_000, percent: change.context },
    rateLimits: change.limits ?? [],
    changed: [
      ...(change.context === undefined ? [] : ['context']),
      ...(change.limits === undefined ? [] : ['rateLimits']),
    ],
  })

const collectToasts = (on: any, clockDenied = false) => {
  const toasts: string[] = []
  on('ui.toast', (_$: unknown, e: { text: string }) => (toasts.push(e.text), { value: undefined }))
  on('session.measure', (_$: unknown, e: { changed: string[] }) => ({ changed: e.changed }))
  on('clock.now', () => (clockDenied ? { deny: 'clock unavailable' } : { value: NOW }))
  return toasts
}

const submitLine = async ($: any, on: any) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: CONTEXT, rateLimits: LIMITS } }))
  on('prompt.submit', (_$: unknown, e: any) => ({ text: e.text, context: e.context }))
  const entered = await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  return entered.context
}

// Stands in for the engine's state store so a test can seed the stored bands and read them back.
const storeState = (on: any, seed?: unknown) => {
  const store = { value: seed, version: 1 }
  on('state.get', () => ({ value: { value: store.value, version: store.version } }))
  on('state.set', (_$: unknown, e: { value: unknown }) => {
    store.value = e.value
    return { value: { isSet: true, version: ++store.version } }
  })
  return store
}
const FIVE_HOUR = { kind: 'five_hour', percentUsed: 81, resetsAt: '2026-11-10T14:10:00Z' }
const NOTICE = /^usage-meter: (context|quota)_toasts ignored \(.+\) — using defaults$/

test('a band crossing toasts once, not on every measurement', async ($, on) => {
  const toasts = collectToasts(on)

  await measure($, { context: 51 })
  await measure($, { context: 51 })
  await measure($, { context: 51, limits: [FIVE_HOUR] })
  await measure($, { limits: [FIVE_HOUR] })

  expect(toasts).toEqual([
    '⚠ Context 51% — consider /compact after this task',
    '⚠ Claude 5h usage 81% — pace your usage (reset: 2h 10m)',
  ])
})

test('a figure that drops below a band and rises again toasts again', async ($, on) => {
  const toasts = collectToasts(on)

  await measure($, { context: 51 })
  await measure($, { context: 10 })
  await measure($, { context: 52 })

  expect(toasts).toEqual([
    '⚠ Context 51% — consider /compact after this task',
    '⚠ Context 52% — consider /compact after this task',
  ])
})

const EVERY_DEFAULT_BAND = [
  '⚠ Context 51% — consider /compact after this task',
  '⚠ Claude 5h usage 81% — pace your usage (reset: 2h 10m)',
  '⚠ Context 76% — /compact or start a new session soon',
  '⚠ Claude 5h usage 96% — nearly used up (reset: 2h 10m)',
  '⚠ Context 91% — near the limit, /compact now',
]

const crossEveryBand = async ($: any, on: any) => {
  const toasts = collectToasts(on)
  await measure($, { context: 51, limits: [FIVE_HOUR] })
  await measure($, { context: 76, limits: [{ ...FIVE_HOUR, percentUsed: 96 }] })
  await measure($, { context: 91 })
  return toasts
}

// The manifest default (no options) and the code fallback (rejected options) must agree.
test('the manifest defaults give every default toast', async ($, on) => {
  expect(await crossEveryBand($, on)).toEqual(EVERY_DEFAULT_BAND)
})

test('the code fallback gives every default toast', { options: { context_toasts: 'x', quota_toasts: 'x' } }, async ($, on) => {
  const toasts = await crossEveryBand($, on)

  expect(toasts.filter(text => !NOTICE.test(text))).toEqual(EVERY_DEFAULT_BAND)
})

const CUSTOM = {
  context_toasts: '20: ctx low {pct} || 40: ctx mid {pct} || 60:ctx high {pct}',
  quota_toasts: '60: quota warn {window} {pct} {reset} || 85: quota high {window} {pct}',
}

test('bands and templates from options replace the defaults', { options: CUSTOM }, async ($, on) => {
  const toasts = collectToasts(on)

  await measure($, { context: 30 })
  await measure($, { context: 30, limits: [{ ...FIVE_HOUR, percentUsed: 70 }] })
  await measure($, { context: 30, limits: [{ kind: 'seven_day', percentUsed: 92 }] })
  await measure($, { context: 65 })

  expect(toasts).toEqual([
    'ctx low 30',
    'quota warn 5h 70 2h 10m',
    'quota high wk 92',
    'ctx high 65',
  ])
})

const PLACEHOLDERS = {
  context_toasts: '10: {pct}/{band} {window} {reset} {nope}',
  quota_toasts: '10: {window}|{pct}|{band}|{reset}|{nope}',
}

test('placeholders are substituted and unknown ones stay as written', { options: PLACEHOLDERS }, async ($, on) => {
  const toasts = collectToasts(on)

  await measure($, {
    context: 12,
    limits: [
      { kind: 'five_hour', percentUsed: 12.5, resetsAt: '2026-11-10T14:10:00Z' },
      { kind: 'spend_limit', percentUsed: 11 },
      { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-11-10T11:00:00Z' },
    ],
  })

  expect(toasts).toEqual([
    '12/10 {window} {reset} {nope}',
    '5h|12.5|10|2h 10m|{nope}',
    'spend_limit|11|10|unknown|{nope}',
    'wk|12|10|passed|{nope}',
  ])
})

test('a denied clock makes {reset} unknown', async ($, on) => {
  const toasts = collectToasts(on, true)

  await measure($, { limits: [FIVE_HOUR] })

  expect(toasts).toEqual(['⚠ Claude 5h usage 81% — pace your usage (reset: unknown)'])
})

const LONG_BAND = { context_toasts: '12.123456789012: at {band}', quota_toasts: '100: full' }

test('a long decimal band prints with ten significant digits', { options: LONG_BAND }, async ($, on) => {
  const toasts = collectToasts(on)

  await measure($, { context: 13 })

  expect(toasts).toEqual(['at 12.12345679'])
})

const LONG_QUOTA = { context_toasts: '100: full', quota_toasts: '12.123456789012: at {band}' }

test('a long decimal quota band prints with ten significant digits', { options: LONG_QUOTA }, async ($, on) => {
  const toasts = collectToasts(on)

  await measure($, { limits: [{ kind: 'five_hour', percentUsed: 13 }] })

  expect(toasts).toEqual(['at 12.12345679'])
})

const COLON = { context_toasts: '12.5: note: {pct}% at {band}', quota_toasts: '100: full' }

test('a message may hold colons and a decimal band prints as is', { options: COLON }, async ($, on) => {
  const toasts = collectToasts(on)

  await measure($, { context: 13 })

  expect(toasts).toEqual(['note: 13% at 12.5'])
})

const BAD_FIELDS = [
  ['band below 1', '0: a || 5: b'],
  ['fraction below 1', '0.5: a'],
  ['band above 100', '50: a || 101: b'],
  ['equal bands', '50: a || 50: b'],
  ['bands not ascending', '75: a || 50: b'],
  ['non-numeric band', 'high: a'],
  ['hex band', '0x32: a'],
  ['item without a colon', '50 a'],
  ['empty message', '50: a || 75:   '],
  ['empty field', '  '],
] as const

for (const [name, bad] of BAD_FIELDS) {
  const options = { context_toasts: bad, quota_toasts: '5: quota {pct}' }

  test(`malformed context_toasts (${name}) falls back with a notice, keeps line and quota`, { options }, async ($, on) => {
    const toasts = collectToasts(on)

    const context = await submitLine($, on)
    await measure($, { context: 51, limits: [{ kind: 'five_hour', percentUsed: 6 }] })

    expect(context).toEqual([LINE])
    expect(toasts).toHaveLength(3)
    expect(toasts[0]).toMatch(NOTICE)
    expect(toasts.slice(1)).toEqual(['⚠ Context 51% — consider /compact after this task', 'quota 6'])
  })
}

test('a malformed quota_toasts falls back to the default quota bands', { options: { quota_toasts: '70 one message' } }, async ($, on) => {
  const toasts = collectToasts(on)

  await measure($, { limits: [{ ...FIVE_HOUR, percentUsed: 85 }] })

  expect(toasts).toHaveLength(2)
  expect(toasts[0]).toMatch(NOTICE)
  expect(toasts[1]).toBe('⚠ Claude 5h usage 85% — pace your usage (reset: 2h 10m)')
})

const NO_COLON = 'usage-meter: context_toasts ignored (no ":" in "bad") — using defaults'
const BAD_CONTEXT = { context_toasts: 'bad' }

test('a rejected field is announced once, then not on later measurements', { options: BAD_CONTEXT }, async ($, on) => {
  const toasts = collectToasts(on)
  const store = storeState(on)

  await measure($, { context: 10 })
  await measure($, { context: 20 })

  expect(toasts).toEqual([NO_COLON])
  expect(store.value).toMatchObject({ rejected: 'context_toasts' })
})

test('a reload with the same rejection stays quiet', { options: BAD_CONTEXT }, async ($, on) => {
  const toasts = collectToasts(on)
  storeState(on, { context: 0, limits: {}, rejected: 'context_toasts' })

  await measure($, { context: 10 })

  expect(toasts).toEqual([])
})

test('a different rejection after a reload is announced', { options: BAD_CONTEXT }, async ($, on) => {
  const toasts = collectToasts(on)
  storeState(on, { context: 0, limits: {}, rejected: 'quota_toasts' })

  await measure($, { context: 10 })

  expect(toasts).toEqual([NO_COLON])
})

test('a fixed config clears the record so the same mistake is announced again', async ($, on) => {
  const toasts = collectToasts(on)
  const store = storeState(on, { context: 0, limits: {}, rejected: 'context_toasts' })

  await measure($, { context: 10 })

  expect(toasts).toEqual([])
  expect(store.value).toMatchObject({ rejected: '' })
})

test('a field broken after a clean start is announced', { options: BAD_CONTEXT }, async ($, on) => {
  const toasts = collectToasts(on)
  storeState(on, { context: 5, limits: {}, rejected: '' })

  await measure($, { context: 10 })

  expect(toasts).toEqual([NO_COLON])
})

const OFF = { toasts: 'off', context_toasts: 'bad' }

test('toasts off: no toast, no notice, line kept, crossed band still recorded', { options: OFF }, async ($, on) => {
  const toasts = collectToasts(on)
  const store = storeState(on)

  const context = await submitLine($, on)
  await measure($, { context: 95, limits: [{ kind: 'five_hour', percentUsed: 99 }] })

  expect(context).toEqual([LINE])
  expect(toasts).toEqual([])
  expect(store.value).toEqual({ context: 90, limits: { five_hour: 95 }, rejected: '' })
})

test('a reconfigured band set does not re-toast a step already passed', { options: { context_toasts: '20: low || 60: high' } }, async ($, on) => {
  const toasts = collectToasts(on)
  storeState(on, { context: 50, limits: {}, rejected: '' })

  await measure($, { context: 55 })
  await measure($, { context: 65 })

  expect(toasts).toEqual(['high'])
})
