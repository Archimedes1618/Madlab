// Fallback for crypto.randomUUID when not in secure context (HTTP)
export const uuid = (): string =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
