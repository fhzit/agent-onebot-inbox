export type LivenessSocket = {
  ping: (payload: Buffer) => void;
  terminate: () => void;
  on: (event: 'pong', listener: (payload: Buffer) => void) => unknown;
  off?: (event: 'pong', listener: (payload: Buffer) => void) => unknown;
};

/** Detects dead WebSocket sessions using RFC 6455 control ping/pong frames. */
export function createProviderSessionLiveness(options: {
  socket: LivenessSocket;
  schedule: (callback: () => void, delayMs: number) => () => void;
  intervalMs: number;
  timeoutMs: number;
  onTimeout: () => void;
}) {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) throw new RangeError('intervalMs must be positive');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new RangeError('timeoutMs must be positive');
  let stopped = false;
  let cancelTimer: (() => void) | undefined;
  let outstandingPing: Buffer | undefined;
  let scheduleToken = 0;
  const onPong = (payload: Buffer) => {
    if (stopped || outstandingPing === undefined || !payload.equals(outstandingPing)) return;
    outstandingPing = undefined;
    cancelTimer?.();
    const token = ++scheduleToken;
    const timer = options.schedule(sendPing, options.intervalMs);
    if (stopped || token !== scheduleToken) timer(); else cancelTimer = timer;
  };
  const sendPing = () => {
    if (stopped) return;
    const payload = Buffer.from(crypto.randomUUID());
    outstandingPing = payload;
    try {
      options.socket.ping(payload);
    } catch {
      timeout();
      return;
    }
    const timer = options.schedule(timeout, options.timeoutMs);
    if (stopped) timer(); else cancelTimer = timer;
  };
  const timeout = () => {
    if (stopped) return;
    outstandingPing = undefined;
    stopped = true;
    scheduleToken++;
    cancelTimer = undefined;
    options.socket.off?.('pong', onPong);
    try {
      options.onTimeout();
    } finally {
      options.socket.terminate();
    }
  };
  options.socket.on('pong', onPong);
  const initialTimer = options.schedule(sendPing, options.intervalMs);
  if (stopped) initialTimer(); else cancelTimer = initialTimer;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      outstandingPing = undefined;
      scheduleToken++;
      cancelTimer?.();
      cancelTimer = undefined;
    },
    get isStopped() { return stopped; },
  };
}
