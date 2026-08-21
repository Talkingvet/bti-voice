/* Rolling in-memory log buffer.
 *
 * TestFlight testers on iOS have no console and no way to hand us a log, so
 * "Send diagnostics" in Settings needs something to send. This wraps the
 * console methods, keeps the most recent entries in memory, and still passes
 * everything through to the real console so normal debugging is unaffected.
 *
 * Nothing is persisted and nothing leaves the device unless the user taps the
 * button. Kept deliberately small: the server sits behind express.json()'s
 * default 100kb body limit, so MAX_CHARS stays well under it.
 */

const MAX_ENTRIES = 400;
const MAX_CHARS   = 60000;

const buffer = [];
let installed = false;

function stringify(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.message + (arg.stack ? '\n' + arg.stack : '');
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function record(level, args) {
  try {
    const line =
      new Date().toISOString().slice(11, 23) + ' [' + level + '] ' +
      Array.from(args).map(stringify).join(' ');
    buffer.push(line.length > 2000 ? line.slice(0, 2000) + '…' : line);
    if (buffer.length > MAX_ENTRIES) buffer.shift();
  } catch {
    // Logging must never break the app.
  }
}

export function installLogBuffer() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level] ? console[level].bind(console) : null;
    console[level] = (...args) => {
      record(level, args);
      if (original) original(...args);
    };
  }

  // Uncaught errors and rejected promises are the ones that matter most and
  // never reach console.error on their own in some webviews.
  window.addEventListener('error', e => {
    record('uncaught', [e.message + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0)]);
  });
  window.addEventListener('unhandledrejection', e => {
    record('unhandled', [stringify(e.reason)]);
  });
}

// Newest entries last. Trimmed from the front so the most recent context wins.
export function getLogs() {
  let text = buffer.join('\n');
  if (text.length > MAX_CHARS) text = text.slice(-MAX_CHARS);
  return text;
}

export function clearLogs() {
  buffer.length = 0;
}
