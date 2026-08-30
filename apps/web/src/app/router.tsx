import { createBrowserRouter, redirect } from 'react-router';
import { AppShell } from './shell/AppShell.js';

function preserveQueryRedirect(target: string) {
  return ({ request }: { request: Request }) => {
    const current = new URL(request.url);
    return redirect(`${target}${current.search}`);
  };
}

const dashboardChildren = [
  {
    index: true,
    lazy: async () => ({ Component: (await import('../routes/ChatPage.js')).ChatPage }),
  },
  // Plans are created, inspected and stopped in the chat: the wizard, list and detail pages are gone.
  { path: 'mandates', loader: preserveQueryRedirect('/chats') },
  { path: 'mandates/new', loader: preserveQueryRedirect('/') },
  { path: 'mandates/:id', loader: preserveQueryRedirect('/chats') },
  {
    path: 'activity',
    lazy: async () => ({ Component: (await import('../routes/ActivityPage.js')).ActivityPage }),
  },
  {
    path: 'chats',
    lazy: async () => ({ Component: (await import('../routes/ChatsPage.js')).ChatsPage }),
  },
  {
    path: 'chats/:chatId',
    lazy: async () => ({ Component: (await import('../routes/ChatPage.js')).ChatPage }),
  },
  {
    path: 'purchases',
    lazy: async () => ({ Component: (await import('../routes/PurchasesPage.js')).PurchasesPage }),
  },
  {
    path: 'purchases/:id',
    lazy: async () => ({
      Component: (await import('../routes/PurchaseDetailPage.js')).PurchaseDetailPage,
    }),
  },
  {
    path: 'settings',
    lazy: async () => ({ Component: (await import('../routes/SettingsPage.js')).SettingsPage }),
  },
  {
    path: 'approvals/:id',
    lazy: async () => ({ Component: (await import('../routes/ApprovalPage.js')).ApprovalPage }),
  },
  {
    path: 'disputes',
    lazy: async () => ({
      Component: (await import('../routes/DisputePages.js')).DisputesListPage,
    }),
  },
  {
    path: 'disputes/new',
    lazy: async () => ({ Component: (await import('../routes/DisputePages.js')).NewDisputePage }),
  },
  {
    path: 'disputes/:id',
    lazy: async () => ({ Component: (await import('../routes/DisputePages.js')).DisputePage }),
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
        lazy: async () => ({ Component: (await import('../routes/AgentPage.js')).AgentPage }),
      },
    ],
  },
  {
    path: '/verify',
    element: <AppShell perspective="merchant" />,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('../routes/MerchantPage.js')).MerchantPage }),
      },
    ],
  },
  {
    path: '/audit',
    element: <AppShell perspective="auditor" />,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('../routes/AuditorPage.js')).AuditorPage }),
      },
    ],
  },
  {
    path: '/demo',
    element: <AppShell perspective="demo" />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('../routes/DemoControlPage.js')).DemoControlPage,
        }),
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
        lazy: async () => ({ Component: (await import('../routes/NotFoundPage.js')).NotFoundPage }),
      },
    ],
  },
]);
