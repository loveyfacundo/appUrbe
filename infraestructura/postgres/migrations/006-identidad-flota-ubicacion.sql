ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS rol VARCHAR(16) NOT NULL DEFAULT 'pasajero',
  ADD COLUMN IF NOT EXISTS permisos TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_rol_valido;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_valido
  CHECK (rol IN ('pasajero', 'chofer', 'operador', 'administrador'));

CREATE INDEX IF NOT EXISTS usuarios_rol_idx ON usuarios (rol);
