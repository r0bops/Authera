import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router.js';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

// Server truth over optimism: short stale times, no automatic mutation retries.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 500, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
