import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditEvent,
  CreateMandateRequest,
  DemoAttemptRequest,
  DemoAttemptResult,
  DemoConcurrentAttemptsRequest,
  DemoDirectAttemptRequest,
  DemoDirectAttemptResult,
  DemoInjectOfferRequest,
  DemoPaymentBehaviorRequest,
  DemoState,
  ExecutionSummary,
  FlightOfferView,
  MandateView,
  MandateChatRequest,
  MandateChatResponse,
  MeResponse,
  PurchaseReceipt,
  ReviseMandateRequest,
  VerificationView,
} from '@authera/contracts';
import { api } from './client.js';

const keys = {
  me: ['me'] as const,
  mandates: ['mandates'] as const,
  mandate: (id: string) => ['mandates', id] as const,
  offers: ['offers'] as const,
  executions: (mandateId?: string) => ['executions', mandateId ?? 'all'] as const,
  verification: (id: string) => ['verification', id] as const,
  audit: (filter: { mandateId?: string; executionId?: string }) =>
    ['audit', filter.mandateId ?? '', filter.executionId ?? ''] as const,
  purchases: ['purchases'] as const,
  purchase: (id: string) => ['purchase', id] as const,
  demo: ['demo'] as const,
};

/** Demo mode polls once per second so server truth replaces the screen within one tick. */
function usePollInterval(): number {
  const me = useMe();
  return me.data?.demoMode ? 1000 : 5000;
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api<MeResponse>('/api/me'),
    staleTime: 30_000,
  });
}

export function useMandates() {
  const interval = usePollInterval();
  return useQuery({
    queryKey: keys.mandates,
    queryFn: () => api<MandateView[]>('/api/mandates'),
    refetchInterval: interval,
  });
}

export function useMandate(id: string | undefined) {
  const interval = usePollInterval();
  return useQuery({
    queryKey: keys.mandate(id ?? ''),
    queryFn: () => api<MandateView>(`/api/mandates/${id}`),
    enabled: Boolean(id),
    refetchInterval: interval,
  });
}

export function useOffers() {
  const interval = usePollInterval();
  return useQuery({
    queryKey: keys.offers,
    queryFn: () => api<FlightOfferView[]>('/api/offers'),
    refetchInterval: interval,
  });
}

export function useExecutions(mandateId?: string, limit = 50) {
  const interval = usePollInterval();
  const search = new URLSearchParams({ limit: String(limit), ...(mandateId ? { mandateId } : {}) });
  return useQuery({
    queryKey: [...keys.executions(mandateId), limit],
    queryFn: () => api<ExecutionSummary[]>(`/api/executions?${search.toString()}`),
    refetchInterval: interval,
  });
}

export function useVerification(id: string | undefined) {
  const interval = usePollInterval();
  return useQuery({
    queryKey: keys.verification(id ?? ''),
    queryFn: () => api<VerificationView>(`/api/verification/${id}`),
    enabled: Boolean(id),
    refetchInterval: interval,
  });
}

export function useAuditEvents(
  filter: { mandateId?: string; executionId?: string; limit?: number; enabled?: boolean } = {},
) {
  const interval = usePollInterval();
  const search = new URLSearchParams({
    limit: String(filter.limit ?? 300),
    ...(filter.mandateId ? { mandateId: filter.mandateId } : {}),
    ...(filter.executionId ? { executionId: filter.executionId } : {}),
  });
  return useQuery({
    queryKey: [...keys.audit(filter), filter.limit ?? 300],
    queryFn: () => api<AuditEvent[]>(`/api/audit/events?${search.toString()}`),
    enabled: filter.enabled ?? true,
    refetchInterval: interval,
  });
}

export function usePurchases() {
  const interval = usePollInterval();
  return useQuery({
    queryKey: keys.purchases,
    queryFn: () => api<ExecutionSummary[]>('/api/purchases'),
    refetchInterval: interval,
  });
}

export function usePurchase(id: string | undefined) {
  const interval = usePollInterval();
  return useQuery({
    queryKey: keys.purchase(id ?? ''),
    queryFn: () => api<PurchaseReceipt>(`/api/purchases/${id}`),
    enabled: Boolean(id),
    refetchInterval: interval,
  });
}

export function useDemoState(enabled = true) {
  const interval = usePollInterval();
  return useQuery({
    queryKey: keys.demo,
    queryFn: () => api<DemoState>('/api/demo/state'),
    enabled,
    refetchInterval: interval,
    retry: false,
  });
}

function useInvalidateAll() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}

/** Mutations never retry automatically and never show optimistic authorization/payment states. */
export function useCreateMandate() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: CreateMandateRequest) =>
      api<MandateView>('/api/mandates', { method: 'POST', body: input }),
    onSuccess: invalidate,
    retry: false,
  });
}

export function useInterpretMandateChat() {
  return useMutation({
    mutationFn: (input: MandateChatRequest) =>
      api<MandateChatResponse>('/api/chat/interpret', { method: 'POST', body: input }),
    retry: false,
  });
}

export function useRevokeMandate(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: { reason?: string }) =>
      api<MandateView>(`/api/mandates/${id}/revoke`, { method: 'POST', body: input }),
    onSuccess: invalidate,
    retry: false,
  });
}

export function useReviseMandate(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: ReviseMandateRequest) =>
      api<MandateView>(`/api/mandates/${id}/revise`, { method: 'POST', body: input }),
    onSuccess: invalidate,
    retry: false,
  });
}

function useDemoAction<TInput, TResult>(path: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: TInput) => api<TResult>(path, { method: 'POST', body: input ?? {} }),
    onSuccess: invalidate,
    retry: false,
  });
}

export const useDemoReset = () =>
  useDemoAction<Record<string, never>, DemoState>('/api/demo/reset');
export const useDemoInjectOffer = () =>
  useDemoAction<DemoInjectOfferRequest, FlightOfferView>('/api/demo/offers');
export const useDemoAttempt = () =>
  useDemoAction<DemoAttemptRequest, DemoAttemptResult | DemoDirectAttemptResult>(
    '/api/demo/attempts',
  );
export const useDemoDirect = () =>
  useDemoAction<DemoDirectAttemptRequest, DemoDirectAttemptResult>('/api/demo/attempts/direct');
export const useDemoImpersonate = () =>
  useDemoAction<DemoDirectAttemptRequest, DemoDirectAttemptResult>(
    '/api/demo/attempts/impersonate',
  );
export const useDemoReplay = () =>
  useDemoAction<{ executionId: string }, DemoDirectAttemptResult>('/api/demo/attempts/replay');
export const useDemoRace = () =>
  useDemoAction<DemoConcurrentAttemptsRequest, DemoDirectAttemptResult[]>(
    '/api/demo/concurrent-attempts',
  );
export const useDemoTime = () =>
  useDemoAction<{ offsetMinutes: number }, DemoState>('/api/demo/time');
export const useDemoPaymentBehavior = () =>
  useDemoAction<DemoPaymentBehaviorRequest, DemoState>('/api/demo/payment-behavior');
export function useMockWebhook() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: {
      executionId: string;
      outcome: 'succeeded' | 'failed' | 'pending';
      amountMinor?: number;
    }) =>
      api<{ outcome: string }>(`/webhooks/mock/${input.executionId}`, {
        method: 'POST',
        body: {
          outcome: input.outcome,
          ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
        },
      }),
    onSuccess: invalidate,
    retry: false,
  });
}

import type {
  ApprovalDecisionRequest,
  ApprovalView,
  CreateDisputeRequest,
  DisputeView,
  EvidenceBundle,
} from '@authera/contracts';

export function useApprovals() {
  const interval = usePollInterval();
  return useQuery({
    queryKey: ['approvals'],
    queryFn: () => api<ApprovalView[]>('/api/approvals'),
    refetchInterval: interval,
  });
}

export function useApproval(id: string | undefined) {
  const interval = usePollInterval();
  return useQuery({
    queryKey: ['approval', id ?? ''],
    queryFn: () => api<ApprovalView>(`/api/approvals/${id}`),
    enabled: Boolean(id),
    refetchInterval: interval,
  });
}

export function useDecideApproval(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ApprovalDecisionRequest) =>
      api<ApprovalView>(`/api/approvals/${id}/decision`, { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries(),
    retry: false,
  });
}

export function useDisputes() {
  const interval = usePollInterval();
  return useQuery({
    queryKey: ['disputes'],
    queryFn: () => api<DisputeView[]>('/api/disputes'),
    refetchInterval: interval,
  });
}

export function useDispute(id: string | undefined) {
  return useQuery({
    queryKey: ['dispute', id ?? ''],
    queryFn: () => api<DisputeView>(`/api/disputes/${id}`),
    enabled: Boolean(id),
  });
}

export function useOpenDispute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDisputeRequest) =>
      api<DisputeView>('/api/disputes', { method: 'POST', body: input }),
    onSuccess: () => client.invalidateQueries(),
    retry: false,
  });
}

export function useEvidence(
  executionId: string | undefined,
  role: 'human' | 'merchant' | 'auditor' = 'auditor',
) {
  return useQuery({
    queryKey: ['evidence', executionId ?? '', role],
    queryFn: () => api<EvidenceBundle>(`/api/evidence/${executionId}?role=${role}`),
    enabled: Boolean(executionId),
  });
}

export function useChainVerification() {
  const interval = usePollInterval();
  return useQuery({
    queryKey: ['audit-verify'],
    queryFn: () =>
      api<{ valid: boolean; events: number; reason?: string; brokenAtSequence?: number }>(
        '/api/audit/verify',
      ),
    refetchInterval: interval * 5,
  });
}
