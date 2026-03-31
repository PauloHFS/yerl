# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

Responda sempre em **português brasileiro**. Commits seguem Conventional Commits em português.

## Visão Geral

Yerl é um Discord self-hosted construído com Go (backend) e React/TypeScript (frontend). O backend embarca o frontend em um único binário.

## Comandos

### Desenvolvimento

```bash
make dev              # Backend (Go :8080) + Frontend (Vite :5173) simultâneos
make run              # Apenas backend
npm --prefix web run dev  # Apenas frontend
```

### Build

```bash
make build            # npm build + go build → bin/yerl (frontend embarcado)
```

### Testes

```bash
make test                                              # Todos (Go + Vitest)
go test -v -run TestNomeDaFuncao ./internal/service/...  # Go: teste único
npm --prefix web run test                              # Frontend: todos
npx --prefix web vitest run src/routes/canal.test.tsx # Frontend: arquivo único
npm --prefix web run test:watch                        # Frontend: modo watch
```

### Geração de código

```bash
make sqlc       # Gera código Go type-safe a partir de repository/sqlite/query/*.sql
make generate   # Executa go:generate (mockgen para interfaces de domain/)
make docs       # Gera OpenAPI/Swagger via swag
```

### Lint e dependências

```bash
make lint                  # golangci-lint
npm --prefix web run lint  # ESLint
make tidy                  # go mod tidy
```

### Migrações

```bash
make new-migration  # Cria nova migração (interativo, pede nome)
```

## Arquitetura

Monolito Go que embarca o frontend React em um único binário via `go:embed`.

### Backend — Layers (Dependency Injection manual)

```
cmd/server/main.go → cria DB, repo, service, handler, router
                     ↓
domain/           → interfaces (AccountRepository, AccountService, etc.) + structs
                     ↓ implementam
repository/sqlite/ → data access via sqlc gerado
                     ↓ injetado em
service/           → lógica de negócio (inclui service/sfu/ para WebRTC)
                     ↓ injetado em
transport/http/    → handlers HTTP + middleware + router
```

**Padrão importante**: todas as interfaces vivem em `domain/`. Mocks são gerados via `//go:generate mockgen` nas próprias interfaces — rodar `make generate` após criar/alterar interfaces.

### Database

- SQLite com driver `modernc.org/sqlite`
- **Todo acesso ao banco usa sqlc** — escreva SQL em `repository/sqlite/query/*.sql`, rode `make sqlc`, e use o código gerado em `repository/sqlite/sqlc/`
- Nunca escreva SQL raw em código da aplicação
- Migrações via goose. Nunca modificar migrations existentes

### WebRTC SFU

```
transport/http/sfu_handler.go  → WebSocket endpoint (/api/ws)
service/sfu/room.go            → RoomManager gerencia Room → Peers → Tracks
service/sfu/peer.go            → Peer encapsula RTCPeerConnection + signaling
```

Signaling via WebSocket JSON com tipos: `join`, `offer`, `answer`, `candidate`, `participants`. Cada peer lê RTP de tracks remotos e faz broadcast via `TrackLocalStaticRTP`.

### Frontend

- **TanStack Router** (file-based em `web/src/routes/`) — gerador automático via Vite plugin
- **TanStack Query** para todo estado do servidor (nunca fetch direto em componentes)
- **`web/src/utils/api.ts`** → `apiClient<T>()` centraliza chamadas HTTP com tratamento de erro
- **`web/src/hooks/useWebRTC.ts`** → hook que encapsula toda lógica WebRTC (connect, streams, stats, mute)
- **Vite proxy**: `/api` → `localhost:8080` em dev

### Frontend embarcado no binário

`web/embed.go` usa `//go:embed all:dist`. O router Go serve o SPA com fallback para `index.html` em rotas não-API.

## Convenções Go

- `context.Context` como primeiro parâmetro em funções com I/O
- Todos os erros tratados — sem `_` ignorando erro relevante
- Imports: stdlib → third-party → internal
- Erros: `fmt.Errorf("contexto: %w", err)` para wrapping
- Logging via `log/slog` (JSON estruturado); middleware injeta logger no contexto
- Naming: PascalCase para exports, camelCase para locals; interfaces nomeadas com sufixo do papel (`AccountRepository`, `MessageService`)
- Roteamento HTTP nativo Go 1.22+ com pattern matching: `mux.HandleFunc("POST /api/accounts/register", handler.Register)`

## Convenções TypeScript/React

- Strict mode, sem `any`
- `console.log` é erro de lint — usar `console.info`, `console.warn`, `console.error`
- Function components apenas, sem class components
- Arquivos: kebab-case. Componentes: PascalCase. Hooks: `use` prefix. Routes: prefixadas com `-`
- Imports React: `import { useState } from 'react'`. Path alias `@/` para `web/src/`
- Styling: Tailwind CSS v4 + DaisyUI v5. Preferir componentes DaisyUI antes de CSS custom
- Testes com React Testing Library: render → act → assert

## Ambiente

Variáveis de ambiente (`.env`):
- `PORT` (padrão: 8080)
- `DB_PATH` (padrão: ./yerl.db)
- `APP_ENV` (development/production)

## Dependências principais

### Backend
- `gorilla/websocket` — WebSocket
- `pion/webrtc` — WebRTC SFU
- `pressly/goose/v3` — Migrações
- `stretchr/testify` — Asserções de teste
- `go.uber.org/mock` — Geração de mocks

### Frontend
- React 19, TanStack Router, TanStack Query
- Zustand (estado cliente)
- Tailwind CSS v4, DaisyUI v5
- Vitest + Testing Library
