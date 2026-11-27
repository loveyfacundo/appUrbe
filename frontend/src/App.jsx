import { useCallback, useState } from 'react';
import AuthPage from './pages/AuthPage.jsx';
import DashboardPage from './pages/dashboard/DashboardPage.jsx';
import ToastViewport from './components/ToastViewport.jsx';
import { uuid } from './services/api.js';
import { ACTIVE_TRIP_KEY, SESSION_KEY } from './config/storage.js';

export default function App() {
  const [session, setSession] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return saved?.accessToken && saved?.user ? saved : null;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
  });
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, kind = 'success') => {
    const id = uuid();
    setToasts((items) => [...items, { id, message, kind }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4500);
  }, []);

  function login(result) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(result));
    setSession(result);
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(ACTIVE_TRIP_KEY);
    setSession(null);
  }

  return <>
    <ToastViewport items={toasts} dismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))} />
    {session ? <DashboardPage key={session.user.id} session={session} notify={notify} logout={logout} /> : <AuthPage notify={notify} onLogin={login} />}
  </>;
}
