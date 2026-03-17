package http

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/PauloHFS/yerl/web"
)

// serveSPA cuida de servir os arquivos do frontend embutido
// e de fazer o fallback para o index.html caso a rota não seja encontrada.
func serveSPA(mux *http.ServeMux) {
	// Acessar a subpasta dist que está dentro do DistFS embed
	distFS, err := fs.Sub(web.DistFS, "dist")
	if err != nil {
		panic(err) // Se der erro aqui, a build ou o embed falhou
	}
	
	fileServer := http.FileServer(http.FS(distFS))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Se a requisição for para a API, não intercepta (por via das dúvidas)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}

		// Tenta abrir o arquivo do embed FS
		f, err := distFS.Open(strings.TrimPrefix(r.URL.Path, "/"))
		if err != nil {
			// Se o arquivo não existir (erro os.ErrNotExist etc), é uma rota do React.
			// Modifica a requisição para pedir a raiz (index.html) e deixa o FileServer agir.
			r.URL.Path = "/"
		} else {
			f.Close() // Fecha logo se achou, o FileServer vai reabrir e servir
		}

		fileServer.ServeHTTP(w, r)
	})
}

func NewRouter(
	accountHandler *AccountHandler,
	messageHandler *MessageHandler,
	sfuHandler *SFUHandler,
) http.Handler {
	mux := http.NewServeMux()

	// Agrupamento de rotas do domínio Account
	mux.HandleFunc("POST /api/accounts/register", accountHandler.Register)
	mux.HandleFunc("POST /api/accounts/login", accountHandler.Login)

	// Agrupamento de rotas do domínio Message
	mux.HandleFunc("POST /api/messages", messageHandler.Send)

	// WebRTC SFU Signaling
	mux.HandleFunc("GET /api/ws", sfuHandler.HandleWS)

	// Scalar API Reference
	mux.HandleFunc("GET /api/docs", func(w http.ResponseWriter, r *http.Request) {
		html := `<!doctype html>
<html>
  <head>
    <title>Yerl API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/api/swagger.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	})
	
	// Serve OpenAPI Spec
	mux.Handle("GET /api/swagger.json", http.StripPrefix("/api/", http.FileServer(http.Dir("./docs"))))

	// Servir o Frontend no fallback das rotas
	serveSPA(mux)

	// Aplicamos o middleware apenas nas rotas que não sejam o WebSocket
	// para evitar problemas com o Hijacker/Upgrade do protocolo.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/ws" {
			mux.ServeHTTP(w, r)
			return
		}
		LoggingMiddleware(mux).ServeHTTP(w, r)
	})
}
