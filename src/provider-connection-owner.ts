export type ProviderConnectionOwner<T> = {
  /** Starts one connection attempt. Duplicate starts while connecting/connected are ignored. */
  connect(start: (opened: (transport: T) => void) => void): boolean;
  /** Invalidates pending callbacks and closes the currently owned transport, if any. */
  close(): void;
  readonly isConnecting: boolean;
  readonly isConnected: boolean;
};

/** Owns a single adapter transport; generation fencing prevents late opens reclaiming ownership. */
export function createProviderConnectionOwner<T>(closeTransport: (transport: T) => void): ProviderConnectionOwner<T> {
  let generation = 0;
  let connecting = false;
  let transport: T | undefined;

  return {
    connect(start) {
      if (connecting || transport !== undefined) return false;
      connecting = true;
      const attempt = ++generation;
      const opened = (candidate: T) => {
        if (attempt !== generation || !connecting) {
          closeTransport(candidate);
          return;
        }
        connecting = false;
        transport = candidate;
      };
      try {
        start(opened);
      } catch (error) {
        if (attempt === generation) connecting = false;
        throw error;
      }
      return true;
    },
    close() {
      generation++;
      connecting = false;
      const current = transport;
      transport = undefined;
      if (current !== undefined) closeTransport(current);
    },
    get isConnecting() { return connecting; },
    get isConnected() { return transport !== undefined; },
  };
}
