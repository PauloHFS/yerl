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

// TrackType classifica o tipo de track de mídia.
type TrackType string

const (
	TrackTypeAudio       TrackType = "audio"
	TrackTypeVideo       TrackType = "video"
	TrackTypeScreenVideo TrackType = "screenshare-video"
	TrackTypeScreenAudio TrackType = "screenshare-audio"
)

// TrackAddedPayload é enviado quando um peer adiciona um track.
type TrackAddedPayload struct {
	PeerID    string    `json:"peerID"`
	TrackType TrackType `json:"trackType"`
	RID       string    `json:"rid,omitempty"` // "h", "m", "l" ou "" (áudio)
}

// TrackRemovedPayload é enviado quando um track é removido.
type TrackRemovedPayload struct {
	PeerID    string    `json:"peerID"`
	TrackType TrackType `json:"trackType"`
}

// SelectLayerPayload é enviado pelo cliente para selecionar uma layer de simulcast.
type SelectLayerPayload struct {
	PeerID    string    `json:"peerID"`
	TrackType TrackType `json:"trackType"`
	RID       string    `json:"rid"` // "h", "m" ou "l"
}

// MuteStatusPayload é enviado para notificar mudança de mute.
type MuteStatusPayload struct {
	PeerID    string    `json:"peerID"`
	TrackType TrackType `json:"trackType"`
	Muted     bool      `json:"muted"`
}

// ErrorPayload é enviado pelo servidor quando ocorre um erro.
type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ScreenSharePayload é enviado ao iniciar ou encerrar screen share.
type ScreenSharePayload struct {
	PeerID  string `json:"peerID"`
	ShareID string `json:"shareID"`
}
