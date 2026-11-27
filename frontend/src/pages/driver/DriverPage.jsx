import { useEffect, useRef, useState } from 'react';
import Field from '../../components/Field.jsx';
import { Detail } from '../../components/trips/TripComponents.jsx';
import { request } from '../../services/api.js';
import { DESTINATION, ORIGIN, statusLabel } from '../../utils/trips.js';

export default function DriverPage({ session, notify, driverStatus, setDriverStatus, driverTrip, setDriverTrip, loadDriverStatus }) {
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [locationMode, setLocationMode] = useState('');
  const watchId = useRef(null);

  useEffect(() => {
    if (!sharing || !driverTrip) return undefined;
    if (locationMode === 'gps') {
      if (!navigator.geolocation) {
        setSharing(false);
        setLocationMode('');
        notify('Este navegador no ofrece geolocalización.', 'error');
        return undefined;
      }
      watchId.current = navigator.geolocation.watchPosition(async ({ coords }) => {
        try {
          await request(`/api/v1/conductores/${encodeURIComponent(session.user.id)}/ubicacion`, {
            method: 'POST', token: session.accessToken,
            body: { latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy }
          });
        } catch (error) {
          setSharing(false);
          setLocationMode('');
          notify(error.message, 'error');
        }
      }, (error) => {
        setSharing(false);
        setLocationMode('');
        notify(error.message || 'Se perdió la señal GPS.', 'error');
      }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 });
      return () => {
        if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      };
    }
    let progress = 0;
    const origin = driverTrip.origin || ORIGIN;
    const destination = driverTrip.destination || DESTINATION;
    const sendPoint = async () => {
      const latitude = origin.latitude + (destination.latitude - origin.latitude) * progress;
      const longitude = origin.longitude + (destination.longitude - origin.longitude) * progress;
      try {
        await request(`/api/v1/conductores/${encodeURIComponent(session.user.id)}/ubicacion`, {
          method: 'POST', token: session.accessToken, body: { latitude, longitude, accuracyMeters: 8 }
        });
        progress = progress >= 1 ? 0 : progress + .08;
      } catch (error) {
        setSharing(false);
        setLocationMode('');
        notify(error.message, 'error');
      }
    };
    sendPoint();
    const timer = setInterval(sendPoint, 3000);
    return () => clearInterval(timer);
  }, [sharing, locationMode, driverTrip, session.accessToken, session.user.id, notify]);

  const status = driverStatus || {};
  const onTripForm = async (event) => {
    event.preventDefault();
    const id = new FormData(event.currentTarget).get('tripId').trim();
    setBusy(true);
    try {
      const result = await request(`/api/v1/viajes/${encodeURIComponent(id)}/asignacion`, { method: 'POST', token: session.accessToken });
      setDriverTrip(result);
      notify('¡Viaje aceptado! El pasajero ya puede seguirte.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const createProfile = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await request('/api/v1/conductores/perfil', { method: 'POST', token: session.accessToken, body: data });
      notify('Perfil de chofer creado.');
      await loadDriverStatus();
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const addVehicle = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await request('/api/v1/conductores/vehiculos', {
        method: 'POST', token: session.accessToken,
        body: { plate: data.plate, brand: data.brand, model: data.model, year: Number(data.year), capacity: 4 }
      });
      notify('Vehículo registrado.');
      await loadDriverStatus();
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const toggleAvailability = async () => {
    const available = !status.available;
    try {
      const result = await request(`/api/v1/conductores/${encodeURIComponent(session.user.id)}/disponibilidad`, {
        method: 'PATCH', token: session.accessToken, body: { available }
      });
      setDriverStatus(result);
      notify(available ? 'Ahora figurás como disponible.' : 'Dejaste de estar disponible.');
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const advance = async () => {
    const next = ({ ASSIGNED: 'DRIVER_ARRIVING', DRIVER_ARRIVING: 'IN_PROGRESS', IN_PROGRESS: 'COMPLETED' })[driverTrip?.status];
    if (!next) return;
    try {
      const result = await request(`/api/v1/viajes/${encodeURIComponent(driverTrip.id)}/estado`, {
        method: 'PATCH', token: session.accessToken,
        body: { status: next, ...(next === 'COMPLETED' ? { distanceKm: 5.2, durationMinutes: 18 } : {}) }
      });
      setDriverTrip(result);
      if (next === 'COMPLETED') {
        setSharing(false);
        setLocationMode('');
      }
      notify(next === 'COMPLETED' ? 'Viaje finalizado.' : `Estado actualizado: ${statusLabel(next)}.`);
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  const toggleDemoLocation = () => {
    if (sharing) {
      setSharing(false);
      setLocationMode('');
      notify('Se detuvo el envío de ubicación.');
      return;
    }
    setLocationMode('demo');
    setSharing(true);
    notify('Simulación iniciada: el pasajero verá moverse el marcador.');
  };

  const startGps = () => {
    if (!navigator.geolocation) {
      notify('Este navegador no ofrece geolocalización.', 'error');
      return;
    }
    if (sharing) {
      setSharing(false);
      setLocationMode('');
      return;
    }
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        await request(`/api/v1/conductores/${encodeURIComponent(session.user.id)}/ubicacion`, {
          method: 'POST', token: session.accessToken,
          body: { latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy }
        });
        setLocationMode('gps');
        setSharing(true);
        notify('Compartiendo ubicación GPS.');
      } catch (error) {
        notify(error.message, 'error');
      }
    }, (error) => notify(error.message || 'No se pudo acceder al GPS.', 'error'), {
      enableHighAccuracy: true, timeout: 10000
    });
  };

  const enabled = status.enabled === true;
  const ready = Boolean(status.vehicleRegistered);
  return <>
    <div className={`banner${enabled && status.available ? ' banner-success' : ''}`}><span>{enabled && status.available ? '✓' : '!'}</span><div><strong>{enabled && status.available ? 'Estás disponible para viajar' : 'Completá la configuración de chofer'}</strong>{enabled && status.available ? 'Compartí tu ID de chofer con el pasajero para que pueda asignarte un viaje en esta demo.' : 'Necesitás completar tu perfil, registrar el vehículo y que un administrador habilite la cuenta.'}</div></div>
    <div className="two-column">
      <section className="card card-pad">
        <div className="card-header"><div><span className="step-label">TU CUENTA</span><h2 className="card-title" style={{ marginTop: 7 }}>Preparación del chofer</h2><p className="card-subtitle">Un paso por cada requisito.</p></div></div>
        <div className="checklist">
          <CheckRow done={status.profileExists === true} label="Perfil de chofer" />
          <CheckRow done={ready} label="Vehículo registrado" />
          <CheckRow done={enabled} label="Habilitación administrativa" />
        </div>
        {status.profileExists === false && <form className="form-grid" onSubmit={createProfile}>
          <Field label="Número de licencia"><input name="licenseNumber" required placeholder="LIC-000000" /></Field>
          <Field label="Vencimiento de licencia"><input name="licenseExpiresAt" type="date" required /></Field>
          <button className="button button-primary field-full" type="submit">Crear perfil</button>
        </form>}
        {status.profileExists && !ready && <form className="form-grid" onSubmit={addVehicle}>
          <Field label="Patente"><input name="plate" required placeholder="AB 123 CD" /></Field>
          <Field label="Marca"><input name="brand" required placeholder="Toyota" /></Field>
          <Field label="Modelo"><input name="model" required placeholder="Etios" /></Field>
          <Field label="Año"><input name="year" type="number" min="1950" max="2200" defaultValue="2022" required /></Field>
          <button className="button button-primary field-full" type="submit">Registrar vehículo</button>
        </form>}
        {enabled && <div className="switch-row"><div className="switch-copy"><strong>Disponibilidad</strong><span>{status.available ? 'Aceptás solicitudes de viaje.' : 'Activá tu disponibilidad para recibir viajes.'}</span></div><button className={`switch${status.available ? ' is-on' : ''}`} type="button" role="switch" aria-checked={Boolean(status.available)} onClick={toggleAvailability} /></div>}
        {!enabled && ready && <div className="banner"><span>i</span><div>Pedile al administrador que habilite tu perfil con tu ID: <strong>{session.user.id}</strong></div></div>}
        <button className="text-button" type="button" onClick={loadDriverStatus}>Actualizar estado de la cuenta</button>
      </section>
      <section className="card card-pad">
        <div className="card-header"><div><span className="step-label">VIAJE COMPARTIDO</span><h2 className="card-title" style={{ marginTop: 7 }}>Unite a un recorrido</h2><p className="card-subtitle">Pedile al pasajero el ID de su viaje.</p></div></div>
        <form className="trip-id-entry" onSubmit={onTripForm}><Field label="ID del viaje"><input name="tripId" required placeholder="UUID del viaje" /></Field><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Aceptando…' : 'Aceptar viaje'}</button></form>
        {driverTrip ? <div className="driver-current-trip">
          <div className="banner banner-success"><span>✓</span><div><strong>{statusLabel(driverTrip.status)}</strong>{driverTrip.origin?.address} → {driverTrip.destination?.address}</div></div>
          {({ ASSIGNED: ['Ya estoy en camino', 'DRIVER_ARRIVING'], DRIVER_ARRIVING: ['Iniciar viaje', 'IN_PROGRESS'], IN_PROGRESS: ['Finalizar viaje', 'COMPLETED'] })[driverTrip.status] && <button className="button button-primary" type="button" onClick={advance}>{({ ASSIGNED: 'Ya estoy en camino', DRIVER_ARRIVING: 'Iniciar viaje', IN_PROGRESS: 'Finalizar viaje' })[driverTrip.status]} →</button>}
          {driverTrip.status !== 'COMPLETED' && <div className="location-actions">
            <span>{sharing ? locationMode === 'gps' ? 'Compartiendo GPS en tiempo real.' : 'Posición simulada cada 3 segundos.' : 'Compartí GPS real o simulá el recorrido.'}</span>
            <div className="location-buttons">
              <button className="button button-ghost small-button" type="button" onClick={toggleDemoLocation}>{sharing ? 'Detener' : 'Simular'}</button>
              <button className="button button-ghost small-button" type="button" onClick={startGps}>{sharing && locationMode === 'gps' ? 'Detener GPS' : 'Usar GPS'}</button>
            </div>
          </div>}
        </div> : <div className="empty-state"><div><span className="empty-icon">↗</span><strong>Tu recorrido aparecerá acá</strong><p>Al aceptar, podés avanzar sus etapas desde esta pantalla.</p></div></div>}
      </section>
    </div>
  </>;
}

function CheckRow({ done, label }) {
  return <div className={`check-row${done ? ' is-complete' : ''}`}><span className="check-mark">{done ? '✓' : '·'}</span>{label} {done ? 'completo' : 'pendiente'}</div>;
}
