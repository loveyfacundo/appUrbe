const test = require('node:test');
const assert = require('node:assert/strict');
const { crearModuloViajes } = require('../src/composicion');
const { ConflictoDeEstado, OperacionNoPermitida, RecursoNoEncontrado } = require('../src/dominio/errores/errores');
const { PoliticaCancelaciones } = require('../src/dominio/politica-cancelaciones');
const { Viaje, ESTADOS } = require('../src/dominio/entidades/viaje');

const pasajero = '5a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
const otroUsuario = '8a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
const idCorrelacion = '9a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
const base = {
  origen: { latitud: -34.6037, longitud: -58.3816, direccion: 'Obelisco, CABA' },
  destino: { latitud: -34.6158, longitud: -58.4333, direccion: 'Palermo, CABA' }
};

async function solicitar(modulo, claveIdempotencia = 'clave-1') {
  return modulo.casosUso.solicitar.ejecutar({
    pasajeroId: pasajero,
    ...base,
    claveIdempotencia,
    idCorrelacion
  });
}

test('solicitar es idempotente y publica TripRequested', async () => {
  const modulo = crearModuloViajes();
  const first = await solicitar(modulo);
  const second = await solicitar(modulo);
  assert.deepEqual(second, first);
  assert.equal(modulo.publicador.eventos.length, 1);
  assert.equal(modulo.publicador.eventos[0].eventType, 'TripRequested');
});

test('rechaza reutilizar idempotencia con payload diferente', async () => {
  const modulo = crearModuloViajes();
  await solicitar(modulo);
  await assert.rejects(() => modulo.casosUso.solicitar.ejecutar({
    pasajeroId: pasajero,
    ...base,
    destino: { ...base.destino, direccion: 'Retiro, CABA' },
    claveIdempotencia: 'clave-1',
    idCorrelacion
  }), ConflictoDeEstado);
});

test('solo el propietario puede consultar y cancelar un viaje', async () => {
  const modulo = crearModuloViajes();
  const viaje = await solicitar(modulo);
  await assert.rejects(() => modulo.casosUso.obtener.ejecutar({
    identificadorViaje: viaje.identificador,
    actor: { identificador: otroUsuario, roles: [] }
  }), OperacionNoPermitida);
  const cancelado = await modulo.casosUso.cancelar.ejecutar({
    identificadorViaje: viaje.identificador,
    actor: { identificador: pasajero, roles: [] },
    motivo: 'Cambio de planes',
    claveIdempotencia: 'cancel-1',
    idCorrelacion
  });
  assert.equal(cancelado.estado, 'CANCELLED_BY_PASSENGER');
  assert.equal(cancelado.cancelacion.penalidadArs, 0);
  assert.equal(modulo.publicador.eventos[1].eventType, 'TripCancelled');
  assert.equal(modulo.publicador.eventos[1].payload.status, 'CANCELLED_BY_PASSENGER');
  assert.equal(modulo.publicador.eventos[1].payload.reason, 'Cambio de planes');
});

test('la cancelación exige un motivo válido también fuera del controlador HTTP', async () => {
  const modulo = crearModuloViajes();
  const viaje = await solicitar(modulo);
  await assert.rejects(
    () => modulo.casosUso.cancelar.ejecutar({
      identificadorViaje: viaje.identificador,
      actor: { identificador: pasajero, roles: [] },
      motivo: ' ',
      claveIdempotencia: 'cancel-invalid-reason',
      idCorrelacion
    }),
    (error) => error.name === 'ErrorDeValidacion'
  );
});

test('devuelve not found para un viaje inexistente', async () => {
  const modulo = crearModuloViajes();
  await assert.rejects(() => modulo.casosUso.obtener.ejecutar({
    identificadorViaje: '7d9f9e3e-4d4d-4c64-bc37-32f3d9b1ce4a',
    actor: { identificador: pasajero, roles: [] }
  }), RecursoNoEncontrado);
});

function crearViaje(estado, conductorId = null) {
  return new Viaje({
    identificador: crypto.randomUUID(),
    pasajeroId: pasajero,
    conductorId,
    origen: base.origen,
    destino: base.destino,
    estado
  });
}

test('la política de pasajero rechaza estados inválidos y calcula penalidad tras la llegada', () => {
  const politica = new PoliticaCancelaciones({ penalidadPasajeroAlLlegarArs: 2300 });
  const actor = { identificador: pasajero, roles: ['pasajero'] };
  for (const estado of [ESTADOS.SOLICITADO, ESTADOS.DESPACHANDO]) {
    const decision = politica.resolver({ viaje: crearViaje(estado), actor });
    assert.equal(decision.estadoFinal, ESTADOS.CANCELADO_PASAJERO);
    assert.equal(decision.penalidadArs, 0);
  }

  const llegada = politica.resolver({
    viaje: crearViaje(ESTADOS.EN_ORIGEN, otroUsuario),
    actor
  });
  assert.equal(llegada.penalidadArs, 2300);
  for (const estado of [
    ESTADOS.ASIGNADO,
    ESTADOS.EN_CURSO,
    ESTADOS.FINALIZADO,
    ESTADOS.SIN_CONDUCTOR,
    ESTADOS.CANCELADO,
    ESTADOS.CANCELADO_PASAJERO
  ]) {
    assert.throws(
      () => politica.resolver({ viaje: crearViaje(estado, otroUsuario), actor }),
      ConflictoDeEstado
    );
  }
});

test('solo el chofer asignado u operador autorizado cancela en sus estados permitidos', () => {
  const politica = new PoliticaCancelaciones();
  const conductorId = '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
  const conductor = { identificador: conductorId, roles: ['chofer'] };
  for (const estado of [ESTADOS.ASIGNADO, ESTADOS.EN_ORIGEN, ESTADOS.EN_CURSO]) {
    assert.equal(
      politica.resolver({
        viaje: crearViaje(estado, conductorId),
        actor: conductor
      }).estadoFinal,
      ESTADOS.CANCELADO_CHOFER
    );
  }
  assert.throws(
    () => politica.resolver({
      viaje: crearViaje(ESTADOS.ASIGNADO, conductorId),
      actor: { identificador: otroUsuario, roles: ['chofer'] }
    }),
    OperacionNoPermitida
  );
  assert.throws(
    () => politica.resolver({
      viaje: crearViaje(ESTADOS.SOLICITADO),
      actor: { identificador: otroUsuario, roles: ['operador'] }
    }),
    OperacionNoPermitida
  );
  assert.equal(
    politica.resolver({
      viaje: crearViaje(ESTADOS.EN_CURSO, conductorId),
      actor: {
        identificador: otroUsuario,
        roles: ['operador'],
        permisos: ['trips:cancel']
      }
    }).estadoFinal,
    ESTADOS.CANCELADO_OPERADOR
  );
  const operador = {
    identificador: otroUsuario,
    roles: ['operador'],
    permisos: ['trips:cancel']
  };
  for (const estado of [
    ESTADOS.SOLICITADO,
    ESTADOS.DESPACHANDO,
    ESTADOS.ASIGNADO,
    ESTADOS.EN_ORIGEN,
    ESTADOS.EN_CURSO
  ]) {
    assert.equal(
      politica.resolver({
        viaje: crearViaje(estado, conductorId),
        actor: operador
      }).estadoFinal,
      ESTADOS.CANCELADO_OPERADOR
    );
  }
  for (const estado of [
    ESTADOS.FINALIZADO,
    ESTADOS.SIN_CONDUCTOR,
    ESTADOS.CANCELADO_CHOFER,
    ESTADOS.CANCELADO_OPERADOR
  ]) {
    assert.throws(
      () => politica.resolver({ viaje: crearViaje(estado, conductorId), actor: operador }),
      ConflictoDeEstado
    );
  }
});

test('el límite bloquea solicitudes y asignaciones, pero permite resolver un viaje activo', async () => {
  const politicaCancelaciones = new PoliticaCancelaciones({
    limiteCancelaciones: 1,
    periodoCancelacionesMs: 60_000,
    bloqueoCancelacionesMs: 60_000,
    penalidadPasajeroAlLlegarArs: 750
  });
  const modulo = crearModuloViajes({ politicaCancelaciones });
  const primerViaje = await solicitar(modulo, 'limite-1');
  await modulo.casosUso.cancelar.ejecutar({
    identificadorViaje: primerViaje.identificador,
    actor: { identificador: pasajero, roles: ['pasajero'] },
    motivo: 'Cambio inicial',
    claveIdempotencia: 'limite-cancel-1',
    idCorrelacion
  });

  const viajeActivo = await modulo.casosUso.solicitar.ejecutar({
    pasajeroId: otroUsuario,
    ...base,
    claveIdempotencia: 'limite-2',
    idCorrelacion
  });
  await modulo.repositorio.asignarConductor({
    identificadorViaje: viajeActivo.identificador,
    conductorId: pasajero
  });
  await assert.rejects(
    () => modulo.casosUso.cancelar.ejecutar({
      identificadorViaje: viajeActivo.identificador,
      actor: { identificador: pasajero, roles: ['chofer'] },
      motivo: 'Excede límite',
      claveIdempotencia: 'limite-cancel-2',
      idCorrelacion
    }),
    (error) => error instanceof ConflictoDeEstado && /bloqueado.*hasta/.test(error.message)
  );
  await assert.rejects(
    () => solicitar(modulo, 'limite-3'),
    (error) => error instanceof ConflictoDeEstado && /bloqueado.*hasta/.test(error.message)
  );
  const viajePendiente = await modulo.casosUso.solicitar.ejecutar({
    pasajeroId: otroUsuario,
    ...base,
    claveIdempotencia: 'limite-4',
    idCorrelacion
  });
  await assert.rejects(
    () => modulo.repositorio.asignarConductor({
      identificadorViaje: viajePendiente.identificador,
      conductorId: pasajero
    }),
    (error) => error instanceof ConflictoDeEstado
  );

  const cancelacionActiva = await modulo.casosUso.cancelar.ejecutar({
    identificadorViaje: viajeActivo.identificador,
    actor: { identificador: pasajero, roles: ['chofer'] },
    motivo: 'Resolver viaje ya iniciado',
    claveIdempotencia: 'limite-cancel-activo',
    idCorrelacion
  });
  assert.equal(cancelacionActiva.estado, ESTADOS.CANCELADO_CHOFER);
  assert.equal(cancelacionActiva.cancelacion.penalidadArs, 0);
});

test('la penalidad configurada se aplica tras llegada y el reintento idempotente no duplica el efecto', async () => {
  const politicaCancelaciones = new PoliticaCancelaciones({
    penalidadPasajeroAlLlegarArs: 3450
  });
  const modulo = crearModuloViajes({ politicaCancelaciones });
  const viaje = await solicitar(modulo, 'fee-trip');
  const conductorId = '6a1d6a80-8fb2-4c6a-9c70-4e8d2fd2b765';
  await modulo.repositorio.asignarConductor({
    identificadorViaje: viaje.identificador,
    conductorId
  });
  await modulo.repositorio.actualizarEstadoOperativo({
    identificadorViaje: viaje.identificador,
    actorId: conductorId,
    estado: ESTADOS.EN_ORIGEN
  });
  const solicitud = {
    identificadorViaje: viaje.identificador,
    actor: { identificador: pasajero, roles: ['pasajero'] },
    motivo: 'Llegó el chofer',
    claveIdempotencia: 'penalty-once',
    idCorrelacion
  };
  const primera = await modulo.casosUso.cancelar.ejecutar(solicitud);
  const repetida = await modulo.casosUso.cancelar.ejecutar(solicitud);
  assert.equal(primera.cancelacion.penalidadArs, 3450);
  assert.deepEqual(repetida, primera);
  assert.equal(modulo.publicador.eventos.filter((evento) =>
    evento.eventType === 'TripCancelled').length, 1);
});

test('el límite de cancelaciones usa una ventana móvil', async () => {
  const politicaCancelaciones = new PoliticaCancelaciones({
    limiteCancelaciones: 1,
    periodoCancelacionesMs: 5,
    bloqueoCancelacionesMs: 1000
  });
  const modulo = crearModuloViajes({ politicaCancelaciones });
  const primera = await solicitar(modulo, 'ventana-1');
  await modulo.casosUso.cancelar.ejecutar({
    identificadorViaje: primera.identificador,
    actor: { identificador: pasajero, roles: ['pasajero'] },
    motivo: 'Primera cancelación',
    claveIdempotencia: 'ventana-cancel-1',
    idCorrelacion
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const segunda = await solicitar(modulo, 'ventana-2');
  const cancelacion = await modulo.casosUso.cancelar.ejecutar({
    identificadorViaje: segunda.identificador,
    actor: { identificador: pasajero, roles: ['pasajero'] },
    motivo: 'Fuera de la ventana',
    claveIdempotencia: 'ventana-cancel-2',
    idCorrelacion
  });
  assert.equal(cancelacion.estado, ESTADOS.CANCELADO_PASAJERO);
});
