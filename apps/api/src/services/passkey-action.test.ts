import { describe, expect, it, vi } from 'vitest';
import type { AuthenticationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server';
import {
  PasskeyActionService,
  type PasskeyActionStore,
  type PasskeyChallengeRecord,
} from './passkey-action.js';

const now = new Date('2026-08-29T15:00:00.000Z');
const credential = {
  id: 'credential-1',
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 4,
  transports: ['internal'],
} satisfies WebAuthnCredential;
const response = { id: credential.id } as AuthenticationResponseJSON;

class MemoryChallenges implements PasskeyActionStore {
  records = new Map<string, PasskeyChallengeRecord>();
  async put(record: PasskeyChallengeRecord) {
    this.records.set(record.challenge, record);
  }
  async consume(challenge: string) {
    const record = this.records.get(challenge);
    this.records.delete(challenge);
    return record;
  }
}

function service(store = new MemoryChallenges()) {
  const verifier = vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 5 },
  }));
  return {
    store,
    verifier,
    service: new PasskeyActionService({
      rpId: 'merchant.example',
      origin: 'https://merchant.example',
      store,
      now: () => now,
      verifier,
    }),
  };
}

describe('passkey action binding', () => {
  it('verifies the exact canonical action with required user verification', async () => {
    const fixture = service();
    const action = { type: 'mandate.revoke', resourceId: 'mandate-1', payload: { reason: 'user' } };
    const issued = await fixture.service.issue('user-1', action);

    await expect(
      fixture.service.verify({
        userId: 'user-1',
        action,
        challenge: issued.challenge,
        response,
        credential,
      }),
    ).resolves.toEqual({ actionHash: issued.actionHash, newCounter: 5 });
    expect(fixture.verifier).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: issued.challenge,
        expectedOrigin: 'https://merchant.example',
        expectedRPID: 'merchant.example',
        requireUserVerification: true,
      }),
    );
  });

  it('rejects a modified action and consumes the challenge', async () => {
    const fixture = service();
    const issued = await fixture.service.issue('user-1', {
      type: 'approval.approve',
      payload: { checkoutHash: 'original', amountMinor: 16_800 },
    });
    const modified = {
      type: 'approval.approve',
      payload: { checkoutHash: 'modified', amountMinor: 16_800 },
    };

    await expect(
      fixture.service.verify({
        userId: 'user-1',
        action: modified,
        challenge: issued.challenge,
        response,
        credential,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'ACTION_MISMATCH' }));
    await expect(
      fixture.service.verify({
        userId: 'user-1',
        action: modified,
        challenge: issued.challenge,
        response,
        credential,
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'CHALLENGE_INVALID' }));
    expect(fixture.verifier).not.toHaveBeenCalled();
  });

  it('rejects expired, cross-user, and replayed challenges before cryptographic verification', async () => {
    const fixture = service();
    const action = { type: 'mandate.create', payload: { maxMinor: 15_000 } };
    const issued = await fixture.service.issue('user-1', action);

    await expect(
      fixture.service.verify({
        userId: 'user-2',
        action,
        challenge: issued.challenge,
        response,
        credential,
      }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
    expect(fixture.verifier).not.toHaveBeenCalled();
  });
});
