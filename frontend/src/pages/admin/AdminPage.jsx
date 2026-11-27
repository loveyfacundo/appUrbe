import { useState } from 'react';
import Field from '../../components/Field.jsx';
import { Detail } from '../../components/trips/TripComponents.jsx';
import { request } from '../../services/api.js';

export default function AdminPage({ session, notify }) {
  const [driverId, setDriverId] = useState('');
  const [driver, setDriver] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function inspect(event) {
    event?.preventDefault();
    setBusy(true);
    setError('');
    try {
      setDriver(await request(`/api/v1/conductores/${encodeURIComponent(driverId)}/habilitacion`, { token: session.accessToken }));
    } catch (problem) {
      setError(problem.message);
      setDriver(null);
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    try {
      await request(`/api/v1/conductores/${encodeURIComponent(driverId)}/habilitacion`, {
        method: 'PATCH', token: session.accessToken, body: { enabled: true }
      });
      notify('Chofer habilitado.');
      await inspect();
    } catch (problem) {
      notify(problem.message, 'error');
    }
  }

  return <>
    <div className="banner"><span>i</span><div><strong>Preparación del recorrido</strong>El chofer crea su perfil y registra el vehículo. Ingresá su ID de usuario para autorizarlo.</div></div>
    <section className="card card-pad">
      <div className="card-header"><div><span className="step-label">REVISIÓN DE PERFIL</span><h2 className="card-title" style={{ marginTop: 7 }}>Habilitar chofer</h2><p className="card-subtitle">El ID se muestra en su cuenta; no es una contraseña.</p></div></div>
      <form className="admin-id-row" onSubmit={inspect}><Field label="ID del usuario chofer"><input value={driverId} onChange={(event) => setDriverId(event.target.value)} required placeholder="UUID del chofer" /></Field><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Consultando…' : 'Consultar perfil'}</button></form>
      {error && <div className="banner" style={{ marginTop: 15 }}><span>!</span><div>{error}</div></div>}
      {driver && <div className="driver-status-result">
        <Detail label="Perfil">{driver.enabled ? 'Habilitado' : 'Pendiente de habilitación'}</Detail>
        <Detail label="Vehículo">{driver.vehicleRegistered ? 'Registrado' : 'Falta registrar'}</Detail>
        <Detail label="Disponibilidad">{driver.available ? 'Disponible' : 'No disponible'}</Detail>
        {!driver.enabled && <button className="button button-primary" style={{ marginTop: 12 }} type="button" onClick={enable}>Habilitar chofer</button>}
      </div>}
    </section>
    <div className="lower-grid">
      <section className="card card-pad"><div className="card-header"><div><h2 className="card-title">Cómo habilitar</h2><p className="card-subtitle">Los pasos necesarios para que el chofer quede disponible.</p></div></div>
        <Detail label="1">El chofer crea su perfil</Detail><Detail label="2">Registra un vehículo</Detail><Detail label="3">Admin habilita el perfil</Detail><Detail label="4">Chofer activa disponibilidad</Detail>
      </section>
      <section className="card card-pad"><div className="card-header"><div><h2 className="card-title">Recorrido de la demo</h2><p className="card-subtitle">Compartí el ID del viaje entre las dos cuentas.</p></div></div><p className="card-subtitle long-copy">Pasajero crea el viaje → chofer acepta el ID → comparte posición simulada → avanza el estado hasta completar.</p></section>
    </div>
  </>;
}

