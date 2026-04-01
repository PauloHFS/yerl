package http

import (
	"log/slog"
	"sync"
)

type Subscription struct {
	Client    *ChatClient
	ChannelID string
}

type BroadcastMessage struct {
	ChannelID string
	Data      []byte
}

type hasClientQuery struct {
	client *ChatClient
	reply  chan bool
}

type ChatHub struct {
	clients     map[*ChatClient]bool
	channels    map[string]map[*ChatClient]bool
	Register    chan *ChatClient
	Unregister  chan *ChatClient
	Subscribe   chan Subscription
	Unsubscribe chan Subscription
	Broadcast   chan BroadcastMessage
	hasClientCh chan hasClientQuery
	stop        chan struct{}
	stopOnce    sync.Once
}

func NewChatHub() *ChatHub {
	return &ChatHub{
		clients:     make(map[*ChatClient]bool),
		channels:    make(map[string]map[*ChatClient]bool),
		Register:    make(chan *ChatClient),
		Unregister:  make(chan *ChatClient),
		Subscribe:   make(chan Subscription),
		Unsubscribe: make(chan Subscription),
		Broadcast:   make(chan BroadcastMessage),
		hasClientCh: make(chan hasClientQuery),
		stop:        make(chan struct{}),
	}
}

func (h *ChatHub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.clients[client] = true

		case client := <-h.Unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.Send)
				for channelID, subscribers := range h.channels {
					delete(subscribers, client)
					if len(subscribers) == 0 {
						delete(h.channels, channelID)
					}
				}
			}

		case sub := <-h.Subscribe:
			if h.channels[sub.ChannelID] == nil {
				h.channels[sub.ChannelID] = make(map[*ChatClient]bool)
			}
			h.channels[sub.ChannelID][sub.Client] = true

		case sub := <-h.Unsubscribe:
			if subscribers, ok := h.channels[sub.ChannelID]; ok {
				delete(subscribers, sub.Client)
				if len(subscribers) == 0 {
					delete(h.channels, sub.ChannelID)
				}
			}

		case msg := <-h.Broadcast:
			if subscribers, ok := h.channels[msg.ChannelID]; ok {
				for client := range subscribers {
					select {
					case client.Send <- msg.Data:
					default:
						// Client buffer full — disconnect
						slog.Warn("chat: buffer cheio, desconectando cliente", "user_id", client.UserID)
						delete(h.clients, client)
						close(client.Send)
						for chID, subs := range h.channels {
							delete(subs, client)
							if len(subs) == 0 {
								delete(h.channels, chID)
							}
						}
					}
				}
			}

		case q := <-h.hasClientCh:
			_, ok := h.clients[q.client]
			q.reply <- ok

		case <-h.stop:
			for client := range h.clients {
				close(client.Send)
			}
			return
		}
	}
}

func (h *ChatHub) Stop() {
	h.stopOnce.Do(func() { close(h.stop) })
}

func (h *ChatHub) HasClient(c *ChatClient) bool {
	reply := make(chan bool, 1)
	select {
	case h.hasClientCh <- hasClientQuery{client: c, reply: reply}:
		return <-reply
	case <-h.stop:
		return false
	}
}
