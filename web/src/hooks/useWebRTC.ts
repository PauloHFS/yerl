import { useState, useEffect, useRef, useCallback } from 'react';

export interface SignalingMessage {
  type: 'join' | 'offer' | 'answer' | 'candidate' | 'participants' | 'joined' | 'error' | 'mute-status' | 'screen-share-started' | 'screen-share-ended';
  roomId?: string;
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | Participant[] | JoinPayload | { peerID: string } | MuteStatusPayload;
}

export interface JoinPayload {
  roomId: string;
  name?: string;
}

export interface Participant {
  id: string;
  name: string;
}

export interface MuteStatusPayload {
  peerID: string;
  trackType: 'audio' | 'video' | 'screenshare-video' | 'screenshare-audio';
  muted: boolean;
}

export interface WebRTCStats {
  outbound: { bitrate: number; packetsSent: number };
  inbound: { bitrate: number; packetsLost: number; jitter: number };
  latency: number; // RTT em ms
}

interface PrevStats {
  bytesSent: number;
  bytesReceived: number;
  timestamp: number;
}

// Interfaces baseadas na especificação do W3C para RTCStats
interface RTCInboundRtpStreamStats extends RTCStats {
  type: 'inbound-rtp';
  kind: string;
  packetsLost: number;
  jitter: number;
  bytesReceived: number;
}

interface RTCOutboundRtpStreamStats extends RTCStats {
  type: 'outbound-rtp';
  kind: string;
  packetsSent: number;
  bytesSent: number;
}

interface RTCRemoteInboundRtpStreamStats extends RTCStats {
  type: 'remote-inbound-rtp';
  roundTripTime?: number;
}

interface RTCIceCandidatePairStats extends RTCStats {
  type: 'candidate-pair';
  state: string;
  currentRoundTripTime?: number;
}

export function useWebRTC(roomId: string, username?: string) {
  const [connected, setConnected] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [stats, setStats] = useState<WebRTCStats | null>(null);
  const [myPeerID, setMyPeerID] = useState('');
  const [isReconnecting, setIsReconnecting] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isConnectingRef = useRef(false);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatsRef = useRef<PrevStats | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalDisconnectRef = useRef(false);

  const startStats = useCallback((pc: RTCPeerConnection) => {
    statsIntervalRef.current = setInterval(async () => {
      const report = await pc.getStats();
      let outboundBitrate = 0;
      let inboundBitrate = 0;
      let packetsSent = 0;
      let packetsLost = 0;
      let jitter = 0;
      let rtt = 0;

      const now = Date.now();

      report.forEach((stat) => {
        const s = stat as RTCStats;
        if (s.type === 'outbound-rtp') {
          const outbound = s as RTCOutboundRtpStreamStats;
          if (outbound.kind === 'audio') {
            packetsSent = outbound.packetsSent;
            if (prevStatsRef.current) {
               const deltaBytes = outbound.bytesSent - prevStatsRef.current.bytesSent;
               const deltaTime = (now - prevStatsRef.current.timestamp) / 1000;
               if (deltaTime > 0) {
                  outboundBitrate = (deltaBytes * 8) / deltaTime / 1000; // kbps
               }
            }
            prevStatsRef.current = {
              bytesSent: outbound.bytesSent,
              bytesReceived: prevStatsRef.current?.bytesReceived ?? 0,
              timestamp: now
            };
          }
        }

        if (s.type === 'inbound-rtp') {
          const inbound = s as RTCInboundRtpStreamStats;
          if (inbound.kind === 'audio') {
            packetsLost = inbound.packetsLost;
            jitter = (inbound.jitter || 0) * 1000; // ms
            if (prevStatsRef.current) {
              const deltaBytes = inbound.bytesReceived - prevStatsRef.current.bytesReceived;
              const deltaTime = (now - prevStatsRef.current.timestamp) / 1000;
              if (deltaTime > 0) {
                 inboundBitrate = (deltaBytes * 8) / deltaTime / 1000; // kbps
              }
            }
            prevStatsRef.current = {
              bytesSent: prevStatsRef.current?.bytesSent ?? 0,
              bytesReceived: inbound.bytesReceived,
              timestamp: now
            };
          }
        }

        if (stat.type === 'remote-inbound-rtp') {
           const remoteInbound = s as RTCRemoteInboundRtpStreamStats;
           if (typeof remoteInbound.roundTripTime === 'number') {
              rtt = remoteInbound.roundTripTime * 1000; // ms
           }
        }

        if (stat.type === 'candidate-pair') {
           const candidatePair = s as RTCIceCandidatePairStats;
           if (candidatePair.state === 'succeeded' && typeof candidatePair.currentRoundTripTime === 'number') {
              rtt = candidatePair.currentRoundTripTime * 1000; // ms
           }
        }
      });

      setStats({
        outbound: { bitrate: Math.round(outboundBitrate), packetsSent },
        inbound: { bitrate: Math.round(inboundBitrate), packetsLost, jitter: Math.round(jitter) },
        latency: Math.round(rtt),
      });
    }, 1000);
  }, []);

  const disconnect = useCallback((intentional = true) => {
    intentionalDisconnectRef.current = intentional;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    setIsReconnecting(false);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    isConnectingRef.current = false;
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    setConnected(false);
    setRemoteStreams([]);
    setParticipants([]);
    setStats(null);
    setLocalStream(null);
    setIsCameraOn(false);
    setIsScreenSharing(false);
  }, []);

  const connect = useCallback(async () => {
    try {
      // Inicia apenas com áudio; vídeo é adicionado via toggleCamera
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setLocalStream(stream);
      localStreamRef.current = stream;

      const userId = myPeerID || crypto.randomUUID();
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ws?userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(username ?? '')}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      startStats(pc);

      pc.ontrack = (event) => {
        if (!event.streams[0]) return;
        setRemoteStreams((prev) => {
          const newStreams = [...prev];
          if (!newStreams.some((s) => s.id === event.streams[0].id)) {
             newStreams.push(event.streams[0]);
          }
          return newStreams;
        });
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'candidate',
            payload: event.candidate.toJSON(),
          }));
        }
      };

      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (ws.readyState === WebSocket.OPEN) {
             ws.send(JSON.stringify({
              type: 'offer',
              payload: pc.localDescription,
            }));
          }
        } catch (err) {
          console.error('Error during negotiation', err);
        }
      };

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({
          type: 'join',
          roomId,
          payload: { roomId, name: username }
        }));
      };

      ws.onmessage = async (event: MessageEvent) => {
        const msg = JSON.parse(event.data as string) as SignalingMessage;

        try {
          if (msg.type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({
              type: 'answer',
              payload: pc.localDescription,
            }));
          } else if (msg.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit));
          } else if (msg.type === 'candidate') {
            await pc.addIceCandidate(new RTCIceCandidate(msg.payload as RTCIceCandidateInit));
          } else if (msg.type === 'participants') {
            setParticipants(msg.payload as Participant[]);
          } else if (msg.type === 'joined') {
            const payload = msg.payload as { peerID: string };
            setMyPeerID(payload.peerID);
          }
        } catch (err) {
          console.error(`Error handling ${msg.type}`, err);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          pc.restartIce();
        }
      };

      ws.onclose = () => {
        setConnected(false);
        isConnectingRef.current = false;

        if (intentionalDisconnectRef.current) return;

        const maxAttempts = 5;
        if (reconnectAttemptsRef.current >= maxAttempts) {
          setIsReconnecting(false);
          return;
        }

        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30_000);
        reconnectAttemptsRef.current += 1;
        setIsReconnecting(true);

        reconnectTimerRef.current = setTimeout(() => {
          isConnectingRef.current = false;
          wsRef.current = null;
          pcRef.current = null;
          void connect();
        }, delay);
      };

    } catch (err) {
      isConnectingRef.current = false;
      console.error('Failed to get media or connect', err);
    }
  }, [roomId, username, startStats, myPeerID]);

  const connectOnce = useCallback(async () => {
    if (isConnectingRef.current || wsRef.current) return;
    isConnectingRef.current = true;
    await connect();
  }, [connect]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const newEnabledState = !audioTracks[0].enabled;
        audioTracks[0].enabled = newEnabledState;
        setIsMuted(!newEnabledState);
      }
    }
  }, []);

  // Ativa câmera e adiciona track de vídeo com simulcast (3 layers: l→m→h)
  const enableCamera = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) return;

      // Adicionar à stream local para exibição
      const currentStream = localStreamRef.current ?? new MediaStream();
      currentStream.addTrack(videoTrack);
      setLocalStream(new MediaStream(currentStream.getTracks()));

      const sender = pc.addTrack(videoTrack, currentStream);

      // Configurar simulcast: ordem crescente (low → high) conforme spec WebRTC
      const params = sender.getParameters();
      params.encodings = [
        { rid: 'l', maxBitrate: 100_000, scaleResolutionDownBy: 4 },
        { rid: 'm', maxBitrate: 500_000, scaleResolutionDownBy: 2 },
        { rid: 'h', maxBitrate: 2_500_000, scaleResolutionDownBy: 1 },
      ];
      await sender.setParameters(params);

      setIsCameraOn(true);
    } catch (err) {
      console.error('Erro ao ativar câmera', err);
    }
  }, []);

  const disableCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    stream.getVideoTracks().forEach(track => {
      track.stop();
      stream.removeTrack(track);
    });
    setLocalStream(new MediaStream(stream.getAudioTracks()));
    setIsCameraOn(false);
  }, []);

  const toggleCamera = useCallback(async () => {
    if (isCameraOn) {
      disableCamera();
    } else {
      await enableCamera();
    }
  }, [isCameraOn, enableCamera, disableCamera]);

  // Screen share com áudio do sistema (best-effort — macOS não suporta)
  const startScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as MediaTrackConstraints,
        audio: true,
      });

      if (screenStream.getAudioTracks().length === 0) {
        console.info('Áudio do sistema não disponível neste browser/OS');
      }

      screenStreamRef.current = screenStream;

      // Usar streamID com convenção "{myPeerID}-screen-0" para classificação backend
      const shareIndex = 0;
      const streamID = `${myPeerID}-screen-${shareIndex}`;
      const screenMediaStream = new MediaStream(screenStream.getTracks());

      screenStream.getTracks().forEach(track => {
        pc.addTrack(track, screenMediaStream);

        // Encerrar share quando usuário parar pelo browser
        track.onended = () => {
          stopScreenShare();
        };
      });

      setIsScreenSharing(true);
      void streamID; // referência para futura notificação signaling
    } catch (err) {
      console.error('Erro ao iniciar screen share', err);
    }
  }, [myPeerID]);

  const stopScreenShare = useCallback(() => {
    const screenStream = screenStreamRef.current;
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
  }, []);

  useEffect(() => {
    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
         disconnect();
      }
    };
  }, [disconnect]);

  return {
    connect: connectOnce,
    disconnect,
    connected,
    isReconnecting,
    remoteStreams,
    localStream,
    isMuted,
    isCameraOn,
    isScreenSharing,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
    stats,
    participants,
    myPeerID,
  };
}
