import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useRegisterAccount } from '../hooks/useRegisterAccount'

export const Route = createFileRoute('/register')({
  component: function RegisterPage() {
    const { mutate, isPending, isError, isSuccess, error } = useRegisterAccount()
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      mutate({ name, email, password })
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <div className="card w-full max-w-sm bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title text-2xl font-bold mb-4 text-center w-full justify-center">Criar Conta</h2>

            {isSuccess && (
              <div className="alert alert-success shadow-lg mb-4 text-sm">
                <span>Conta criada com sucesso! Você já pode fazer login.</span>
              </div>
            )}

            {isError && (
              <div className="alert alert-error shadow-lg mb-4 text-sm">
                <span>{error?.message || 'Ocorreu um erro ao tentar criar a conta.'}</span>
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-control w-full">
                <label className="label">
                  <span className="label-text">Nome</span>
                </label>
                <input 
                  type="text" 
                  placeholder="Seu nome" 
                  className="input input-bordered w-full focus:input-primary" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-control w-full mt-2">
                <label className="label">
                  <span className="label-text">Email</span>
                </label>
                <input 
                  type="email" 
                  placeholder="seu@email.com" 
                  className="input input-bordered w-full focus:input-primary" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-control w-full mt-2">
                <label className="label">
                  <span className="label-text">Senha</span>
                </label>
                <input 
                  type="password" 
                  placeholder="******" 
                  className="input input-bordered w-full focus:input-primary" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              <div className="form-control mt-6">
                <button 
                  type="submit" 
                  className="btn btn-primary w-full" 
                  disabled={isPending}
                >
                  {isPending ? <span className="loading loading-spinner"></span> : 'Registrar'}
                </button>
              </div>

              <div className="text-center mt-4">
                <Link to="/" className="link link-hover text-sm">
                  Voltar para o início
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    )
  }
})
