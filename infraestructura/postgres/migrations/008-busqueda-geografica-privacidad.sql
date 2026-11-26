CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE ubicaciones
  ADD COLUMN IF NOT EXISTS posicion GEOGRAPHY(Point, 4326);

DELETE FROM ubicaciones actual
USING ubicaciones anterior
WHERE actual.conductor_id = anterior.conductor_id
  AND (
    actual.registrada_en < anterior.registrada_en
    OR (actual.registrada_en = anterior.registrada_en AND actual.id < anterior.id)
  );

DELETE FROM ubicaciones u
 WHERE u.registrada_en <= NOW() - INTERVAL '15 seconds'
    OR NOT EXISTS (
      SELECT 1
        FROM conductores c
       WHERE c.id = u.conductor_id
         AND c.activo = TRUE
         AND c.disponible = TRUE
    );

UPDATE ubicaciones
   SET posicion = ST_SetSRID(ST_MakePoint(longitud, latitud), 4326)::geography
 WHERE posicion IS NULL;

ALTER TABLE ubicaciones
  ALTER COLUMN posicion SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ubicaciones_conductor_actual_unico_idx
  ON ubicaciones (conductor_id);

DROP INDEX IF EXISTS ubicaciones_conductor_fecha_idx;

CREATE INDEX IF NOT EXISTS ubicaciones_posicion_gist_idx
  ON ubicaciones USING GIST (posicion);

CREATE INDEX IF NOT EXISTS ubicaciones_registrada_en_idx
  ON ubicaciones (registrada_en);
