import assert from 'node:assert/strict';
import test from 'node:test';
import { AOI_RUNTIME_METRICS, escapePrometheusText, MetricsRegistry } from '../src/metrics.js';

test('AOI runtime registry exposes operational counters and connected transport gauge', () => {
  const registry = MetricsRegistry.forAoiRuntime();
  registry.increment(AOI_RUNTIME_METRICS.messageIngest, 3);
  registry.increment(AOI_RUNTIME_METRICS.duplicateEvent);
  registry.setGauge(AOI_RUNTIME_METRICS.connectedTransports, 2);
  assert.equal(registry.renderPrometheus(), [
    '# TYPE message_ingest_total counter', 'message_ingest_total 3',
    '# TYPE duplicate_event_total counter', 'duplicate_event_total 1',
    '# TYPE send_success_total counter', 'send_success_total 0',
    '# TYPE send_failure_total counter', 'send_failure_total 0',
    '# TYPE connected_transports gauge', 'connected_transports 2', '',
  ].join('\n'));
});

test('registered counters and gauges retain immutable snapshots', () => {
  const registry = new MetricsRegistry(['requests_total'], ['active_connections']);
  registry.increment('requests_total', 3);
  registry.setGauge('active_connections', 1);
  const snapshot = registry.snapshot();
  registry.increment('requests_total');
  registry.setGauge('active_connections', 4);
  assert.equal(snapshot.counters.requests_total, 3);
  assert.equal(snapshot.gauges.active_connections, 1);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.counters));
  assert.ok(Object.isFrozen(snapshot.gauges));
});

test('registry rejects invalid names, duplicates, unknown metrics, and unsafe values', () => {
  assert.throws(() => new MetricsRegistry(['bad metric']), /Invalid metric name/);
  assert.throws(() => new MetricsRegistry(['same', 'same']), /Duplicate metric/);
  assert.throws(() => new MetricsRegistry(['same'], ['same']), /Duplicate metric/);
  const registry = new MetricsRegistry(['requests_total'], ['active_connections']);
  for (const amount of [-1, 0.5, Number.NaN]) assert.throws(() => registry.increment('requests_total', amount), RangeError);
  assert.throws(() => registry.increment('other_total'), /Unregistered counter/);
  assert.throws(() => registry.setGauge('other', 1), /Unregistered gauge/);
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => registry.setGauge('active_connections', value), RangeError);
  registry.increment('requests_total', Number.MAX_SAFE_INTEGER);
  assert.throws(() => registry.increment('requests_total'), /overflow/);
});

test('Prometheus escaping and empty exposition', () => {
  assert.equal(escapePrometheusText('a\\b"c\nd'), 'a\\\\b\\"c\\nd');
  assert.equal(new MetricsRegistry([]).renderPrometheus(), '');
});
