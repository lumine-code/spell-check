// Runs the checks one at a time across every editor, newest request first, and
// prefers whichever editor the user is looking at.
//
// Checking is per-editor but the cost is shared: each request holds a copy of
// its whole buffer and the checkers run on the same process everything else
// does. The linter lints every editor as it opens, so a directory of large
// files would otherwise start one whole-buffer check per editor at once — which
// is how spell-check earned its reputation for locking up the window. A single
// queue bounds that to one buffer in flight, and picking the active editor out
// of the queue means the file on screen resolves first however many others are
// waiting behind it.

const queue = [];
let running = false;

// Drops queued requests the caller no longer wants an answer to. Their callers
// are still waiting, and `null` is the linter's "leave the previous messages
// alone" — an empty array would clear them instead.
function discard(predicate) {
  const kept = [];
  for (const request of queue) {
    if (predicate(request)) request.resolve(null);
    else kept.push(request);
  }
  queue.length = 0;
  queue.push(...kept);
}

function takeNext() {
  if (queue.length === 0) return null;

  const activeEditor = lumine.workspace.getActiveTextEditor();
  let index = activeEditor ? queue.findIndex((request) => request.editor === activeEditor) : -1;
  if (index === -1) index = queue.length - 1;

  return queue.splice(index, 1)[0];
}

function pump() {
  if (running) return;

  const request = takeNext();
  if (!request) return;

  running = true;
  Promise.resolve(request.manager.check(request.args, request.args.text)).then(
    (results) => {
      running = false;
      request.resolve(request.editor.isDestroyed() ? null : results.misspellings);
      pump();
    },
    (error) => {
      running = false;
      request.reject(error);
      pump();
    },
  );
}

/**
 * Checks an editor's text.
 * @param {Object} manager - The spell-check manager.
 * @param {Object} editor - The editor the text belongs to.
 * @param {Object} [options]
 * @param {string} [options.text] - What to check. Defaults to the whole buffer.
 * @param {string} [options.kind] - Which request this is. A new request
 *   supersedes an earlier one for the same editor and kind, and only that: the
 *   ongoing check of a buffer and a one-off check of a selection within it are
 *   two different questions and neither answers the other.
 * @returns {Promise<Array|null>} The misspelled ranges, relative to the text
 *   given, or null when a newer request of the same kind replaced this one or
 *   the editor went away — both of which mean "no answer", not "no
 *   misspellings".
 */
function check(manager, editor, { text, kind = "buffer" } = {}) {
  const buffer = editor.getBuffer();
  const subject = text ?? buffer.getText();
  if (subject.length === 0) {
    return Promise.resolve([]);
  }

  let projectPath = null;
  let relativePath = null;
  const filePath = buffer.getPath();
  if (filePath) [projectPath, relativePath] = lumine.project.relativizePath(filePath);

  // This editor is asking again, so whatever it asked for last is stale.
  discard((request) => request.editor === editor && request.kind === kind);

  return new Promise((resolve, reject) => {
    queue.push({
      manager,
      editor,
      kind,
      args: { projectPath, relativePath, text: subject },
      resolve,
      reject,
    });
    pump();
  });
}

/** Drops every queued request for an editor that is going away. */
function cancel(editor) {
  discard((request) => request.editor === editor);
}

/** Drops everything, for deactivation. */
function clear() {
  discard(() => true);
}

module.exports = { check, cancel, clear, queue };
