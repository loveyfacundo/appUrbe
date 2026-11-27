import { useState } from 'react';
import Field from '../../components/Field.jsx';
import { CopyButton, Guidance, LocationField, TripCard } from '../../components/trips/TripComponents.jsx';
import { request } from '../../services/api.js';
import { dateLabel, EMPTY_LOCATION, money } from '../../utils/trips.js';

export default function PassengerPage({ session, notify, trip, setTrip, setActiveTrip, loadTrip, quote, setQuote }) {
  const [origin, setOrigin] = useState({ ...EMPTY_LOCATION });
  const [destination, setDestination] = useState({ ...EMPTY_LOCATION });
  const [busy, setBusy] = useState(false);

  function updatePoint(setPoint, key, value) {
    setPoint((current) => ({ ...current, [key]: value }));
    setQuote(null);
  }

  async function getQuote(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const estimate = await request('/api/v1/tarifas/estimacion', {
        method: 'POST',
        token: session.accessToken,
        body: {
          origin: { ...origin, latitude: Number(origin.latitude), longitude: Number(origin.longitude) },
          destination: { ...destination, latitude: Number(destination.latitude), longitude: Number(destination.longitude) }
        }
      });
      setQuote({
        ...estimate,
        origin: { ...origin, latitude: Number(origin.latitude), longitude: Number(origin.longitude) },
        destination: { ...destination, latitude: Number(destination.latitude), longitude: Number(destination.longitude) }
      });
      notify('Estimación calculada correctamente.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createTrip() {
    if (!quote) return;
    setBusy(true);
    try {
      const result = await request('/api/v1/viajes', {
        method: 'POST', token: session.accessToken,
        body: { origin: quote.origin, destination: quote.destination, scheduledAt: null }
      });
      setActiveTrip(result);
      setQuote(null);
      notify('Viaje solicitado. Compartí el ID con el chofer para esta demo.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function useLocation() {
    if (!navigator.geolocation) return notify('Este navegador no ofrece geolocalización.', 'error');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setOrigin((current) => ({ ...current, address: 'Mi ubicación actual', latitude: coords.latitude, longitude: coords.longitude }));
      setQuote(null);
      notify('Origen actualizado con tu ubicación.');
    }, (error) => notify(error.message || 'No se pudo obtener tu ubicación.', 'error'), { enableHighAccuracy: true, timeout: 10000 });
  }

  async function openSharedTrip(event) {
    event.preventDefault();
    await loadTrip(new FormData(event.currentTarget).get('tripId').trim());
  }

  return <>
    <div className="content-grid">
      <section className="card card-pad">
        <div className="card-header"><div><span className="step-label">PASO 01 · NUEVO VIAJE</span><h2 className="card-title" style={{ marginTop: 7 }}>Elegí tu recorrido</h2><p className="card-subtitle">La tarifa se estima en el servidor.</p></div><span className="status-badge">Auto</span></div>
        <form onSubmit={getQuote}>
          <div className="location-fields">
            <LocationField type="origin" label="Punto de partida" point={origin} onChange={(key, value) => updatePoint(setOrigin, key, value)} />
            <LocationField type="destination" label="¿A dónde vamos?" point={destination} onChange={(key, value) => updatePoint(setDestination, key, value)} />
          </div>
          <button className="inline-action location-action" type="button" onClick={useLocation}>◎ Usar mi ubicación actual</button>
          {quote && <><div className="fare-box"><span>Estimación del viaje</span><strong className="fare-amount">{money(quote.amount, quote.currency)}</strong></div><p className="fare-footnote">Estimación válida hasta {dateLabel(quote.expiresAt)}. El monto final puede variar según el recorrido real.</p></>}
          <button className="button button-primary button-wide" type="submit" disabled={busy}><span>{busy ? 'Calculando…' : quote ? 'Actualizar estimación' : 'Calcular estimación'}</span><span>↗</span></button>
          {quote && <button className="button button-secondary button-wide" type="button" disabled={busy} onClick={createTrip}>Confirmar y solicitar viaje <span>→</span></button>}
        </form>
      </section>
      <div><TripCard trip={trip} /><section className="card card-pad guidance-card"><div className="card-header"><div><span className="step-label">SEGUIMIENTO</span><h2 className="card-title" style={{ marginTop: 7 }}>El viaje, paso a paso</h2></div></div><Guidance trip={trip} /></section></div>
    </div>
    <div className="lower-grid">
      <section className="card card-pad"><div className="card-header"><div><span className="step-label">ACCESO RÁPIDO</span><h2 className="card-title" style={{ marginTop: 7 }}>¿Ya tenés un ID?</h2><p className="card-subtitle">Abrí el seguimiento de un viaje compartido con vos.</p></div></div>
        <form className="trip-id-entry" onSubmit={openSharedTrip}><Field label="ID del viaje"><input name="tripId" required placeholder="UUID del viaje" /></Field><button className="button button-ghost" type="submit">Ver viaje</button></form>
      </section>
      {trip && <section className="card card-pad"><div className="card-header"><div><span className="step-label">VIAJE ACTIVO</span><h2 className="card-title" style={{ marginTop: 7 }}>Compartí el ID con tu chofer</h2><p className="card-subtitle">En esta demo, el pasajero comparte el viaje manualmente.</p></div></div><div className="trip-summary-top"><code className="trip-id">{trip.id}</code><CopyButton value={trip.id} notify={notify} /></div><div className="trip-note">Luego el chofer acepta tu viaje desde su panel.</div></section>}
    </div>
  </>;
}
