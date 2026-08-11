// Runs the checks one at a time across every editor, newest request first, and
// prefers whichever editor the user is looking at.
//
// Checking is per-editor but the cost is shared: each job holds a copy of its
// whole buffer and the checkers run on the same process everything else does.
// Opening a directory of large files used to start one check per editor at
// once, which is how spell-check earned its reputation for locking up the
// window. A single queue bounds that to one buffer in flight, and picking the
// active editor out of the queue means the file on screen resolves first
// however many others are waiting behind it.
class SpellCheckTask {
  static queue = [];
  static running = false;

  constructor(manager) {
    this.manager = manager;
    this.generation = 0;
    this.destroyed = false;
  }

  terminate() {
    this.destroyed = true;
    this.generation++;
    SpellCheckTask.discardQueued((job) => job.task === this);
  }

  start(editor, onDidSpellCheck) {
    this.destroyed = false;
    const generation = ++this.generation;
    const buffer = editor.getBuffer();
    let projectPath = null;
    let relativePath = null;
    const filePath = buffer.getPath();
    if (filePath) [projectPath, relativePath] = lumine.project.relativizePath(filePath);

    const args = {
      projectPath,
      relativePath,
      text: buffer.getText(),
    };

    if (args.text.length === 0) {
      onDidSpellCheck([]);
      return Promise.resolve({ misspellings: [] });
    }

    // This editor asked again, so whatever it asked for last is stale.
    SpellCheckTask.discardQueued((job) => job.task === this);

    return new Promise((resolve, reject) => {
      SpellCheckTask.queue.push({
        task: this,
        editor,
        generation,
        args,
        onDidSpellCheck,
        resolve,
        reject,
      });
      SpellCheckTask.pump();
    });
  }

  // Drops matching jobs that have not started yet. Their callers are still
  // waiting on a promise, so settle it rather than leaving it pending forever.
  static discardQueued(predicate) {
    const kept = [];
    for (const job of this.queue) {
      if (predicate(job)) job.resolve({ misspellings: [] });
      else kept.push(job);
    }
    this.queue = kept;
  }

  static takeNext() {
    if (this.queue.length === 0) return null;

    const activeEditor = lumine.workspace.getActiveTextEditor();
    let index = activeEditor ? this.queue.findIndex((job) => job.editor === activeEditor) : -1;
    if (index === -1) index = this.queue.length - 1;

    return this.queue.splice(index, 1)[0];
  }

  static pump() {
    if (this.running) return;

    const job = this.takeNext();
    if (!job) return;

    this.running = true;
    Promise.resolve(job.task.manager.check(job.args, job.args.text)).then(
      (results) => {
        this.running = false;
        if (
          !job.task.destroyed &&
          job.generation === job.task.generation &&
          !job.editor.isDestroyed()
        ) {
          job.onDidSpellCheck(results.misspellings);
        }
        job.resolve(results);
        this.pump();
      },
      (error) => {
        this.running = false;
        job.reject(error);
        this.pump();
      },
    );
  }

  static clear() {
    this.discardQueued(() => true);
  }
}

module.exports = SpellCheckTask;
