import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import 'katex/dist/katex.min.css';
import './styles/tailwind.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
