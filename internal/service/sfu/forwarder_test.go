package sfu

import (
	"testing"

	"github.com/PauloHFS/yerl/internal/domain"
	"github.com/pion/webrtc/v4"
	"github.com/stretchr/testify/assert"
)

func TestClassifyTrack(t *testing.T) {
	tests := []struct {
		name     string
		streamID string
		kind     webrtc.RTPCodecType
		want     domain.TrackType
	}{
		{
			name:     "câmera com vídeo → TrackTypeVideo",
			streamID: "peer-1-camera",
			kind:     webrtc.RTPCodecTypeVideo,
			want:     domain.TrackTypeVideo,
		},
		{
			name:     "câmera com áudio → TrackTypeAudio",
			streamID: "peer-1-camera",
			kind:     webrtc.RTPCodecTypeAudio,
			want:     domain.TrackTypeAudio,
		},
		{
			name:     "screen share com vídeo → TrackTypeScreenVideo",
			streamID: "peer-1-screen-0",
			kind:     webrtc.RTPCodecTypeVideo,
			want:     domain.TrackTypeScreenVideo,
		},
		{
			name:     "screen share com áudio → TrackTypeScreenAudio",
			streamID: "peer-1-screen-0",
			kind:     webrtc.RTPCodecTypeAudio,
			want:     domain.TrackTypeScreenAudio,
		},
		{
			name:     "screen share índice > 0 com vídeo",
			streamID: "abc123-screen-2",
			kind:     webrtc.RTPCodecTypeVideo,
			want:     domain.TrackTypeScreenVideo,
		},
		{
			name:     "stream sem sufixo conhecido com vídeo → TrackTypeVideo",
			streamID: "peer-xyz",
			kind:     webrtc.RTPCodecTypeVideo,
			want:     domain.TrackTypeVideo,
		},
		{
			name:     "stream sem sufixo conhecido com áudio → TrackTypeAudio",
			streamID: "peer-xyz",
			kind:     webrtc.RTPCodecTypeAudio,
			want:     domain.TrackTypeAudio,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ClassifyTrack(tt.streamID, tt.kind)
			assert.Equal(t, tt.want, got)
		})
	}
}
