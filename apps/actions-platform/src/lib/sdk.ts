export type ClientOpts = { baseUrl: string; auth?: string; tenantId?: string };

export class ActionsClient {
  private baseUrl: string;
  private auth?: string;
  private tenantId?: string;
  constructor(opts: ClientOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.auth = opts.auth;
    this.tenantId = opts.tenantId;
  }
  private headers(extra?: Record<string, string>) {
    return {
      'content-type': 'application/json',
      ...(this.auth ? { authorization: this.auth } : {}),
      ...(this.tenantId ? { 'x-tenant-id': this.tenantId } : {}),
      ...(extra || {})
    } as Record<string, string>;
  }
  async lookupCustomer(body: { query: string; include?: string[] }) {
    return this.post('/tools/crm/lookup_customer', body);
  }
  async createCase(body: { customer_id: string; subject: string; priority?: string; initial_note?: string; tags?: string[] }, idempotencyKey: string) {
    return this.post('/tools/crm/create_case', body, { 'idempotency-key': idempotencyKey });
  }
  async addNote(body: { case_id: string; body: string; visibility?: string; author?: string }, idempotencyKey: string) {
    return this.post('/tools/crm/add_note', body, { 'idempotency-key': idempotencyKey });
  }
  async updateCase(body: { id: string; subject?: string; status?: string; priority?: string; assigned_queue?: string; tags?: string[]; custom_fields?: Record<string, unknown> }, idempotencyKey: string) {
    return this.post('/tools/crm/update_case', body, { 'idempotency-key': idempotencyKey });
  }
  async escalateCase(body: { id: string; queue: string; note?: string }, idempotencyKey: string) {
    return this.post('/tools/crm/escalate_case', body, { 'idempotency-key': idempotencyKey });
  }
  private async post(path: string, body: any, extraHeaders?: Record<string, string>) {
    const res = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: this.headers(extraHeaders), body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw Object.assign(new Error('Request failed'), { status: res.status, body: json });
    return json;
  }
}


