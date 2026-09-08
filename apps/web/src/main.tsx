import { CssBaseline } from '@mui/material';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocaleProvider } from './i18n/LocaleContext';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

/**
 * LocaleProvider supplies the ThemeProvider, because the theme carries text direction and the
 * locale decides it. Two providers that could disagree about direction is a seam worth not
 * having.
 */
createRoot(container).render(
  <React.StrictMode>
    <LocaleProvider>
      <CssBaseline />
      <App />
    </LocaleProvider>
  </React.StrictMode>,
);
