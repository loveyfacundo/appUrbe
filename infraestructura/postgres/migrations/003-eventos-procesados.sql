CREATE TABLE IF NOT EXISTS eventos_procesados (
  event_id UUID PRIMARY KEY,
  tipo_evento VARCHAR(100) NOT NULL,
  procesado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
