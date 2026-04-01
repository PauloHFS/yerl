import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeakingDetection } from './useSpeakingDetection';

// Fábrica de mock de AudioContext configurável
function createMockAudioContext(amplitudeValue: number) {
  const mockGetByteTimeDomainData = vi.fn((array: Uint8Array) => {
    array.fill(amplitudeValue);
  });

  const mockAnalyser = {
    fftSize: 0,
    frequencyBinCount: 256,
    getByteTimeDomainData: mockGetByteTimeDomainData,
  };

  const mockSource = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const mockClose = vi.fn().mockResolvedValue(undefined);

  // Deve ser uma classe (ou função normal) para ser usada com `new AudioContext()`
  class MockAudioContext {
    createAnalyser() { return mockAnalyser; }
    createMediaStreamSource() { return mockSource; }
    close = mockClose;
  }

  return { MockAudioContext, mockClose };
}

// Cria um MediaStream com um fake AudioTrack
function mockStreamWithAudio(): MediaStream {
  const stream = new MediaStream();
  const track = { kind: 'audio', enabled: true } as unknown as MediaStreamTrack;
  Object.defineProperty(stream, 'getAudioTracks', {
    value: vi.fn().mockReturnValue([track]),
    configurable: true,
  });
  return stream;
}

describe('useSpeakingDetection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retorna false quando stream é null', () => {
    const { result } = renderHook(() => useSpeakingDetection(null));
    expect(result.current).toBe(false);
  });

  it('retorna false quando stream não tem tracks de áudio', () => {
    const stream = new MediaStream(); // sem tracks
    const { result } = renderHook(() => useSpeakingDetection(stream));
    expect(result.current).toBe(false);
  });

  it('retorna false enquanto amplitude está abaixo do threshold (128 = silêncio)', () => {
    // Todos os valores = 128 → desvio médio = 0 → abaixo do threshold de 10
    const { MockAudioContext } = createMockAudioContext(128);
    vi.stubGlobal('AudioContext', MockAudioContext);

    const stream = mockStreamWithAudio();
    const { result } = renderHook(() => useSpeakingDetection(stream));

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(false);
  });

  it('retorna true quando amplitude supera o threshold', () => {
    // Valores = 148 → desvio = |148-128| = 20 → acima do threshold de 10
    const { MockAudioContext } = createMockAudioContext(148);
    vi.stubGlobal('AudioContext', MockAudioContext);

    const stream = mockStreamWithAudio();
    const { result } = renderHook(() => useSpeakingDetection(stream));

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(true);
  });

  it('cancela o intervalo e fecha o AudioContext ao desmontar', () => {
    const { MockAudioContext, mockClose } = createMockAudioContext(128);
    vi.stubGlobal('AudioContext', MockAudioContext);

    const stream = mockStreamWithAudio();
    const { unmount } = renderHook(() => useSpeakingDetection(stream));

    unmount();

    expect(mockClose).toHaveBeenCalledOnce();
  });

  it('volta para false quando stream muda para null', () => {
    const { MockAudioContext } = createMockAudioContext(148);
    vi.stubGlobal('AudioContext', MockAudioContext);
    const stream = mockStreamWithAudio();

    const { result, rerender } = renderHook(
      ({ s }: { s: MediaStream | null }) => useSpeakingDetection(s),
      { initialProps: { s: stream } }
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Muda para null → deve voltar a false
    rerender({ s: null as unknown as MediaStream });
    expect(result.current).toBe(false);
  });
});
