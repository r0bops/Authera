import { randomBytes } from 'node:crypto';
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { hashCanonical } from '@authera/domain';

const ACTION_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type PasskeyAction = Readonly<{
  type: string;
  resourceId?: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export interface PasskeyChallengeRecord {
  challenge: string;
  userId: string;
  actionHash: string;
  expiresAt: Date;
}

export interface PasskeyActionStore {
  put(record: PasskeyChallengeRecord): Promise<void>;
  /** Must atomically return and delete one challenge. */
  consume(challenge: string): Promise<PasskeyChallengeRecord | undefined>;
}

export type PasskeyAuthenticationVerifier = (input: {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
  credential: WebAuthnCredential;
  requireUserVerification: true;
}) => Promise<{ verified: boolean; authenticationInfo: { newCounter: number } }>;

export class PasskeyActionError extends Error {
  constructor(readonly code: 'CHALLENGE_INVALID' | 'ACTION_MISMATCH' | 'VERIFICATION_FAILED') {
    super(code);
    this.name = 'PasskeyActionError';
  }
}

export class PasskeyActionService {
  constructor(
    private readonly options: {
      rpId: string;
      origin: string;
      store: PasskeyActionStore;
      now?: () => Date;
      verifier?: PasskeyAuthenticationVerifier;
    },
  ) {}

  async issue(userId: string, action: PasskeyAction): Promise<PasskeyChallengeRecord> {
    const now = (this.options.now ?? (() => new Date()))();
    const actionHash = hashCanonical(action);
    const challenge = Buffer.from(
      JSON.stringify({ nonce: randomBytes(32).toString('base64url'), actionHash }),
    ).toString('base64url');
    const record = {
      challenge,
      userId,
      actionHash,
      expiresAt: new Date(now.getTime() + ACTION_CHALLENGE_TTL_MS),
    };
    await this.options.store.put(record);
    return record;
  }

  async verify(input: {
    userId: string;
    action: PasskeyAction;
    challenge: string;
    response: AuthenticationResponseJSON;
    credential: WebAuthnCredential;
  }): Promise<{ actionHash: string; newCounter: number }> {
    // Consume before all checks: a malformed or failed assertion cannot be retried as an oracle.
    const record = await this.options.store.consume(input.challenge);
    const now = (this.options.now ?? (() => new Date()))();
    if (!record || record.userId !== input.userId || record.expiresAt.getTime() <= now.getTime()) {
      throw new PasskeyActionError('CHALLENGE_INVALID');
    }
    const actionHash = hashCanonical(input.action);
    if (actionHash !== record.actionHash || !challengeContainsHash(input.challenge, actionHash)) {
      throw new PasskeyActionError('ACTION_MISMATCH');
    }
    if (input.response.id !== input.credential.id) {
      throw new PasskeyActionError('VERIFICATION_FAILED');
    }
    const verifier = this.options.verifier ?? verifyAuthenticationResponse;
    let verification;
    try {
      verification = await verifier({
        response: input.response,
        expectedChallenge: input.challenge,
        expectedOrigin: this.options.origin,
        expectedRPID: this.options.rpId,
        credential: input.credential,
        requireUserVerification: true,
      });
    } catch {
      throw new PasskeyActionError('VERIFICATION_FAILED');
    }
    if (!verification.verified) throw new PasskeyActionError('VERIFICATION_FAILED');
    return { actionHash, newCounter: verification.authenticationInfo.newCounter };
  }
}

function challengeContainsHash(challenge: string, expectedHash: string): boolean {
  try {
    const value = JSON.parse(Buffer.from(challenge, 'base64url').toString('utf8')) as unknown;
    return (
      typeof value === 'object' &&
      value !== null &&
      'actionHash' in value &&
      value.actionHash === expectedHash
    );
  } catch {
    return false;
  }
}
