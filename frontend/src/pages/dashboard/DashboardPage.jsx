import { useEffect, useMemo, useState } from 'react';
import Footer from '../../layout/footer/Footer.jsx';
import Header from '../../layout/header/Header.jsx';
import { request, uuid } from '../../services/api.js';
import { ACTIVE_TRIP_KEY } from '../../config/storage.js';
import AdminPage from '../admin/AdminPage.jsx';
import DriverPage from '../driver/DriverPage.jsx';
import HistoryPage from '../history/HistoryPage.jsx';
import PassengerPage from '../passenger/PassengerPage.jsx';
import { TERMINAL_STATUSES } from '../../utils/trips.js';

function AppShell({ session, notify, logout }) {
  const [section, setSection] = useState('overview');
  const [trip, setTrip] = useState(null);
  const [tripId, setTripId] = useState(sessionStorage.getItem(ACTIVE_TRIP_KEY) || '');
  const [driverTrip, setDriverTrip] = useState(null);
  const [driverStatus, setDriverStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [streamOnline, setStreamOnline] = useState(false);
  const [locationMode, setLocationMode] = useState('');
  const [quote, setQuote] = useState(null);
  const role = session.user.role;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!['chofer', 'conductor'].includes(role)) return;
    let active = true;
    request(`/api/v1/conductores/${encodeURIComponent(session.user.id)}/habilitacion`, { token: session.accessToken })
      .then((result) => { if (active) setDriverStatus({ ...result, profileExists: true }); })
      .catch((error) => {
        if (active && error.status === 404) setDriverStatus({ profileExists: false, enabled: false, available: false, vehicleRegistered: false });
        else if (active) notify(error.message, 'error');
      });
    return () => { active = false; };
  }, [role, session.accessToken, session.user.id, notify]);

  useEffect(() => {
    if (role !== 'pasajero' || !tripId || !session.accessToken) return undefined;
    const controller = new AbortController();
    let reconnectDelay = 1000;
    const connect = async () => {
      while (!controller.signal.aborted) {
        try {
          const currentTrip = await request(`/api/v1/viajes/${encodeURIComponent(tripId)}`, {
            token: session.accessToken
          });
          setTrip(currentTrip);
          const response = await fetch(`/api/v1/viajes/${encodeURIComponent(tripId)}/seguimiento/eventos`, {
            headers: { Authorization: `Bearer ${session.accessToken}`, 'X-Correlation-Id': uuid(), Accept: 'text/event-stream' },
            signal: controller.signal
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message || `Seguimiento no disponible (HTTP ${response.status})`);
          }
          setStreamOnline(true);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let finished = false;
          while (!finished && !controller.signal.aborted) {
            const result = await reader.read();
            if (result.done) break;
            buffer += decoder.decode(result.value, { stream: true }).replace(/\r\n/g, '\n');
            let frameEnd;
            while ((frameEnd = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, frameEnd);
              buffer = buffer.slice(frameEnd + 2);
              const eventName = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
              const data = frame.match(/^data:\s*(.+)$/m)?.[1];
              if (!data) continue;
              const snapshot = JSON.parse(data);
              if (eventName === 'error') throw new Error(snapshot.message || 'El seguimiento dejó de estar disponible.');
              setTrip((current) => current ? {
                ...current,
                status: snapshot.status,
                driverId: snapshot.driverId,
                location: snapshot.location,
                updatedAt: snapshot.updatedAt
              } : current);
              if (TERMINAL_STATUSES.has(snapshot.status)) finished = true;
            }
          }
          if (finished || controller.signal.aborted) return;
          setStreamOnline(false);
        } catch (error) {
          if (controller.signal.aborted) return;
          setStreamOnline(false);
          if (error.status === 401 || error.status === 403 || error.status === 404) {
            notify(error.message, 'error');
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, reconnectDelay));
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
      }
    };
    connect();
    return () => controller.abort();
  }, [role, tripId, session.accessToken, notify]);

  const nav = useMemo(() => {
    const items = [{ id: 'overview', icon: '⌂', label: role === 'chofer' ? 'Mi actividad' : 'Inicio' }];
    if (role === 'pasajero' || role === 'chofer') items.push({ id: 'history', icon: '↻', label: 'Mis viajes' });
    if (role === 'chofer') items.push({ id: 'driver', icon: '◉', label: 'Panel chofer' });
    if (role === 'administrador') items.push({ id: 'admin', icon: '⚙', label: 'Administración' });
    return items;
  }, [role]);

  function navigate(next) {
    setSection(next);
  }

  function setActiveTrip(next) {
    setTrip(next);
    setTripId(next.id);
    sessionStorage.setItem(ACTIVE_TRIP_KEY, next.id);
  }

  async function loadTrip(id) {
    try {
      const result = await request(`/api/v1/viajes/${encodeURIComponent(id)}`, { token: session.accessToken });
      setActiveTrip(result);
      setSection('overview');
      notify('Viaje cargado.');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function loadHistory() {
    const path = role === 'chofer' ? '/api/v1/viajes/historial/conductor' : '/api/v1/viajes/historial/pasajero';
    try {
      setHistory(await request(path, { token: session.accessToken }));
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function loadDriverStatus() {
    try {
      const result = await request(`/api/v1/conductores/${encodeURIComponent(session.user.id)}/habilitacion`, { token: session.accessToken });
      setDriverStatus({ ...result, profileExists: true });
    } catch (error) {
      if (error.status === 404) setDriverStatus({ profileExists: false, enabled: false, available: false, vehicleRegistered: false });
      else notify(error.message, 'error');
    }
  }

  const commonProps = { session, notify, trip, setTrip, setActiveTrip, loadTrip, quote, setQuote };
  let page;
  if (section === 'history') page = <HistoryPage {...{ session, history, loadHistory, loadTrip }} />;
  else if (section === 'driver' || role === 'chofer') page = <DriverPage {...{ ...commonProps, driverStatus, setDriverStatus, driverTrip, setDriverTrip, loadDriverStatus, forcePanel: section === 'driver' }} />;
  else if (section === 'admin' || role === 'administrador') page = <AdminPage {...commonProps} />;
  else page = <PassengerPage {...commonProps} />;

  const title = section === 'history'
    ? ['TU ACTIVIDAD', 'Mis viajes', 'Todos tus recorridos, en un solo lugar.']
    : role === 'chofer'
      ? ['ESPACIO DEL CHOFER', 'Tu próxima oportunidad.', 'Prepará tu cuenta y aceptá el viaje que te compartieron.']
      : role === 'administrador'
        ? ['GESTIÓN DE FLOTA', 'Habilitá a tus choferes.', 'Un administrador debe aprobar perfil y vehículo.']
        : ['TU MOVILIDAD, MÁS SIMPLE', `Buen día, ${session.user.name.split(' ')[0]}.`, '¿A dónde vamos hoy?'];
  const connectionText = !online
    ? 'Sin conexión'
    : tripId && trip && !TERMINAL_STATUSES.has(trip.status)
      ? streamOnline ? 'Seguimiento en vivo' : 'Reconectando…'
      : 'API conectada';

  return (
    <div className="app-screen">
      <Header
        session={session}
        online={online}
        connectionText={connectionText}
        trackingConnected={!tripId || streamOnline || TERMINAL_STATUSES.has(trip?.status)}
        onLogout={logout}
      />
      <main className="dashboard">
        <aside className="sidebar">
          <div className="sidebar-label">ESPACIO DE TRABAJO</div>
          <nav className="main-nav" aria-label="Secciones">
            {nav.map((item) => <button key={item.id} className={`nav-item${(section === item.id || (role === 'chofer' && section === 'overview' && item.id === 'overview')) ? ' is-active' : ''}`} type="button" onClick={() => navigate(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}
          </nav>
          <div className="sidebar-bottom">
            <div className="help-card"><span className="help-icon">✳</span><strong>Modo demostración</strong><p>Esta app se conecta a la API de AppUrbe en el mismo origen.</p></div>
            <span className="sidebar-version">APPURBE WEB <span>·</span> REACT</span>
          </div>
        </aside>
        <section className="content">
          <div className="page-heading"><div><div className="eyebrow">{title[0]}</div><h1>{title[1]}</h1><p>{title[2]}</p></div></div>
          {page}
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default AppShell;
