import { defaultReconnectDelayOptions, reconnectDelayMs, type DelayOptions } from './provider-reconnect-policy.js';

export type ProviderAttemptEvents = { connected: () => void; failed: () => void };
export type ProviderLifecycleOptions = {
  connect: (events: ProviderAttemptEvents) => void;
  schedule: (callback: () => void, delayMs: number) => () => void;
  delayOptions?: DelayOptions;
  random?: () => number;
};

/** Transport-agnostic controller; callers wire events from a provider. Not production transport wiring. */
export function createProviderLifecycle(options: ProviderLifecycleOptions) {
  let failures = 0;
  let closed = false;
  let activeAttempt = 0;
  let started = false;
  let pendingCancel: (() => void) | undefined;
  let generation = 0;

  const beginAttempt = () => {
    if (closed) return;
    started = true;
    const attempt = ++activeAttempt;
    options.connect({
      connected() {
        if (closed || attempt !== activeAttempt) return;
        failures = 0;
        generation++;
        pendingCancel?.();
        pendingCancel = undefined;
      },
      failed() {
        if (closed || attempt !== activeAttempt || pendingCancel) return;
        const ticket = ++generation;
        const delay = reconnectDelayMs(failures++, options.delayOptions ?? defaultReconnectDelayOptions, options.random);
        let fired = false;
        let synchronous = true;
        const cancel = options.schedule(() => {
          fired = true;
          if (closed || ticket !== generation) return;
          pendingCancel = undefined;
          if (!synchronous) beginAttempt();
        }, delay);
        synchronous = false;
        if (!fired && ticket === generation && !closed) pendingCancel = cancel;
        else if (fired && ticket === generation && !closed) beginAttempt();
      },
    });
  };

  return {
    start() { if (!closed && !started) beginAttempt(); },
    close() {
      if (closed) return;
      closed = true;
      generation++;
      pendingCancel?.();
      pendingCancel = undefined;
    },
    get isClosed() { return closed; },
  };
}
