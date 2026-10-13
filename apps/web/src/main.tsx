import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { NotifyProvider } from './state/notify';
import { SessionProvider } from './state/session';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <NotifyProvider>
          <App />
        </NotifyProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
