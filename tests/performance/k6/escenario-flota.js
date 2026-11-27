import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const fixtures = JSON.parse(open(__ENV.BENCH_FIXTURE_PATH));
const driverCount = Number(__ENV.BENCH_DRIVER_COUNT || fixtures.drivers.length);
const assignmentVus = Number(__ENV.BENCH_ASSIGNMENT_VUS || 1);
const duration = `${Number(__ENV.BENCH_DURATION_SECONDS || 180)}s`;

const locationRequests = new Counter('driver_location_requests');
const locationFailures = new Counter('driver_location_failures');
const locationLatency = new Trend('driver_location_latency_ms');
const tripRequests = new Counter('trip_requests');
const tripRequestFailures = new Counter('trip_request_failures');
const tripRequestLatency = new Trend('trip_request_latency_ms');
const candidateSearchLatency = new Trend('candidate_search_latency_ms');
const assignmentRequests = new Counter('trip_assignment_requests');
const assignmentFailures = new Counter('trip_assignment_failures');
const assignmentLatency = new Trend('trip_assignment_latency_ms');
const timeToAssignment = new Trend('time_to_assignment_ms');
const healthLatency = new Trend('health_endpoint_latency_ms');
const httpFailures = new Counter('benchmark_http_failures');
const successfulJourneys = new Counter('successful_journeys');

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)', 'p(99)'],
  scenarios: {
    location_updates: {
      executor: 'constant-vus',
      vus: driverCount,
      duration,
      exec: 'actualizarUbicaciones'
    },
    trip_dispatch: {
      executor: 'constant-vus',
      vus: assignmentVus,
      duration,
      startTime: '1s',
      exec: 'solicitarYAsignar'
    },
    health_probe: {
      executor: 'constant-vus',
      vus: 2,
      duration,
      exec: 'medirHealth'
    }
  }
};

function headers(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-correlation-id': __ENV.BENCH_RUN_ID,
    ...extra
  };
}

function comprobar(respuesta, estado, etiqueta) {
  return check(respuesta, {
    [etiqueta]: (res) => res.status === estado
  });
}

function solicitarViaje(driver, passenger, indice, clave) {
  const origen = {
    latitude: driver.latitude,
    longitude: driver.longitude,
    address: `Origen de prueba ${indice}`
  };
  const destino = {
    latitude: driver.latitude + 0.001,
    longitude: driver.longitude + 0.001,
    address: `Destino de prueba ${indice}`
  };
  const respuesta = http.post(
    `${__ENV.BENCH_BASE_URL}/api/v1/viajes`,
    JSON.stringify({ origin: origen, destination: destino }),
    {
      headers: headers(passenger.token, { 'idempotency-key': clave }),
      tags: { endpoint: 'trip_request' }
    }
  );
  tripRequests.add(1);
  tripRequestLatency.add(respuesta.timings.duration);
  if (comprobar(respuesta, 201, 'viaje_solicitado')) return respuesta.json();

  tripRequestFailures.add(1);
  httpFailures.add(1);
  if (indice === 0) {
    console.error(`Trip request failed: HTTP ${respuesta.status} ${String(respuesta.body).slice(0, 300)}`);
  }
  return null;
}

function buscarConductor(driver) {
  const query = `latitude=${driver.latitude}&longitude=${driver.longitude}&radiusMeters=100`;
  const respuesta = http.get(
    `${__ENV.BENCH_BASE_URL}/api/v1/conductores/disponibles/cercanos?${query}`,
    {
      headers: headers(fixtures.admin.token),
      tags: { endpoint: 'nearby_drivers' }
    }
  );
  candidateSearchLatency.add(respuesta.timings.duration);
  if (!comprobar(respuesta, 200, 'candidatos_encontrados')) {
    assignmentFailures.add(1);
    httpFailures.add(1);
    return false;
  }

  if (respuesta.json().some((candidato) => candidato.driverId === driver.id)) return true;
  assignmentFailures.add(1);
  return false;
}

function asignarViaje(viaje, driver, clave) {
  const respuesta = http.post(
    `${__ENV.BENCH_BASE_URL}/api/v1/viajes/${viaje.id}/asignacion`,
    null,
    {
      headers: headers(driver.token, { 'idempotency-key': clave }),
      tags: { endpoint: 'trip_assignment' }
    }
  );
  assignmentRequests.add(1);
  assignmentLatency.add(respuesta.timings.duration);
  if (comprobar(respuesta, 200, 'viaje_asignado')) return true;

  assignmentFailures.add(1);
  httpFailures.add(1);
  return false;
}

export function actualizarUbicaciones() {
  if (__ITER === 0) sleep(((__VU - 1) * 2) / driverCount);
  const driver = fixtures.drivers[(__VU - 1) % fixtures.drivers.length];
  const inicio = Date.now();
  const respuesta = http.post(
    `${__ENV.BENCH_BASE_URL}/api/v1/conductores/${driver.id}/ubicacion`,
    JSON.stringify({
      latitude: driver.latitude,
      longitude: driver.longitude,
      accuracyMeters: 8
    }),
    { headers: headers(driver.token), tags: { endpoint: 'driver_location' } }
  );
  const duracionMs = Date.now() - inicio;
  locationRequests.add(1);
  locationLatency.add(respuesta.timings.duration);
  if (!comprobar(respuesta, 200, 'ubicacion_actualizada')) {
    locationFailures.add(1);
    httpFailures.add(1);
    if (__VU === 1 && __ITER === 0) {
      console.error(`Location update failed: HTTP ${respuesta.status} ${String(respuesta.body).slice(0, 300)}`);
    }
  }

  const esperaMs = 2000 - duracionMs;
  if (esperaMs > 0) sleep(esperaMs / 1000);
}

export function solicitarYAsignar() {
  const indice = __ITER;
  if (indice >= fixtures.drivers.length) {
    sleep(1);
    return;
  }

  const driver = fixtures.drivers[indice];
  const passenger = fixtures.passengers[
    Number(__ENV.BENCH_PASSENGER_INDEX || 0) % fixtures.passengers.length
  ];
  const inicio = Date.now();
  const clave = driver.id;
  const viaje = solicitarViaje(driver, passenger, indice, clave);
  if (!viaje || !buscarConductor(driver) || !asignarViaje(viaje, driver, clave)) {
    sleep(1);
    return;
  }

  timeToAssignment.add(Date.now() - inicio);
  successfulJourneys.add(1);
  sleep(1);
}

export function medirHealth() {
  const respuesta = http.get(`${__ENV.BENCH_BASE_URL}/health`, {
    tags: { endpoint: 'health' }
  });
  healthLatency.add(respuesta.timings.duration);
  if (!comprobar(respuesta, 200, 'health_disponible')) httpFailures.add(1);
  sleep(0.25);
}
