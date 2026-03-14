# Yerl

Seu próprio Discord self-hosted

## Road map

- [ ] Auth (Login, Cadastro, 2FA)
- [ ] Adicionar amigos.
- [ ] DM.
- [ ] Criar canal de texto.
- [ ] Criar canal de voz.
- [ ] Adicionar compartilhamento de tela nos canais de voz (SFU)
- [ ] Adicionar envio de arquivos nos canais de texto. (Adicionar um limite por usuário para não consumir muito do servidor)
- [ ] Adicionar envio de imagens nos canais de texto. (é um upload de arquivo especializado).

## Tech

### Backend
- Golang (slog para logging estruturado)
- SQLite
- sqlc (geração de código SQL type-safe)
- goose (migrações de banco de dados)
- go:embed (embutir frontend no binário)
- testify (asserções de teste)
- mockgen (geração de mocks)

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS v4
- DaisyUI v5
- TanStack Router
- TanStack Query
- Vitest
- React Testing Library
