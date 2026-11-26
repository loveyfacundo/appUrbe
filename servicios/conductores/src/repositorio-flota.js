const {
  RETENCION_UBICACION_MS
} = require('./politica-ubicaciones');

class RepositorioFlotaMemoria {
  constructor() {
    this.perfiles = new Map();
    this.vehiculos = new Map();
    this.ubicaciones = new Map();
  }

  async guardarPerfil(perfil) {
    this.perfiles.set(perfil.id, perfil);
    return perfil;
  }

  async establecerHabilitacion(conductorId, habilitado) {
    const perfil = this.perfiles.get(conductorId);
    if (!perfil) return null;
    perfil.habilitado = habilitado;
    if (!habilitado) {
      perfil.disponible = false;
      this.ubicaciones.delete(conductorId);
    }
    return perfil;
  }

  async establecerDisponibilidad(conductorId, disponible) {
    const perfil = this.perfiles.get(conductorId);
    if (!perfil || !perfil.habilitado || (disponible && !this.vehiculos.has(conductorId))) {
      return null;
    }
    perfil.disponible = disponible;
    if (!disponible) this.ubicaciones.delete(conductorId);
    return perfil;
  }

  async buscarPerfil(id) {
    return this.perfiles.get(id) || null;
  }

  async buscarPerfilPorUsuario(usuarioId) {
    return [...this.perfiles.values()].find((perfil) => perfil.usuarioId === usuarioId) || null;
  }

  async guardarVehiculo(vehiculo) {
    this.vehiculos.set(vehiculo.conductorId, vehiculo);
    return vehiculo;
  }

  async buscarVehiculo(conductorId) {
    return this.vehiculos.get(conductorId) || null;
  }

  async guardarUbicacion(ubicacion) {
    const perfil = this.perfiles.get(ubicacion.conductorId);
    if (!perfil?.habilitado || !perfil.disponible) return null;
    this.ubicaciones.set(ubicacion.conductorId, ubicacion);
    return ubicacion;
  }

  async buscarUbicacion(conductorId) {
    const ubicacion = this.ubicaciones.get(conductorId);
    if (!ubicacion) return null;
    const registradaEn = Date.parse(ubicacion.recordedAt);
    if (!Number.isFinite(registradaEn) ||
        Date.now() - registradaEn >= RETENCION_UBICACION_MS) {
      this.ubicaciones.delete(conductorId);
      return null;
    }
    return ubicacion;
  }

  async listarDisponibles() {
    return [...this.perfiles.values()]
      .filter((perfil) => perfil.habilitado && perfil.disponible)
      .map((perfil) => ({
        ...perfil,
        vehicle: this.vehiculos.get(perfil.id) || null
      }));
  }

  async buscarCercanos({ latitude, longitude, radiusMeters }) {
    const candidatos = [];
    for (const perfil of this.perfiles.values()) {
      if (!perfil.habilitado || !perfil.disponible || !this.vehiculos.has(perfil.id)) continue;
      const ubicacion = await this.buscarUbicacion(perfil.id);
      if (!ubicacion) continue;
      const distanceMeters = calcularDistanciaMetros(
        latitude,
        longitude,
        ubicacion.latitude,
        ubicacion.longitude
      );
      if (distanceMeters <= radiusMeters) {
        candidatos.push({ driverId: perfil.id, distanceMeters });
      }
    }
    return candidatos.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  async eliminarUbicacionesVencidas() {
    const limite = Date.now() - RETENCION_UBICACION_MS;
    for (const [conductorId, ubicacion] of this.ubicaciones) {
      const registradaEn = Date.parse(ubicacion.recordedAt);
      if (!Number.isFinite(registradaEn) || registradaEn <= limite) {
        this.ubicaciones.delete(conductorId);
      }
    }
  }
}

class RepositorioFlotaPostgres {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') {
      throw new TypeError('RepositorioFlotaPostgres requiere un pool PostgreSQL');
    }
    this.pool = pool;
  }

  async guardarPerfil(perfil) {
    const resultado = await this.pool.query(
      `INSERT INTO conductores
        (id, usuario_id, licencia_numero, licencia_expira_en, disponible, activo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, usuario_id, licencia_numero, licencia_expira_en, disponible, activo`,
      [
        perfil.id,
        perfil.usuarioId,
        perfil.licenseNumber,
        perfil.licenseExpiresAt,
        perfil.disponible,
        perfil.habilitado
      ]
    );
    return convertirPerfil(resultado.rows[0]);
  }

  async establecerHabilitacion(conductorId, habilitado) {
    const resultado = await this.pool.query(
      `WITH actualizado AS (
       UPDATE conductores
          SET activo = $2,
              disponible = CASE WHEN $2 THEN disponible ELSE FALSE END,
              actualizado_en = NOW()
        WHERE id = $1
        RETURNING id, usuario_id, licencia_numero, licencia_expira_en, disponible, activo
       ), ubicacion_borrada AS (
         DELETE FROM ubicaciones u
          USING actualizado a
          WHERE a.id = u.conductor_id AND a.activo = FALSE
          RETURNING u.conductor_id
       )
       SELECT * FROM actualizado`,
      [conductorId, habilitado]
    );
    return convertirPerfil(resultado.rows[0]);
  }

  async establecerDisponibilidad(conductorId, disponible) {
    const resultado = await this.pool.query(
      `WITH actualizado AS (
       UPDATE conductores c
          SET disponible = $2, actualizado_en = NOW()
        WHERE c.id = $1
          AND c.activo = TRUE
          AND ($2 = FALSE OR EXISTS (
            SELECT 1 FROM vehiculos v
             WHERE v.conductor_id = c.id AND v.activo = TRUE
          ))
        RETURNING c.id, c.usuario_id, c.licencia_numero, c.licencia_expira_en,
                  c.disponible, c.activo
       ), ubicacion_borrada AS (
         DELETE FROM ubicaciones u
          USING actualizado a
          WHERE a.id = u.conductor_id AND a.disponible = FALSE
          RETURNING u.conductor_id
       )
       SELECT * FROM actualizado`,
      [conductorId, disponible]
    );
    return convertirPerfil(resultado.rows[0]);
  }

  async buscarPerfil(id) {
    const resultado = await this.pool.query(
      `SELECT id, usuario_id, licencia_numero, licencia_expira_en, disponible, activo
         FROM conductores
        WHERE id = $1`,
      [id]
    );
    return convertirPerfil(resultado.rows[0]);
  }

  async buscarPerfilPorUsuario(usuarioId) {
    const resultado = await this.pool.query(
      `SELECT id, usuario_id, licencia_numero, licencia_expira_en, disponible, activo
         FROM conductores
        WHERE usuario_id = $1`,
      [usuarioId]
    );
    return convertirPerfil(resultado.rows[0]);
  }

  async guardarVehiculo(vehiculo) {
    const resultado = await this.pool.query(
      `INSERT INTO vehiculos
        (id, conductor_id, patente, marca, modelo, anio, capacidad, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (conductor_id) DO UPDATE SET
         patente = EXCLUDED.patente,
         marca = EXCLUDED.marca,
         modelo = EXCLUDED.modelo,
         anio = EXCLUDED.anio,
         capacidad = EXCLUDED.capacidad,
         activo = TRUE,
         actualizado_en = NOW()
       RETURNING id, conductor_id, patente, marca, modelo, anio, capacidad`,
      [
        vehiculo.id,
        vehiculo.conductorId,
        vehiculo.plate,
        vehiculo.brand,
        vehiculo.model,
        vehiculo.year,
        vehiculo.capacity
      ]
    );
    return convertirVehiculo(resultado.rows[0]);
  }

  async buscarVehiculo(conductorId) {
    const resultado = await this.pool.query(
      `SELECT id, conductor_id, patente, marca, modelo, anio, capacidad
         FROM vehiculos
        WHERE conductor_id = $1 AND activo = TRUE`,
      [conductorId]
    );
    return convertirVehiculo(resultado.rows[0]);
  }

  async guardarUbicacion(ubicacion) {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const conductor = await cliente.query(
        `SELECT id FROM conductores
          WHERE id = $1 AND activo = TRUE AND disponible = TRUE
          FOR UPDATE`,
        [ubicacion.conductorId]
      );
      if (conductor.rowCount === 0) {
        await cliente.query('COMMIT');
        return null;
      }
      const resultado = await cliente.query(
        `INSERT INTO ubicaciones
          (conductor_id, latitud, longitud, precision_metros, posicion, registrada_en)
         VALUES (
           $1, $2, $3, $4,
           ST_SetSRID(
             ST_MakePoint($3::numeric::double precision, $2::numeric::double precision),
             4326
           )::geography,
           NOW()
         )
         ON CONFLICT (conductor_id) DO UPDATE SET
           latitud = EXCLUDED.latitud,
           longitud = EXCLUDED.longitud,
           precision_metros = EXCLUDED.precision_metros,
           posicion = EXCLUDED.posicion,
           registrada_en = EXCLUDED.registrada_en
         RETURNING conductor_id, latitud, longitud, precision_metros, registrada_en`,
        [
          ubicacion.conductorId,
          ubicacion.latitude,
          ubicacion.longitude,
          ubicacion.accuracyMeters
        ]
      );
      await cliente.query('COMMIT');
      return convertirUbicacion(resultado.rows[0]);
    } catch (error) {
      await cliente.query('ROLLBACK');
      throw error;
    } finally {
      cliente.release();
    }
  }

  async buscarUbicacion(conductorId) {
    const resultado = await this.pool.query(
      `SELECT conductor_id, latitud, longitud, precision_metros, registrada_en
         FROM ubicaciones
        WHERE conductor_id = $1
          AND registrada_en > NOW() - ($2::double precision * INTERVAL '1 millisecond')`,
      [conductorId, RETENCION_UBICACION_MS]
    );
    return convertirUbicacion(resultado.rows[0]);
  }

  async listarDisponibles() {
    const resultado = await this.pool.query(
      `SELECT c.id, c.usuario_id, c.licencia_numero, c.licencia_expira_en,
              c.disponible, c.activo,
              v.id AS vehiculo_id, v.patente, v.marca, v.modelo, v.anio, v.capacidad
         FROM conductores c
         JOIN vehiculos v
           ON v.conductor_id = c.id AND v.activo = TRUE
        WHERE c.activo = TRUE AND c.disponible = TRUE
        ORDER BY c.id`
    );
    return resultado.rows.map((fila) => ({
      ...convertirPerfil(fila),
      vehicle: convertirVehiculo({
        id: fila.vehiculo_id,
        conductor_id: fila.id,
        patente: fila.patente,
        marca: fila.marca,
        modelo: fila.modelo,
        anio: fila.anio,
        capacidad: fila.capacidad
      })
    }));
  }

  async buscarCercanos({ latitude, longitude, radiusMeters }) {
    const resultado = await this.pool.query(
      `SELECT c.id AS conductor_id,
              ST_Distance(
                u.posicion,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
              ) AS distancia_metros
         FROM ubicaciones u
         JOIN conductores c
           ON c.id = u.conductor_id
         JOIN vehiculos v
           ON v.conductor_id = c.id AND v.activo = TRUE
        WHERE c.activo = TRUE
          AND c.disponible = TRUE
          AND u.registrada_en > NOW() - ($4::double precision * INTERVAL '1 millisecond')
          AND ST_DWithin(
            u.posicion,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3::double precision
          )
        ORDER BY distancia_metros, c.id`,
      [longitude, latitude, radiusMeters, RETENCION_UBICACION_MS]
    );
    return resultado.rows.map((fila) => ({
      driverId: fila.conductor_id,
      distanceMeters: Number(fila.distancia_metros)
    }));
  }

  async eliminarUbicacionesVencidas() {
    await this.pool.query(
      `DELETE FROM ubicaciones
        WHERE registrada_en <= NOW() - ($1::double precision * INTERVAL '1 millisecond')`,
      [RETENCION_UBICACION_MS]
    );
  }
}

function calcularDistanciaMetros(latitudA, longitudA, latitudB, longitudB) {
  const radioTierraMetros = 6371008.8;
  const aLatitud = latitudA * Math.PI / 180;
  const bLatitud = latitudB * Math.PI / 180;
  const diferenciaLatitud = (latitudB - latitudA) * Math.PI / 180;
  const diferenciaLongitud = (longitudB - longitudA) * Math.PI / 180;
  const a = Math.sin(diferenciaLatitud / 2) ** 2 +
    Math.cos(aLatitud) * Math.cos(bLatitud) *
    Math.sin(diferenciaLongitud / 2) ** 2;
  const fraccion = Math.min(1, Math.max(0, a));
  return 2 * radioTierraMetros * Math.atan2(Math.sqrt(fraccion), Math.sqrt(1 - fraccion));
}

function convertirPerfil(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    usuarioId: fila.usuario_id,
    licenseNumber: fila.licencia_numero,
    licenseExpiresAt: fila.licencia_expira_en instanceof Date
      ? fila.licencia_expira_en.toISOString().slice(0, 10)
      : String(fila.licencia_expira_en).slice(0, 10),
    disponible: fila.disponible,
    habilitado: fila.activo
  };
}

function convertirVehiculo(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    conductorId: fila.conductor_id,
    plate: fila.patente,
    brand: fila.marca,
    model: fila.modelo,
    year: fila.anio,
    capacity: fila.capacidad
  };
}

function convertirUbicacion(fila) {
  if (!fila) return null;
  return {
    conductorId: fila.conductor_id,
    latitude: Number(fila.latitud),
    longitude: Number(fila.longitud),
    accuracyMeters: fila.precision_metros === null ? null : Number(fila.precision_metros),
    recordedAt: new Date(fila.registrada_en).toISOString()
  };
}

module.exports = { RepositorioFlotaMemoria, RepositorioFlotaPostgres };
