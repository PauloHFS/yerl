package http

import (
	"github.com/gorilla/websocket"
)

type ChatClient struct {
	Hub      *ChatHub
	Conn     *websocket.Conn
	UserID   string
	UserName string
	Send     chan []byte
}
