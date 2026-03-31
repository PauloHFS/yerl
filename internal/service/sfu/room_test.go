package sfu

import (
	"errors"
	"sync"
	"testing"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/pion/webrtc/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestTrack cria um TrackLocalStaticRTP para uso em testes.
func newTestTrack(t *testing.T) *webrtc.TrackLocalStaticRTP {
	t.Helper()
	track, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{
		MimeType:  webrtc.MimeTypeVP8,
		ClockRate: 90000,
	}, "video-track-"+t.Name(), "stream-id")
	require.NoError(t, err)
	return track
}

// mockPeer cria um Peer leve sem PeerConnection real, útil para testes de Room.
func mockPeer(id, name string, signals *[]domain.SignalingMessage) *Peer {
	return &Peer{
		ID:   id,
		Name: name,
		SendSignalFunc: func(msg domain.SignalingMessage) error {
			if signals != nil {
				*signals = append(*signals, msg)
			}
			return nil
		},
	}
}

// mockRoom cria uma Room sem manager (nil-safe).
func mockRoom(id string) *Room {
	return &Room{
		ID:     id,
		Peers:  make(map[string]*Peer),
		Tracks: make(map[string]trackInfo),
	}
}

// --- RoomManager ---

func TestRoomManager_GetOrCreateRoom_CriaNovaRoom(t *testing.T) {
	m := NewRoomManager()
	r := m.GetOrCreateRoom("sala-1")
	require.NotNil(t, r)
	assert.Equal(t, "sala-1", r.ID)
}

func TestRoomManager_GetOrCreateRoom_RetornaExistente(t *testing.T) {
	m := NewRoomManager()
	r1 := m.GetOrCreateRoom("sala-1")
	r2 := m.GetOrCreateRoom("sala-1")
	assert.Same(t, r1, r2, "deve retornar o mesmo ponteiro para a room existente")
}

func TestRoomManager_GetOrCreateRoom_IsolaRoomsDiferentes(t *testing.T) {
	m := NewRoomManager()
	r1 := m.GetOrCreateRoom("sala-1")
	r2 := m.GetOrCreateRoom("sala-2")
	assert.NotSame(t, r1, r2)
}

func TestRoomManager_DeleteRoom_RemoveRoom(t *testing.T) {
	m := NewRoomManager()
	m.GetOrCreateRoom("sala-1")
	m.deleteRoom("sala-1")

	// Após deletar, GetOrCreateRoom deve criar uma nova instância
	r := m.GetOrCreateRoom("sala-1")
	require.NotNil(t, r)
}

// --- Room.AddPeer ---

func TestRoom_AddPeer_SucessoSemLimite(t *testing.T) {
	r := mockRoom("sala")
	p := mockPeer("p1", "User1", nil)

	err := r.AddPeer(p)
	require.NoError(t, err)
	assert.Contains(t, r.Peers, "p1")
}

func TestRoom_AddPeer_BroadcastParticipants(t *testing.T) {
	var signals []domain.SignalingMessage
	r := mockRoom("sala")
	p := mockPeer("p1", "User1", &signals)

	err := r.AddPeer(p)
	require.NoError(t, err)

	// Ao adicionar um peer, broadcastParticipants é chamado e envia "participants" para o próprio peer
	require.NotEmpty(t, signals)
	assert.Equal(t, "participants", signals[0].Type)
}

func TestRoom_AddPeer_UserLimit_Atingido(t *testing.T) {
	r := mockRoom("sala")
	r.UserLimit = 1
	p1 := mockPeer("p1", "User1", nil)
	p2 := mockPeer("p2", "User2", nil)

	require.NoError(t, r.AddPeer(p1))
	err := r.AddPeer(p2)
	assert.Error(t, err, "deve retornar erro quando limite de participantes é atingido")
}

func TestRoom_AddPeer_UserLimit_DentroDoLimite(t *testing.T) {
	r := mockRoom("sala")
	r.UserLimit = 2
	p1 := mockPeer("p1", "User1", nil)
	p2 := mockPeer("p2", "User2", nil)

	require.NoError(t, r.AddPeer(p1))
	require.NoError(t, r.AddPeer(p2))
	assert.Len(t, r.Peers, 2)
}

func TestRoom_AddPeer_UserLimitZero_SemLimite(t *testing.T) {
	r := mockRoom("sala")
	r.UserLimit = 0 // sem limite

	for i := range 10 {
		p := mockPeer(string(rune('a'+i)), "User", nil)
		require.NoError(t, r.AddPeer(p))
	}
	assert.Len(t, r.Peers, 10)
}

// --- Room.RemovePeer ---

func TestRoom_RemovePeer_RemovePeerETracksDoMesmoPeer(t *testing.T) {
	r := mockRoom("sala")
	p1 := mockPeer("p1", "User1", nil)
	p2 := mockPeer("p2", "User2", nil)

	require.NoError(t, r.AddPeer(p1))
	require.NoError(t, r.AddPeer(p2))

	// Adiciona track fictício pertencente a p1
	r.mu.Lock()
	r.Tracks["p1-track-abc-"] = trackInfo{peerID: "p1"}
	r.Tracks["p2-track-xyz-"] = trackInfo{peerID: "p2"}
	r.mu.Unlock()

	r.RemovePeer("p1")

	assert.NotContains(t, r.Peers, "p1")
	assert.NotContains(t, r.Tracks, "p1-track-abc-", "tracks do peer removido devem ser deletados")
	assert.Contains(t, r.Tracks, "p2-track-xyz-", "tracks de outros peers devem permanecer")
}

func TestRoom_RemovePeer_RoomVazia_ChamaDeleteRoom(t *testing.T) {
	m := NewRoomManager()
	r := m.GetOrCreateRoom("sala-efemera")
	p := mockPeer("p1", "User1", nil)

	require.NoError(t, r.AddPeer(p))

	r.RemovePeer("p1")

	// Room vazia deve ter sido removida do manager
	m.mu.RLock()
	_, exists := m.rooms["sala-efemera"]
	m.mu.RUnlock()
	assert.False(t, exists, "room vazia deve ser removida do manager")
}

func TestRoom_RemovePeer_NaoVazia_NaoRemoveDoManager(t *testing.T) {
	m := NewRoomManager()
	r := m.GetOrCreateRoom("sala-persistente")
	p1 := mockPeer("p1", "User1", nil)
	p2 := mockPeer("p2", "User2", nil)

	require.NoError(t, r.AddPeer(p1))
	require.NoError(t, r.AddPeer(p2))

	r.RemovePeer("p1")

	m.mu.RLock()
	_, exists := m.rooms["sala-persistente"]
	m.mu.RUnlock()
	assert.True(t, exists, "room com peers restantes não deve ser removida do manager")
}

func TestRoom_RemovePeer_SemManager_NaoPanica(t *testing.T) {
	// Room sem manager (nil) — não deve dar panic ao esvaziar
	r := mockRoom("sala-sem-manager")
	p := mockPeer("p1", "User1", nil)

	require.NoError(t, r.AddPeer(p))

	assert.NotPanics(t, func() {
		r.RemovePeer("p1")
	})
}

// --- Room.BroadcastExcept ---

func TestRoom_BroadcastExcept_IgnoraPeerExcluido(t *testing.T) {
	r := mockRoom("sala")
	var sig1, sig2 []domain.SignalingMessage
	p1 := mockPeer("p1", "User1", &sig1)
	p2 := mockPeer("p2", "User2", &sig2)

	require.NoError(t, r.AddPeer(p1))
	require.NoError(t, r.AddPeer(p2))

	// Limpa signals do AddPeer
	sig1 = nil
	sig2 = nil

	msg := domain.SignalingMessage{Type: "test"}
	r.BroadcastExcept("p1", msg)

	assert.Empty(t, sig1, "p1 (excluído) não deve receber a mensagem")
	assert.Len(t, sig2, 1, "p2 deve receber a mensagem")
}

func TestRoom_BroadcastExcept_EnviaParaTodos_ExcetoUm(t *testing.T) {
	r := mockRoom("sala")
	recebidos := make(map[string]int)
	var mu sync.Mutex

	for _, id := range []string{"p1", "p2", "p3"} {
		pid := id
		p := &Peer{
			ID:   pid,
			Name: pid,
			SendSignalFunc: func(msg domain.SignalingMessage) error {
				mu.Lock()
				recebidos[pid]++
				mu.Unlock()
				return nil
			},
		}
		require.NoError(t, r.AddPeer(p))
	}

	// Limpa signals do AddPeer
	mu.Lock()
	clear(recebidos)
	mu.Unlock()

	r.BroadcastExcept("p1", domain.SignalingMessage{Type: "ping"})

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 0, recebidos["p1"])
	assert.Equal(t, 1, recebidos["p2"])
	assert.Equal(t, 1, recebidos["p3"])
}

func TestRoom_BroadcastExcept_ErroDeEnvio_NaoInterrompeBroadcast(t *testing.T) {
	r := mockRoom("sala")
	var sig3 []domain.SignalingMessage

	// p1 com SendSignalFunc que falha
	p1 := &Peer{
		ID:   "p1",
		Name: "User1",
		SendSignalFunc: func(msg domain.SignalingMessage) error {
			return errors.New("send failed")
		},
	}
	// p3 que funciona normalmente
	p3 := mockPeer("p3", "User3", &sig3)

	require.NoError(t, r.AddPeer(p1))
	require.NoError(t, r.AddPeer(p3))

	sig3 = nil

	assert.NotPanics(t, func() {
		r.BroadcastExcept("p2", domain.SignalingMessage{Type: "ping"})
	})

	// p3 deve ter recebido apesar do erro em p1
	assert.Len(t, sig3, 1)
}

// --- Room.AddTrack ---

func TestRoom_AddTrack_ArmazenaTrackComMetadados(t *testing.T) {
	r := mockRoom("sala")
	track := newTestTrack(t)

	r.AddTrack(track, "p1", domain.TrackTypeVideo, "h")

	r.mu.RLock()
	defer r.mu.RUnlock()
	assert.Len(t, r.Tracks, 1)
	for _, info := range r.Tracks {
		assert.Equal(t, "p1", info.peerID)
		assert.Equal(t, domain.TrackTypeVideo, info.kind)
		assert.Equal(t, "h", info.rid)
	}
}

func TestRoom_AddTrack_SimulcastLayersArmazenadosSeparadamente(t *testing.T) {
	r := mockRoom("sala")

	for _, rid := range []string{"l", "m", "h"} {
		track := newTestTrack(t)
		r.AddTrack(track, "p1", domain.TrackTypeVideo, rid)
	}

	r.mu.RLock()
	defer r.mu.RUnlock()
	assert.Len(t, r.Tracks, 3, "cada layer de simulcast deve ser uma entrada separada")
}
