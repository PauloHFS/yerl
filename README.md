# Yerl

Seu próprio Discord self-hosted — um único binário Go que embarca o frontend React.

## Funcionalidades implementadas

- [x] Auth — cadastro, login, middleware JWT, sessão via cookie
- [x] Canal de texto — envio e listagem de mensagens
- [x] Canal de voz/vídeo — WebRTC SFU com pion/webrtc
  - [x] Voz multi-usuário
  - [x] Vídeo com simulcast (3 camadas de qualidade)
  - [x] Compartilhamento de tela
  - [x] Reconexão automática com backoff exponencial
  - [x] Detecção de fala (AudioContext + AnalyserNode)
  - [x] Indicador de qualidade (RTT + packet loss)

## Road map

- [ ] Adicionar amigos
- [ ] DM (mensagem direta)
- [ ] Criar canais (texto e voz) dinâmicos via UI
- [ ] Envio de arquivos e imagens nos canais de texto (com limite por usuário)
- [ ] 2FA
- [ ] Notificações

## Como rodar

```bash
# Desenvolvimento (backend :8080 + frontend :5173 simultâneos)
make dev

# Build completo — gera bin/yerl com frontend embutido
make build
./bin/yerl
```

Variáveis de ambiente (`.env`):

| Variável      | Padrão         | Descrição                  |
|---------------|----------------|----------------------------|
| `PORT`        | `8080`         | Porta do servidor HTTP     |
| `DB_PATH`     | `./yerl.db`    | Caminho do banco SQLite    |
| `APP_ENV`     | `development`  | `development` / `production` |
| `FRONTEND_URL`| `http://localhost:5173` | Origin permitida pelo CORS |

## Tech

### Backend

- Go 1.22+ (roteamento nativo com pattern matching)
- SQLite via `modernc.org/sqlite` (sem CGo)
- sqlc — geração de código Go type-safe a partir de SQL
- goose — migrações de banco
- go:embed — frontend embutido no binário
- pion/webrtc v4 — SFU WebRTC
- gorilla/websocket — sinalização WebSocket
- golang-jwt/jwt v5 — autenticação JWT
- testify + mockgen — testes e mocks

### Frontend

- React 19
- TypeScript (strict mode)
- Vite + TanStack Router (file-based)
- TanStack Query — estado do servidor
- Zustand — estado cliente
- Tailwind CSS v4 + DaisyUI v5
- Vitest + React Testing Library

## Arquitetura

Monolito Go com DI manual:

```
cmd/server/main.go
  └── domain/          → interfaces + structs
  └── repository/      → acesso ao banco via sqlc
  └── service/         → lógica de negócio (inclui service/sfu/ para WebRTC)
  └── transport/http/  → handlers HTTP + middleware + router
  └── web/             → frontend React (embutido via go:embed)
```

## Testes

```bash
make test                    # Go + Vitest
make lint                    # golangci-lint + ESLint
```
