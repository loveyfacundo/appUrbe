const test = require('node:test');
const assert = require('node:assert/strict');
const { BloqueadorRedis } = require('../src/infra/redis/bloqueador-redis');
const { DependenciaNoDisponible } = require('../src/dominio/errores/errores');

test('el bloqueo Redis usa vencimiento y libera solo con su token', async () => {
  const llamadas = [];
  const client = {
    isReady: true,
    async set(...argumentos) {
      llamadas.push({ comando: 'set', argumentos });
      return 'OK';
    },
    async eval(...argumentos) {
      llamadas.push({ comando: 'eval', argumentos });
    }
  };
  const bloqueador = new BloqueadorRedis({ client });
  const resultado = await bloqueador.ejecutar('idempotencia:usuario:clave', async () => 'ok');
  assert.equal(resultado, 'ok');
  assert.deepEqual(llamadas[0].argumentos[2], {
    NX: true,
    PX: 10000
  });
  assert.match(llamadas[1].argumentos[0], /redis\.call\("get", KEYS\[1\]\) == ARGV\[1\]/);
  assert.equal(llamadas[1].argumentos[1].arguments[0].length, 36);
});

test('Redis real aplica TTL y permite adquirir el bloqueo después del vencimiento', {
  skip: !process.env.TEST_REDIS_URL
}, async () => {
  const { createClient } = require('redis');
  const client = createClient({ url: process.env.TEST_REDIS_URL });
  client.on('error', () => {});
  await client.connect();
  const clave = `test:appurbe:lock:${require('node:crypto').randomUUID()}`;
  const bloqueador = new BloqueadorRedis({
    client,
    tiempoVidaMs: 200,
    intentos: 1
  });
  try {
    await bloqueador.ejecutar(clave, async () => {
      assert.ok(await client.pTTL(clave) > 0);
      await assert.rejects(
        () => bloqueador.ejecutar(clave, async () => {}),
        DependenciaNoDisponible
      );
      await new Promise((resolve) => setTimeout(resolve, 220));
      assert.equal(await client.get(clave), null);
    });
    await bloqueador.ejecutar(clave, async () => {
      assert.equal(await client.get(clave) !== null, true);
    });
  } finally {
    await client.del(clave);
    await client.quit();
  }
});
