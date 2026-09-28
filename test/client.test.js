import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TornApiClient,
    TornApiError,
    TORN_API_BASE,
    TORN_ERROR_KEY_INVALID,
    TORN_ERROR_RATE_LIMIT,
    redactKey,
} from '../src/api/client.js';

const KEY = 'abcdef1234567890';

function jsonResponse(body, { ok = true, status = 200 } = {}) {
    return {
        ok,
        status,
        json: async () => body,
    };
}

/** Records every URL the client tries to reach. */
function recordingFetch(handler) {
    const calls = [];
    const impl = async (url) => {
        calls.push(url);
        return handler(url, calls.length);
    };
    impl.calls = calls;
    return impl;
}

function makeClient(fetchImpl, options = {}) {
    return new TornApiClient({
        getKey: () => KEY,
        fetchImpl,
        maxRetries: 0,
        ...options,
    });
}

test('every request goes to api.torn.com and carries the key', async () => {
    const fetchImpl = recordingFetch(async () =>
        jsonResponse({ items: { 1: { name: 'Hammer' } } }),
    );

    const client = makeClient(fetchImpl);
    await client.get('torn', { selections: 'items' });

    assert.equal(fetchImpl.calls.length, 1);

    const url = new URL(fetchImpl.calls[0]);
    assert.equal(url.origin + '/', TORN_API_BASE);
    assert.equal(url.pathname, '/torn/');
    assert.equal(url.searchParams.get('selections'), 'items');
    assert.equal(url.searchParams.get('key'), KEY);
});

test('a path cannot redirect the client off api.torn.com', async () => {
    const fetchImpl = recordingFetch(async () => jsonResponse({ ok: 1 }));
    const client = makeClient(fetchImpl);

    // A path that tries to look like another host still resolves under the
    // fixed base, because the base is a constant and callers pass a path.
    await client.get('evil.example.com/steal', {});

    const url = new URL(fetchImpl.calls[0]);
    assert.equal(url.hostname, 'api.torn.com');
});

test('a Torn error becomes a typed error carrying the code', async () => {
    const fetchImpl = recordingFetch(async () =>
        jsonResponse({ error: { code: 2, error: 'Incorrect key' } }),
    );

    const client = makeClient(fetchImpl);

    await assert.rejects(
        () => client.get('torn', { selections: 'items' }),
        (error) => {
            assert.ok(error instanceof TornApiError);
            assert.equal(error.code, TORN_ERROR_KEY_INVALID);
            return true;
        },
    );
});

test('an invalid key is not retried', async () => {
    const fetchImpl = recordingFetch(async () =>
        jsonResponse({ error: { code: TORN_ERROR_KEY_INVALID, error: 'nope' } }),
    );

    const client = makeClient(fetchImpl, { maxRetries: 3 });

    await assert.rejects(() => client.get('torn', {}));
    assert.equal(fetchImpl.calls.length, 1);
});

test('a rate-limit error is retried with backoff', async () => {
    const fetchImpl = recordingFetch(async (url, n) => {
        if (n === 1) {
            return jsonResponse({
                error: { code: TORN_ERROR_RATE_LIMIT, error: 'Too many' },
            });
        }
        return jsonResponse({ items: {} });
    });

    const client = makeClient(fetchImpl, {
        maxRetries: 1,
        rateLimitBackoffMs: 5,
    });

    const data = await client.get('torn', { selections: 'items' });

    assert.deepEqual(data, { items: {} });
    assert.equal(fetchImpl.calls.length, 2);
});

test('identical concurrent requests are deduped into one fetch', async () => {
    const fetchImpl = recordingFetch(async () => jsonResponse({ items: {} }));
    const client = makeClient(fetchImpl);

    await Promise.all([
        client.get('torn', { selections: 'items' }),
        client.get('torn', { selections: 'items' }),
        client.get('torn', { selections: 'items' }),
    ]);

    assert.equal(fetchImpl.calls.length, 1);
});

test('a repeat request inside the dedup window reuses the response', async () => {
    const fetchImpl = recordingFetch(async () => jsonResponse({ items: {} }));
    const client = makeClient(fetchImpl, { dedupTtlMs: 10000 });

    await client.get('torn', { selections: 'items' });
    await client.get('torn', { selections: 'items' });

    assert.equal(fetchImpl.calls.length, 1);
});

test('different requests are not deduped', async () => {
    const fetchImpl = recordingFetch(async () => jsonResponse({ ok: 1 }));
    const client = makeClient(fetchImpl);

    await client.get('torn', { selections: 'items' });
    await client.get('torn', { selections: 'shops' });

    assert.equal(fetchImpl.calls.length, 2);
});

test('the rate limiter reports its remaining budget', async () => {
    const fetchImpl = recordingFetch(async () => jsonResponse({ ok: 1 }));
    const client = makeClient(fetchImpl, { maxPerMinute: 70, dedupTtlMs: 0 });

    await client.get('torn', { selections: 'items' });
    await client.get('torn', { selections: 'shops' });

    const stats = client.stats();
    assert.equal(stats.usedLastMinute, 2);
    assert.equal(stats.remaining, 68);
});

test('a missing key fails before any request is made', async () => {
    const fetchImpl = recordingFetch(async () => jsonResponse({ ok: 1 }));

    const client = new TornApiClient({
        getKey: () => '',
        fetchImpl,
        maxRetries: 0,
    });

    await assert.rejects(() => client.get('torn', {}));
    assert.equal(fetchImpl.calls.length, 0);
});

test('an HTTP failure is reported without leaking the key', async () => {
    const fetchImpl = recordingFetch(async () =>
        jsonResponse({}, { ok: false, status: 503 }),
    );

    const client = makeClient(fetchImpl);

    await assert.rejects(
        () => client.get('torn', {}),
        (error) => {
            assert.equal(error.http, 503);
            assert.ok(!error.message.includes(KEY));
            return true;
        },
    );
});

test('redactKey removes the key from any message', () => {
    assert.equal(redactKey('failed for ' + KEY, KEY), 'failed for <redacted>');

    // Also catches a key that arrived embedded in a URL from elsewhere.
    assert.equal(
        redactKey('https://api.torn.com/torn/?key=zzzzzzzzzzzzzzzz', ''),
        'https://api.torn.com/torn/?key=<redacted>',
    );

    assert.equal(redactKey(null, KEY), '');
});

test('an absolute path cannot redirect the key to another host', async () => {
    // new URL(absolute, base) ignores the base entirely, so the constant base
    // was not by itself the guarantee the README claimed.
    const fetchImpl = recordingFetch(async () => jsonResponse({ ok: 1 }));
    const client = makeClient(fetchImpl);

    await assert.rejects(
        () => client.get('https://evil.example.com/steal'),
        /Refusing to send the API key to evil\.example\.com/,
    );

    assert.equal(fetchImpl.calls.length, 0);
});


