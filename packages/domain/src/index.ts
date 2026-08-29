/**
 * @agentcerta/domain — pure, deterministic logic only.
 *
 * Boundary (CLAUDE_IMPLEMENTATION_SPEC.md §6): this package imports no React, Hono,
 * OpenAI, Yuno, or database code. The rule is enforced by ESLint (`no-restricted-imports`)
 * in the root eslint.config.js.
 *
 * Phase 1 adds: policy evaluator, state machines, integer money, canonical hashing,
 * reason-code templates.
 */
export const DOMAIN_PACKAGE = '@agentcerta/domain' as const;
