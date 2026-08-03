const SENSITIVE_KEYS = new Set([
  "databaseUrl",
  "prompt",
  "referenceImageUrl",
  "referenceImages",
  "providerRaw",
  "userId",
]);

export type GenerationEvent = Readonly<Record<string, unknown>>;

export function redactGenerationEvent(event: GenerationEvent) {
  return Object.fromEntries(
    Object.entries(event).filter(
      ([key, value]) =>
        !SENSITIVE_KEYS.has(key) &&
        !/secret|token|authorization|api.?key|password/i.test(key) &&
        value !== undefined
    )
  );
}

export function createGenerationObservability(
  write: (event: GenerationEvent) => void = (event) => console.info(JSON.stringify(event))
) {
  const counters = new Map<string, number>();
  const timings = new Map<string, number[]>();

  return {
    event(name: string, fields: GenerationEvent = {}) {
      write(redactGenerationEvent({ name, ...fields }));
    },
    increment(name: string, value = 1) {
      counters.set(name, (counters.get(name) ?? 0) + value);
    },
    observe(name: string, milliseconds: number) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
      timings.set(name, [...(timings.get(name) ?? []), milliseconds]);
    },
    snapshot() {
      return {
        counters: Object.fromEntries(counters),
        timings: Object.fromEntries(
          [...timings].map(([name, values]) => [
            name,
            { count: values.length, sumMs: values.reduce((a, b) => a + b, 0) },
          ])
        ),
      };
    },
  };
}

export type GenerationObservability = ReturnType<
  typeof createGenerationObservability
>;
