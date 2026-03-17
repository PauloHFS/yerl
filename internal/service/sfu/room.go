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
		ID:     id,
		Peers:  make(map[string]*Peer),
		Tracks: make(map[string]trackInfo),
	}
	m.rooms[id] = r
	slog.Info("Room created", "room_id", id)
	return r
}

type Room struct {
	ID     string
	mu     sync.RWMutex
	Peers  map[string]*Peer
	Tracks map[string]trackInfo // key: unique track ID
}

type trackInfo struct {
	track   *webrtc.TrackLocalStaticRTP
	peerID  string
}

func (r *Room) AddPeer(p *Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()

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
}

func (r *Room) RemovePeer(peerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.Peers, peerID)
	
	// Cleanup: Remove all tracks belonging to this peer
	for tid, info := range r.Tracks {
		if info.peerID == peerID {
			delete(r.Tracks, tid)
			slog.Info("Cleanup track from leaving peer", "track_id", tid, "peer_id", peerID)
		}
	}
	
	slog.Info("Peer removed from room", "peer_id", peerID, "room_id", r.ID)

	// Broadcast updated participants list
	r.broadcastParticipants()
}

func (r *Room) broadcastParticipants() {
	participants := make([]domain.Participant, 0, len(r.Peers))
	for id, p := range r.Peers {
		participants = append(participants, domain.Participant{
			ID:   id,
			Name: p.Name,
		})
	}

	payload, _ := json.Marshal(participants)
	msg := domain.SignalingMessage{
		Type:    "participants",
		Payload: payload,
	}

	for _, p := range r.Peers {
		_ = p.SendSignalFunc(msg)
	}
}

func (r *Room) AddTrack(track *webrtc.TrackLocalStaticRTP, sourcePeerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Use a unique key for the map to avoid collisions between users with same track IDs
	uniqueTrackID := fmt.Sprintf("%s-%s", sourcePeerID, track.ID())
	r.Tracks[uniqueTrackID] = trackInfo{
		track:  track,
		peerID: sourcePeerID,
	}

	slog.Info("Track added to room", "track_id", uniqueTrackID, "room_id", r.ID, "source_peer", sourcePeerID)

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

func (r *Room) RemoveTrack(trackID string, sourcePeerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	uniqueTrackID := fmt.Sprintf("%s-%s", sourcePeerID, trackID)
	delete(r.Tracks, uniqueTrackID)
	slog.Info("Track removed from room", "track_id", uniqueTrackID, "room_id", r.ID)
}
