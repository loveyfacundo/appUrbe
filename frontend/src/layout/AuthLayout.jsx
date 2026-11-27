import Brand from './Brand.jsx';

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <main className="auth-screen">
      <section className="auth-intro">
        <Brand light />
        <div className="intro-copy">
          <span className="eyebrow eyebrow-light"><i className="status-pulse" /> MOVERNOS NOS ACERCA</span>
          <h1>Tu ciudad,<br />en movimiento.</h1>
          <p>Un viaje más simple empieza acá. Cotizá, encontrá tu chofer y seguí cada tramo en tiempo real.</p>
        </div>
        <div className="intro-route" aria-hidden="true">
          <span className="route-node" />
          <span className="route-line" />
          <span className="route-node route-node-end" />
          <span className="route-label route-label-start">OBELISCO</span>
          <span className="route-label route-label-end">PALERMO</span>
        </div>
        <div className="intro-footer"><span>BUENOS AIRES, ARGENTINA</span><span>APPURBE · 2026</span></div>
      </section>
      <section className="auth-panel">
        <div className="auth-panel-inner">
          <div className="mobile-brand"><Brand /></div>
          <div className="auth-heading">
            <span className="eyebrow">TU PRÓXIMO DESTINO</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
