import type { FastifyRequest, FastifyReply } from 'fastify';
import { jwtVerify, importJWK, createRemoteJWKSet } from 'jose';

export type AuthResult = {
  ok: true;
  scopes: string[];
  sub: string;
} | {
  ok: false;
  error: { type: string; message: string };
};

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function authenticate(req: FastifyRequest): Promise<AuthResult> {
  if (process.env.AUTH_BYPASS === '1') {
    return { ok: true, scopes: ['customer:read', 'case:write', 'note:write'], sub: 'local-dev' };
  }
  const hdr = req.headers['authorization'];
  if (!hdr || !hdr.toString().startsWith('Bearer ')) {
    return { ok: false, error: { type: 'PermissionDenied', message: 'Missing bearer token' } };
  }
  const token = hdr.toString().slice('Bearer '.length);
  try {
    const jwkJson = process.env.AUTH_JWK;
    const jwksUrl = process.env.AUTH_JWKS_URL;
    let payload: any;
    if (jwksUrl) {
      if (!jwksCache) jwksCache = createRemoteJWKSet(new URL(jwksUrl));
      const res = await jwtVerify(token, jwksCache, { audience: process.env.AUTH_AUD, issuer: process.env.AUTH_ISS });
      payload = res.payload;
    } else if (jwkJson) {
      const jwk = JSON.parse(jwkJson);
      const key = await importJWK(jwk, jwk.alg);
      const res = await jwtVerify(token, key, { audience: process.env.AUTH_AUD, issuer: process.env.AUTH_ISS });
      payload = res.payload;
    } else {
      return { ok: false, error: { type: 'PermissionDenied', message: 'Verifier not configured' } };
    }
    const scopes = (payload.scope as string | undefined)?.split(' ') || [];
    return { ok: true, scopes, sub: String(payload.sub || '') };
  } catch (err: any) {
    return { ok: false, error: { type: 'PermissionDenied', message: 'Invalid token' } };
  }
}

export function requireScopes(have: string[], need: string[]): boolean {
  if (need.length === 0) return true;
  const set = new Set(have);
  return need.every((s) => set.has(s));
}


