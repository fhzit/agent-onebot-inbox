/** Fixed label-free metric contract used by the AOI HTTP runtime. */
export const AOI_RUNTIME_METRICS = Object.freeze({
  messageIngest: 'message_ingest_total',
  duplicateEvent: 'duplicate_event_total',
  sendSuccess: 'send_success_total',
  sendFailure: 'send_failure_total',
  connectedTransports: 'connected_transports',
} as const);

export type CounterName = string;
export interface MetricsSnapshot { readonly counters: Readonly<Record<string, number>>; readonly gauges: Readonly<Record<string, number>>; }
const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

/** Fixed-name registry; labels are deliberately unsupported to prevent cardinality leaks. */
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  constructor(counterNames: readonly string[], gaugeNames: readonly string[] = []) {
    const all = new Set<string>();
    for (const [kind, names] of [['counter', counterNames], ['gauge', gaugeNames]] as const) {
      for (const name of names) {
        if (!METRIC_NAME.test(name)) throw new Error(`Invalid metric name: ${name}`);
        if (all.has(name)) throw new Error(`Duplicate metric name: ${name}`);
        all.add(name);
        (kind === 'counter' ? this.counters : this.gauges).set(name, 0);
      }
    }
  }

  static forAoiRuntime(): MetricsRegistry {
    return new MetricsRegistry(
      [AOI_RUNTIME_METRICS.messageIngest, AOI_RUNTIME_METRICS.duplicateEvent, AOI_RUNTIME_METRICS.sendSuccess, AOI_RUNTIME_METRICS.sendFailure],
      [AOI_RUNTIME_METRICS.connectedTransports],
    );
  }

  increment(name: CounterName, amount = 1): void {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Counter increment must be a non-negative safe integer');
    const current = this.counters.get(name);
    if (current === undefined) throw new Error(`Unregistered counter: ${name}`);
    if (!Number.isSafeInteger(current + amount)) throw new RangeError(`Counter overflow: ${name}`);
    this.counters.set(name, current + amount);
  }

  /** Set an absolute finite, non-negative gauge value. */
  setGauge(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Gauge value must be finite and non-negative');
    if (!this.gauges.has(name)) throw new Error(`Unregistered gauge: ${name}`);
    this.gauges.set(name, value);
  }

  snapshot(): MetricsSnapshot {
    const copy = (source: Map<string, number>) => Object.freeze(Object.fromEntries(source));
    return Object.freeze({ counters: copy(this.counters), gauges: copy(this.gauges) });
  }

  /** Render Prometheus 0.0.4 exposition with deterministic HELP/TYPE declarations. */
  renderPrometheus(snapshot: MetricsSnapshot = this.snapshot()): string {
    const lines: string[] = [];
    for (const [type, values] of [['counter', snapshot.counters], ['gauge', snapshot.gauges]] as const) {
      for (const [name, value] of Object.entries(values)) {
        if (!METRIC_NAME.test(name) || !Number.isFinite(value) || value < 0 || (type === 'counter' && !Number.isSafeInteger(value))) throw new Error(`Invalid ${type} snapshot: ${name}`);
        lines.push(`# TYPE ${name} ${type}`, `${name} ${value}`);
      }
    }
    return lines.length ? `${lines.join('\n')}\n` : '';
  }
}

export function escapePrometheusText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}
