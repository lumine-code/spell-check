const { CompositeDisposable, Disposable } = require("lumine");
const EditorChecker = require("./editor-checker");
const queue = require("./spell-check-queue");

let CorrectionsView = null;

const LARGE_FILE_SIZE = 2 * 1024 * 1024;

let log = () => {};
let debug;

module.exports = {
  activate() {
    if (lumine.config.get("spell-check.enableDebug")) {
      debug = require("debug");
      log = debug("spell-check");
    }

    log("initializing");

    this.subs = new CompositeDisposable();
    this.checkers = new WeakMap();
    // Whether anything consumed our linter. Nothing reports misspellings
    // without one, so a user who has not installed it should be told once
    // rather than left wondering.
    this.linterConsumed = false;
    this.warnedAboutLinter = false;

    // Since the spell-checking is done on another process, we gather up all the
    // arguments and pass them into the task. Whenever these change, we'll update
    // the object with the parameters and resend it to the task.
    this.globalArgs = {
      // These are the settings that are part of the main `spell-check` package.
      locales: lumine.config.get("spell-check.locales"),
      localePaths: lumine.config.get("spell-check.localePaths"),
      useSystem: lumine.config.get("spell-check.useSystem"),
      useLocales: lumine.config.get("spell-check.useLocales"),
      knownWords: lumine.config.get("spell-check.knownWords"),
      addKnownWords: lumine.config.get("spell-check.addKnownWords"),

      // Collection of all the absolute paths to checkers which will be
      // `require` on the process side to load the checker. We have to do this
      // because we can't pass the actual objects from the main Lumine process to
      // the background safely.
      checkerPaths: [],
    };
    this.checkerPathCounts = new Map();

    const manager = this.getInstance(this.globalArgs);

    // Settings that change what a check finds have to reach the linter, which
    // has no reason to re-run on their account.
    for (const setting of ["grammars", "excludedScopes", "severity"]) {
      this.subs.add(
        lumine.config.onDidChange(`spell-check.${setting}`, () => this.relintEverything()),
      );
    }

    for (const setting of [
      "locales",
      "localePaths",
      "useSystem",
      "useLocales",
      "knownWords",
      "addKnownWords",
    ]) {
      this.subs.add(
        lumine.config.onDidChange(`spell-check.${setting}`, ({ newValue }) => {
          this.globalArgs[setting] = newValue;
          manager.setGlobalArgs(this.globalArgs);
          this.relintEverything();
        }),
      );
    }

    this.subs.add(
      lumine.commands.add("lumine-workspace", {
        "spell-check:toggle": () => this.toggle(),
        // Registered once, on the workspace, and resolved from whatever the
        // dispatch came from: a keystroke or a right-click means the editor it
        // arrived in, the command palette means the active one.
        "spell-check:correct-misspelling": (event) => this.correctMisspelling(event),
        "spell-check:check-selected": (event) => this.checkSelected(event),
        "spell-check:clear-checked-selection": () => this.indie?.clearMessages(),
      }),
    );

    this.subs.add(
      lumine.workspace.observeTextEditors((editor) => {
        this.checkerFor(editor);
      }),
    );

    // Services are wired as packages activate, so whether anything consumed our
    // linter is not known until they all have. Asking any earlier would warn
    // every user who has the linter installed.
    this.subs.add(
      lumine.packages.onDidActivateInitialPackages(() => this.warnWhenNothingIsListening()),
    );
  },

  deactivate() {
    queue.clear();
    if (this.instance != null) {
      this.instance.deactivate();
    }
    this.instance = null;
    this.checkerPathCounts = new Map();
    this.checkers = new WeakMap();
    if (this.correctionsView != null) {
      this.correctionsView.destroy();
      this.correctionsView = null;
    }
    return this.subs.dispose();
  },

  // The checker for an editor, created on first sight. An editor that gets none
  // reports nothing, which also clears anything it reported before.
  checkerFor(editor) {
    if (this.checkers.has(editor)) {
      return this.checkers.get(editor);
    }
    if (editor.getBuffer().getLength() > LARGE_FILE_SIZE) {
      return null;
    }

    const checker = new EditorChecker(editor, this.getInstance(this.globalArgs));
    this.checkers.set(editor, checker);

    const destroySub = editor.onDidDestroy(() => {
      checker.destroy();
      this.checkers.delete(editor);
      this.subs.remove(destroySub);
    });
    this.subs.add(destroySub);

    return checker;
  },

  // Reports misspellings to the linter, which owns every surface they appear on:
  // the panel, the navigation commands, the overview layer and the underline.
  provideLinter() {
    this.linterConsumed = true;
    return {
      name: "Spell Check",
      scope: "file",
      lintsOnChange: true,
      // The `grammars` setting accepts descendant scopes — `source.js comment`
      // and the like — which `grammarScopes` cannot express, so every editor
      // arrives here and the checker decides. Which editors arrive at all is
      // the linter's question: documents only, plus whatever a package
      // registered through `linter.editors`.
      grammarScopes: ["*"],
      lint: (editor) => {
        const checker = this.checkerFor(editor);
        return checker ? checker.lint() : [];
      },
    };
  },

  // The corrections, as code actions at the cursor.
  provideIntentionsList() {
    return {
      getIntentions: ({ textEditor, bufferPosition }) => {
        const found = this.checkers.get(textEditor)?.correctionsAt(bufferPosition);
        if (!found) return [];

        return found.corrections.map((correction, index) => ({
          icon: "book",
          title: correction.label,
          // Below a language server's own fixes: a misspelling in a comment is
          // rarely what the reader opened the menu for.
          priority: 40 - index,
          selected: () => this.applyCorrection(textEditor, found.range, correction),
        }));
      },
    };
  },

  applyCorrection(editor, range, correction) {
    editor.transact(() => {
      if (correction.isSuggestion) {
        editor.setSelectedBufferRange(range);
        editor.insertText(correction.suggestion);
        return;
      }

      let projectPath = null;
      let relativePath = null;
      const filePath = editor.getPath();
      if (filePath) [projectPath, relativePath] = lumine.project.relativizePath(filePath);
      correction.plugin.add({ projectPath, relativePath }, correction);
    });
  },

  // The dedicated keystroke, which lists the same corrections without needing
  // the `intentions` package installed.
  correctMisspelling(event) {
    const element = event?.target?.closest?.("lumine-text-editor:not([mini])");
    const editor = element?.getModel?.() ?? lumine.workspace.getActiveTextEditor() ?? null;
    if (!editor) return;

    const found = this.checkers.get(editor)?.correctionsAt(editor.getCursorBufferPosition());
    if (!found) return;

    if (CorrectionsView == null) {
      CorrectionsView = require("./corrections-view");
    }
    if (this.correctionsView != null) {
      this.correctionsView.destroy();
    }
    this.correctionsView = new CorrectionsView(
      editor,
      found.range,
      found.corrections,
      (correction) => this.applyCorrection(editor, found.range, correction),
    );
    this.correctionsView.attach();
  },

  // Where a checked selection's results are published. An indie delegate's
  // messages persist until they are replaced, which an ordinary lint of the same
  // buffer cannot do — and that is the point: the selection is usually in a file
  // `grammars` does not cover, whose ordinary lint reports nothing at all.
  consumeLinterRegistry(registerIndie) {
    this.indie = registerIndie({ name: "Spell Check/Selection" });
    return new Disposable(() => {
      this.indie.dispose();
      this.indie = null;
    });
  },

  // Checks whatever is selected, whatever the grammar.
  //
  // The `grammars` and `excludedScopes` settings are deliberately not consulted:
  // this exists for the text they exclude. Selecting a docstring in a source
  // file and asking for it checked is the whole use.
  async checkSelected(event) {
    const element = event?.target?.closest?.("lumine-text-editor:not([mini])");
    const editor = element?.getModel?.() ?? lumine.workspace.getActiveTextEditor() ?? null;
    if (!editor) return;

    if (!this.indie) {
      lumine.notifications.addWarning("Spell Check needs the `linter` package", {
        description: "A checked selection is reported to the linter, which shows it in its panel.",
        dismissable: true,
      });
      return;
    }

    const ranges = editor.getSelectedBufferRanges().filter((range) => !range.isEmpty());
    if (ranges.length === 0) {
      lumine.notifications.addWarning("Select the text to check first.");
      return;
    }

    const manager = this.getInstance(this.globalArgs);
    const filePath = editor.getPath();
    const target = filePath ? { file: filePath } : { buffer: editor.getBuffer() };
    const severity = lumine.config.get("spell-check.severity") || "error";
    const messages = [];

    for (const range of ranges) {
      const misspellings = await queue.check(manager, editor, {
        text: editor.getTextInBufferRange(range),
        kind: "selection",
      });
      if (misspellings === null) return;

      for (const misspelling of misspellings) {
        // The ranges came back relative to the selected text. Its first row
        // starts partway along a buffer row, so only that row's columns shift.
        const position = misspelling.map(([row, column]) => [
          range.start.row + row,
          row === 0 ? range.start.column + column : column,
        ]);
        messages.push({
          severity,
          excerpt: `${editor.getTextInBufferRange(position)} is not in the dictionary`,
          location: { ...target, position },
        });
      }
    }

    // Replaces the previous check rather than adding to it, and re-buckets by
    // each message's own location, which `setMessages` could not do for a buffer
    // that has no path.
    this.indie.setAllMessages(messages);

    if (messages.length === 0) {
      lumine.notifications.addInfo("No misspellings in the selection.");
    }
  },

  // Registers any Lumine packages that provide our service.
  consumeSpellCheckers(checkerPaths) {
    const paths = [...new Set(Array.isArray(checkerPaths) ? checkerPaths : [checkerPaths])].filter(
      (checkerPath) => typeof checkerPath === "string" && checkerPath.length > 0,
    );
    for (const checkerPath of paths) {
      const count = this.checkerPathCounts.get(checkerPath) ?? 0;
      this.checkerPathCounts.set(checkerPath, count + 1);
      if (count > 0) continue;

      this.globalArgs.checkerPaths.push(checkerPath);
      if (this.instance != null) this.instance.addCheckerPath(checkerPath);
    }
    this.relintEverything();

    return new Disposable(() => {
      for (const checkerPath of paths) {
        const count = this.checkerPathCounts.get(checkerPath) ?? 0;
        if (count > 1) {
          this.checkerPathCounts.set(checkerPath, count - 1);
          continue;
        }

        this.checkerPathCounts.delete(checkerPath);
        this.globalArgs.checkerPaths = this.globalArgs.checkerPaths.filter(
          (registeredPath) => registeredPath !== checkerPath,
        );
        if (this.instance != null) this.instance.removeCheckerPath(checkerPath);
      }
      this.relintEverything();
    });
  },

  // Asks the linter to run everything again. A setting that changes what counts
  // as a misspelling is not a buffer change, so nothing else would.
  relintEverything() {
    lumine.commands.dispatch(lumine.views.getView(lumine.workspace), "linter:lint");
  },

  // Retrieves, creating if required, the single SpellingManager instance.
  getInstance(globalArgs) {
    if (!this.instance) {
      const SpellCheckerManager = require("./spell-check-manager");
      this.instance = SpellCheckerManager;
      this.instance.setGlobalArgs(globalArgs);

      for (let checkerPath of globalArgs.checkerPaths) {
        this.instance.addCheckerPath(checkerPath);
      }
    }

    return this.instance;
  },

  // Internal: Toggles the spell-check activation state.
  toggle() {
    const editor = lumine.workspace.getActiveTextEditor();
    if (!editor) return;

    const checker = this.checkers.get(editor);
    if (!checker) return;

    checker.setActive(!checker.active);
    this.relintEverything();
  },

  // Every surface belongs to the linter now, so without it nothing shows.
  warnWhenNothingIsListening() {
    if (this.linterConsumed || this.warnedAboutLinter) return;
    this.warnedAboutLinter = true;

    lumine.notifications.addWarning("Spell Check needs the `linter` package", {
      description:
        "Misspellings are reported as linter messages, so `linter` is what shows them — in its " +
        "panel, on the scrollbar, and underlined in the editor. Without it, nothing is shown.",
      dismissable: true,
      buttons: [
        {
          className: "btn",
          text: "Open the Install pane",
          onDidClick: () => lumine.workspace.open("lumine://config/install"),
        },
      ],
    });
  },
};
