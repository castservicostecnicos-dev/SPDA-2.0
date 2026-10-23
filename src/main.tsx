import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Registra o Service Worker imediatamente para funcionamento 100% offline
registerSW({
  immediate: true,
  onRegisteredSW(swScriptUrl) {
    console.log('SPDA Offline Service Worker ativo:', swScriptUrl);
  },
  onRegisterError(error) {
    console.warn('Falha no registro do Service Worker:', error);
  },
});

createRoot(document.getElementById('root')!).render(<App />);
