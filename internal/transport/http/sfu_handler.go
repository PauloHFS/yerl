package http

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/PauloHFS/yerl/internal/service/sfu"
	"github.com/google/uuid"
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

func (h *SFUHandler) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("Failed to upgrade websocket", "err", err)
		return
	}
	defer conn.Close()

	peerID := uuid.New().String()
	slog.Info("New WebSocket connection", "peer_id", peerID)

	var currentPeer *sfu.Peer
	var writeMu sync.Mutex // Protege a escrita simultânea no WebSocket

	sendSignal := func(msg domain.SignalingMessage) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(msg)
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
				// Fallback para suportar o formato anterior se necessário, mas idealmente usar o novo
				joinData.RoomID = msg.RoomID
			}
			
			if joinData.RoomID == "" {
				joinData.RoomID = msg.RoomID
			}

			room := h.roomManager.GetOrCreateRoom(joinData.RoomID)
			p, err := sfu.NewPeer(r.Context(), peerID, joinData.Name, room, sendSignal)
			if err != nil {
				slog.Error("Failed to create peer", "err", err)
				break
			}
			
			currentPeer = p
			room.AddPeer(p)
			slog.Info("Peer joined room", "peer_id", peerID, "room_id", joinData.RoomID, "name", joinData.Name)

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
		default:
			slog.Warn("Unknown signaling message type", "type", msg.Type)
		}
	}

	if currentPeer != nil {
		currentPeer.Close()
	}
}
