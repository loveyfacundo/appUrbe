INSERT INTO estados_viaje (codigo, descripcion, terminal) VALUES
  ('CANCELLED_BY_PASSENGER', 'Trip cancelled by passenger', TRUE),
  ('CANCELLED_BY_DRIVER', 'Trip cancelled by driver', TRUE)
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS distancia_real_km NUMERIC(8, 3),
  ADD COLUMN IF NOT EXISTS tiempo_real_min INTEGER,
  ADD COLUMN IF NOT EXISTS monto_estimado INTEGER,
  ADD COLUMN IF NOT EXISTS monto_final INTEGER,
  ADD COLUMN IF NOT EXISTS moneda CHAR(3) DEFAULT 'ARS';
