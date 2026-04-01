package http_test

import (
	"testing"
	"time"

	transporthttp "github.com/PauloHFS/yerl/internal/transport/http"
	"github.com/stretchr/testify/assert"
)

func TestChatHub_RegisterAndUnregister(t *testing.T) {
	hub := transporthttp.NewChatHub()
	go hub.Run()
	defer hub.Stop()

	client := &transporthttp.ChatClient{
		Send: make(chan []byte, 256),
	}

	hub.Register <- client
	time.Sleep(10 * time.Millisecond)
	assert.True(t, hub.HasClient(client))

	hub.Unregister <- client
	time.Sleep(10 * time.Millisecond)
	assert.False(t, hub.HasClient(client))
}

func TestChatHub_SubscribeAndBroadcast(t *testing.T) {
	hub := transporthttp.NewChatHub()
	go hub.Run()
	defer hub.Stop()

	client1 := &transporthttp.ChatClient{Send: make(chan []byte, 256)}
	client2 := &transporthttp.ChatClient{Send: make(chan []byte, 256)}
	client3 := &transporthttp.ChatClient{Send: make(chan []byte, 256)}

	hub.Register <- client1
	hub.Register <- client2
	hub.Register <- client3
	time.Sleep(10 * time.Millisecond)

	hub.Subscribe <- transporthttp.Subscription{Client: client1, ChannelID: "ch-geral"}
	hub.Subscribe <- transporthttp.Subscription{Client: client2, ChannelID: "ch-geral"}
	// client3 not subscribed to ch-geral
	time.Sleep(10 * time.Millisecond)

	hub.Broadcast <- transporthttp.BroadcastMessage{ChannelID: "ch-geral", Data: []byte(`{"type":"new-message"}`)}
	time.Sleep(10 * time.Millisecond)

	assert.Len(t, client1.Send, 1)
	assert.Len(t, client2.Send, 1)
	assert.Len(t, client3.Send, 0) // not subscribed
}

func TestChatHub_Unsubscribe(t *testing.T) {
	hub := transporthttp.NewChatHub()
	go hub.Run()
	defer hub.Stop()

	client := &transporthttp.ChatClient{Send: make(chan []byte, 256)}
	hub.Register <- client
	hub.Subscribe <- transporthttp.Subscription{Client: client, ChannelID: "ch-geral"}
	time.Sleep(10 * time.Millisecond)

	hub.Unsubscribe <- transporthttp.Subscription{Client: client, ChannelID: "ch-geral"}
	time.Sleep(10 * time.Millisecond)

	hub.Broadcast <- transporthttp.BroadcastMessage{ChannelID: "ch-geral", Data: []byte(`{"msg":"test"}`)}
	time.Sleep(10 * time.Millisecond)

	assert.Len(t, client.Send, 0)
}

func TestChatHub_UnregisterCleansUpSubscriptions(t *testing.T) {
	hub := transporthttp.NewChatHub()
	go hub.Run()
	defer hub.Stop()

	client := &transporthttp.ChatClient{Send: make(chan []byte, 256)}
	hub.Register <- client
	hub.Subscribe <- transporthttp.Subscription{Client: client, ChannelID: "ch-geral"}
	hub.Subscribe <- transporthttp.Subscription{Client: client, ChannelID: "ch-dev"}
	time.Sleep(10 * time.Millisecond)

	hub.Unregister <- client
	time.Sleep(10 * time.Millisecond)

	// Broadcast should not panic or send to closed channel
	hub.Broadcast <- transporthttp.BroadcastMessage{ChannelID: "ch-geral", Data: []byte(`{"msg":"test"}`)}
	time.Sleep(10 * time.Millisecond)
	// No assertion needed — if it doesn't panic, it passes
}
