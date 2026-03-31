import { createFileRoute, Link } from '@tanstack/react-router'
import trumpiUrl from '../assets/trumpi.jpeg'

export const Route = createFileRoute('/')({
  component: function HomePage() {
    return (
      <div className="hero min-h-screen bg-base-200">
        <div className="hero-content text-center">
          <div className="max-w-md">
            <h1 className="text-5xl font-bold">Olá, Yerl!</h1>
            <div className="py-6 flex justify-center">
              <img src={trumpiUrl} alt="Mission Accomplished" className="rounded-xl shadow-2xl max-w-sm" />
            </div>
            <p className="pb-6">
              Sua plataforma de mensagens embutida em um binário único.
              Segura, rápida e moderna.
            </p>
            <div className="flex gap-4 justify-center">
              <Link to="/register" className="btn btn-primary">
                Começar agora
              </Link>
              <Link to="/login" className="btn btn-outline">
                Login
              </Link>
              <Link to="/canal" className="btn btn-outline">
                Testar SFU (Voz)
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }
})
