/**
 * Backend security + failure-handling tests.
 *
 * These assert the contract in server/aiHandler.mjs directly over HTTP:
 *   - the key is never echoed by any endpoint, in any field, on any path
 *   - every failure maps to a short sanitised string
 *   - malformed input is rejected without a stack trace reaching the client
 *
 * Run against a server that is already up:
 *   npx vite preview --port 4173 &   (or: node server/index.mjs)
 *   node tools/backendtest.mjs
 */

const BASE = process.env.PLAYTEST_URL_BASE ?? 'http://localhost:4173';

/** A syntactically valid but fake key. Never a real one. */
const FAKE_KEY = 'sk-' + 'A1b2C3d4E5f6G7h8J9k0L1m2N3o4P5q6';

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function call(path, body, method = 'POST') {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  return { status: res.status, text, json };
}

/** The single most important assertion in this file. */
function assertNoKey(label, text) {
  const leaked =
    text.includes(FAKE_KEY) ||
    text.includes(FAKE_KEY.slice(0, 12)) ||
    /sk-[A-Za-z0-9_-]{8,}/.test(text);
  check(`${label} does not leak the key`, !leaked, leaked ? text.slice(0, 200) : '');
}

async function main() {
  console.log('[backendtest]', BASE);

  /* ---- status before anything ---- */
  let r = await call('/api/ai/status', null, 'GET');
  check('status endpoint responds', r.status === 200 && r.json !== null, String(r.status));
  check('status reports a provider', r.json?.provider === 'openai', String(r.json?.provider));
  check('status has no key field', !('key' in (r.json ?? {})) && !('apiKey' in (r.json ?? {})));
  assertNoKey('status', r.text);

  /* ---- test with no key ---- */
  r = await call('/api/ai/test', {});
  check(
    'test without a key fails cleanly',
    r.json?.ok === false && typeof r.json?.error === 'string',
    r.json?.error
  );
  assertNoKey('test-without-key', r.text);

  r = await call('/api/ai/text', { user: 'hello' });
  check('text without a key fails cleanly', r.json?.ok === false, r.json?.error);
  r = await call('/api/ai/image', { prompt: 'hello' });
  check('image without a key fails cleanly', r.json?.ok === false, r.json?.error);

  /* ---- reject junk keys ---- */
  r = await call('/api/ai/connect', { key: 'not-a-key' });
  check('malformed key rejected', r.json?.ok === false && r.json?.connected === false, r.json?.error);
  r = await call('/api/ai/connect', { key: '' });
  check('empty key rejected', r.json?.ok === false, r.json?.error);

  /* ---- connect with a well-formed fake key ---- */
  r = await call('/api/ai/connect', { key: FAKE_KEY });
  check('well-formed key accepted for storage', r.json?.ok === true && r.json?.connected === true);
  assertNoKey('connect-response', r.text);

  r = await call('/api/ai/status', null, 'GET');
  check('status now reports connected', r.json?.connected === true);
  check('status still reports unverified', r.json?.verified === false);
  assertNoKey('status-after-connect', r.text);

  /* ---- the real failure path ---- */
  r = await call('/api/ai/test', {});
  const err = r.json?.error ?? '';
  const known = [
    'Invalid API key',
    'Network unavailable',
    'Request timed out',
    'API unavailable',
    'Rate limited — too many requests',
    'API rejected the request',
    'API unavailable — model not found',
  ];
  check('a bad key produces a sanitised error', r.json?.ok === false && known.includes(err), err);
  check('error is short and human', err.length > 0 && err.length < 60, `${err.length} chars`);
  assertNoKey('test-with-bad-key', r.text);
  check('no stack trace in the response', !/\bat \w+.*:\d+:\d+/.test(r.text));

  r = await call('/api/ai/text', { system: 'x', user: 'y' });
  check('text with a bad key fails cleanly', r.json?.ok === false, r.json?.error);
  assertNoKey('text-with-bad-key', r.text);

  /* ---- disconnect forgets it ---- */
  r = await call('/api/ai/disconnect', {});
  check('disconnect succeeds', r.json?.ok === true && r.json?.connected === false);
  r = await call('/api/ai/status', null, 'GET');
  check('status reports disconnected after disconnect', r.json?.connected === false);
  assertNoKey('status-after-disconnect', r.text);

  /* ---- malformed input ---- */
  const bad = await fetch(BASE + '/api/ai/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  const badText = await bad.text();
  check('malformed JSON rejected', bad.status === 400, String(bad.status));
  check('malformed JSON gives no stack trace', !/\bat \w+.*:\d+:\d+/.test(badText));

  r = await call('/api/ai/nope', {});
  check('unknown endpoint 404s', r.status === 404, String(r.status));

  const wrongMethod = await fetch(BASE + '/api/ai/connect', { method: 'GET' });
  check('wrong method does not crash the server', wrongMethod.status === 404, String(wrongMethod.status));

  // Server still alive after all of that?
  r = await call('/api/ai/status', null, 'GET');
  check('server survives the whole suite', r.status === 200);

  const badPath = await fetch(BASE + '/%');
  check('malformed path returns 400', badPath.status === 400, String(badPath.status));
  r = await call('/api/ai/status', null, 'GET');
  check('server survives malformed path', r.status === 200);

  const foreign = await fetch(BASE + '/api/ai/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' },
    body: '{"key":"sk-test"}',
  });
  check('foreign origin POST to /connect rejected', foreign.status >= 400 && foreign.status < 500, String(foreign.status));

  const failed = checks.filter((c) => !c.ok);
  console.log('\n================ BACKEND ================');
  console.log(`checks: ${checks.length - failed.length}/${checks.length} passed`);
  for (const f of failed) console.log('  FAILED:', f.name, f.detail);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('backendtest failed:', e);
  process.exit(2);
});
