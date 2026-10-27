import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LanguageProvider } from './i18n';
import './styles.css';
import './match-centre/styles.css';
import './studio/studio-theme.css';
import './studio/studio-home.css';
import './studio/studio-match.css';
import {applyStudioTheme,readStudioTheme} from './studio/StudioThemeToggle';

applyStudioTheme(readStudioTheme());
createRoot(document.getElementById('root')!).render(<StrictMode><LanguageProvider><App /></LanguageProvider></StrictMode>);
