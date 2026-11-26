INSERT INTO estados_viaje (codigo, descripcion, terminal)
VALUES ('CANCELLED_BY_OPERATOR', 'Trip cancelled by operator', TRUE)
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE historial_estados_viaje
  ADD COLUMN IF NOT EXISTS estado_previo VARCHAR(32)
    REFERENCES estados_viaje (codigo),
  ADD COLUMN IF NOT EXISTS penalidad_ars INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE historial_estados_viaje
    ADD CONSTRAINT historial_penalidad_no_negativa
    CHECK (penalidad_ars >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS historial_cancelaciones_actor_periodo_idx
  ON historial_estados_viaje (actor_id, ocurrido_en DESC)
  WHERE estado IN ('CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER');

CREATE TABLE IF NOT EXISTS bloqueos_cancelacion (
  usuario_id UUID PRIMARY KEY,
  bloqueado_hasta TIMESTAMPTZ,
  motivo VARCHAR(500),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
