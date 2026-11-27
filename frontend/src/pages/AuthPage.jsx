import { useState } from 'react';
import AuthLayout from '../layout/AuthLayout.jsx';
import LoginPage from './login/LoginPage.jsx';
import RegisterPage from './register/RegisterPage.jsx';

export default function AuthPage({ notify, onLogin }) {
  const [mode, setMode] = useState('login');
  const registering = mode === 'register';

  return (
    <AuthLayout
      title={registering ? 'Empezá tu viaje.' : 'Qué bueno verte.'}
      subtitle={registering ? 'Creá tu cuenta para usar AppUrbe.' : 'Ingresá a tu cuenta para continuar.'}
    >
      <div className="auth-tabs" role="tablist" aria-label="Acceso">
        <button
          type="button"
          role="tab"
          aria-selected={!registering}
          className={`auth-tab${!registering ? ' is-active' : ''}`}
          onClick={() => setMode('login')}
        >
          Iniciar sesión
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={registering}
          className={`auth-tab${registering ? ' is-active' : ''}`}
          onClick={() => setMode('register')}
        >
          Crear cuenta
        </button>
      </div>
      {registering
        ? <RegisterPage notify={notify} onLogin={onLogin} />
        : <LoginPage notify={notify} onLogin={onLogin} />}
    </AuthLayout>
  );
}
