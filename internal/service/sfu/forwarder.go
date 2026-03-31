package sfu

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// TrackForwarder encapsula o forwarding de RTP de um track remoto para um track local.
// Strip de extension headers é feito para compatibilidade cross-browser.
type TrackForwarder struct {
	ctx    context.Context
	cancel context.CancelFunc
	remote *webrtc.TrackRemote
	local  *webrtc.TrackLocalStaticRTP
	RID    string
}

// newTrackForwarder cria um novo TrackForwarder.
func newTrackForwarder(ctx context.Context, remote *webrtc.TrackRemote, local *webrtc.TrackLocalStaticRTP) *TrackForwarder {
	fwdCtx, cancel := context.WithCancel(ctx)
	return &TrackForwarder{
		ctx:    fwdCtx,
		cancel: cancel,
		remote: remote,
		local:  local,
		RID:    remote.RID(),
	}
}

// Start inicia a goroutine de forwarding RTP.
func (f *TrackForwarder) Start() {
	go f.readRTPLoop()
}

// Stop cancela o context, encerrando a goroutine de forwarding.
func (f *TrackForwarder) Stop() {
	f.cancel()
}

// readRTPLoop lê pacotes RTP do track remoto, strip de extension headers, e escreve no track local.
// Extension headers são removidas porque browsers diferentes usam IDs distintos —
// sem limpeza, vídeo quebra em conexões cross-browser (ex: Chrome→Firefox).
func (f *TrackForwarder) readRTPLoop() {
	buf := make([]byte, 1500)
	for {
		select {
		case <-f.ctx.Done():
			return
		default:
		}

		n, _, err := f.remote.Read(buf)
		if err != nil {
			if !errors.Is(err, io.EOF) && f.ctx.Err() == nil {
				slog.Error("forwarder: read rtp error", "rid", f.RID, "err", err)
			}
			return
		}

		pkt := &rtp.Packet{}
		if err := pkt.Unmarshal(buf[:n]); err != nil {
			continue
		}

		// Strip de extension headers para compatibilidade cross-browser
		pkt.Extension = false
		pkt.Extensions = nil

		if err := f.local.WriteRTP(pkt); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			slog.Error("forwarder: write rtp error", "rid", f.RID, "err", err)
		}
	}
}

// ClassifyTrack determina o TrackType com base no streamID e no kind do codec.
// Convenção de streamID:
//   - "{peerID}-camera"  → audio/video de câmera
//   - "{peerID}-screen-{index}" → screenshare-video ou screenshare-audio
func ClassifyTrack(streamID string, kind webrtc.RTPCodecType) domain.TrackType {
	if strings.Contains(streamID, "-screen-") {
		if kind == webrtc.RTPCodecTypeVideo {
			return domain.TrackTypeScreenVideo
		}
		return domain.TrackTypeScreenAudio
	}

	if kind == webrtc.RTPCodecTypeVideo {
		return domain.TrackTypeVideo
	}
	return domain.TrackTypeAudio
}
