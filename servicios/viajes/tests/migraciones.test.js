const test = require('node:test');
const assert = require('node:assert/strict');
const {
  aplicarMigraciones,
  DIRECTORIO_MIGRACIONES
} = require('../src/infra/db/aplicar-migraciones');

test('aplica migraciones ordenadas y registra cada archivo', async () => {
  const consultas = [];
  const cliente = {
    async query(texto, parametros) {
      consultas.push({ texto, parametros });
      if (texto.includes('SELECT archivo FROM esquema_migraciones')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  const pool = {
    async query(texto, parametros) {
      consultas.push({ texto, parametros });
      return { rows: [], rowCount: 1 };
    },
    async connect() {
      return cliente;
    }
  };

  await aplicarMigraciones(pool);
  const archivosAplicados = consultas
    .filter(({ texto }) => texto.includes('INSERT INTO esquema_migraciones'))
    .map(({ parametros }) => parametros[0]);
  assert.deepEqual(archivosAplicados, [
    '001-viajes-idempotencia.sql',
    '002-esquema-plataforma.sql',
    '003-eventos-procesados.sql',
    '004-eventos-outbox.sql',
    '005-invariantes-concurrencia.sql',
    '006-identidad-flota-ubicacion.sql',
    '007-viajes-tarifas-pagos.sql'
  ]);
  assert.ok(consultas.some(({ texto }) => texto.includes('CREATE TABLE IF NOT EXISTS eventos_procesados')));
  assert.ok(consultas.some(({ texto }) => texto.includes('CREATE TABLE IF NOT EXISTS eventos_outbox')));
  assert.ok(consultas.some(({ texto }) => texto.includes('pg_advisory_xact_lock')));
});
