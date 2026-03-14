import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import { logger } from './utils/logger'
import './index.css'

// Observabilidade Global para Requisições de API (React Query)
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      logger.error('api_query_error', {
        query_key: query.queryKey,
        error_message: error instanceof Error ? error.message : String(error),
      });
    },
  }),
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      logger.info('api_mutation_success', {
        mutation_key: mutation.options.mutationKey,
      });
    },
    onError: (error, _variables, _context, mutation) => {
      logger.error('api_mutation_error', {
        mutation_key: mutation.options.mutationKey,
        error_message: error instanceof Error ? error.message : String(error),
      });
    },
  }),
});

const router = createRouter({ routeTree })

// Observabilidade de Navegação (TanStack Router)
router.subscribe('onResolved', ({ toLocation }) => {
  logger.info('page_view', {
    path: toLocation.pathname,
    params: toLocation.search,
  });
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}