export type Crossed = { context: number; limits: Record<string, number>; rejected: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { crossed: Crossed }
  }
}
