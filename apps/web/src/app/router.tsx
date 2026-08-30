import { createBrowserRouter, redirect } from 'react-router';
import { AppShell } from './shell/AppShell.js';

const RELOAD_KEY = 'authera:chunk-reload';

/**
 * A page chunk can fail to load when the browser holds an index.html from a previous deploy.
 * Reload once so the fresh index is fetched; if it still fails, surface the error normally.
 */
function withReload<T extends object>(load: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      const result = await load();
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        // storage unavailable: nothing to clear
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const chunkFailure = /dynamically imported module|Loading chunk|import\(\)/i.test(message);
      let alreadyReloaded = true;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
        if (!alreadyReloaded) sessionStorage.setItem(RELOAD_KEY, '1');
      } catch {
        // storage unavailable: do not loop on reloads
      }
      if (chunkFailure && !alreadyReloaded) {
        window.location.reload();
        await new Promise<never>(() => {});
      }
      throw error;
    }
  };
}

function preserveQueryRedirect(target: string) {
  return ({ request }: { request: Request }) => {
    const current = new URL(request.url);
    return redirect(`${target}${current.search}`);
  };
}

const dashboardChildren = [
  {
    index: true,
    lazy: withReload(async () => ({ Component: (await import('../routes/ChatPage.js')).ChatPage })),
  },
  // Plans are created, inspected and stopped in the chat: the wizard, list and detail pages are gone.
  { path: 'mandates', loader: preserveQueryRedirect('/chats') },
  { path: 'mandates/new', loader: preserveQueryRedirect('/') },
  { path: 'mandates/:id', loader: preserveQueryRedirect('/chats') },
  {
    path: 'activity',
    lazy: withReload(async () => ({
      Component: (await import('../routes/ActivityPage.js')).ActivityPage,
    })),
  },
  {
    path: 'chats',
    lazy: withReload(async () => ({
      Component: (await import('../routes/ChatsPage.js')).ChatsPage,
    })),
  },
  {
    path: 'chats/:chatId',
    lazy: withReload(async () => ({ Component: (await import('../routes/ChatPage.js')).ChatPage })),
  },
  {
    path: 'purchases',
    lazy: withReload(async () => ({
      Component: (await import('../routes/PurchasesPage.js')).PurchasesPage,
    })),
  },
  {
    path: 'purchases/:id',
    lazy: withReload(async () => ({
      Component: (await import('../routes/PurchaseDetailPage.js')).PurchaseDetailPage,
    })),
  },
  {
    path: 'settings',
    lazy: withReload(async () => ({
      Component: (await import('../routes/SettingsPage.js')).SettingsPage,
    })),
  },
  {
    path: 'approvals/:id',
    lazy: withReload(async () => ({
      Component: (await import('../routes/ApprovalPage.js')).ApprovalPage,
    })),
  },
  {
    path: 'disputes',
    lazy: withReload(async () => ({
      Component: (await import('../routes/DisputePages.js')).DisputesListPage,
    })),
  },
  {
    path: 'disputes/new',
    lazy: withReload(async () => ({
      Component: (await import('../routes/DisputePages.js')).NewDisputePage,
    })),
  },
  {
    path: 'disputes/:id',
    lazy: withReload(async () => ({
      Component: (await import('../routes/DisputePages.js')).DisputePage,
    })),
  },
];

/** `/dashboard/anything` → `/anything`: the client app lives at the root now. */
function stripDashboardPrefix({ request }: { request: Request }) {
  const current = new URL(request.url);
  const path = current.pathname.replace(/^\/dashboard(?=\/|$)/, '') || '/';
  return redirect(`${path}${current.search}`);
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell perspective="client" />,
    children: dashboardChildren,
  },
  {
    path: '/agent',
    element: <AppShell perspective="agent" />,
    children: [
      {
        index: true,
        lazy: withReload(async () => ({
          Component: (await import('../routes/AgentPage.js')).AgentPage,
        })),
      },
    ],
  },
  {
    path: '/verify',
    element: <AppShell perspective="merchant" />,
    children: [
      {
        index: true,
        lazy: withReload(async () => ({
          Component: (await import('../routes/MerchantPage.js')).MerchantPage,
        })),
      },
    ],
  },
  {
    path: '/audit',
    element: <AppShell perspective="auditor" />,
    children: [
      {
        index: true,
        lazy: withReload(async () => ({
          Component: (await import('../routes/AuditorPage.js')).AuditorPage,
        })),
      },
    ],
  },
  {
    path: '/demo',
    element: <AppShell perspective="demo" />,
    children: [
      {
        index: true,
        lazy: withReload(async () => ({
          Component: (await import('../routes/DemoControlPage.js')).DemoControlPage,
        })),
      },
    ],
  },

  // Local compatibility while bookmarks and older demo recordings move to the root route tree.
  { path: '/dashboard', loader: stripDashboardPrefix },
  { path: '/dashboard/*', loader: stripDashboardPrefix },
  { path: '/overview', loader: preserveQueryRedirect('/') },
  { path: '/merchant', loader: preserveQueryRedirect('/verify') },
  { path: '/auditor', loader: preserveQueryRedirect('/audit') },
  { path: '/demo-control', loader: preserveQueryRedirect('/demo') },
  {
    path: '*',
    element: <AppShell perspective="client" />,
    children: [
      {
        index: true,
        lazy: withReload(async () => ({
          Component: (await import('../routes/NotFoundPage.js')).NotFoundPage,
        })),
      },
    ],
  },
]);
