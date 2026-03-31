package http

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096
)

type ChatClient struct {
	Hub      *ChatHub
	Conn     *websocket.Conn
	UserID   string
	UserName string
	Send     chan []byte
	handler  func(client *ChatClient, msg ChatMessage)
}

type ChatMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type ChatResponse struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

func (c *ChatClient) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	if err := c.Conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		slog.Error("chat ws: falha ao definir read deadline", "user_id", c.UserID, "err", err)
		return
	}
	c.Conn.SetPongHandler(func(string) error {
		return c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, data, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				slog.Error("chat ws read error", "user_id", c.UserID, "err", err)
			}
			break
		}

		var msg ChatMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Warn("chat ws invalid json", "user_id", c.UserID, "err", err)
			continue
		}

		if c.handler != nil {
			c.handler(c, msg)
		}
	}
}

func (c *ChatClient) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			if !ok {
				_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			if err := c.Conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				return
			}
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *ChatClient) SendJSON(resp ChatResponse) {
	data, err := json.Marshal(resp)
	if err != nil {
		slog.Error("chat marshal error", "user_id", c.UserID, "err", err)
		return
	}
	select {
	case c.Send <- data:
	default:
		slog.Warn("chat client send buffer full", "user_id", c.UserID)
	}
}
