package http

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"sync"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/PauloHFS/yerl/internal/service/sfu"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Em dev, permitir qualquer origem. Em prod, restringir para os domínios do Yerl.
	},
}

type SFUHandler struct {
	roomManager *sfu.RoomManager
}

func NewSFUHandler(roomManager *sfu.RoomManager) *SFUHandler {
	return &SFUHandler{
		roomManager: roomManager,
	}
}

var roomIDRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func (h *SFUHandler) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("Failed to upgrade websocket", "err", err)
		return
	}
	defer conn.Close()

	// Auth simplificado: userId via query param (login stub — sem auth real ainda)
	userID := r.URL.Query().Get("userId")
	userName := r.URL.Query().Get("name")

	peerID := userID
	if peerID == "" {
		// Fallback para compatibilidade se userId não fornecido
		peerID = r.URL.Query().Get("peerId")
	}
	slog.Info("New WebSocket connection", "peer_id", peerID, "name", userName)

	var currentPeer *sfu.Peer
	var writeMu sync.Mutex // Protege a escrita simultânea no WebSocket

	sendSignal := func(msg domain.SignalingMessage) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(msg)
	}

	sendError := func(code, message string) {
		payload, _ := json.Marshal(domain.ErrorPayload{Code: code, Message: message})
		_ = sendSignal(domain.SignalingMessage{Type: "error", Payload: payload})
	}

	for {
		var msg domain.SignalingMessage
		if err := conn.ReadJSON(&msg); err != nil {
			slog.Info("WebSocket closed or error reading JSON", "err", err, "peer_id", peerID)
			break
		}

		switch msg.Type {
		case "join":
			if currentPeer != nil {
				slog.Warn("Peer already joined a room", "peer_id", peerID)
				continue
			}

			var joinData domain.JoinPayload
			if err := json.Unmarshal(msg.Payload, &joinData); err != nil {
				joinData.RoomID = msg.RoomID
			}
			if joinData.RoomID == "" {
				joinData.RoomID = msg.RoomID
			}

			// Name do query param tem precedência; fallback para payload
			if userName != "" {
				joinData.Name = userName
			}

			// Validar roomID
			if joinData.RoomID == "" || len(joinData.RoomID) > 64 {
				sendError("invalid-room", "roomID inválido")
				continue
			}
			if !roomIDRegex.MatchString(joinData.RoomID) {
				sendError("invalid-room", "roomID contém caracteres inválidos")
				continue
			}
			// Validar name
			if joinData.Name == "" || len(joinData.Name) > 32 {
				sendError("invalid-name", "name inválido")
				continue
			}

			room := h.roomManager.GetOrCreateRoom(joinData.RoomID)
			p, err := sfu.NewPeer(r.Context(), peerID, joinData.Name, room, sendSignal)
			if err != nil {
				slog.Error("Failed to create peer", "err", err)
				break
			}

			if err := room.AddPeer(p); err != nil {
				slog.Warn("Room cheia", "peer_id", peerID, "err", err)
				sendError("room-full", err.Error())
				p.Close()
				continue
			}

			currentPeer = p
			slog.Info("Peer joined room", "peer_id", peerID, "room_id", joinData.RoomID, "name", joinData.Name)

			joinedPayload, err := json.Marshal(domain.JoinedPayload{PeerID: peerID})
			if err != nil {
				slog.Error("failed to marshal joined payload", "peer_id", peerID, "err", err)
			} else if err := sendSignal(domain.SignalingMessage{Type: "joined", Payload: joinedPayload}); err != nil {
				slog.Error("failed to send joined message", "peer_id", peerID, "err", err)
			}

		case "offer":
			if currentPeer == nil {
				continue
			}
			var offer webrtc.SessionDescription
			if err := json.Unmarshal(msg.Payload, &offer); err != nil {
				slog.Error("Failed to unmarshal offer", "err", err)
				continue
			}
			if err := currentPeer.HandleOffer(offer); err != nil {
				slog.Error("Failed to handle offer", "err", err)
			}

		case "answer":
			if currentPeer == nil {
				continue
			}
			var answer webrtc.SessionDescription
			if err := json.Unmarshal(msg.Payload, &answer); err != nil {
				slog.Error("Failed to unmarshal answer", "err", err)
				continue
			}
			if err := currentPeer.HandleAnswer(answer); err != nil {
				slog.Error("Failed to handle answer", "err", err)
			}

		case "candidate":
			if currentPeer == nil {
				continue
			}
			var candidate webrtc.ICECandidateInit
			if err := json.Unmarshal(msg.Payload, &candidate); err != nil {
				slog.Error("Failed to unmarshal candidate", "err", err)
				continue
			}
			if err := currentPeer.HandleCandidate(candidate); err != nil {
				slog.Error("Failed to handle candidate", "err", err)
			}

		case "mute-status":
			if currentPeer == nil {
				continue
			}
			var mutePayload domain.MuteStatusPayload
			if err := json.Unmarshal(msg.Payload, &mutePayload); err != nil {
				slog.Error("Failed to unmarshal mute-status", "err", err)
				continue
			}
			// Broadcast para todos os outros peers
			currentPeer.Room.BroadcastExcept(peerID, msg)

		default:
			slog.Warn("Unknown signaling message type", "type", msg.Type)
		}
	}

	if currentPeer != nil {
		currentPeer.Close()
	}
}
