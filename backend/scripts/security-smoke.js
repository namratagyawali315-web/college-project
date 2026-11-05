'use strict';

const baseUrl = new URL(
  process.env.SMOKE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3101}`
);
const origin = baseUrl.origin;
const results = [];

function record(name, error) {
  results.push({ name, error });
  console.log(`${error ? 'FAIL' : 'PASS'} ${name}${error ? `: ${error.message}` : ''}`);
}

async function check(name, callback) {
  try {
    await callback();
    record(name);
  } catch (error) {
    record(name, error);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, options = {}) {
  return fetch(new URL(path, baseUrl), {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
    ...options
  });
}

async function json(response) {
  return response.json().catch(() => ({}));
}

async function main() {
  let configResponse;

  await check('security headers are present', async () => {
    configResponse = await request('/api/public/config');
    assert(configResponse.status === 200, `expected 200, received ${configResponse.status}`);

    const csp = configResponse.headers.get('content-security-policy') || '';
    const permissions = configResponse.headers.get('permissions-policy') || '';

    assert(csp.includes("default-src 'self'"), 'CSP default-src is missing');
    assert(
      permissions === 'camera=(), microphone=(), geolocation=(), payment=()',
      `unexpected Permissions-Policy: ${permissions}`
    );
    assert(
      configResponse.headers.get('x-content-type-options') === 'nosniff',
      'nosniff header is missing'
    );
    assert(
      configResponse.headers.get('cache-control') === 'no-store',
      'API responses must not be cached'
    );
  });

  await check('environment files are not served', async () => {
    for (const path of ['/.env', '/backend/.env', '/backend/.env.example']) {
      const response = await request(path);
      const body = await response.text();
      assert(response.status === 404, `${path} returned ${response.status}`);
      assert(!body.includes('JWT_SECRET'), `${path} exposed configuration`);
    }
  });

  await check('admin endpoints require a session', async () => {
    const response = await request('/api/admin/me');
    assert(response.status === 401, `expected 401, received ${response.status}`);
  });

  await check('admin writes reject a missing Origin', async () => {
    const response = await request('/api/admin/logout', { method: 'POST' });
    assert(response.status === 403, `expected 403, received ${response.status}`);
  });

  await check('admin writes reject a cross-origin request', async () => {
    const response = await request('/api/admin/logout', {
      method: 'POST',
      headers: { Origin: 'https://example.invalid' }
    });
    assert(response.status === 403, `expected 403, received ${response.status}`);
  });

  await check('admin writes accept the app origin', async () => {
    const response = await request('/api/admin/logout', {
      method: 'POST',
      headers: { Origin: origin }
    });
    assert(response.status === 200, `expected 200, received ${response.status}`);
  });

  await check('order tracking requires the header token', async () => {
    const response = await request('/api/public/orders/999999999');
    assert(response.status === 400, `expected 400, received ${response.status}`);
  });

  await check('order tracking ignores query-string tokens', async () => {
    const response = await request('/api/public/orders/999999999?token=not-a-real-token');
    assert(response.status === 400, `expected 400, received ${response.status}`);
  });

  await check('order tracking rejects an invalid header token', async () => {
    const response = await request('/api/public/orders/999999999', {
      headers: { 'X-Order-Token': 'not-a-real-token' }
    });
    assert(response.status === 404, `expected 404, received ${response.status}`);
  });

  if (process.env.SMOKE_RATE_LIMIT === '1') {
    await check('order rate limit returns 429', async () => {
      let response;

      for (let attempt = 0; attempt < 31; attempt += 1) {
        response = await request('/api/public/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
      }

      assert(response.status === 429, `expected 429, received ${response.status}`);
    });
  }

  const failures = results.filter((result) => result.error);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Security smoke test failed:', error.message);
  process.exitCode = 1;
});
