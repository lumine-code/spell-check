class SpellCheckTask {
  constructor(manager) {
    this.manager = manager;
    this.generation = 0;
    this.destroyed = false;
    this.pending = Promise.resolve();
  }

  terminate() {
    this.destroyed = true;
    this.generation++;
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

    const check = this.pending
      .catch(() => undefined)
      .then(() => this.manager.check(args, args.text));
    this.pending = check;

    return check.then((results) => {
      if (!this.destroyed && generation === this.generation && !editor.isDestroyed()) {
        onDidSpellCheck(results.misspellings);
      }
      return results;
    });
  }

  static clear() {}
}

module.exports = SpellCheckTask;
