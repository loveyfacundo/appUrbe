CREATE TABLE IF NOT EXISTS eventos_outbox (
  event_id UUID PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  event_version SMALLINT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  correlation_id UUID,
  causation_id UUID,
  producer VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  publicado_en TIMESTAMPTZ,
  bloqueado_hasta TIMESTAMPTZ,
  intentos INTEGER NOT NULL DEFAULT 0,
  ultimo_error VARCHAR(100),
  CONSTRAINT eventos_outbox_version_valida CHECK (event_version > 0),
  CONSTRAINT eventos_outbox_intentos_validos CHECK (intentos >= 0)
);

CREATE INDEX IF NOT EXISTS eventos_outbox_pendientes_idx
  ON eventos_outbox (creado_en)
  WHERE publicado_en IS NULL;
