const test = require('node:test');
const assert = require('node:assert/strict');
const { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const {
  PARAMETROS_CONSULTA_SENSIBLES,
  crearInstrumentaciones,
  iniciarTelemetria,
  registrarMetricasRuntime
} = require('../observabilidad/opentelemetry');

test('mantiene OpenTelemetry desactivado si no se habilita', async () => {
  const cerrar = iniciarTelemetria({ OTEL_ENABLED: 'false' });

  await assert.doesNotReject(cerrar);
});

test('exige endpoint y credencial antes de habilitar el envío', () => {
  assert.throws(
    () => iniciarTelemetria({
      OTEL_ENABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.test/otlp',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic <completar-solo-localmente>'
    }),
    /OTEL_ENABLED=true requiere/
  );
});

test('configura redacción de parámetros sensibles en spans de cliente y servidor', () => {
  const [httpInstrumentacion] = crearInstrumentaciones();
  const config = httpInstrumentacion.getConfig();

  for (const parametro of ['latitude', 'longitude', 'token', 'password', 'Signature']) {
    assert.ok(config.redactedQueryParams.includes(parametro));
    assert.ok(config.redactedQueryParamsServer.includes(parametro));
  }
  assert.deepEqual(config.redactedQueryParams, [...PARAMETROS_CONSULTA_SENSIBLES]);
  assert.deepEqual(config.redactedQueryParamsServer, [...PARAMETROS_CONSULTA_SENSIBLES]);
});

test('iniciarTelemetria inicia y exporta métricas de runtime con entorno válido', async () => {
  const exportador = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const lector = new PeriodicExportingMetricReader({
    exporter: exportador,
    exportIntervalMillis: 60000
  });

  const cerrar = iniciarTelemetria({
    OTEL_ENABLED: 'true',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dGVzdDp0ZXN0'
  }, {
    metricReader: lector
  });

  await assert.doesNotReject(cerrar);
  await assert.doesNotReject(cerrar);
});

test('registrarMetricasRuntime expone lag del event loop y memoria del proceso', async () => {
  const exportador = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const lector = new PeriodicExportingMetricReader({
    exporter: exportador,
    exportIntervalMillis: 60000
  });
  const provider = new MeterProvider({ readers: [lector] });

  const detener = registrarMetricasRuntime(provider.getMeter('appurbe-runtime-test'));
  try {
    await lector.forceFlush();
    const metricas = exportador.getMetrics()
      .flatMap((recurso) => recurso.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .map((metrica) => metrica.descriptor.name);

    assert.ok(metricas.includes('nodejs.eventloop.delay.p99'));
    assert.ok(metricas.includes('nodejs.eventloop.delay.max'));
    assert.ok(metricas.includes('process.memory.rss'));
    assert.ok(metricas.includes('process.memory.heap_used'));
  } finally {
    detener();
    await provider.shutdown();
  }
});
