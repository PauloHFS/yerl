package domain

import (
	"encoding/json"
)

// SignalingMessage represents a message sent over the WebSocket for WebRTC signaling.
type SignalingMessage struct {
	Type    string          `json:"type"`              // join, offer, answer, candidate
	RoomID  string          `json:"roomId,omitempty"`  // Used for "join"
	Payload json.RawMessage `json:"payload,omitempty"` // webrtc.SessionDescription or webrtc.ICECandidateInit
}

// JoinPayload represents the payload for a "join" message.
type JoinPayload struct {
	RoomID string `json:"roomId"`
	Name   string `json:"name"`
}

// Participant represents a user in a room.
type Participant struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// JoinedPayload is sent to a peer after they successfully join a room.
type JoinedPayload struct {
	PeerID string `json:"peerID"`
}
