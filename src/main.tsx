import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

import {App} from './App';
import './styles.css';
import {runStartupSync} from './sync';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root is missing from the page');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// The one and only automatic refresh: once, here, at startup.
runStartupSync();

/**
 * Register the service worker, which is what makes the app installable and able
 * to start with no connection.
 *
 * `navigator.serviceWorker` does not exist outside a secure context, so over
 * plain HTTP to anything but localhost this is simply skipped and the app
 * degrades to an ordinary website: still usable, but with no offline start and
 * no home-screen install. That is worth a console line, because otherwise it is
 * a silent and very confusing absence.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
  });
} else if (window.isSecureContext === false) {
  console.warn(
    '[schedule] Not a secure context, so no service worker: the app will not work offline ' +
      'or install to a home screen. Serve it over HTTPS (or use localhost) to enable that.'
  );
}
