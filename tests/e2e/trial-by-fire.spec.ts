import { expect, test } from '@playwright/test';
import {
  createMandate,
  directAttempt,
  expectNoHorizontalScroll,
  get,
  injectOffer,
  paymentCalls,
  post,
  resetDemo,
  signIn,
} from './helpers.js';

/**
 * Trial-by-fire (CLAUDE_IMPLEMENTATION_SPEC.md §18). Sequential by design: each step builds on
 * the previous state, exactly like the live demo. Requires DEMO_MODE=true, PAYMENT_MODE=mock.
 */
test.describe.configure({ mode: 'serial' });

let paymentMethodId: string;
let mandateId: string;
let chatId: string;
let purchasedExecutionId: string;
let blockedExecutionId: string;

test.beforeEach(async ({ request }) => {
  ({ paymentMethodId } = await signIn(request));
});

test('1 · reset demo', async ({ request }) => {
  await resetDemo(request);
  expect(await paymentCalls(request)).toBe(0);
});

test('2 · create the USD 150 Córdoba mandate through the conversation', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page
    .getByLabel(/message aria/i)
    .fill(
      'Watch a flight from Caracas to Córdoba next month under $150, valid until the end of the month. Ask me if it is outside the rules.',
    );
  await page.getByRole('button', { name: /send message/i }).click();
  await expect(page.getByText(/your plan is ready/i)).toBeVisible();
  await expect(page.getByText(/USD 150\.00/).first()).toBeVisible();
  await expect(page).toHaveURL(/\/chats\/[0-9a-f-]+$/i);
  chatId = page.url().split('/').at(-1) ?? '';
  expect(chatId).toBeTruthy();
  await page.reload();
  await expect(page.getByText(/your plan is ready/i)).toBeVisible();
  await expect(page.getByText(/Watch a flight from Caracas/i)).toBeVisible();
  await page.getByRole('button', { name: /review and authorize/i }).click();
  await expect(page.getByRole('heading', { name: /review before authorizing/i })).toBeVisible();
  await page.getByRole('button', { name: /authorize this plan/i }).click();
  await expect(page.getByText(/signed and active/i)).toBeVisible();
  await page.goto('/chats');
  await page.getByRole('link', { name: /CCS → COR/i }).click();
  await page.getByLabel(/message aria/i).fill('Have you found a flight yet?');
  await page.getByRole('button', { name: /send message/i }).click();
  await expect(page.getByText(/not changed any signed rule or claimed a flight/i)).toBeVisible();
  await expectNoHorizontalScroll(page);
  const mandates = await get<Array<{ id: string; status: string }>>(request, '/api/mandates');
  mandateId = mandates.data?.find((mandate) => mandate.status === 'ACTIVE')?.id ?? '';
  expect(mandateId).toBeTruthy();
});

test('3 · inject a USD 130 offer', async ({ request }) => {
  const offer = await injectOffer(request, 13_000);
  expect(offer.id).toBeTruthy();
});

test('4 · the agent buys and every role view agrees', async ({ page, request }) => {
  const run = await post<{
    outcome: string;
    purchase?: { executionId: string; decision: string; reasonCode: string; state: string };
  }>(request, '/api/demo/attempts', { mandateId, mode: 'scripted' });
  expect(run.status).toBe(200);
  expect(run.body.data?.outcome).toBe('PURCHASE_REQUESTED');
  expect(run.body.data?.purchase).toMatchObject({
    decision: 'ALLOW',
    reasonCode: 'ALLOW_WITHIN_MANDATE',
    state: 'SUCCEEDED',
  });
  purchasedExecutionId = run.body.data!.purchase!.executionId;
  expect(await paymentCalls(request)).toBe(1);

  await page.goto(`/purchases/${purchasedExecutionId}`);
  await expect(page.getByRole('heading', { name: /flight purchased/i })).toBeVisible();
  await expect(page.getByText(/USD 130\.00/).first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto(`/verify?executionId=${purchasedExecutionId}`);
  await expect(page.getByText('PURCHASED').first()).toBeVisible();
  await expect(page.getByText(/bound/).first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto(`/audit?executionId=${purchasedExecutionId}`);
  await expect(page.getByText(/chain verified/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'PAYMENT_SUCCEEDED', exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto('/chats');
  await page.getByRole('link', { name: /CCS → COR/i }).click();
  await expect(page.getByText(/conversation is complete/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /revoke mandate/i })).toBeVisible();
  const ended = await post(request, `/api/chats/${chatId}/messages`, {
    message: 'Can we keep changing this trip?',
  });
  expect(ended.status).toBe(409);
  expect(ended.body.error?.code).toBe('CHAT_ENDED');
});

test('5 · USD 300 is blocked with zero payment calls', async ({ request }) => {
  const before = await paymentCalls(request);
  const fresh = await createMandate(request, { paymentMethodId });
  const offer = await injectOffer(request, 30_000);
  const result = await directAttempt(request, { mandateId: fresh.id, offerId: offer.id });
  expect(result.status).toBe(403);
  expect(result.purchase).toMatchObject({
    decision: 'BLOCK',
    reasonCode: 'AMOUNT_EXCEEDED',
    state: 'BLOCKED',
  });
  blockedExecutionId = result.purchase!.executionId;
  expect(await paymentCalls(request)).toBe(before);
});

test('6 · an expired mandate is blocked', async ({ request }) => {
  const soon = new Date(Date.now() + 2_000).toISOString();
  const expiring = await createMandate(request, { paymentMethodId, validUntil: soon });
  const offer = await injectOffer(request, 12_000);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const result = await directAttempt(request, { mandateId: expiring.id, offerId: offer.id });
  expect(result.purchase).toMatchObject({ decision: 'BLOCK', reasonCode: 'MANDATE_EXPIRED' });
});

test('7 · replaying a signed request is rejected', async ({ request }) => {
  const replay = await post<{ status: number; response: { error?: { code: string } } }>(
    request,
    '/api/demo/attempts/replay',
    { executionId: blockedExecutionId },
  );
  expect(replay.status).toBe(200);
  expect(replay.body.data?.status).toBe(409);
  expect(replay.body.data?.response.error?.code).toBe('REPLAY_DETECTED');
});

test('8 · a forged agent key is rejected', async ({ request }) => {
  const fresh = await createMandate(request, { paymentMethodId });
  const offer = await injectOffer(request, 12_000);
  const result = await directAttempt(request, {
    mandateId: fresh.id,
    offerId: offer.id,
    impersonate: true,
  });
  expect(result.status).toBe(401);
  expect((result.response as { error?: { code: string } }).error?.code).toBe('SIGNATURE_INVALID');
});

test('9 · racing two attempts on a one-use mandate allows exactly one', async ({ request }) => {
  const oneUse = await createMandate(request, { paymentMethodId, maxFulfillments: 1 });
  const offer = await injectOffer(request, 12_500);
  const race = await post<Array<{ purchase?: { decision: string; reasonCode: string } }>>(
    request,
    '/api/demo/concurrent-attempts',
    { mandateId: oneUse.id, offerId: offer.id, attempts: 2 },
  );
  expect(race.status).toBe(200);
  const decisions = race.body.data!.map((r) => r.purchase?.decision);
  expect(decisions.filter((d) => d === 'ALLOW')).toHaveLength(1);
  expect(decisions.filter((d) => d === 'BLOCK')).toHaveLength(1);
});

test('10 · live revocation blocks the immediate retry', async ({ page, request }) => {
  const fresh = await createMandate(request, { paymentMethodId });
  const offer = await injectOffer(request, 12_000);
  // The chat is the human's only surface for a plan: link it, then stop it from there.
  const chat = await post<{ id: string }>(request, '/api/chats', {
    message: 'Flight from Caracas to Córdoba next month, max $150.',
  });
  await post(request, `/api/chats/${chat.id}/mandate`, { mandateId: fresh.id });
  await page.goto(`/chats/${chat.id}`);
  await expect(page.getByText(/signed and active/i).first()).toBeVisible();
  await post(request, `/api/chats/${chat.id}/revoke`, {});
  await page.reload();
  await expect(page.getByText(/revoked/i).first()).toBeVisible();
  const result = await directAttempt(request, { mandateId: fresh.id, offerId: offer.id });
  expect(result.purchase).toMatchObject({ decision: 'BLOCK', reasonCode: 'MANDATE_REVOKED' });
  await expectNoHorizontalScroll(page);
});

test('11 · USD 168 escalates, one approval completes the exact checkout once', async ({
  page,
  request,
}) => {
  const escalating = await createMandate(request, { paymentMethodId, escalation: 'require_human' });
  const offer = await injectOffer(request, 16_800);
  const paused = await directAttempt(request, { mandateId: escalating.id, offerId: offer.id });
  expect(paused.status).toBe(202);
  expect(paused.purchase).toMatchObject({
    decision: 'REQUIRE_HUMAN',
    reasonCode: 'REQUIRE_HUMAN_AMOUNT',
  });
  const approvalId = paused.purchase!.approvalRequestId!;
  const checkoutId = paused.checkoutId!;

  await page.goto(`/approvals/${approvalId}`);
  await expect(page.getByRole('heading', { name: /aria needs your decision/i })).toBeVisible();
  await page.getByRole('button', { name: /approve this offer only/i }).click();
  await expect(page.getByText(/Approved/).first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  const bought = await directAttempt(request, {
    mandateId: escalating.id,
    offerId: offer.id,
    checkoutId,
  });
  expect(bought.purchase).toMatchObject({
    decision: 'ALLOW',
    reasonCode: 'ALLOW_CHECKOUT_APPROVAL',
    state: 'SUCCEEDED',
  });

  const again = await directAttempt(request, {
    mandateId: escalating.id,
    offerId: offer.id,
    checkoutId,
  });
  expect(again.purchase?.decision).not.toBe('ALLOW');
});

test('12 · a checkout modified after approval is blocked', async ({ request }) => {
  const escalating = await createMandate(request, { paymentMethodId, escalation: 'require_human' });
  const offer = await injectOffer(request, 16_800);
  const paused = await directAttempt(request, { mandateId: escalating.id, offerId: offer.id });
  const approvalId = paused.purchase!.approvalRequestId!;
  const checkoutId = paused.checkoutId!;
  const decision = await post(request, `/api/approvals/${approvalId}/decision`, {
    decision: 'APPROVED',
  });
  expect(decision.status).toBe(200);
  const tampered = await post(request, `/api/demo/checkouts/${checkoutId}/tamper`);
  expect(tampered.status).toBe(200);
  const result = await directAttempt(request, {
    mandateId: escalating.id,
    offerId: offer.id,
    checkoutId,
  });
  expect(result.purchase).toMatchObject({
    decision: 'BLOCK',
    reasonCode: 'CHECKOUT_HASH_MISMATCH',
  });
});

test('13 · a dispute resolves deterministically from evidence', async ({ page, request }) => {
  const revoked = await post<{ state: string; mandateId: string }>(
    request,
    `/api/chats/${chatId}/revoke`,
  );
  expect(revoked.body.data).toMatchObject({ state: 'REVOKED', mandateId });
  const dispute = await post<{ id: string; resolution: { outcome: string; headline: string } }>(
    request,
    '/api/disputes',
    { executionId: purchasedExecutionId, reason: 'REVOKED_BEFORE_PURCHASE' },
  );
  expect(dispute.status).toBe(201);
  expect(dispute.body.data?.resolution.outcome).toBe('AUTHORIZED');
  await page.goto(`/disputes/${dispute.body.data!.id}`);
  await expect(page.getByRole('heading', { name: /purchase was authorized/i })).toBeVisible();
  await expect(page.getByText(/Mandate revoked/).first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  const evidence = await get<{ audit: { chain: { valid: boolean } }; bundleHash: string }>(
    request,
    `/api/evidence/${purchasedExecutionId}`,
  );
  expect(evidence.data?.audit.chain.valid).toBe(true);
  expect(evidence.data?.bundleHash).toMatch(/^sha256:/);

  const ap2 = await get<{
    payload: { alignment: { protocol: string; version: string; certified: boolean } };
    jws: string;
  }>(request, `/api/evidence/${purchasedExecutionId}/ap2`);
  expect(ap2.data?.payload.alignment).toMatchObject({
    protocol: 'AP2',
    version: '0.2',
    certified: false,
  });
  expect(ap2.data?.jws.split('.')).toHaveLength(3);
});

test('14 · every console screen fits the viewport', async ({ page }) => {
  for (const path of [
    '/',
    '/activity',
    '/chats',
    '/purchases',
    '/settings',
    '/agent',
    '/verify',
    '/audit',
    '/demo',
  ]) {
    await page.goto(path);
    await expect(page.locator('main').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: `test-results/screens/${path.replaceAll('/', '-').replace(/^-/, '') || 'root'}-${page.viewportSize()?.width}.png`,
      fullPage: false,
    });
  }
});

test('15 · perspectives stay separated and legacy links redirect', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: /Your account navigation/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Updates' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Agent overview' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Purchase verification' })).toHaveCount(0);

  await page.goto('/agent');
  await expect(
    page.getByRole('navigation', { name: /Purchasing agent navigation/i }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mandates' })).toHaveCount(0);

  await page.goto('/overview');
  await expect(page).toHaveURL(/\/\/[^/]+\/$/);

  await page.goto(`/mandates/${mandateId}`);
  await expect(page).toHaveURL(/\/chats$/);

  await page.goto(`/merchant?executionId=${purchasedExecutionId}`);
  await expect(page).toHaveURL(
    new RegExp(`/verify\\?executionId=${purchasedExecutionId.replaceAll('-', '\\-')}$`),
  );
});
