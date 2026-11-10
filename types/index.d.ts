export type Crossed = { context: number; limits: Record<string, number> }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { crossed: Crossed }
  }
}
