import { expect, test } from 'claude-code/testing'

import { line } from '../hooks/register'

const CONTEXT = { tokens: 72_140, window: 1_000_000, percent: 7 }
const LIMITS = [
  { kind: 'five_hour', percentUsed: 50 },
  { kind: 'seven_day', percentUsed: 5 },
]
const LINE = 'ctx 7.2% (72,140 / 1,000,000, engine) | self 5h 50% wk 5%'

test('line renders the engine figures', () => {
  expect(line(CONTEXT, LIMITS)).toBe(LINE)
  expect(line({ window: 200_000 }, [])).toBe('ctx unknown (window 200,000)')
})

test('a submitted prompt carries the line as model-only context', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: CONTEXT, rateLimits: LIMITS } }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))

  const entered = await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })

  expect(entered.context).toEqual([LINE])
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
    '⚠ ctx 51% 넘음 — 현재 작업 후 /compact 권장',
    '⚠ Claude 5h 71% — 다른 풀 엔진 우선',
  ])
})
