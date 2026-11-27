import { useState } from 'react';
import Field from '../../components/Field.jsx';
import { request } from '../../services/api.js';

export default function RegisterPage({ notify, onLogin }) {
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    try {
      const session = await request('/api/v1/identidad/registro', {
        method: 'POST',
        body: { name: data.name, email: data.email, password: data.password, role: data.role }
      });
      onLogin(session);
      notify('Cuenta creada. ¡Bienvenido a AppUrbe!');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="form-stack" onSubmit={submit}>
        <Field label="Nombre y apellido">
          <input name="name" autoComplete="name" minLength="2" required placeholder="Ej. Alex García" />
        </Field>
        <Field label="Quiero usar AppUrbe como">
          <select name="role">
            <option value="pasajero">Pasajero</option>
            <option value="chofer">Chofer</option>
          </select>
        </Field>
        <Field label="Correo electrónico">
          <input name="email" type="email" autoComplete="email" required placeholder="vos@correo.com" />
        </Field>
        <Field label="Contraseña">
          <input name="password" type="password" autoComplete="new-password" minLength="8" required placeholder="Al menos 8 caracteres" />
        </Field>
        <button className="button button-primary button-wide" disabled={busy} type="submit">
          <span>{busy ? 'Un momento…' : 'Crear mi cuenta'}</span><span>↗</span>
        </button>
      </form>
      <p className="auth-legal">Esta aplicación es una demostración de AppUrbe.</p>
    </>
  );
}
