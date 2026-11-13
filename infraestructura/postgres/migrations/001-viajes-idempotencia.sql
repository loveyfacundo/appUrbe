CREATE TABLE IF NOT EXISTS viajes (
  id UUID PRIMARY KEY,
  pasajero_id UUID NOT NULL,
  conductor_id UUID,
  origen JSONB NOT NULL,
  destino JSONB NOT NULL,
  fecha_programada TIMESTAMPTZ,
  estado VARCHAR(32) NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS viajes_pasajero_id_idx ON viajes (pasajero_id);
CREATE INDEX IF NOT EXISTS viajes_estado_idx ON viajes (estado);

CREATE TABLE IF NOT EXISTS idempotencia (
  clave VARCHAR(255) PRIMARY KEY,
  huella TEXT NOT NULL,
  respuesta JSONB NOT NULL,
  expira_en TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idempotencia_expira_en_idx ON idempotencia (expira_en);
