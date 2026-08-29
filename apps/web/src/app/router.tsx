import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './shell/AppShell.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      {
        path: 'overview',
        lazy: async () => ({ Component: (await import('../routes/OverviewPage.js')).OverviewPage }),
      },
      {
        path: 'mandates',
        lazy: async () => ({ Component: (await import('../routes/MandatesPage.js')).MandatesPage }),
      },
      {
        path: 'mandates/new',
        lazy: async () => ({
          Component: (await import('../routes/NewMandatePage.js')).NewMandatePage,
        }),
      },
      {
        path: 'mandates/:id',
        lazy: async () => ({
          Component: (await import('../routes/MandateDetailPage.js')).MandateDetailPage,
        }),
      },
      {
        path: 'activity',
        lazy: async () => ({ Component: (await import('../routes/ActivityPage.js')).ActivityPage }),
      },
      {
        path: 'purchases',
        lazy: async () => ({
          Component: (await import('../routes/PurchasesPage.js')).PurchasesPage,
        }),
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
        lazy: async () => ({
          Component: (await import('../routes/ApprovalPage.js')).ApprovalPage,
        }),
      },
      {
        path: 'disputes',
        lazy: async () => ({
          Component: (await import('../routes/DisputePages.js')).DisputesListPage,
        }),
      },
      {
        path: 'disputes/new',
        lazy: async () => ({
          Component: (await import('../routes/DisputePages.js')).NewDisputePage,
        }),
      },
      {
        path: 'disputes/:id',
        lazy: async () => ({
          Component: (await import('../routes/DisputePages.js')).DisputePage,
        }),
      },
      {
        path: 'agent',
        lazy: async () => ({ Component: (await import('../routes/AgentPage.js')).AgentPage }),
      },
      {
        path: 'merchant',
        lazy: async () => ({ Component: (await import('../routes/MerchantPage.js')).MerchantPage }),
      },
      {
        path: 'auditor',
        lazy: async () => ({ Component: (await import('../routes/AuditorPage.js')).AuditorPage }),
      },
      {
        path: 'demo-control',
        lazy: async () => ({
          Component: (await import('../routes/DemoControlPage.js')).DemoControlPage,
        }),
      },
      {
        path: '*',
        lazy: async () => ({ Component: (await import('../routes/NotFoundPage.js')).NotFoundPage }),
      },
    ],
  },
]);
