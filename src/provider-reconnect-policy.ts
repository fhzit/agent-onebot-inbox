export type DelayOptions = { baseDelayMs: number; maxDelayMs: number; jitterRatio: number };
export const defaultReconnectDelayOptions: DelayOptions = { baseDelayMs: 500, maxDelayMs: 30_000, jitterRatio: 0.2 };

/** retryIndex is zero-based. random must return a value in [0, 1]. */
export function reconnectDelayMs(retryIndex: number, options: DelayOptions = defaultReconnectDelayOptions, random: () => number = Math.random): number {
  if (!Number.isInteger(retryIndex) || retryIndex < 0) throw new RangeError('retryIndex must be a non-negative integer');
  const { baseDelayMs, maxDelayMs, jitterRatio } = options;
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs || !Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new RangeError('invalid reconnect delay options');
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) throw new RangeError('random sample must be in [0, 1]');
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(retryIndex, 1023));
  return Math.round(capped * (1 - jitterRatio + 2 * jitterRatio * sample));
}

export type ReconnectLifecycleOptions = {
  connect: () => void;
  schedule: (callback: () => void, delayMs: number) => () => void;
  delayOptions?: DelayOptions;
  random?: () => number;
};

/** A small transport-agnostic retry controller. failed() schedules; connected() resets. */
export function createReconnectLifecycle(options: ReconnectLifecycleOptions) {
  let failures = 0;
  let closed = false;
  let cancelPending: (() => void) | undefined;
  let generation = 0;
  const startAttempt = () => { if (!closed) options.connect(); };
  return {
    start() { if (!closed) startAttempt(); },
    failed() {
      if (closed || cancelPending) return;
      const ticket = ++generation;
      const delay = reconnectDelayMs(failures++, options.delayOptions, options.random);
      cancelPending = options.schedule(() => {
        if (closed || ticket !== generation) return;
        cancelPending = undefined;
        startAttempt();
      }, delay);
    },
    connected() { failures = 0; },
    close() {
      if (closed) return;
      closed = true;
      generation++;
      cancelPending?.();
      cancelPending = undefined;
    },
    get isClosed() { return closed; },
  };
}
