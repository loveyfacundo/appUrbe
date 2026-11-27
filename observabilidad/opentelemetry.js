const { monitorEventLoopDelay } = require('node:perf_hooks');

const PARAMETROS_CONSULTA_SENSIBLES = Object.freeze([
  'sig',
  'Signature',
  'AWSAccessKeyId',
  'X-Goog-Signature',
  'X-Amz-Signature',
  'X-Amz-Credential',
  'X-Amz-Security-Token',
  'latitude',
  'longitude',
  'token',
  'access_token',
  'authorization',
  'password'
]);

function validarConfiguracion(entorno) {
  const endpoint = entorno.OTEL_EXPORTER_OTLP_ENDPOINT;
  const headers = entorno.OTEL_EXPORTER_OTLP_HEADERS;

  if (!endpoint || !headers || /<[^>]*>|placeholder|completar-solo-localmente/i.test(headers)) {
    throw new Error(
      'OTEL_ENABLED=true requiere OTEL_EXPORTER_OTLP_ENDPOINT y un OTEL_EXPORTER_OTLP_HEADERS real'
    );
  }

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT debe ser una URL válida');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT debe usar HTTP o HTTPS');
  }
}

function crearOpcionesExportador(entorno, rutaSenal) {
  if (entorno === process.env) return undefined;
  const { parseKeyPairsIntoRecord } = require('@opentelemetry/core');
  const base = entorno.OTEL_EXPORTER_OTLP_ENDPOINT.endsWith('/')
    ? entorno.OTEL_EXPORTER_OTLP_ENDPOINT
    : `${entorno.OTEL_EXPORTER_OTLP_ENDPOINT}/`;
  return {
    url: new URL(rutaSenal, base).href,
    headers: parseKeyPairsIntoRecord(entorno.OTEL_EXPORTER_OTLP_HEADERS)
  };
}

function crearInstrumentaciones() {
  const { AmqplibInstrumentation } = require('@opentelemetry/instrumentation-amqplib');
  const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');

  const parametrosRedactados = [...PARAMETROS_CONSULTA_SENSIBLES];
  return [
    new HttpInstrumentation({
      redactedQueryParams: parametrosRedactados,
      redactedQueryParamsServer: parametrosRedactados
    }),
    new ExpressInstrumentation(),
    new PgInstrumentation(),
    new AmqplibInstrumentation()
  ];
}

function registrarMetricasRuntime(meter) {
  const histogramaLag = monitorEventLoopDelay({ resolution: 10 });
  histogramaLag.enable();

  const lagP99 = meter.createObservableGauge('nodejs.eventloop.delay.p99', {
    description: 'Percentil 99 del retraso del event loop de Node.js.',
    unit: 'ms'
  });

  const lagMaximo = meter.createObservableGauge('nodejs.eventloop.delay.max', {
    description: 'Retraso máximo observado del event loop de Node.js.',
    unit: 'ms'
  });

  const observarLag = (resultado) => {
    try {
      resultado.observe(lagP99, histogramaLag.percentile(99) / 1e6);
      resultado.observe(lagMaximo, histogramaLag.max / 1e6);
    } finally {
      histogramaLag.reset();
    }
  };
  const metricasLag = [lagP99, lagMaximo];
  meter.addBatchObservableCallback(observarLag, metricasLag);

  meter.createObservableGauge('process.memory.rss', {
    description: 'Memoria residente (RSS) del proceso Node.js.',
    unit: 'By'
  }).addCallback((resultado) => {
    resultado.observe(process.memoryUsage().rss);
  });

  meter.createObservableGauge('process.memory.heap_used', {
    description: 'Memoria heap utilizada del proceso Node.js.',
    unit: 'By'
  }).addCallback((resultado) => {
    resultado.observe(process.memoryUsage().heapUsed);
  });

  return () => {
    meter.removeBatchObservableCallback(observarLag, metricasLag);
    histogramaLag.disable();
  };
}

function iniciarTelemetria(entorno = process.env, opciones = {}) {
  if (entorno.OTEL_ENABLED !== 'true') return async () => {};

  validarConfiguracion(entorno);

  const { metrics } = require('@opentelemetry/api');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
  const { NodeSDK } = require('@opentelemetry/sdk-node');

  const sdk = new NodeSDK({
    traceExporter: opciones.traceExporter || new OTLPTraceExporter(
      crearOpcionesExportador(entorno, 'v1/traces')
    ),
    metricReader: opciones.metricReader || new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(crearOpcionesExportador(entorno, 'v1/metrics'))
    }),
    instrumentations: crearInstrumentaciones()
  });

  sdk.start();
  const detenerMetricasRuntime = registrarMetricasRuntime(metrics.getMeter('appurbe-runtime'));

  let cierre;
  return () => {
    if (!cierre) {
      detenerMetricasRuntime();
      cierre = sdk.shutdown();
    }
    return cierre;
  };
}

module.exports = {
  PARAMETROS_CONSULTA_SENSIBLES,
  crearInstrumentaciones,
  iniciarTelemetria,
  registrarMetricasRuntime
};
