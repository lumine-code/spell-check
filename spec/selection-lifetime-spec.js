const path = require("path");

describe("Spell Check selection lifetime", () => {
  let main, linterMain, editor, replies, rejections, pending, providers;
  function complete(index = 0) {
    replies[index]({
      misspellings: [
        [
          [0, 0],
          [0, 7],
        ],
      ],
    });
  }
  function check() {
    const promise = main.checkSelected();
    pending.push(promise);
    return promise;
  }
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    lumine.config.set("spell-check.grammars", []);
    linterMain = (await lumine.packages.activatePackage("linter")).mainModule;
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    editor = await lumine.workspace.open();
    editor.setText("zzzzzzz");
    editor.selectAll();
    replies = [];
    rejections = [];
    pending = [];
    providers = [];
    const manager = main.getInstance(main.globalArgs);
    spyOn(manager, "check").and.callFake(
      () =>
        new Promise((resolve, reject) => {
          replies.push(resolve);
          rejections.push(reject);
        }),
    );
  });
  afterEach(async () => {
    // Settle the real serial queue before retiring fixtures; no held check leaks to another spec.
    for (let turn = 0; turn < pending.length + 2; turn++) {
      for (const resolve of replies) resolve({ misspellings: [] });
      await Promise.resolve();
    }
    await Promise.allSettled(pending);
    for (const provider of providers) provider.dispose();
    if (lumine.packages.isPackageActive("spell-check"))
      await lumine.packages.deactivatePackage("spell-check");
    editor.destroy();
  });

  it("does not publish old misspellings onto text edited while the check was pending", async () => {
    const result = check();
    editor.setText("correct");
    complete();
    await result;
    expect(main.indie.getMessages()).toEqual([]);
    expect(main.checkers.get(editor).selectionMessages).toEqual([]);
  });

  it("does not publish a pending selection under a renamed editor path", async () => {
    editor.getBuffer().setPath(path.join(__dirname, "selection-source.txt"));
    const result = check();
    editor.getBuffer().setPath(path.join(__dirname, "selection-target.txt"));
    complete();
    await result;
    expect(main.indie.getMessages()).toEqual([]);
  });

  it("lets the newest explicit selection check own publication before its answer arrives", async () => {
    const first = check();
    const second = check();
    complete();
    await first;
    expect(main.indie.getMessages()).toEqual([]);
    expect(replies.length).toBe(2);
    complete(1);
    await second;
    expect(main.indie.getMessages().length).toBe(1);
  });

  it("keeps the explicit clear command effective while an older check is pending", async () => {
    const result = check();
    await lumine.commands.dispatch(
      lumine.workspace.getElement(),
      "spell-check:clear-checked-selection",
    );
    complete();
    await result;
    expect(main.indie.getMessages()).toEqual([]);
    expect(main.checkedSelectionEditor).toBeNull();
  });

  it("does not write an old result into a reactivated package's actual Indie delegate", async () => {
    const result = check();
    await lumine.packages.deactivatePackage("spell-check");
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    const delegate = main.indie;
    complete();
    await result;
    expect(main.indie).toBe(delegate);
    expect(delegate.getMessages()).toEqual([]);
  });

  it("keeps the current real Indie delegate until the final shared registry edge retires", () => {
    const api = linterMain.provideLinterRegistry();
    const first = lumine.packages.serviceHub.provide("linter.registry", "1.0.0", api);
    const second = lumine.packages.serviceHub.provide("linter.registry", "1.0.0", api);
    providers.push(first, second);
    const delegate = main.indie;
    first.dispose();
    expect(main.indie).toBe(delegate);
    expect(delegate.subscriptions.disposed).toBe(false);
    second.dispose();
    expect(main.indie).not.toBeNull();
  });

  it("does not remove a reconsumed checker path through an older activation's lease", async () => {
    const checkerPath = path.join(
      lumine.packages.getActivePackage("spell-check").path,
      "spec/fixtures/service-checker.js",
    );
    const old = main.consumeSpellCheckers(checkerPath);
    await lumine.packages.deactivatePackage("spell-check");
    main = (await lumine.packages.activatePackage("spell-check")).mainModule;
    const current = main.consumeSpellCheckers(checkerPath);
    old.dispose();
    expect(main.checkerPathCounts.get(checkerPath)).toBe(1);
    expect(main.globalArgs.checkerPaths).toContain(checkerPath);
    expect(main.instance.checkersByPath.has(checkerPath)).toBe(true);
    current.dispose();
  });

  it("consumes a dictionary failure from a selection the user already cleared", async () => {
    const result = check();
    const assertion = expectAsync(result).toBeResolved();
    await lumine.commands.dispatch(
      lumine.workspace.getElement(),
      "spell-check:clear-checked-selection",
    );
    rejections[0](new Error("Retired dictionary failure"));
    await assertion;
    expect(main.indie.getMessages()).toEqual([]);
  });

  it("preserves the existing live dictionary error outcome", async () => {
    const result = check();
    const assertion = expectAsync(result).toBeRejectedWithError("Current dictionary failure");
    rejections[0](new Error("Current dictionary failure"));
    await assertion;
  });

  it("publishes the actual Indie delegate from the latest surviving A-B-A registry edge", () => {
    const api = linterMain.provideLinterRegistry();
    const aDelegates = [],
      bDelegates = [];
    const a = (options) => {
      const delegate = api(options);
      aDelegates.push(delegate);
      return delegate;
    };
    const b = (options) => {
      const delegate = api(options);
      bDelegates.push(delegate);
      return delegate;
    };
    const first = lumine.packages.serviceHub.provide("linter.registry", "1.0.0", a);
    const middle = lumine.packages.serviceHub.provide("linter.registry", "1.0.0", b);
    const newest = lumine.packages.serviceHub.provide("linter.registry", "1.0.0", a);
    providers.push(first, middle, newest);
    expect(main.indie).toBe(aDelegates.at(-1));
    newest.dispose();
    expect(main.indie).toBe(bDelegates.at(-1));
    middle.dispose();
    expect(main.indie).toBe(aDelegates.at(-1));
    expect(main.indie.subscriptions.disposed).toBe(false);
  });

  it("disposes a staged old real Indie delegate without replacing a reentrant current owner", () => {
    const api = linterMain.provideLinterRegistry();
    let replacement, retired, lease;
    const provider = lumine.packages.serviceHub.provide("linter.registry", "1.0.0", (options) => {
      retired = api(options);
      main.deactivate();
      main.activate();
      lease = main.consumeLinterRegistry(api);
      replacement = main.indie;
      return retired;
    });
    providers.push(provider);
    expect(main.indie).toBe(replacement);
    expect(replacement.subscriptions.disposed).toBe(false);
    expect(retired.subscriptions.disposed).toBe(true);
    lease.dispose();
  });
});
