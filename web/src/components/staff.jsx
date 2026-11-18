import { NavLink, Link } from 'react-router-dom';
import { useApp } from '../lib/app.jsx';
import { Icon } from './ui.jsx';

const I = {
  kitchen: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 13h12v6a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM4 13h16M9 9a3 3 0 1 1 6 0" /></svg>,
  chart: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 19V11M12 19V5M19 19v-6" /></svg>,
};

/** Staff header: title + dark pill navigation, mirroring the customer dock. */
export function StaffHead({ title, sub, children }) {
  const { me } = useApp();
  return (
    <header className="staff-head">
      <div className="ttl grow"><h1>{title}</h1>{sub && <span>{sub}</span>}</div>
      {children}
      <nav className="staff-nav" aria-label="Darbuotojų navigacija">
        <NavLink to="/kitchen" className={({ isActive }) => (isActive ? 'active' : '')}><I.kitchen />Virtuvė</NavLink>
        {me.user?.role === 'admin' && <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')}><I.chart />Admin</NavLink>}
        <Link to="/"><Icon.home />Appsas</Link>
      </nav>
    </header>
  );
}

export function StaffLogin({ title, next }) {
  return (
    <div className="staff" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="panel" style={{ maxWidth: 400, width: '100%', alignItems: 'flex-start' }}>
        <h1>{title}</h1>
        <p className="muted" style={{ margin: 0 }}>Prisijunkite darbuotojo paskyra.</p>
        <Link className="btn block" to={`/account?next=${next}`}>Prisijungti</Link>
      </div>
    </div>
  );
}
