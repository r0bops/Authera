import { getExecutionForUser, type Database, type ExecutionRow, type UserRow } from '@authera/db';
import { ApiProblem } from '../http/problem.js';

export async function requireExecutionAccess(
  db: Database,
  user: UserRow,
  executionId: string,
): Promise<ExecutionRow> {
  const execution = await getExecutionForUser(db, user.id, executionId);
  if (!execution) throw ApiProblem.notFound('execution');
  return execution;
}
