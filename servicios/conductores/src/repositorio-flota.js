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
    if (!habilitado) perfil.disponible = false;
    return perfil;
  }

  async establecerDisponibilidad(conductorId, disponible) {
    const perfil = this.perfiles.get(conductorId);
    if (!perfil || !perfil.habilitado || (disponible && !this.vehiculos.has(conductorId))) {
      return null;
    }
    perfil.disponible = disponible;
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
    if (!perfil?.disponible) return null;
    this.ubicaciones.set(ubicacion.conductorId, ubicacion);
    return ubicacion;
  }

  async buscarUbicacion(conductorId) {
    return this.ubicaciones.get(conductorId) || null;
  }

  async listarDisponibles() {
    return [...this.perfiles.values()]
      .filter((perfil) => perfil.habilitado && perfil.disponible)
      .map((perfil) => ({
        ...perfil,
        vehicle: this.vehiculos.get(perfil.id) || null,
        location: this.ubicaciones.get(perfil.id) || null
      }));
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
      `UPDATE conductores
          SET activo = $2,
              disponible = CASE WHEN $2 THEN disponible ELSE FALSE END,
              actualizado_en = NOW()
        WHERE id = $1
        RETURNING id, usuario_id, licencia_numero, licencia_expira_en, disponible, activo`,
      [conductorId, habilitado]
    );
    return convertirPerfil(resultado.rows[0]);
  }

  async establecerDisponibilidad(conductorId, disponible) {
    const resultado = await this.pool.query(
      `UPDATE conductores c
          SET disponible = $2, actualizado_en = NOW()
        WHERE c.id = $1
          AND c.activo = TRUE
          AND ($2 = FALSE OR EXISTS (
            SELECT 1 FROM vehiculos v
             WHERE v.conductor_id = c.id AND v.activo = TRUE
          ))
        RETURNING c.id, c.usuario_id, c.licencia_numero, c.licencia_expira_en,
                  c.disponible, c.activo`,
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
    const resultado = await this.pool.query(
      `INSERT INTO ubicaciones
        (conductor_id, latitud, longitud, precision_metros)
       SELECT c.id, $2, $3, $4
         FROM conductores c
        WHERE c.id = $1 AND c.activo = TRUE AND c.disponible = TRUE
       RETURNING conductor_id, latitud, longitud, precision_metros, registrada_en`,
      [
        ubicacion.conductorId,
        ubicacion.latitude,
        ubicacion.longitude,
        ubicacion.accuracyMeters
      ]
    );
    if (resultado.rowCount === 0) return null;
    return convertirUbicacion(resultado.rows[0]);
  }

  async buscarUbicacion(conductorId) {
    const resultado = await this.pool.query(
      `SELECT conductor_id, latitud, longitud, precision_metros, registrada_en
         FROM ubicaciones
        WHERE conductor_id = $1
        ORDER BY registrada_en DESC, id DESC
        LIMIT 1`,
      [conductorId]
    );
    return convertirUbicacion(resultado.rows[0]);
  }

  async listarDisponibles() {
    const resultado = await this.pool.query(
      `SELECT c.id, c.usuario_id, c.licencia_numero, c.licencia_expira_en,
              c.disponible, c.activo,
              v.id AS vehiculo_id, v.patente, v.marca, v.modelo, v.anio, v.capacidad,
              u.latitud, u.longitud, u.precision_metros, u.registrada_en
         FROM conductores c
         JOIN vehiculos v
           ON v.conductor_id = c.id AND v.activo = TRUE
         LEFT JOIN LATERAL (
           SELECT latitud, longitud, precision_metros, registrada_en
             FROM ubicaciones
            WHERE conductor_id = c.id
            ORDER BY registrada_en DESC, id DESC
            LIMIT 1
         ) u ON TRUE
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
      }),
      location: convertirUbicacion(fila.latitud === null ? null : {
        conductor_id: fila.id,
        latitud: fila.latitud,
        longitud: fila.longitud,
        precision_metros: fila.precision_metros,
        registrada_en: fila.registrada_en
      })
    }));
  }
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
