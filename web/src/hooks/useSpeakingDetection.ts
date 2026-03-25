import { useState, useEffect, useRef } from 'react';

const AMPLITUDE_THRESHOLD = 10; // Valor de 0–255; abaixo = silêncio
const CHECK_INTERVAL_MS = 100;

/**
 * Detecta se uma MediaStream contém áudio ativo usando AudioContext + AnalyserNode.
 * Retorna `isSpeaking` que é true enquanto a amplitude média superar o threshold.
 */
export function useSpeakingDetection(stream: MediaStream | null): boolean {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream) {
      setIsSpeaking(false);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setIsSpeaking(false);
      return;
    }

    const context = new AudioContext();
    contextRef.current = context;

    const analyser = context.createAnalyser();
    analyser.fftSize = 512;

    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    intervalRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(dataArray);

      // Calcula desvio médio em relação ao centro (128 = silêncio)
      let sum = 0;
      for (const v of dataArray) {
        sum += Math.abs(v - 128);
      }
      const avg = sum / dataArray.length;

      setIsSpeaking(avg > AMPLITUDE_THRESHOLD);
    }, CHECK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      source.disconnect();
      void context.close();
      contextRef.current = null;
    };
  }, [stream]);

  return isSpeaking;
}
