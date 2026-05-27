interface BootstrapWindow extends Window {
  __bootstrapStart?: number;
}
(window as BootstrapWindow).__bootstrapStart = performance.now();

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
