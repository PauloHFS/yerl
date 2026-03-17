import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app')({
  component: AppPage,
})

/* eslint-disable react-refresh/only-export-components */
function AppPage() {
  return (
    <div className="flex h-screen">
      
      {/* Sidebar */}
      <div className="w-64 bg-base-300 p-4">
        <h2 className="font-bold text-lg">Yerl</h2>
        <ul className="mt-4 space-y-2">
          <li># geral</li>
          <li># dev</li>
        </ul>
      </div>

      {/* Chat */}
      <div className="flex-1 p-6">
        <h1 className="text-2xl font-bold">Bem-vindo 👋</h1>
        <p className="mt-2">Você está logado.</p>
      </div>

    </div>
  )
}