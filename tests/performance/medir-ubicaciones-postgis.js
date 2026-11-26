const crypto = require('node:crypto');
const { Pool } = require('pg');
const { aplicarMigraciones } = require('../../servicios/viajes/src/infra/db/aplicar-migraciones');

async function medir() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('Define TEST_DATABASE_URL para ejecutar la medición PostGIS');
  }

  const esquema = `medir_geo_${crypto.randomUUID().replace(/-/g, '')}`;
  const poolAdministrativo = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let pool;
  try {
    await poolAdministrativo.query(`CREATE SCHEMA ${esquema}`);
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${esquema},public`
    });
    await aplicarMigraciones(pool);
    await pool.query(`
      INSERT INTO conductores
        (id, usuario_id, licencia_numero, licencia_expira_en, disponible, activo)
      SELECT md5(i::text)::uuid, md5(i::text)::uuid, 'LIC-' || i,
             DATE '2035-01-01', TRUE, TRUE
        FROM generate_series(1, 10000) AS series(i)
    `);
    await pool.query(`
      INSERT INTO vehiculos
        (id, conductor_id, patente, marca, modelo, anio, capacidad, activo)
      SELECT md5('vehiculo-' || i)::uuid, md5(i::text)::uuid, 'PAT-' || i,
             'Marca', 'Modelo', 2024, 4, TRUE
        FROM generate_series(1, 10000) AS series(i)
    `);
    await pool.query(`
      INSERT INTO ubicaciones
        (conductor_id, latitud, longitud, precision_metros, posicion, registrada_en)
      SELECT md5(i::text)::uuid,
             CASE WHEN i % 100 = 0 THEN ((i / 100) % 5 - 2) / 10000.0
                  ELSE -80 + (i * 37 % 16000) / 100.0 END,
             CASE WHEN i % 100 = 0 THEN ((i / 100) % 5 - 2) / 10000.0
                  ELSE -180 + (i * 71 % 36000) / 100.0 END,
             5,
             ST_SetSRID(ST_MakePoint(
               CASE WHEN i % 100 = 0 THEN ((i / 100) % 5 - 2) / 10000.0
                    ELSE -180 + (i * 71 % 36000) / 100.0 END,
               CASE WHEN i % 100 = 0 THEN ((i / 100) % 5 - 2) / 10000.0
                    ELSE -80 + (i * 37 % 16000) / 100.0 END
             ), 4326)::geography,
             NOW()
        FROM generate_series(1, 10000) AS series(i)
    `);
    await pool.query('ANALYZE ubicaciones');
    await pool.query('ANALYZE conductores');
    await pool.query('ANALYZE vehiculos');
    const resultado = await pool.query(`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT c.id,
             ST_Distance(
               u.posicion,
               ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography
             ) AS distancia_metros
        FROM ubicaciones u
        JOIN conductores c ON c.id = u.conductor_id
        JOIN vehiculos v ON v.conductor_id = c.id AND v.activo = TRUE
       WHERE c.activo = TRUE
         AND c.disponible = TRUE
         AND u.registrada_en > NOW() - INTERVAL '15 seconds'
         AND ST_DWithin(
           u.posicion,
           ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography,
           5000
         )
       ORDER BY distancia_metros, c.id
    `);
    console.log(resultado.rows.map((fila) => fila['QUERY PLAN']).join('\n'));
  } finally {
    if (pool) await pool.end();
    await poolAdministrativo.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
    await poolAdministrativo.end();
  }
}

medir().catch((error) => {
  console.error('Falló la medición PostGIS', error);
  process.exitCode = 1;
});
