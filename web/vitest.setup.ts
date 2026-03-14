import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Limpa a árvore do DOM após cada teste, evitando vazamento de estado entre os testes
afterEach(() => {
  cleanup();
});