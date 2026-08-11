const SpellCheckTask = require("../lib/spell-check-task");

// A stand-in for a `TextEditor`, for the cases that do not need a real one.
function fakeEditor(text) {
  return {
    isDestroyed: () => false,
    getBuffer: () => ({ getPath: () => null, getText: () => text }),
  };
}

// A manager whose checks finish when the spec says so.
function deferredManager() {
  const pending = [];
  return {
    pending,
    check(_args, text) {
      return new Promise((resolve) => pending.push({ text, resolve }));
    },
    settleFirst(misspellings = []) {
      const job = pending.shift();
      job.resolve({ misspellings });
      return job;
    },
  };
}

describe("SpellCheckTask", () => {
  beforeEach(() => {
    SpellCheckTask.queue = [];
    SpellCheckTask.running = false;
  });

  it("short-circuits an empty buffer without queueing anything", async () => {
    const manager = deferredManager();
    const task = new SpellCheckTask(manager);
    const seen = [];

    await task.start(fakeEditor(""), (misspellings) => seen.push(misspellings));

    expect(seen).toEqual([[]]);
    expect(manager.pending.length).toBe(0);
    expect(SpellCheckTask.queue.length).toBe(0);
  });

  it("runs one check at a time across separate editors", async () => {
    const manager = deferredManager();
    const first = new SpellCheckTask(manager);
    const second = new SpellCheckTask(manager);

    const firstDone = first.start(fakeEditor("alpha"), () => {});
    const secondDone = second.start(fakeEditor("bravo"), () => {});

    // Only one check has been handed to the manager; the other waits its turn.
    expect(manager.pending.map((job) => job.text)).toEqual(["alpha"]);
    expect(SpellCheckTask.queue.length).toBe(1);

    manager.settleFirst();
    await firstDone;

    expect(manager.pending.map((job) => job.text)).toEqual(["bravo"]);

    manager.settleFirst();
    await secondDone;

    expect(SpellCheckTask.queue.length).toBe(0);
  });

  it("takes the active editor out of the queue ahead of the rest", async () => {
    const manager = deferredManager();
    const background = new SpellCheckTask(manager);
    const foreground = new SpellCheckTask(manager);
    const blocker = new SpellCheckTask(manager);

    const active = await lumine.workspace.open();
    active.setText("active buffer");

    // Occupy the runner so the next two requests both have to queue.
    const blocked = blocker.start(fakeEditor("blocking"), () => {});
    const backgroundDone = background.start(fakeEditor("background"), () => {});
    const foregroundDone = foreground.start(active, () => {});

    expect(manager.pending.map((job) => job.text)).toEqual(["blocking"]);

    manager.settleFirst();
    await blocked;

    // The active editor jumps the queue even though it asked last.
    expect(manager.pending.map((job) => job.text)).toEqual(["active buffer"]);

    manager.settleFirst();
    await foregroundDone;

    expect(manager.pending.map((job) => job.text)).toEqual(["background"]);

    manager.settleFirst();
    await backgroundDone;
    active.destroy();
  });

  it("supersedes a queued request from the same editor", async () => {
    const manager = deferredManager();
    const blocker = new SpellCheckTask(manager);
    const task = new SpellCheckTask(manager);
    const seen = [];

    const blocked = blocker.start(fakeEditor("blocking"), () => {});
    const stale = task.start(fakeEditor("first"), (misspellings) => seen.push(misspellings));
    const fresh = task.start(fakeEditor("second"), (misspellings) => seen.push(misspellings));

    expect(SpellCheckTask.queue.length).toBe(1);

    manager.settleFirst();
    await blocked;

    expect(manager.pending.map((job) => job.text)).toEqual(["second"]);

    manager.settleFirst([["marker"]]);
    await Promise.all([stale, fresh]);

    // The superseded request never reaches its callback, and never hangs.
    expect(seen).toEqual([[["marker"]]]);
  });

  it("drops a result the editor has already moved past", async () => {
    const manager = deferredManager();
    const task = new SpellCheckTask(manager);
    const seen = [];

    const stale = task.start(fakeEditor("first"), (misspellings) => seen.push(misspellings));
    const fresh = task.start(fakeEditor("second"), (misspellings) => seen.push(misspellings));

    // "first" is already running, so it is not superseded — but its result is
    // for a generation the task has moved past and must not be delivered.
    manager.settleFirst([["stale"]]);
    await stale;
    manager.settleFirst([["fresh"]]);
    await fresh;

    expect(seen).toEqual([[["fresh"]]]);
  });

  it("discards queued work when a task is terminated", async () => {
    const manager = deferredManager();
    const blocker = new SpellCheckTask(manager);
    const task = new SpellCheckTask(manager);
    const seen = [];

    const blocked = blocker.start(fakeEditor("blocking"), () => {});
    const abandoned = task.start(fakeEditor("abandoned"), (m) => seen.push(m));

    task.terminate();

    expect(SpellCheckTask.queue.length).toBe(0);
    await abandoned;

    expect(seen).toEqual([]);

    manager.settleFirst();
    await blocked;
  });

  it("keeps running after a check rejects", async () => {
    const manager = deferredManager();
    const failing = new SpellCheckTask(manager);
    const following = new SpellCheckTask(manager);

    manager.check = (_args, text) =>
      text === "boom" ? Promise.reject(new Error("boom")) : Promise.resolve({ misspellings: [] });

    const rejected = failing.start(fakeEditor("boom"), () => {});
    let delivered = false;
    const next = following.start(fakeEditor("fine"), () => {
      delivered = true;
    });

    await expectAsync(rejected).toBeRejectedWithError("boom");
    await next;

    expect(delivered).toBe(true);
    expect(SpellCheckTask.running).toBe(false);
  });
});
