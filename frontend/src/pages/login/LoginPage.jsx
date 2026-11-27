import { useState } from 'react';
import Field from '../../components/Field.jsx';
import { request } from '../../services/api.js';

export default function LoginPage({ notify, onLogin }) {
  const [busy, setBusy] = useState(false);
  const [showBootstrap, setShowBootstrap] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    try {
      const session = await request('/api/v1/identidad/login', {
        method: 'POST',
        body: { email: data.email, password: data.password }
      });
      onLogin(session);
      notify('Sesión iniciada.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function bootstrap(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    try {
      const session = await request('/api/v1/identidad/bootstrap/administrador', {
        method: 'POST',
        headers: { 'X-Bootstrap-Token': data.bootstrapToken },
        body: { name: data.name, email: data.email, password: data.password }
      });
      onLogin(session);
      notify('Administrador inicial creado.');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="form-stack" onSubmit={submit}>
        <Field label="Correo electrónico">
          <input name="email" type="email" autoComplete="email" required placeholder="vos@correo.com" />
        </Field>
        <Field label="Contraseña">
          <input name="password" type="password" autoComplete="current-password" minLength="8" required placeholder="Al menos 8 caracteres" />
        </Field>
        <button className="button button-primary button-wide" disabled={busy} type="submit">
          <span>{busy ? 'Un momento…' : 'Entrar a mi cuenta'}</span><span>↗</span>
        </button>
      </form>
      <div className="auth-divider"><span>O BIEN</span></div>
      <button type="button" className="text-button" onClick={() => setShowBootstrap((value) => !value)}>
        Configurar administrador inicial
      </button>
      {showBootstrap && (
        <form className="form-stack bootstrap-form" onSubmit={bootstrap}>
          <p className="form-hint">Solo funciona si todavía no existe un administrador. El token se usa una vez y no se guarda.</p>
          <Field label="Nombre"><input name="name" required minLength="2" /></Field>
          <Field label="Correo"><input name="email" type="email" required /></Field>
          <Field label="Contraseña"><input name="password" type="password" minLength="8" required /></Field>
          <Field label="Token de alta inicial"><input name="bootstrapToken" type="password" required autoComplete="off" /></Field>
          <button className="button button-secondary button-wide" disabled={busy} type="submit">Crear administrador</button>
        </form>
      )}
      <p className="auth-legal">Esta aplicación es una demostración de AppUrbe.</p>
    </>
  );
}
