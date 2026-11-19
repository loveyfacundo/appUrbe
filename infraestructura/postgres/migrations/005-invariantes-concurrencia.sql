CREATE UNIQUE INDEX IF NOT EXISTS viajes_un_conductor_activo_idx
  ON viajes (conductor_id)
  WHERE conductor_id IS NOT NULL
    AND estado IN ('ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS');
