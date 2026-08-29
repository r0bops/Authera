import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './shell/AppShell.js';
import { ActivityPage } from '../routes/ActivityPage.js';
import { AgentPage } from '../routes/AgentPage.js';
import { ApprovalPage } from '../routes/ApprovalPage.js';
import { DisputePage, DisputesListPage, NewDisputePage } from '../routes/DisputePages.js';
import { AuditorPage } from '../routes/AuditorPage.js';
import { DemoControlPage } from '../routes/DemoControlPage.js';
import { MandateDetailPage } from '../routes/MandateDetailPage.js';
import { MandatesPage } from '../routes/MandatesPage.js';
import { MerchantPage } from '../routes/MerchantPage.js';
import { NewMandatePage } from '../routes/NewMandatePage.js';
import { NotFoundPage } from '../routes/NotFoundPage.js';
import { OverviewPage } from '../routes/OverviewPage.js';
import { PurchaseDetailPage } from '../routes/PurchaseDetailPage.js';
import { PurchasesPage } from '../routes/PurchasesPage.js';
import { SettingsPage } from '../routes/SettingsPage.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: 'overview', element: <OverviewPage /> },
      { path: 'mandates', element: <MandatesPage /> },
      { path: 'mandates/new', element: <NewMandatePage /> },
      { path: 'mandates/:id', element: <MandateDetailPage /> },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'purchases', element: <PurchasesPage /> },
      { path: 'purchases/:id', element: <PurchaseDetailPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'approvals/:id', element: <ApprovalPage /> },
      { path: 'disputes', element: <DisputesListPage /> },
      { path: 'disputes/new', element: <NewDisputePage /> },
      { path: 'disputes/:id', element: <DisputePage /> },
      { path: 'agent', element: <AgentPage /> },
      { path: 'merchant', element: <MerchantPage /> },
      { path: 'auditor', element: <AuditorPage /> },
      { path: 'demo-control', element: <DemoControlPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
