import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const view = new URLSearchParams(window.location.search).get('view');
if (view === 'splash') document.documentElement.classList.add('splash-mode');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
