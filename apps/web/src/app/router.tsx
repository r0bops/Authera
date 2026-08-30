import { createBrowserRouter, Navigate, redirect } from 'react-router';
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
  { path: 'mandates', loader: preserveQueryRedirect('/dashboard/chats') },
  { path: 'mandates/new', loader: preserveQueryRedirect('/dashboard') },
  { path: 'mandates/:id', loader: preserveQueryRedirect('/dashboard/chats') },
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

function dashboardResourceRedirect(resource: string) {
  return ({
    params,
    request,
  }: {
    params: Record<string, string | undefined>;
    request: Request;
  }) => {
    const current = new URL(request.url);
    const id = params.id ? `/${params.id}` : '';
    return redirect(`/dashboard/${resource}${id}${current.search}`);
  };
}

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    path: '/dashboard',
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

  // Local compatibility while bookmarks and older demo recordings move to the new route tree.
  { path: '/overview', loader: preserveQueryRedirect('/dashboard') },
  { path: '/mandates', loader: preserveQueryRedirect('/dashboard/chats') },
  { path: '/mandates/new', loader: preserveQueryRedirect('/dashboard') },
  { path: '/mandates/:id', loader: preserveQueryRedirect('/dashboard/chats') },
  { path: '/activity', loader: preserveQueryRedirect('/dashboard/activity') },
  { path: '/purchases', loader: preserveQueryRedirect('/dashboard/purchases') },
  { path: '/purchases/:id', loader: dashboardResourceRedirect('purchases') },
  { path: '/settings', loader: preserveQueryRedirect('/dashboard/settings') },
  { path: '/approvals/:id', loader: dashboardResourceRedirect('approvals') },
  { path: '/disputes', loader: preserveQueryRedirect('/dashboard/disputes') },
  { path: '/disputes/new', loader: preserveQueryRedirect('/dashboard/disputes/new') },
  { path: '/disputes/:id', loader: dashboardResourceRedirect('disputes') },
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
