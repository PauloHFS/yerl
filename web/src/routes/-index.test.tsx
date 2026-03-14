import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { Route as IndexRoute } from './index';

function renderWithRouter(component: () => JSX.Element) {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory(),
  })

  return render(<RouterProvider router={router} />)
}

describe('Landing Page (/)', () => {
  it('deve renderizar o título principal e os botões de ação', async () => {
    renderWithRouter(IndexRoute.options.component as () => JSX.Element);

    // Usa await waitFor ou findByRole porque o Router do TanStack renderiza de forma assíncrona
    const heading = await screen.findByRole('heading', { name: /Olá, Yerl!/i });
    expect(heading).toBeInTheDocument();

    const text = screen.getByText(/Sua plataforma de mensagens embutida/i);
    expect(text).toBeInTheDocument();

    const btnComecar = screen.getByRole('link', { name: /Começar agora/i });
    expect(btnComecar).toBeInTheDocument();
    expect(btnComecar).toHaveAttribute('href', '/register');

    const btnSaibaMais = screen.getByRole('button', { name: /Saiba mais/i });
    expect(btnSaibaMais).toBeInTheDocument();
  });
});
