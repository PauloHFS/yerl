import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { Route as IndexRoute } from './index';
import { type JSX } from 'react';

function renderWithRouter(component: () => React.JSX.Element) {
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
    renderWithRouter(IndexRoute.options.component as () => React.JSX.Element);

    // Usa await waitFor ou findByRole porque o Router do TanStack renderiza de forma assíncrona
    const heading = await screen.findByRole('heading', { name: /Olá, Yerl!/i });
    expect(heading).toBeInTheDocument();

    const text = screen.getByText(/Sua plataforma de mensagens embutida/i);
    expect(text).toBeInTheDocument();

    const btnComecar = screen.getByRole('link', { name: /Começar agora/i });
    expect(btnComecar).toBeInTheDocument();
    expect(btnComecar).toHaveAttribute('href', '/register');

    // Verifica que o link principal existe e aponta para registro
    const btnComecarDuplicate = screen.getAllByRole('link', { name: /Começar agora/i });
    expect(btnComecarDuplicate.length).toBeGreaterThan(0);
  });
});
