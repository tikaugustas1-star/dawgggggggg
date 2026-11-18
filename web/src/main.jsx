import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
// Self-hosted font (no request to Google Fonts → no visitor IP sent to a third party).
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import './styles.css';
import { AppProvider } from './lib/app.jsx';
import { CartProvider, useCart } from './lib/cart.jsx';
import { Dock, CartPill, Toast } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Menu from './pages/Menu.jsx';
import Item from './pages/Item.jsx';
import Cart from './pages/Cart.jsx';
import Order from './pages/Order.jsx';
import { Account, Orders } from './pages/Account.jsx';
import Kitchen from './pages/Kitchen.jsx';
import Locations from './pages/Locations.jsx';
import { Privacy, Terms } from './pages/Legal.jsx';
import Admin from './pages/Admin.jsx';

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// Main tabs get the floating dock; detail/checkout/tracker are full-screen with their own CTA.
function Tab({ children }) {
  const { count } = useCart(); const { pathname } = useLocation();
  const pill = count > 0 && ['/', '/menu'].includes(pathname); // extra room so the cart pill never covers content
  return <div className={`shell with-nav${pill ? ' with-pill' : ''}`}>{children}<CartPill /><Dock /></div>;
}
const Full = ({ children }) => <div className="shell">{children}</div>;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppProvider>
        <CartProvider>
          <ScrollTop />
          <Toast />
          <Routes>
            <Route path="/kitchen" element={<Kitchen />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/" element={<Tab><Home /></Tab>} />
            <Route path="/menu" element={<Tab><Menu /></Tab>} />
            <Route path="/orders" element={<Tab><Orders /></Tab>} />
            <Route path="/account" element={<Tab><Account /></Tab>} />
            <Route path="/locations" element={<Tab><Locations /></Tab>} />
            <Route path="/item/:id" element={<Item />} />
            <Route path="/cart" element={<Full><Cart /></Full>} />
            <Route path="/checkout" element={<Full><Cart /></Full>} />
            <Route path="/order/:token" element={<Full><Order /></Full>} />
            <Route path="/privacy" element={<Full><Privacy /></Full>} />
            <Route path="/terms" element={<Full><Terms /></Full>} />
            <Route path="*" element={<Tab><Home /></Tab>} />
          </Routes>
        </CartProvider>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
