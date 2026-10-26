// TP259: la web arranca en la liga ficticia; las pruebas existentes describen los nombres reales del catálogo.
try { globalThis.localStorage?.setItem('timepitch.names', 'real'); } catch { /* sin almacenamiento */ }
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => { cleanup(); localStorage.clear(); });
