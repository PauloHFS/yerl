package sfu

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"sync"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/pion/webrtc/v4"
)

type Peer struct {
	ID             string
	Name           string
	Room           *Room
	PC             *webrtc.PeerConnection
	SendSignalFunc func(msg domain.SignalingMessage) error

	ctx               context.Context
	cancel            context.CancelFunc
	mu                sync.Mutex
	isClosed          bool
	pendingCandidates []webrtc.ICECandidateInit
}

func NewPeer(ctx context.Context, id, name string, room *Room, sendSignal func(domain.SignalingMessage) error) (*Peer, error) {
	peerCtx, cancel := context.WithCancel(ctx)

	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: []string{"stun:stun.l.google.com:19302"},
			},
		},
	}

	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		cancel()
		return nil, err
	}

	p := &Peer{
		ID:                id,
		Name:              name,
		Room:              room,
		PC:                pc,
		SendSignalFunc:    sendSignal,
		ctx:               peerCtx,
		cancel:            cancel,
		pendingCandidates: make([]webrtc.ICECandidateInit, 0),
	}

	p.setupHandlers()
	return p, nil
}

func (p *Peer) setupHandlers() {
	p.PC.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		
		payload, err := json.Marshal(c.ToJSON())
		if err != nil {
			slog.Error("Failed to marshal ICE candidate", "err", err)
			return
		}

		p.SendSignalFunc(domain.SignalingMessage{
			Type:    "candidate",
			Payload: payload,
		})
	})

	p.PC.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		slog.Info("PeerConnection state changed", "state", s.String(), "peer_id", p.ID)
		if s == webrtc.PeerConnectionStateFailed || s == webrtc.PeerConnectionStateClosed {
			p.Close()
		}
	})

	p.PC.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		slog.Info("Track received", "kind", remoteTrack.Kind().String(), "id", remoteTrack.ID(), "peer_id", p.ID)
		
		// Create a local track to broadcast
		localTrack, err := webrtc.NewTrackLocalStaticRTP(
			remoteTrack.Codec().RTPCodecCapability,
			remoteTrack.ID(),
			p.ID, // Use peer ID as stream ID to group tracks by user
		)
		if err != nil {
			slog.Error("Failed to create local track", "err", err)
			return
		}

		// Add to room (which will broadcast to others)
		p.Room.AddTrack(localTrack, p.ID)

		// Read RTP packets e encaminha para o local track, respeitando o context
		go func() {
			rtpBuf := make([]byte, 1400)
			for {
				select {
				case <-p.ctx.Done():
					p.Room.RemoveTrack(remoteTrack.ID(), p.ID)
					return
				default:
				}

				i, _, readErr := remoteTrack.Read(rtpBuf)
				if readErr != nil {
					if errors.Is(readErr, io.EOF) {
						slog.Info("Remote track ended", "track_id", remoteTrack.ID())
					}
					p.Room.RemoveTrack(remoteTrack.ID(), p.ID)
					return
				}

				if _, err = localTrack.Write(rtpBuf[:i]); err != nil {
					if !errors.Is(err, io.ErrClosedPipe) {
						slog.Error("Error writing to local track", "err", err)
					}
				}
			}
		}()
	})

	p.PC.OnNegotiationNeeded(func() {
		p.mu.Lock()
		defer p.mu.Unlock()

		offer, err := p.PC.CreateOffer(nil)
		if err != nil {
			slog.Error("Failed to create offer on negotiation", "err", err)
			return
		}

		if err = p.PC.SetLocalDescription(offer); err != nil {
			slog.Error("Failed to set local description", "err", err)
			return
		}

		payload, err := json.Marshal(p.PC.LocalDescription())
		if err != nil {
			slog.Error("Failed to marshal offer", "err", err)
			return
		}

		p.SendSignalFunc(domain.SignalingMessage{
			Type:    "offer",
			Payload: payload,
		})
	})
}

func (p *Peer) AddTrack(track *webrtc.TrackLocalStaticRTP) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.isClosed {
		return errors.New("peer is closed")
	}

	_, err := p.PC.AddTrack(track)
	return err
}

func (p *Peer) HandleOffer(offer webrtc.SessionDescription) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if err := p.PC.SetRemoteDescription(offer); err != nil {
		return err
	}

	// Process pending candidates now that remote description is set
	for _, c := range p.pendingCandidates {
		if err := p.PC.AddICECandidate(c); err != nil {
			slog.Error("Failed to add buffered candidate", "err", err, "peer_id", p.ID)
		}
	}
	p.pendingCandidates = make([]webrtc.ICECandidateInit, 0)

	answer, err := p.PC.CreateAnswer(nil)
	if err != nil {
		return err
	}

	if err := p.PC.SetLocalDescription(answer); err != nil {
		return err
	}

	payload, err := json.Marshal(p.PC.LocalDescription())
	if err != nil {
		return err
	}

	return p.SendSignalFunc(domain.SignalingMessage{
		Type:    "answer",
		Payload: payload,
	})
}

func (p *Peer) HandleAnswer(answer webrtc.SessionDescription) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	
	if err := p.PC.SetRemoteDescription(answer); err != nil {
		return err
	}

	// Process pending candidates
	for _, c := range p.pendingCandidates {
		if err := p.PC.AddICECandidate(c); err != nil {
			slog.Error("Failed to add buffered candidate", "err", err, "peer_id", p.ID)
		}
	}
	p.pendingCandidates = make([]webrtc.ICECandidateInit, 0)
	
	return nil
}

func (p *Peer) HandleCandidate(candidate webrtc.ICECandidateInit) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.PC.RemoteDescription() == nil {
		slog.Info("Buffering candidate because remote description is not set", "peer_id", p.ID)
		p.pendingCandidates = append(p.pendingCandidates, candidate)
		return nil
	}
	
	return p.PC.AddICECandidate(candidate)
}

func (p *Peer) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.isClosed {
		return
	}
	p.isClosed = true
	p.cancel() // Cancela context ANTES de fechar PC

	if p.Room != nil {
		p.Room.RemovePeer(p.ID)
	}

	if p.PC != nil {
		p.PC.Close()
	}
}
