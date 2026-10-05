import { createRemoteJWKSet, jwtVerify } from 'jose';

export async function authorize(request, env, resolver, access) {
  const issuer = env.ACCESS_TEAM_DOMAIN;
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer || '') || !env.ACCESS_AUD || !env.ALLOWED_EMAIL) return null;
  if (access && access.aud === env.ACCESS_AUD && typeof access.getIdentity === 'function') {
    try {
      const identity = await access.getIdentity();
      if (typeof identity?.email !== 'string' || identity.email.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) return null;
      return { email:identity.email, subject:identity.id || identity.sub || identity.email };
    } catch { return null; }
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16384) return null;
  try {
    const keys = resolver || createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'), { timeoutDuration:5000 });
    const { payload } = await jwtVerify(token, keys, { issuer, audience:env.ACCESS_AUD, algorithms:['RS256'],requiredClaims:['exp','iat','sub','email'] });
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) return null;
    return { email:payload.email, subject:payload.sub };
  } catch { return null; }
}

