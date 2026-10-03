interface BootstrapWindow extends Window {
  __bootstrapStart?: number;
}
(window as BootstrapWindow).__bootstrapStart = performance.now();

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
// D0 (Spec 33): inicializa o i18n ANTES do primeiro render (side-effect do módulo)
import './i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
