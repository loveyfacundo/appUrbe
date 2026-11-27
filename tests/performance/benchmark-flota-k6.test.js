const assert = require('node:assert/strict');
const test = require('node:test');
const { extraerResultadosK6 } = require('./benchmark-flota-k6');

test('extrae percentiles y tasas de las métricas de k6', () => {
  const resultado = extraerResultadosK6({
    metrics: {
      http_reqs: { values: { count: 100, rate: 25 } },
      benchmark_http_failures: { values: { count: 5 } },
      trip_requests: { values: { count: 10 } },
      successful_journeys: { values: { count: 8 } },
      trip_request_latency_ms: { values: { 'p(50)': 12, 'p(95)': 30 } }
    }
  });

  assert.deepEqual(resultado.requestLatencyMs, { p50: 12, p95: 30, p99: null });
  assert.equal(resultado.totalRequestsPerSecond, 25);
  assert.equal(resultado.httpFailureRate, 0.05);
  assert.equal(resultado.successfulJourneyRate, 0.8);
});

test('usa valores seguros cuando k6 no reporta métricas', () => {
  const resultado = extraerResultadosK6({});

  assert.equal(resultado.httpFailures, 0);
  assert.equal(resultado.httpFailureRate, null);
  assert.equal(resultado.tripRequests, 0);
  assert.equal(resultado.successfulJourneyRate, null);
  assert.deepEqual(resultado.timeToAssignmentMs, { p50: null, p95: null, p99: null });
});
