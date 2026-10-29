export type ReverseWsAccount = { id: string; self_id: string };

/** Resolve a reverse-WebSocket account by explicit route or OneBot self_id. */
export function resolveReverseWsAccount<T extends ReverseWsAccount>(
  accounts: readonly T[],
  pathAccountId: string | undefined,
  selfId: string | undefined,
): T | null {
  if (pathAccountId !== undefined) {
    const account = accounts.find(candidate => candidate.id === pathAccountId);
    if (!account || (selfId !== undefined && selfId !== account.self_id)) return null;
    return account;
  }
  if (selfId !== undefined) return accounts.find(candidate => candidate.self_id === selfId) ?? null;
  return accounts.length === 1 ? accounts[0] ?? null : null;
}

/** OneBot v11 action responses have status and retcode; events do not. */
export function classifyActionResponse(packet: unknown, expectedEcho: string): boolean {
  if (packet === null || typeof packet !== 'object' || Array.isArray(packet)) return false;
  const value = packet as Record<string, unknown>;
  return value.echo !== undefined
    && String(value.echo) === expectedEcho
    && (value.status === 'ok' || value.status === 'failed')
    && typeof value.retcode === 'number';
}

import { createProviderLifecycle } from './provider-lifecycle.js';

/** Owns one outbound Reverse WS socket and applies the shared reconnect policy. */
export function createManagedReverseWsClient<T extends { close: () => void }>(options: {
  connect: (events: { connected: () => void; failed: () => void }) => T;
  schedule: (callback: () => void, delayMs: number) => () => void;
  delayOptions?: import('./provider-reconnect-policy.js').DelayOptions;
  random?: () => number;
}) {
  let socket: T | undefined;
  const connecting = new Set<T>();
  const disposed = new WeakSet<object>();
  let closed = false;
  let generation = 0;
  const lifecycle = createProviderLifecycle({
    schedule: options.schedule,
    ...(options.delayOptions ? { delayOptions: options.delayOptions } : {}),
    ...(options.random ? { random: options.random } : {}),
    connect(events) {
      const attempt = ++generation;
      let candidate: T | undefined;
      const dispose = () => {
        if (!candidate) return;
        if (disposed.has(candidate)) return;
        disposed.add(candidate);
        connecting.delete(candidate);
        if (socket === candidate) socket = undefined;
        candidate.close();
      };
      try {
        candidate = options.connect({
          connected() {
            if (!candidate) return;
            if (closed || attempt !== generation) { dispose(); return; }
            connecting.delete(candidate);
            const prior = socket;
            socket = candidate;
            events.connected();
            if (prior && prior !== candidate) prior.close();
            for (const pending of connecting) pending.close();
            connecting.clear();
          },
          failed() {
            if (closed || attempt !== generation) { dispose(); return; }
            if (!candidate) return;
            dispose();
            events.failed();
          },
        });
        if (closed || attempt !== generation) candidate.close();
        else connecting.add(candidate);
      } catch {
        events.failed();
        return;
      }
    },
  });
  return {
    start() { if (!closed) lifecycle.start(); },
    close() {
      if (closed) return;
      closed = true;
      generation++;
      lifecycle.close();
      const active = socket;
      socket = undefined;
      active?.close();
      for (const pending of connecting) pending.close();
      connecting.clear();
    },
    get currentSocket() { return socket; },
    get isClosed() { return closed; },
  };
}
