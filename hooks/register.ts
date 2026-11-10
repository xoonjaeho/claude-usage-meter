import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Crossed } from '../types'

const CONTEXT_BANDS: [number, string][] = [
  [75, '정리 지점에서 멈추고 /handoff'],
  [50, '현재 작업 후 /compact 권장'],
  [25, '보호 구간: 읽기는 위임, 출력 상한 축소'],
]
const LIMIT_BANDS: [number, string][] = [
  [90, '오케스트레이터 전용 (실행은 위임)'],
  [70, '다른 풀 엔진 우선'],
]
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: 'wk' }

// Stored so a hot reload does not repeat toasts already shown this session.
const crossed = atom({ plugin: 'usage-meter', key: 'crossed' } as const, { context: 0, limits: {} })

const band = (percent: number, bands: [number, string][]) =>
  bands.find(([at]) => percent >= at) ?? [0, '']

export const line = (context: SessionContextUsage, limits: SessionRateLimit[]) => {
  const ctx =
    context.tokens === undefined
      ? `ctx unknown (window ${context.window.toLocaleString('en-US')})`
      : `ctx ${((context.tokens / context.window) * 100).toFixed(1)}% (${context.tokens.toLocaleString('en-US')} / ${context.window.toLocaleString('en-US')}, engine)`
  const quota = limits.map(l => `${LABELS[l.kind] ?? l.kind} ${l.percentUsed}%`).join(' ')

  return quota ? `${ctx} | self ${quota}` : ctx
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const usage = await $.session.usage()

    return next({ ...e, context: [...(e.context ?? []), line(usage.context, usage.rateLimits)] })
  })

  on('session.measure', async ($, e, next) => {
    const seen = await read($, crossed)
    const toasts: string[] = []
    const now: Crossed = { context: seen.context, limits: { ...seen.limits } }

    if (e.changed.includes('context') && e.context.percent !== undefined) {
      const [at, advice] = band(e.context.percent, CONTEXT_BANDS)
      if (at > seen.context) toasts.push(`⚠ ctx ${e.context.percent}% 넘음 — ${advice}`)
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
