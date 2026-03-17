import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useLogin } from '../hooks/useLoginAccount'

export const Route = createFileRoute('/login')({
  component: function LoginPage() {
    const { mutate, isPending, isError, error } = useLogin()
    const navigate = useNavigate();

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      mutate({ email, password },
        {
    onSuccess: () => {
      void navigate({ to: '/app' })
    }
}
      )
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-base-200">
        <div className="card w-full max-w-sm bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="text-2xl font-bold text-center">Login</h2>

            {isError && (
              <div className="alert alert-error">
                <span>{error?.message}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <input
                type="email"
                placeholder="Email"
                className="input input-bordered w-full mt-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <input
                type="password"
                placeholder="Senha"
                className="input input-bordered w-full mt-2"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <button className="btn btn-primary w-full mt-4">
                {isPending ? 'Entrando...' : 'Entrar'}
              </button>
            </form>

            <Link to="/register" className="text-sm text-center mt-4">
              Criar conta
            </Link>
          </div>
        </div>
      </div>
    )
  }
})