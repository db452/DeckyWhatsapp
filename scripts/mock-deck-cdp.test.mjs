import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import {
  bounded,
  boundedCdpOperation,
  boundedCdpCommand,
  closeClientBounded,
  connectBounded,
  createNoRedirectWebSocket,
  createDiagnostics,
  discoverTargets,
  exerciseMock,
  formatCliError,
  inspectTarget,
  isForbiddenRequest,
  isQuickAccessTarget,
  loadStrictCdpClient,
  sanitizeException,
  selectQuickAccessTarget,
  validateTargetSocket
} from './mock-deck-cdp.mjs';

function fakeClient({ valid = true, label = 'MOCK / OFFLINE', hitControl = true, invalidScopeAfterScroll = false, missingControlAfterScroll = false, changedScopeAfterScroll = false, changedControlAfterScroll = false, changedBackendScopeAfterScroll = false, changedBackendControlAfterScroll = false } = {}) {
  const calls = [];
  const eventHandlers = {};
  let scrolled = false;
  let scopeQueries = 0;
  const client = {
    calls,
    DOM: {
      async getDocument() { calls.push(['getDocument']); return { root: { nodeId: 1 } }; },
      async querySelector({ selector }) {
        calls.push(['querySelector', selector]);
        if (selector.includes('data-decky-provider')) {
          scopeQueries += 1;
          if (changedScopeAfterScroll && scopeQueries > 1) return { nodeId: 8 };
          return { nodeId: valid && !(invalidScopeAfterScroll && scopeQueries > 1) ? 2 : 0 };
        }
        const isControl = selector.includes('mock-connection-toggle-start') || selector.includes('mock-connection-toggle-stop') || selector.includes('open-ava');
        if (isControl && changedControlAfterScroll && scrolled) return { nodeId: 9 };
        return { nodeId: isControl && !(missingControlAfterScroll && scrolled) ? 3 : 0 };
      },
      async describeNode({ nodeId }) {
        calls.push(['describeNode', nodeId]);
        const isScope = nodeId === 2 || nodeId === 8;
        const isControl = nodeId === 3 || nodeId === 9;
        const currentControlId = changedControlAfterScroll && scrolled ? 9 : 3;
        return { node: {
          ...(isScope ? {
            backendNodeId: nodeId === 8 && changedBackendScopeAfterScroll ? 201 : 200,
            attributes: ['data-decky-provider', 'mock', 'data-decky-label', label, 'data-decky-scope', 'mock-panel', 'aria-label', label]
          } : {}),
          ...(isControl ? { backendNodeId: nodeId === 9 && changedBackendControlAfterScroll ? 301 : 300 } : {}),
          ...(nodeId === 4 ? { parentId: hitControl ? currentControlId : 99 } : nodeId === 3 || nodeId === 9 ? { parentId: 2 } : {})
        } };
      },
      async getNodeForLocation({ x, y }) { calls.push(['getNodeForLocation', x, y]); return { nodeId: 4 }; },
      async getBoxModel({ nodeId }) { calls.push(['getBoxModel', nodeId]); return { model: { border: [10, 20, 30, 20, 30, 40, 10, 40] } }; },
      async scrollIntoViewIfNeeded({ nodeId }) { calls.push(['scrollIntoViewIfNeeded', nodeId]); scrolled = true; }
    },
    Input: {
      async dispatchMouseEvent(event) { calls.push(['mouse', event]); }
    },
    Runtime: {
      exceptionThrown(handler) { eventHandlers.exception = handler; },
      consoleAPICalled(handler) { eventHandlers.console = handler; },
      async enable() { calls.push(['runtimeEnable']); },
    },
    Network: {
      requestWillBeSent(handler) { eventHandlers.request = handler; },
      async enable() { calls.push(['networkEnable']); }
    },
    emit: eventHandlers
  };
  client.buttonLabel = 'Start';
  return client;
}

test('CDP discovery accepts only loopback and returns only page targets', async () => {
  const seen = [];
  let requestOptions;
  const targets = await discoverTargets('http://127.0.0.1:9222', async (url, options) => {
    seen.push(url);
    requestOptions = options;
    return { ok: true, json: async () => [
      { id: 'quick', type: 'page', title: 'QuickAccess_uid2', url: 'http://steam/quick' },
      { id: 'game', type: 'page', title: 'Game', url: 'http://steam/game' },
      { id: 'worker', type: 'service_worker', title: 'QuickAccess_uid2', url: 'http://steam/quick' }
    ] };
  });
  assert.deepEqual(seen, ['http://127.0.0.1:9222/json/list']);
  assert.equal(requestOptions.redirect, 'error');
  assert.equal(targets.length, 1);
  assert.equal(selectQuickAccessTarget(targets).id, 'quick');
  await assert.rejects(() => discoverTargets('http://192.168.1.5:9222', async () => ({ ok: true, json: async () => [] })), /loopback/);
  await assert.rejects(() => discoverTargets('http://127.0.0.1:9222', async () => ({
    ok: true, redirected: true, url: 'http://192.0.2.5:9222/json/list', json: async () => []
  })), /redirected/);
});

test('HTTP target discovery rejects redirects before contacting the redirect destination', async (t) => {
  let destinationHits = 0;
  const destination = http.createServer((_request, response) => { destinationHits += 1; response.end('[]'); });
  const redirector = http.createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${destination.address().port}/json/list` });
    response.end();
  });
  await new Promise((resolve) => destination.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => redirector.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await Promise.all([redirector, destination].map((server) => new Promise((resolve) => server.close(resolve))));
  });
  await assert.rejects(() => discoverTargets(`http://127.0.0.1:${redirector.address().port}`));
  assert.equal(destinationHits, 0, 'fetch redirect:error must not contact a changed discovery endpoint');
});

test('validated target keeps the discovery websocket object and rejects host or port substitution', () => {
  const original = { id: 'quick', type: 'page', title: 'QuickAccess_uid2', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/quick' };
  const validated = validateTargetSocket(original, 'http://127.0.0.1:9222');
  assert.equal(validated.webSocketDebuggerUrl, original.webSocketDebuggerUrl);
  assert.equal(Object.isFrozen(validated), true);
  assert.throws(() => validateTargetSocket({ ...original, webSocketDebuggerUrl: 'ws://192.0.2.5:9222/devtools/page/quick' }, 'http://127.0.0.1:9222'), /does not match/);
  assert.throws(() => validateTargetSocket({ ...original, webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/quick' }, 'http://127.0.0.1:9222'), /does not match/);
});

test('WebSocket transport refuses redirects instead of following a changed target', async (t) => {
  let redirectedHits = 0;
  const redirectedServer = http.createServer((_request, response) => { redirectedHits += 1; response.end('unexpected'); });
  const initialServer = http.createServer((_request, response) => {
    response.writeHead(302, { location: `ws://127.0.0.1:${redirectedServer.address().port}/redirected` });
    response.end();
  });
  await new Promise((resolve) => redirectedServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => initialServer.listen(0, '127.0.0.1', resolve));
  t.after(() => { initialServer.close(); redirectedServer.close(); });
  const StrictWebSocket = createNoRedirectWebSocket(WebSocket);
  const socket = new StrictWebSocket(`ws://127.0.0.1:${initialServer.address().port}/initial`, [], { followRedirects: true, handshakeTimeout: 500 });
  await new Promise((resolve) => socket.once('error', resolve));
  socket.terminate();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(redirectedHits, 0);
});

test('pinned CDP adapter attaches to the discovered socket and never follows its redirect', async (t) => {
  let redirectedHits = 0;
  let discoveryRequests = 0;
  let socketPaths = [];
  const redirectedServer = http.createServer((_request, response) => { redirectedHits += 1; response.end('unexpected'); });
  redirectedServer.on('upgrade', () => { redirectedHits += 1; });
  await new Promise((resolve) => redirectedServer.listen(0, '127.0.0.1', resolve));

  const originServer = http.createServer((request, response) => {
    if (request.url !== '/json/list') { response.writeHead(404).end(); return; }
    discoveryRequests += 1;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify([{
      id: 'quick', type: 'page', title: 'QuickAccess_uid2', url: 'http://steam/quick',
      webSocketDebuggerUrl: `ws://127.0.0.1:${originServer.address().port}/devtools/page/quick`
    }]));
  });
  originServer.on('upgrade', (request, socket) => {
    socketPaths.push(request.url);
    socket.write(`HTTP/1.1 302 Found\r\nLocation: ws://127.0.0.1:${redirectedServer.address().port}/redirected\r\nContent-Length: 0\r\n\r\n`);
    socket.end();
  });
  await new Promise((resolve) => originServer.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await Promise.all([originServer, redirectedServer].map((server) => new Promise((resolve) => server.close(resolve))));
  });

  const endpoint = `http://127.0.0.1:${originServer.address().port}`;
  const discovered = await discoverTargets(endpoint);
  const target = validateTargetSocket(selectQuickAccessTarget(discovered), endpoint);
  const { CDP, sockets } = loadStrictCdpClient();
  assert.equal(discoveryRequests, 1);
  await assert.rejects(() => connectBounded(() => CDP({ target, local: true }), { timeoutMs: 1000, sockets }));
  for (const socket of sockets) socket.terminate();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(socketPaths, ['/devtools/page/quick']);
  assert.equal(discoveryRequests, 1, 'attaching must use the exact discovery result without rediscovery');
  assert.equal(redirectedHits, 0, 'the redirect destination must never receive a connection');
});

test('connection, commands, and cleanup time out and terminate owned sockets', async () => {
  let terminated = 0;
  const socket = { terminate() { terminated += 1; } };
  await assert.rejects(() => connectBounded(() => new Promise(() => {}), { timeoutMs: 15, sockets: new Set([socket]) }), /connection timed out/);
  assert.equal(terminated, 1);

  await assert.rejects(() => boundedCdpCommand({ Runtime: { evaluate: () => new Promise(() => {}) } }, 'Runtime', 'evaluate', {}, 15), /Runtime\.evaluate timed out/);

  const beforeClose = terminated;
  await closeClientBounded({ close: () => new Promise(() => {}) }, new Set([socket]), 15);
  assert.equal(terminated, beforeClose + 1);
  await assert.rejects(() => bounded(() => new Promise(() => {}), 15, 'overall operation timed out.'), /overall operation timed out/);

  let operationTerminated = 0;
  let clientClosed = 0;
  const ownedSocket = { terminate() { operationTerminated += 1; } };
  const ownedClient = { close: async () => { clientClosed += 1; } };
  await assert.rejects(() => boundedCdpOperation(() => new Promise(() => {}), {
    timeoutMs: 15, sockets: new Set([ownedSocket]), getClient: () => ownedClient
  }), /MOCK CDP operation timed out/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(operationTerminated, 1);
  assert.equal(clientClosed, 1, 'an overall timeout must start bounded cleanup for the owned client');
});

test('Quick Access selection rejects missing or ambiguous targets', () => {
  assert.equal(isQuickAccessTarget({ id: 'id', type: 'page', url: 'http://x/QuickAccess_uid2' }), true);
  assert.throws(() => selectQuickAccessTarget([]), /not found/);
  assert.throws(() => selectQuickAccessTarget([
    { id: 'one', type: 'page', title: 'QuickAccess_uid2' },
    { id: 'two', type: 'page', url: 'http://x/QuickAccess_uid2' }
  ]), /Multiple/);
});

test('MOCK marker and visible label failure stops before input dispatch', async () => {
  const client = fakeClient({ valid: false });
  await assert.rejects(() => exerciseMock(client, 'start'), /MOCK panel scope is absent/);
  assert.equal(client.calls.some(([name]) => name === 'mouse'), false);

  const wrongLabel = fakeClient({ label: 'Decky WhatsApp' });
  await assert.rejects(() => exerciseMock(wrongLabel, 'start'), /MOCK provider guard/);
  assert.equal(wrongLabel.calls.some(([name]) => name === 'mouse'), false);
});

test('CLI reports the exact safe missing-MOCK-scope guard and suppresses unknown errors', () => {
  assert.equal(
    formatCliError(new Error('Verified MOCK panel scope is absent; no UI action was taken.')),
    'Verified MOCK panel scope is absent; no UI action was taken.'
  );
  assert.equal(
    formatCliError(new Error('private CDP payload: token=secret')),
    'MOCK CDP operation failed; details were suppressed.'
  );
});

test('allowed MOCK action clicks only an exactly matched control inside the verified subtree', async () => {
  const client = fakeClient();
  const outcome = await exerciseMock(client, 'start');
  assert.deepEqual(outcome, { exercised: 'start', mockGuard: true });
  assert.equal(client.calls.filter(([name]) => name === 'mouse').length, 2);
  assert.deepEqual(client.calls.filter(([name]) => name === 'mouse').map(([, event]) => [event.type, event.x, event.y]), [
    ['mousePressed', 20, 30], ['mouseReleased', 20, 30]
  ]);
  const scrollIndex = client.calls.findIndex(([name]) => name === 'scrollIntoViewIfNeeded');
  const refreshedScopeIndex = client.calls.findIndex(([name], index) => name === 'getDocument' && index > scrollIndex);
  const refreshedControlIndex = client.calls.findIndex(([name, selector], index) => name === 'querySelector' && selector.includes('mock-connection-toggle-start') && index > scrollIndex);
  const boundsIndex = client.calls.findIndex(([name]) => name === 'getBoxModel');
  const clickIndex = client.calls.findIndex(([name]) => name === 'mouse');
  assert.ok(scrollIndex >= 0, 'the exact control is scrolled into view');
  assert.ok(refreshedScopeIndex > scrollIndex, 'the MOCK scope is revalidated after scrolling');
  assert.ok(refreshedControlIndex > refreshedScopeIndex, 'the exact control is re-resolved after scrolling');
  assert.ok(boundsIndex > refreshedControlIndex, 'click bounds are read only after revalidation');
  assert.ok(clickIndex > boundsIndex, 'input is dispatched only after hit testing');
  await assert.rejects(() => exerciseMock(client, 'send-live-message'), /Unsupported/);

  const overlay = fakeClient({ hitControl: false });
  await assert.rejects(() => exerciseMock(overlay, 'start'), /not the hit-tested target/);
  assert.equal(overlay.calls.some(([name]) => name === 'mouse'), false, 'an overlay or unrelated element must never receive the click');

  const scopeLostAfterScroll = fakeClient({ invalidScopeAfterScroll: true });
  await assert.rejects(() => exerciseMock(scopeLostAfterScroll, 'open-ava'), /MOCK panel scope is absent/);
  assert.equal(scopeLostAfterScroll.calls.some(([name]) => name === 'mouse'), false, 'a lost MOCK scope must prevent input');

  const controlLostAfterScroll = fakeClient({ missingControlAfterScroll: true });
  await assert.rejects(() => exerciseMock(controlLostAfterScroll, 'open-ava'), /Requested MOCK control is unavailable/);
  assert.equal(controlLostAfterScroll.calls.some(([name]) => name === 'mouse'), false, 'a missing re-resolved control must prevent input');

  const changedScopeAfterScroll = fakeClient({ changedScopeAfterScroll: true });
  await exerciseMock(changedScopeAfterScroll, 'open-ava');
  assert.equal(changedScopeAfterScroll.calls.filter(([name]) => name === 'mouse').length, 2, 'a refreshed frontend scope ID with the same backend identity remains safe');

  const changedControlAfterScroll = fakeClient({ changedControlAfterScroll: true });
  await exerciseMock(changedControlAfterScroll, 'open-ava');
  assert.equal(changedControlAfterScroll.calls.filter(([name]) => name === 'mouse').length, 2, 'a refreshed frontend control ID with the same backend identity remains safe');

  const changedBackendScopeAfterScroll = fakeClient({ changedScopeAfterScroll: true, changedBackendScopeAfterScroll: true });
  await assert.rejects(() => exerciseMock(changedBackendScopeAfterScroll, 'open-ava'), /panel identity changed after scrolling/);
  assert.equal(changedBackendScopeAfterScroll.calls.some(([name]) => name === 'mouse'), false, 'a changed MOCK scope backend identity must prevent input');

  const changedBackendControlAfterScroll = fakeClient({ changedControlAfterScroll: true, changedBackendControlAfterScroll: true });
  await assert.rejects(() => exerciseMock(changedBackendControlAfterScroll, 'open-ava'), /control identity changed after scrolling/);
  assert.equal(changedBackendControlAfterScroll.calls.some(([name]) => name === 'mouse'), false, 'a changed MOCK control backend identity must prevent input');
});

test('diagnostics report only forbidden-request presence and sanitized exception metadata', () => {
  assert.equal(isForbiddenRequest('http://127.0.0.1:8787/api/chats?private=message'), true);
  assert.equal(isForbiddenRequest('https://web.whatsapp.com/send?text=secret'), true);
  assert.equal(isForbiddenRequest('https://example.test/'), false);
  const diagnostics = createDiagnostics();
  diagnostics.onRequest({ request: { url: 'http://127.0.0.1:8787/private?token=secret' } });
  diagnostics.onRequest({ request: { url: 'https://example.test/private-message' } });
  diagnostics.onException({ exceptionDetails: {
    text: 'private message text', exception: { className: 'TypeError', description: 'token=secret private data' },
    lineNumber: 4, columnNumber: 7, scriptId: '123'
  } });
  diagnostics.onConsole({ type: 'error', args: [{ value: 'private message' }] });
  const result = diagnostics.snapshot();
  assert.deepEqual(result, {
    forbiddenRequests: { occurred: true, count: 1 },
    consoleErrors: 1,
    exceptions: [{ className: 'TypeError', line: 4, column: 7, scriptId: '123' }]
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|private|127\.0\.0\.1|https?:/);
  assert.deepEqual(sanitizeException({ text: 'secret', exception: { className: 'Exception\nsecret' } }), {
    className: 'Error', line: null, column: null, scriptId: null
  });
});

test('inspection enables metadata diagnostics and confirms the guarded MOCK panel', async () => {
  const client = fakeClient();
  const result = await inspectTarget(client);
  assert.equal(result.mockReady, true);
  assert.deepEqual(result.diagnostics, { forbiddenRequests: { occurred: false, count: 0 }, consoleErrors: 0, exceptions: [] });
  assert.equal(client.calls.some(([name]) => name === 'evaluate'), false, 'read-only inspection does not evaluate page scripts');
});
