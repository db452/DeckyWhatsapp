#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:9222';
const MOCK_SCOPE_SELECTOR = '[data-decky-provider="mock"][data-decky-label="MOCK / OFFLINE"][data-decky-scope="mock-panel"]';
const FORBIDDEN_HOSTS = new Set(['web.whatsapp.com', 'whatsapp.com', 'whatsapp.net', 'mmg.whatsapp.net']);
const SAFE_EXERCISES = new Set(['start', 'stop', 'open-ava']);
const CONNECT_TIMEOUT_MS = 5000;
const COMMAND_TIMEOUT_MS = 5000;
const OPERATION_TIMEOUT_MS = 30000;
const CLOSE_TIMEOUT_MS = 1000;

function safeEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('CDP endpoint must use HTTP on loopback.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('CDP endpoint must be a plain loopback origin.');
  }
  return url.origin;
}
export async function discoverTargets(endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch) {
  const origin = safeEndpoint(endpoint);
  const requestUrl = `${origin}/json/list`;
  const controller = new AbortController();
  return bounded(async () => {
    const response = await fetchImpl(requestUrl, { signal: controller.signal, redirect: 'error' });
    if (response.redirected || (response.url && response.url !== requestUrl)) throw new Error('CDP discovery redirected; refusing target data.');
    if (!response.ok) throw new Error(`CDP target discovery failed (HTTP ${response.status}).`);
    const targets = await response.json();
    if (!Array.isArray(targets)) throw new Error('CDP target discovery returned an invalid response.');
    return targets.filter((target) => target?.type === 'page' && isQuickAccessTarget(target));
  }, CONNECT_TIMEOUT_MS, 'CDP discovery timed out.', () => controller.abort());
}

export function isQuickAccessTarget(target) {
  return typeof target?.id === 'string' &&
    (target.title === 'QuickAccess_uid2' || /(?:^|\/)QuickAccess_uid2(?:[/?#]|$)/.test(target.url || ''));
}

export function selectQuickAccessTarget(targets) {
  const matches = targets.filter(isQuickAccessTarget);
  if (matches.length !== 1) throw new Error(matches.length ? 'Multiple Quick Access targets found; refusing to choose.' : 'Quick Access target not found.');
  return matches[0];
}

export function validateTargetSocket(target, endpoint) {
  const endpointUrl = new URL(safeEndpoint(endpoint));
  const socketUrl = new URL(target?.webSocketDebuggerUrl);
  const endpointPort = endpointUrl.port || '80';
  if (socketUrl.protocol !== 'ws:' || socketUrl.hostname !== endpointUrl.hostname || socketUrl.port !== endpointPort ||
      socketUrl.username || socketUrl.password || socketUrl.search || socketUrl.hash) {
    throw new Error('Quick Access debugger socket does not match the validated loopback endpoint.');
  }
  return Object.freeze({ ...target });
}

export function createNoRedirectWebSocket(BaseWebSocket, socketSet = new Set()) {
  return class StrictWebSocket extends BaseWebSocket {
    constructor(url, protocols, options = {}) {
      super(url, protocols, { ...options, followRedirects: false });
      socketSet.add(this);
      this.once('close', () => socketSet.delete(this));
    }
  };
}

export async function bounded(operation, timeoutMs, message, onTimeout = () => {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout(); } catch { /* cleanup is best effort; timeout still returns */ }
      reject(new Error(message));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function connectBounded(connect, { timeoutMs = CONNECT_TIMEOUT_MS, sockets = new Set() } = {}) {
  try {
    return await bounded(connect, timeoutMs, 'CDP connection timed out.', () => terminateSockets(sockets));
  } catch (error) {
    terminateSockets(sockets);
    throw error;
  }
}

function terminateSockets(sockets) {
  for (const socket of sockets) {
    try { socket.terminate(); } catch { /* socket may already be closed */ }
    sockets.delete(socket);
  }
}

export async function closeClientBounded(client, sockets = new Set(), timeoutMs = CLOSE_TIMEOUT_MS) {
  if (!client) { terminateSockets(sockets); return; }
  try {
    await bounded(() => client.close(), timeoutMs, 'CDP cleanup timed out.', () => terminateSockets(sockets));
  } catch {
    terminateSockets(sockets);
  }
}

export async function boundedCdpCommand(client, domain, method, params = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
  return bounded(() => client[domain][method](params), timeoutMs, `CDP ${domain}.${method} timed out.`);
}

export async function boundedCdpOperation(operation, { timeoutMs = OPERATION_TIMEOUT_MS, sockets = new Set(), getClient = () => undefined } = {}) {
  return bounded(operation, timeoutMs, 'MOCK CDP operation timed out.', () => {
    terminateSockets(sockets);
    const client = getClient();
    if (client) void closeClientBounded(client, sockets);
  });
}
const cdpCommand = boundedCdpCommand;

export function isForbiddenRequest(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return url.port === '8787' ||
      FORBIDDEN_HOSTS.has(host) || host.endsWith('.whatsapp.com') || host.endsWith('.whatsapp.net');
  } catch {
    return false;
  }
}

export function sanitizeException(exceptionDetails) {
  const exception = exceptionDetails?.exception;
  return {
    className: /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(exception?.className || '') ? exception.className : 'Error',
    line: Number.isInteger(exceptionDetails?.lineNumber) ? exceptionDetails.lineNumber : null,
    column: Number.isInteger(exceptionDetails?.columnNumber) ? exceptionDetails.columnNumber : null,
    scriptId: /^[0-9]{1,12}$/.test(exceptionDetails?.scriptId || '') ? exceptionDetails.scriptId : null
  };
}

export function createDiagnostics() {
  let forbiddenCount = 0;
  let consoleErrorCount = 0;
  const exceptions = [];
  return {
    onRequest(event) { if (isForbiddenRequest(event?.request?.url || '')) forbiddenCount += 1; },
    onException(event) {
      if (event?.exceptionDetails) exceptions.push(sanitizeException(event.exceptionDetails));
    },
    onConsole(event) { if (event?.type === 'error') consoleErrorCount += 1; },
    snapshot() {
      return {
        forbiddenRequests: { occurred: forbiddenCount > 0, count: forbiddenCount },
        consoleErrors: consoleErrorCount,
        exceptions: exceptions.slice(0, 20)
      };
    }
  };
}

const SAFE_CLI_ERRORS = new Set([
  'CDP endpoint must use HTTP on loopback.',
  'CDP endpoint must be a plain loopback origin.',
  'CDP client was loaded before the strict transport guard.',
  'Unsupported CDP client version; refusing an unverified transport.',
  'Quick Access target not found.',
  'Multiple Quick Access targets found; refusing to choose.',
  'Verified MOCK panel scope is absent; no UI action was taken.',
  'Verified MOCK panel identity changed after scrolling; no UI action was taken.',
  'Verified MOCK control identity changed after scrolling; no UI action was taken.',
  'Could not verify stable MOCK node identity; no UI action was taken.',
  'MOCK provider guard did not match; no UI action was taken.',
  'Visible MOCK label was not found inside the verified MOCK subtree; no UI action was taken.',
  'The guarded MOCK panel was not available for sampling.'
]);

export function formatCliError(error) {
  return error instanceof Error && SAFE_CLI_ERRORS.has(error.message)
    ? error.message
    : 'MOCK CDP operation failed; details were suppressed.';
}

async function getMockScope(client) {
  const { root } = await cdpCommand(client, 'DOM', 'getDocument', { depth: 0 });
  const { nodeId } = await cdpCommand(client, 'DOM', 'querySelector', { nodeId: root.nodeId, selector: MOCK_SCOPE_SELECTOR });
  if (!nodeId) throw new Error('Verified MOCK panel scope is absent; no UI action was taken.');

  const { node } = await cdpCommand(client, 'DOM', 'describeNode', { nodeId });
  const attributes = Object.fromEntries((node.attributes || []).reduce((pairs, value, index, all) => {
    if (index % 2 === 0) pairs.push([value, all[index + 1]]);
    return pairs;
  }, []));
  if (attributes['data-decky-provider'] !== 'mock' ||
      attributes['data-decky-label'] !== 'MOCK / OFFLINE' ||
      attributes['data-decky-scope'] !== 'mock-panel' ||
      attributes['aria-label'] !== 'MOCK / OFFLINE') {
    throw new Error('MOCK provider guard did not match; no UI action was taken.');
  }

  if (!Number.isInteger(node.backendNodeId) || node.backendNodeId <= 0) {
    throw new Error('Could not verify stable MOCK node identity; no UI action was taken.');
  }
  return { nodeId, backendNodeId: node.backendNodeId };
}

async function findControl(client, scopeNodeId, selector) {
  const { nodeId } = await cdpCommand(client, 'DOM', 'querySelector', { nodeId: scopeNodeId, selector });
  if (!nodeId) throw new Error('Requested MOCK control is unavailable.');
  const { node } = await cdpCommand(client, 'DOM', 'describeNode', { nodeId });
  if (!Number.isInteger(node.backendNodeId) || node.backendNodeId <= 0) {
    throw new Error('Could not verify stable MOCK node identity; no UI action was taken.');
  }
  return { nodeId, backendNodeId: node.backendNodeId };
}

async function clickNode(client, nodeId) {
  const { model } = await cdpCommand(client, 'DOM', 'getBoxModel', { nodeId });
  const [x1, y1, x2, y2, x3, y3, x4, y4] = model.border;
  const x = Math.round((x1 + x2 + x3 + x4) / 4);
  const y = Math.round((y1 + y2 + y3 + y4) / 4);
  if (![x, y].every(Number.isFinite)) throw new Error('MOCK control has no safe clickable bounds.');
  const hit = await cdpCommand(client, 'DOM', 'getNodeForLocation', { x, y, includeUserAgentShadowDOM: false });
  let hitNodeId = hit.nodeId;
  let belongsToControl = false;
  for (let depth = 0; hitNodeId && depth < 12; depth += 1) {
    if (hitNodeId === nodeId) { belongsToControl = true; break; }
    const { node } = await cdpCommand(client, 'DOM', 'describeNode', { nodeId: hitNodeId });
    hitNodeId = node.parentId;
  }
  if (!belongsToControl) throw new Error('MOCK control is not the hit-tested target; no UI action was taken.');
  await cdpCommand(client, 'Input', 'dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdpCommand(client, 'Input', 'dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

export async function exerciseMock(client, exercise) {
  if (!SAFE_EXERCISES.has(exercise)) throw new Error('Unsupported MOCK exercise.');
  const controls = {
    start: '[data-testid="mock-connection-toggle-start"] button',
    stop: '[data-testid="mock-connection-toggle-stop"] button',
    'open-ava': '[data-decky-action="open-ava"] button'
  };
  const verifiedScope = await getMockScope(client);
  const verifiedControl = await findControl(client, verifiedScope.nodeId, controls[exercise]);
  // Only scroll a control after querying it beneath the verified MOCK scope.
  await cdpCommand(client, 'DOM', 'scrollIntoViewIfNeeded', { nodeId: verifiedControl.nodeId });

  // Scrolling can trigger layout or React updates. Revalidate the scope and
  // resolve the exact selector again before calculating bounds or dispatching input.
  const refreshedScope = await getMockScope(client);
  if (refreshedScope.backendNodeId !== verifiedScope.backendNodeId) {
    throw new Error('Verified MOCK panel identity changed after scrolling; no UI action was taken.');
  }
  const refreshedControl = await findControl(client, refreshedScope.nodeId, controls[exercise]);
  if (refreshedControl.backendNodeId !== verifiedControl.backendNodeId) {
    throw new Error('Verified MOCK control identity changed after scrolling; no UI action was taken.');
  }
  await clickNode(client, refreshedControl.nodeId);
  return { exercised: exercise, mockGuard: true };
}

export async function inspectTarget(client, { exercise } = {}) {
  return boundedCdpOperation(async () => {
    const diagnostics = createDiagnostics();
    client.Network.requestWillBeSent(diagnostics.onRequest);
    client.Runtime.exceptionThrown(diagnostics.onException);
    client.Runtime.consoleAPICalled(diagnostics.onConsole);
    await Promise.all([
      cdpCommand(client, 'Network', 'enable'),
      cdpCommand(client, 'Runtime', 'enable')
    ]);
    const mockReady = Boolean(await getMockScope(client));
    let action = null;
    if (exercise) action = await exerciseMock(client, exercise);
    return { mockReady, action, diagnostics: diagnostics.snapshot() };
  });
}

function parseArgs(argv) {
  const options = { endpoint: DEFAULT_ENDPOINT, exercise: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--endpoint') options.endpoint = argv[++index];
    else if (argument === '--exercise') options.exercise = argv[++index];
    else if (argument === '--help') options.help = true;
    else throw new Error('Unknown option. Use --help for supported options.');
  }
  if (options.exercise && !SAFE_EXERCISES.has(options.exercise)) throw new Error('Unsupported MOCK exercise.');
  return options;
}

let strictCdpState;
export function loadStrictCdpClient() {
  if (strictCdpState) return strictCdpState;
  const localRequire = createRequire(import.meta.url);
  const entry = localRequire.resolve('chrome-remote-interface');
  const packageInfo = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8'));
  if (packageInfo.version !== '0.34.0') throw new Error('Unsupported CDP client version; refusing an unverified transport.');
  if (localRequire.cache[entry]) throw new Error('CDP client was loaded before the strict transport guard.');
  const cdpRequire = createRequire(entry);
  const websocketPath = cdpRequire.resolve('ws');
  if (!localRequire.cache[websocketPath]) cdpRequire(websocketPath);
  const websocketModule = localRequire.cache[websocketPath];
  if (!websocketModule) throw new Error('Could not prepare the strict CDP transport.');
  const originalWebSocket = websocketModule.exports;
  const sockets = new Set();
  let CDP;
  websocketModule.exports = createNoRedirectWebSocket(originalWebSocket, sockets);
  try {
    CDP = cdpRequire('chrome-remote-interface');
  } finally {
    websocketModule.exports = originalWebSocket;
  }
  strictCdpState = Object.freeze({ CDP, sockets });
  return strictCdpState;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Read-only by default. Options: --endpoint http://127.0.0.1:9222, --exercise start|stop|open-ava');
    return;
  }
  const origin = safeEndpoint(options.endpoint);
  const { CDP, sockets } = loadStrictCdpClient();
  let client;
  try {
    const result = await boundedCdpOperation(async () => {
      const targets = await discoverTargets(origin);
      const target = validateTargetSocket(selectQuickAccessTarget(targets), origin);
      client = await connectBounded(() => CDP({ target, local: true }), { sockets });
      return inspectTarget(client, { exercise: options.exercise });
    }, { sockets, getClient: () => client });
    console.log(JSON.stringify({ target: 'QuickAccess_uid2', ...result }, null, 2));
  } finally {
    await closeClientBounded(client, sockets);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(formatCliError(error));
    process.exitCode = 1;
  });
}
