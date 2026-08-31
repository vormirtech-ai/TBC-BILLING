import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LOCAL_MODE } from './lib/api';
import './index.css';

async function start(): Promise<void> {
  // The hosted build answers every request from IndexedDB, so the database has
  // to be open before the first screen renders.
  if (LOCAL_MODE) {
    const { bootstrapLocalApi } = await import('./local');
    await bootstrapLocalApi();
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  // Keeps the hosted app usable with no connection once it has been opened once.
  if (LOCAL_MODE && import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    });
  }
}

void start();
