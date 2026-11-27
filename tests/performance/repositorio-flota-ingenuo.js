const {
  RepositorioFlotaPostgres,
  calcularDistanciaMetros
} = require('../../servicios/conductores/src/repositorio-flota');
const { RETENCION_UBICACION_MS } = require('../../servicios/conductores/src/politica-ubicaciones');

class RepositorioFlotaPostgresIngenuo extends RepositorioFlotaPostgres {
  async buscarCercanos({ latitude, longitude, radiusMeters }) {
    const resultado = await this.pool.query(
      `SELECT c.id AS conductor_id, u.latitud, u.longitud
         FROM ubicaciones u
         JOIN conductores c ON c.id = u.conductor_id
         JOIN vehiculos v ON v.conductor_id = c.id AND v.activo = TRUE
        WHERE c.activo = TRUE
          AND c.disponible = TRUE
          AND u.registrada_en > NOW() - ($1::double precision * INTERVAL '1 millisecond')`,
      [RETENCION_UBICACION_MS]
    );

    return resultado.rows
      .map((fila) => ({
        driverId: fila.conductor_id,
        distanceMeters: calcularDistanciaMetros(
          latitude,
          longitude,
          Number(fila.latitud),
          Number(fila.longitud)
        )
      }))
      .filter((candidato) => candidato.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters || a.driverId.localeCompare(b.driverId));
  }
}

module.exports = { RepositorioFlotaPostgresIngenuo };
