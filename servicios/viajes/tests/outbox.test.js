const test = require('node:test');
const assert = require('node:assert/strict');
const { RepositorioOutboxPostgres } = require('../src/infra/db/outbox');
const { DespachadorOutbox } = require('../src/infra/mensajeria/despachador-outbox');

const evento = {
  eventId: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
  eventType: 'TripStarted',
  eventVersion: 1,
  occurredAt: '2026-11-14T20:00:00.000Z',
  correlationId: '8d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
  causationId: null,
  producer: 'viajes',
  payload: {
    tripId: '9d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    driverId: '6d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    status: 'IN_PROGRESS',
    startedAt: '2026-11-14T20:00:00.000Z'
  }
};

test('outbox reclama eventos vencidos con locking distribuido', async () => {
  const llamadas = [];
  const pool = {
    async query(texto, parametros) {
      llamadas.push({ texto, parametros });
      return {
        rows: [{
          event_id: evento.eventId,
          event_type: evento.eventType,
          event_version: evento.eventVersion,
          occurred_at: new Date(evento.occurredAt),
          correlation_id: evento.correlationId,
          causation_id: null,
          producer: evento.producer,
          payload: evento.payload
        }]
      };
    }
  };
  const repositorio = new RepositorioOutboxPostgres({ pool });
  const [reclamado] = await repositorio.reclamar();
  assert.deepEqual(reclamado, evento);
  assert.match(llamadas[0].texto, /FOR UPDATE SKIP LOCKED/);
  assert.match(llamadas[0].texto, /bloqueado_hasta/);
  assert.deepEqual(llamadas[0].parametros, [25, 30000]);
});

test('despachador conserva eventos ante falla y los reintenta', async () => {
  let pendiente = true;
  let intentos = 0;
  let marcados = 0;
  const repositorio = {
    async reclamar() {
      if (!pendiente) return [];
      pendiente = false;
      return [evento];
    },
    async marcarPublicado(id) {
      assert.equal(id, evento.eventId);
      marcados += 1;
    },
    async liberar(id) {
      assert.equal(id, evento.eventId);
      pendiente = true;
    },
    async pendientes() {
      return pendiente ? 1 : 0;
    }
  };
  const publicador = {
    async publicar(eventoPublicado) {
      assert.deepEqual(eventoPublicado, evento);
      intentos += 1;
      if (intentos === 1) throw new Error('broker offline');
    }
  };
  const despachador = new DespachadorOutbox({
    repositorio,
    publicador,
    intervaloMs: 10000
  });
  await despachador.iniciar();
  assert.equal(pendiente, true);
  assert.equal(marcados, 0);

  await despachador.drenar();
  assert.equal(pendiente, false);
  assert.equal(marcados, 1);
  assert.equal(intentos, 2);
  await despachador.cerrar();
});
