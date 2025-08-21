import { readFile } from 'node:fs/promises';

export type PolicyResult = { status: 'approved' | 'needs_approval' | 'denied'; reason?: string; required_steps?: string[] };

export async function loadPolicy(policyPath: URL): Promise<any> {
  try {
    const json = JSON.parse(await readFile(policyPath, 'utf-8'));
    return json;
  } catch {
    return {};
  }
}

export function checkUpdateCase(policy: any, input: { id: string; status?: string; priority?: string }): PolicyResult {
  const rules = policy?.update_case || {};
  if (input.priority && rules?.priority?.deny?.includes?.(input.priority)) {
    return { status: 'denied', reason: 'priority not allowed' };
  }
  return { status: 'approved' };
}

export function checkEscalateCase(policy: any, input: { id: string; queue: string }): PolicyResult {
  const allowed = policy?.escalate_case?.allowed_queues as string[] | undefined;
  if (allowed && !allowed.includes(input.queue)) {
    const needs = policy?.escalate_case?.needs_approval_queues as string[] | undefined;
    if (needs && needs.includes(input.queue)) {
      return { status: 'needs_approval', required_steps: ['supervisor_approval'] };
    }
    return { status: 'denied', reason: 'queue not allowed' };
  }
  return { status: 'approved' };
}


