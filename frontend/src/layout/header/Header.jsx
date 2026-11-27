import Brand from '../Brand.jsx';

export default function Header({ session, online, connectionText, trackingConnected, onLogout }) {
  const connectionIsHealthy = online && trackingConnected;

  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-right">
        <span className={`connection-pill${connectionIsHealthy ? '' : ' is-offline'}`}>
          <i className="connection-dot" />
          {connectionText}
        </span>
        <div className="user-chip">
          <span className="avatar">{session.user.name.trim().charAt(0).toUpperCase()}</span>
          <span className="user-name">{session.user.name}</span>
          <span className="role-badge">{roleLabel(session.user.role)}</span>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          onClick={onLogout}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 17l5-5-5-5M15 12H3m9-8h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
          </svg>
        </button>
      </div>
    </header>
  );
}

function roleLabel(role) {
  return ({ pasajero: 'Pasajero', chofer: 'Chofer', conductor: 'Chofer', administrador: 'Admin', operador: 'Operador' })[role] || role;
}
