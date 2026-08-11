const queue = require("../lib/spell-check-queue");

// A manager whose checks finish when the spec says so.
function deferredManager() {
  const pending = [];
  return {
    pending,
    check(_args, text) {
      return new Promise((resolve) => pending.push({ text, resolve }));
    },
    settleFirst(misspellings = []) {
      pending.shift().resolve({ misspellings });
    },
  };
}

describe("lib/spell-check-queue", () => {
  let manager;
  let editors;

  const editorWith = async (text) => {
    const editor = await lumine.workspace.open();
    editor.setText(text);
    editors.push(editor);
    return editor;
  };

  beforeEach(() => {
    queue.clear();
    manager = deferredManager();
    editors = [];
  });

  afterEach(() => {
    queue.clear();
    for (const editor of editors) editor.destroy();
  });

  it("answers an empty buffer without queueing anything", async () => {
    const editor = await editorWith("");

    expect(await queue.check(manager, editor)).toEqual([]);
    expect(manager.pending.length).toBe(0);
  });

  it("checks one buffer at a time across separate editors", async () => {
    const first = await editorWith("alpha");
    const second = await editorWith("bravo");

    const firstDone = queue.check(manager, first);
    const secondDone = queue.check(manager, second);

    // Only one check has been handed to the manager; the other waits its turn.
    expect(manager.pending.map((job) => job.text)).toEqual(["alpha"]);

    manager.settleFirst();
    await firstDone;

    expect(manager.pending.map((job) => job.text)).toEqual(["bravo"]);

    manager.settleFirst();
    await secondDone;
    expect(queue.queue.length).toBe(0);
  });

  it("takes the active editor out of the queue ahead of the rest", async () => {
    const blocker = await editorWith("blocking");
    const background = await editorWith("background");
    const active = await editorWith("active buffer");

    // `open` activates each item, so the last one opened is the active editor.
    const blocked = queue.check(manager, blocker);
    const backgroundDone = queue.check(manager, background);
    const activeDone = queue.check(manager, active);

    expect(manager.pending.map((job) => job.text)).toEqual(["blocking"]);

    manager.settleFirst();
    await blocked;

    // The active editor jumps the queue even though it asked last.
    expect(manager.pending.map((job) => job.text)).toEqual(["active buffer"]);

    manager.settleFirst();
    await activeDone;
    manager.settleFirst();
    await backgroundDone;
  });

  it("answers null for a request a newer one supersedes", async () => {
    const blocker = await editorWith("blocking");
    const editor = await editorWith("first");

    const blocked = queue.check(manager, blocker);
    const stale = queue.check(manager, editor);
    editor.setText("second");
    const fresh = queue.check(manager, editor);

    manager.settleFirst();
    await blocked;

    expect(manager.pending.map((job) => job.text)).toEqual(["second"]);

    manager.settleFirst([
      [
        [0, 0],
        [0, 6],
      ],
    ]);

    // Null leaves the linter's previous messages alone; an empty array would
    // clear them, which is not what a superseded request means.
    expect(await stale).toBeNull();
    expect((await fresh).length).toBe(1);
  });

  it("answers null once the editor has gone away", async () => {
    const editor = await editorWith("alpha");
    const done = queue.check(manager, editor);

    editor.destroy();
    manager.settleFirst([
      [
        [0, 0],
        [0, 5],
      ],
    ]);

    expect(await done).toBeNull();
  });

  it("drops queued requests when an editor is cancelled", async () => {
    const blocker = await editorWith("blocking");
    const editor = await editorWith("abandoned");

    const blocked = queue.check(manager, blocker);
    const abandoned = queue.check(manager, editor);

    queue.cancel(editor);

    expect(queue.queue.length).toBe(0);
    expect(await abandoned).toBeNull();

    manager.settleFirst();
    await blocked;
  });

  it("keeps running after a check rejects", async () => {
    const failing = await editorWith("boom");
    const following = await editorWith("fine");
    manager.check = (_args, text) =>
      text === "boom" ? Promise.reject(new Error("boom")) : Promise.resolve({ misspellings: [] });

    const rejected = queue.check(manager, failing);
    const next = queue.check(manager, following);

    await expectAsync(rejected).toBeRejectedWithError("boom");

    expect(await next).toEqual([]);
    expect(queue.queue.length).toBe(0);
  });
});
