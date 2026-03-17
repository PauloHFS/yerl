package http

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/google/uuid"
)

type contextKey string

const (
	RequestIDKey contextKey = "request_id"
	LoggerKey    contextKey = "logger"
)

// GetLogger recupera o logger do contexto para adicionar atributos de negócio
func GetLogger(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(LoggerKey).(*slog.Logger); ok {
		return logger
	}
	return slog.Default()
}

// responseWriterInterceptor captura o status code para o log final
type responseWriterInterceptor struct {
	http.ResponseWriter
	statusCode int
	bodySize   int
}

func (w *responseWriterInterceptor) WriteHeader(statusCode int) {
	w.statusCode = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *responseWriterInterceptor) Write(b []byte) (int, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bodySize += n
	return n, err
}

func (w *responseWriterInterceptor) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("ResponseWriter does not implement http.Hijacker")
	}
	return h.Hijack()
}

func (w *responseWriterInterceptor) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// LoggingMiddleware implementa o padrão de Wide Events (Canonical Log Lines)
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.New().String()
		}

		// Adiciona o logger rico em contexto para os handlers usarem
		logger := slog.With(
			slog.String("request_id", requestID),
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.String("remote_addr", r.RemoteAddr),
			slog.String("user_agent", r.UserAgent()),
		)

		ctx := context.WithValue(r.Context(), RequestIDKey, requestID)
		ctx = context.WithValue(ctx, LoggerKey, logger)
		r = r.WithContext(ctx)

		interceptor := &responseWriterInterceptor{ResponseWriter: w, statusCode: http.StatusOK}

		// Recupera de pânicos para garantir que o log seja emitido
		defer func() {
			if err := recover(); err != nil {
				interceptor.statusCode = http.StatusInternalServerError
				logger.Error("panic_recovered",
					slog.Any("error", err),
					slog.String("stack", string(debug.Stack())),
				)
				http.Error(interceptor, "Internal Server Error", http.StatusInternalServerError)
			}

			// O WIDE EVENT: Uma única linha com todo o contexto
			duration := time.Since(start)
			
			logLevel := slog.LevelInfo
			if interceptor.statusCode >= 500 {
				logLevel = slog.LevelError
			}

			slog.Log(r.Context(), logLevel, "request_completed",
				slog.String("request_id", requestID),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status_code", interceptor.statusCode),
				slog.Duration("duration_ms", duration),
				slog.Int("response_size_bytes", interceptor.bodySize),
				slog.String("user_agent", r.UserAgent()),
			)
		}()

		next.ServeHTTP(interceptor, r)
	})
}
