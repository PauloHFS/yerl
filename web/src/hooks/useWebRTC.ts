import { useState, useEffect, useRef, useCallback } from 'react';

export interface SignalingMessage {
  type: 'join' | 'offer' | 'answer' | 'candidate' | 'participants';
  roomId?: string;
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | Participant[] | JoinPayload;
}

export interface JoinPayload {
  roomId: string;
  name?: string;
}

export interface Participant {
  id: string;
  name: string;
}

export interface WebRTCStats {
  outbound: { bitrate: number; packetsSent: number };
  inbound: { bitrate: number; packetsLost: number; jitter: number };
  latency: number; // RTT in ms
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
  const [stats, setStats] = useState<WebRTCStats | null>(null);
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isConnectingRef = useRef(false);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatsRef = useRef<PrevStats | null>(null);

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

  const disconnect = useCallback(() => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
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
  }, [localStream]);

  const connect = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setLocalStream(stream);

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      startStats(pc);

      pc.ontrack = (event) => {
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
          }
        } catch (err) {
          console.error(`Error handling ${msg.type}`, err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        isConnectingRef.current = false;
      };

    } catch (err) {
      isConnectingRef.current = false;
      console.error('Failed to get media or connect', err);
    }
  }, [roomId, username, startStats]);

  const connectOnce = useCallback(async () => {
    if (isConnectingRef.current || wsRef.current) return;
    isConnectingRef.current = true;
    await connect();
  }, [connect]);

  const toggleMute = useCallback(() => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const newEnabledState = !audioTracks[0].enabled;
        audioTracks[0].enabled = newEnabledState;
        setIsMuted(!newEnabledState);
      }
    }
  }, [localStream]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount if it was active
      if (wsRef.current?.readyState === WebSocket.OPEN) {
         disconnect();
      }
    };
  }, [disconnect]);

  return { connect: connectOnce, disconnect, connected, remoteStreams, isMuted, toggleMute, stats, participants };
}
