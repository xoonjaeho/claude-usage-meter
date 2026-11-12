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

test('a band crossing toasts once, not on every measurement', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  const ctx51 = { context: { tokens: 510_000, window: 1_000_000, percent: 51 }, rateLimits: [] }
  await $.session.measure({ ...ctx51, changed: ['context'] })
  await $.session.measure({ ...ctx51, changed: ['context'] })
  await $.session.measure({
    context: ctx51.context,
    rateLimits: [{ kind: 'five_hour', percentUsed: 71 }],
    changed: ['rateLimits'],
  })

  expect(toasts).toEqual([
    '⚠ ctx 51% crossed — /compact after the current task',
    '⚠ Claude 5h 71% — prefer engines on another pool',
  ])
})
