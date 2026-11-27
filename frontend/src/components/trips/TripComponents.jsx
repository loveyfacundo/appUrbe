import { TRIP_STEPS, dateLabel, statusLabel, statusTone } from '../../utils/trips.js';

export function LocationField({ type, label, point, onChange }) {
  return <div className="location-field">
    <div className="location-indicator"><span className={`location-dot${type === 'destination' ? ' destination' : ''}`} />{type === 'origin' && <span className="location-connector" />}</div>
    <label className="field"><span>{label}</span>
      <input value={point.address} minLength="3" maxLength="200" required onChange={(event) => onChange('address', event.target.value)} />
      <span className="coordinate-row">
        <input aria-label={`Latitud de ${label.toLowerCase()}`} type="number" step="any" min="-90" max="90" value={point.latitude} required onChange={(event) => onChange('latitude', event.target.value)} />
        <input aria-label={`Longitud de ${label.toLowerCase()}`} type="number" step="any" min="-180" max="180" value={point.longitude} required onChange={(event) => onChange('longitude', event.target.value)} />
      </span>
    </label>
  </div>;
}

export function TripCard({ trip }) {
  return <article className="card trip-card">
    <div className="map-top"><div><h2 className="card-title">Tu recorrido</h2><p className="card-subtitle">{trip ? trip.driverId ? 'Seguimos el viaje mientras avanza.' : 'El chofer todavía no fue asignado.' : 'El mapa se activa cuando confirmás el viaje.'}</p></div><span className={`status-badge${trip ? ` status-${statusTone(trip.status)}` : ''}`}>{trip ? statusLabel(trip.status) : 'Sin viaje activo'}</span></div>
    {trip ? <>
      <div className="map-canvas"><SchematicMap trip={trip} /></div>
      <div className="map-legend"><span className="legend-item"><i className="legend-swatch" />Origen</span><span className="legend-item"><i className="legend-swatch legend-swatch-end" />Destino</span>{trip.driverId && <span className="legend-item"><i className="legend-swatch legend-swatch-driver" />Chofer</span>}</div>
      <p className="schematic-note">Vista esquemática; no es una ruta vial ni un mapa cartográfico.</p>
    </> : <div className="map-empty">
      <span className="empty-icon">⌖</span>
      <strong>El recorrido aparecerá al solicitar un viaje</strong>
      <p>Ingresá el origen y destino para ver el trayecto.</p>
    </div>}
    {trip ? <div className="trip-summary">
      <div className="trip-summary-top"><code className="trip-id">{trip.id}</code><span className="trip-time">{dateLabel(trip.updatedAt)}</span></div>
      <div className="timeline" aria-label="Progreso del viaje">{TRIP_STEPS.map(([status, label], index) => {
        const progress = TRIP_STEPS.findIndex(([value]) => value === trip.status);
        const failed = ['NO_DRIVERS_AVAILABLE', 'CANCELLED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER'].includes(trip.status);
        const done = !failed && progress >= index && progress >= 0;
        return <div key={status} className={`timeline-step${done ? ' is-done' : ''}${progress === index && !failed ? ' is-current' : ''}`}><span className="timeline-point" /><span>{label}</span></div>;
      })}</div>
      <div className="trip-summary-top"><span className="card-subtitle">{trip.origin?.address} → {trip.destination?.address}</span><CopyButton value={trip.id} notify={() => {}} /></div>
    </div> : <div className="empty-state"><div><span className="empty-icon">↗</span><strong>Tu próximo viaje empieza acá</strong><p>Ingresá origen y destino para recibir una estimación.</p></div></div>}
  </article>;
}

function SchematicMap({ trip }) {
  const origin = trip.origin;
  const destination = trip.destination;
  const minLat = Math.min(origin.latitude, destination.latitude) - .008;
  const maxLat = Math.max(origin.latitude, destination.latitude) + .008;
  const minLon = Math.min(origin.longitude, destination.longitude) - .01;
  const maxLon = Math.max(origin.longitude, destination.longitude) + .01;
  const project = (point) => ({
    x: 30 + ((point.longitude - minLon) / (maxLon - minLon || 1)) * 640,
    y: 30 + ((maxLat - point.latitude) / (maxLat - minLat || 1)) * 230
  });
  const start = project(origin);
  const end = project(destination);
  const driver = trip?.location ? project(trip.location) : null;
  const cp1 = { x: start.x + (end.x - start.x) * .38, y: start.y - 65 };
  const cp2 = { x: start.x + (end.x - start.x) * .72, y: end.y + 55 };
  return <>
    <svg className="map-svg" viewBox="0 0 700 300" role="img" aria-label="Vista esquemática del recorrido">
      <path className="map-road" d="M 0 82 Q 180 130 300 58 T 720 60 M 0 245 Q 170 200 330 230 T 720 180 M 120 0 Q 145 100 118 160 T 140 300 M 500 0 Q 465 100 525 170 T 480 300" />
      <path className="map-route-shadow" d={`M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`} />
      <path className="map-route" d={`M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`} />
      <circle className="map-marker-origin" cx={start.x} cy={start.y} r="8" />
      <rect className="map-marker-destination" x={end.x - 7} y={end.y - 7} width="14" height="14" rx="3" transform={`rotate(45 ${end.x} ${end.y})`} />
      {driver && <><circle className="map-driver-pulse" cx={driver.x} cy={driver.y} r="19" /><circle className="map-marker-driver" cx={driver.x} cy={driver.y} r="9" /></>}
    </svg>
    <span className="map-label map-label-origin">{origin.address || 'Origen'}</span><span className="map-label map-label-destination">{destination.address || 'Destino'}</span>
    <span className="map-status"><i className="live-dot" />{driver ? 'Posición actualizada' : 'Esperando posición del chofer'}</span>
  </>;
}

export function Guidance({ trip }) {
  if (!trip) return <div className="empty-state compact-empty"><div><strong>Seguimiento en tiempo real</strong><p>Al crear un viaje, el estado y la posición se actualizarán aquí.</p></div></div>;
  return <>
    <Detail label="Estado actual">{statusLabel(trip.status)}</Detail>
    <Detail label="Chofer asignado">{trip.driverId ? `${trip.driverId.slice(0, 8)}…` : 'Pendiente'}</Detail>
    <Detail label="Última ubicación">{trip.location ? `${Number(trip.location.latitude).toFixed(4)}, ${Number(trip.location.longitude).toFixed(4)}` : 'Aún no disponible'}</Detail>
    <Detail label="Actualizado">{dateLabel(trip.updatedAt)}</Detail>
    {trip.status === 'NO_DRIVERS_AVAILABLE' && <div className="banner"><span>!</span><div><strong>No encontramos un chofer</strong>Podés volver a intentar cuando haya conductores disponibles.</div></div>}
  </>;
}

export function Detail({ label, children }) {
  return <div className="detail-row"><span>{label}</span><strong>{children}</strong></div>;
}

export function CopyButton({ value, notify }) {
  return <button className="inline-action" type="button" onClick={async () => {
    try {
      await navigator.clipboard.writeText(value);
      notify('ID del viaje copiado.');
    } catch {
      notify(value);
    }
  }}>Copiar ID</button>;
}
