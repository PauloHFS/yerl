import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: function HomePage() {
    return (
      <div className="hero min-h-screen bg-base-200">
        <div className="hero-content text-center">
          <div className="max-w-md">
            <h1 className="text-5xl font-bold">Olá, Yerl!</h1>
            <p className="py-6">
              Sua plataforma de mensagens embutida em um binário único.
              Segura, rápida e moderna.
            </p>
            <div className="flex gap-4 justify-center">
              <Link to="/register" className="btn btn-primary">
                Começar agora
              </Link>
              <button className="btn btn-outline">Saiba mais</button>
            </div>
          </div>
        </div>
      </div>
    )
  }
})
