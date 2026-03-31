import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Limpa a árvore do DOM após cada teste, evitando vazamento de estado entre os testes
afterEach(() => {
  cleanup();
});

// Mock scrollIntoView que jsdom não implementa
Element.prototype.scrollIntoView = vi.fn();

// jsdom não implementa Web Media APIs — mocks mínimos para compilar testes
if (typeof MediaStream === 'undefined') {
  class MockMediaStream {
    private tracks: MediaStreamTrack[] = [];
    id = Math.random().toString(36).slice(2);
    getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
    getTracks() { return this.tracks; }
    addTrack(t: MediaStreamTrack) { this.tracks.push(t); }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaStream = MockMediaStream;
}

if (typeof MediaStreamTrack === 'undefined') {
  class MockMediaStreamTrack {
    kind = 'audio';
    label = '';
    enabled = true;
    stop = vi.fn();
    onended: (() => void) | null = null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaStreamTrack = MockMediaStreamTrack;
}