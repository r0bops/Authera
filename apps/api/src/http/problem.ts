import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** A structured, user-safe HTTP error mapped to the JSON envelope by app.onError. */
export class ApiProblem extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiProblem';
  }

  static notFound(what: string): ApiProblem {
    return new ApiProblem(404, 'NOT_FOUND', `${what} not found`);
  }

  static validation(details: unknown): ApiProblem {
    return new ApiProblem(422, 'VALIDATION_FAILED', 'Request did not pass validation', details);
  }

  static unauthenticated(): ApiProblem {
    return new ApiProblem(401, 'UNAUTHENTICATED', 'A human session is required');
  }

  static forbidden(message = 'Forbidden'): ApiProblem {
    return new ApiProblem(403, 'FORBIDDEN', message);
  }

  static conflict(code: string, message: string, details?: unknown): ApiProblem {
    return new ApiProblem(409, code, message, details);
  }
}

export function formatZodIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));
}
