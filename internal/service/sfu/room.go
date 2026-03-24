package sfu

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/pion/webrtc/v4"
)

type RoomManager struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

func NewRoomManager() *RoomManager {
	return &RoomManager{
		rooms: make(map[string]*Room),
	}
}

func (m *RoomManager) GetOrCreateRoom(id string) *Room {
	m.mu.Lock()
	defer m.mu.Unlock()

	if r, ok := m.rooms[id]; ok {
		return r
	}

	r := &Room{
		ID:        id,
		Peers:     make(map[string]*Peer),
		Tracks:    make(map[string]trackInfo),
		manager:   m,
		UserLimit: 0,
	}
	m.rooms[id] = r
	slog.Info("Room created", "room_id", id)
	return r
}

func (m *RoomManager) deleteRoom(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.rooms, id)
	slog.Info("Room deleted (vazia)", "room_id", id)
}

type Room struct {
	ID        string
	UserLimit int // 0 = sem limite
	manager   *RoomManager
	mu        sync.RWMutex
	Peers     map[string]*Peer
	Tracks    map[string]trackInfo // key: "{sourcePeerID}-{trackID}-{rid}"
}

type trackInfo struct {
	track  *webrtc.TrackLocalStaticRTP
	peerID string
	kind   domain.TrackType
	rid    string // "h", "m", "l" ou "" (áudio/vídeo sem simulcast)
}

// AddPeer adiciona um peer à room. Retorna erro se o UserLimit foi atingido.
func (r *Room) AddPeer(p *Peer) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.UserLimit > 0 && len(r.Peers) >= r.UserLimit {
		return fmt.Errorf("room cheia: limite de %d participantes atingido", r.UserLimit)
	}

	r.Peers[p.ID] = p
	slog.Info("Peer added to room", "peer_id", p.ID, "room_id", r.ID)

	// Broadcast updated participants list
	r.broadcastParticipants()

	// Add existing tracks to the new peer, EXCEPT their own tracks
	for _, info := range r.Tracks {
		if info.peerID == p.ID {
			continue
		}
		if err := p.AddTrack(info.track); err != nil {
			slog.Error("Failed to add existing track to new peer", "err", err, "peer_id", p.ID)
		}
	}

	return nil
}

func (r *Room) RemovePeer(peerID string) {
	r.mu.Lock()

	delete(r.Peers, peerID)

	// Cleanup: Remove all tracks belonging to this peer
	for tid, info := range r.Tracks {
		if info.peerID == peerID {
			delete(r.Tracks, tid)
			slog.Info("Cleanup track from leaving peer", "track_id", tid, "peer_id", peerID)
		}
	}

	slog.Info("Peer removed from room", "peer_id", peerID, "room_id", r.ID)

	isEmpty := len(r.Peers) == 0
	r.mu.Unlock()

	if isEmpty {
		if r.manager != nil {
			r.manager.deleteRoom(r.ID)
		}
		return
	}

	// Broadcast updated participants list
	r.mu.RLock()
	r.broadcastParticipants()
	r.mu.RUnlock()
}

func (r *Room) broadcastParticipants() {
	participants := make([]domain.Participant, 0, len(r.Peers))
	for id, p := range r.Peers {
		participants = append(participants, domain.Participant{
			ID:   id,
			Name: p.Name,
		})
	}

	payload, err := json.Marshal(participants)
	if err != nil {
		slog.Error("broadcast: marshal error", "err", err)
		return
	}
	msg := domain.SignalingMessage{
		Type:    "participants",
		Payload: payload,
	}

	for _, p := range r.Peers {
		if err := p.SendSignalFunc(msg); err != nil {
			slog.Error("broadcast: send signal error", "peer_id", p.ID, "err", err)
		}
	}
}

// BroadcastExcept envia uma mensagem para todos os peers exceto o especificado.
func (r *Room) BroadcastExcept(exceptPeerID string, msg domain.SignalingMessage) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, p := range r.Peers {
		if id == exceptPeerID {
			continue
		}
		if err := p.SendSignalFunc(msg); err != nil {
			slog.Error("broadcast except: send error", "peer_id", p.ID, "err", err)
		}
	}
}

// AddTrack adiciona um track com metadados de tipo e RID.
func (r *Room) AddTrack(track *webrtc.TrackLocalStaticRTP, sourcePeerID string, kind domain.TrackType, rid string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Chave única inclui RID para suportar múltiplas layers de simulcast
	uniqueTrackID := fmt.Sprintf("%s-%s-%s", sourcePeerID, track.ID(), rid)
	r.Tracks[uniqueTrackID] = trackInfo{
		track:  track,
		peerID: sourcePeerID,
		kind:   kind,
		rid:    rid,
	}

	slog.Info("Track added to room", "track_id", uniqueTrackID, "room_id", r.ID, "source_peer", sourcePeerID, "kind", kind, "rid", rid)

	// Broadcast track to all other peers
	for pid, p := range r.Peers {
		if pid == sourcePeerID {
			continue // Don't loop back to sender
		}
		if err := p.AddTrack(track); err != nil {
			slog.Error("Failed to add new track to peer", "err", err, "peer_id", pid)
		}
	}
}

func (r *Room) RemoveTrack(trackID string, sourcePeerID string, rid string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	uniqueTrackID := fmt.Sprintf("%s-%s-%s", sourcePeerID, trackID, rid)
	delete(r.Tracks, uniqueTrackID)
	slog.Info("Track removed from room", "track_id", uniqueTrackID, "room_id", r.ID)
}
