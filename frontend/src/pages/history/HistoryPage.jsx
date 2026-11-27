import { useEffect } from 'react';
import { dateLabel, statusLabel } from '../../utils/trips.js';

export default function HistoryPage({ session, history, loadHistory, loadTrip }) {
  useEffect(() => { loadHistory(); }, []);
  const trips = history || [];
  return <section className="card card-pad">
    <div className="card-header"><div><h2 className="card-title">Historial reciente</h2><p className="card-subtitle">Los viajes asociados a esta cuenta.</p></div><button className="button button-ghost small-button" type="button" onClick={loadHistory}>Actualizar</button></div>
    {trips.length ? <div className="history-list">{trips.map((item) => <div className="history-item" key={item.id}><div className="history-route"><strong>{item.origin?.address} → {item.destination?.address}</strong><span>{dateLabel(item.updatedAt)} · {statusLabel(item.status)}</span></div><button className="button button-ghost small-button" type="button" onClick={() => loadTrip(item.id)}>Abrir</button></div>)}</div>
      : <div className="empty-state"><div><span className="empty-icon">↻</span><strong>Todavía no hay viajes</strong><p>Cuando completes un recorrido, lo vas a encontrar acá.</p></div></div>}
  </section>;
}

