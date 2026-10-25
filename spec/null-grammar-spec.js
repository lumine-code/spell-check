const path = require("node:path");

describe("spell-check with no grammar", () => {
  let editor, main;
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
    lumine.config.set("spell-check.useSystem", false);
    lumine.config.set("spell-check.useLocales", false);
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    editor = await lumine.workspace.open();
    editor.setText("misspeled word");
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("spell-check");
    lumine.config.unset("spell-check.useSystem");
    lumine.config.unset("spell-check.useLocales");
  });

  it("retires old correction actions across None and a resumed grammar", () => {
    const grammar = lumine.grammars.grammarForScopeName("text.plain");
    editor.setGrammar(grammar);
    const checker = main.checkerFor(editor);
    spyOn(checker, "correctionsAt").and.returnValue({
      range: [
        [0, 0],
        [0, 9],
      ],
      corrections: [{ label: "Correct", isSuggestion: true, suggestion: "correct" }],
    });
    const [action] = main.provideIntentionsList().getIntentions({
      textEditor: editor,
      bufferPosition: [0, 0],
    });
    spyOn(main, "applyCorrection").and.callThrough();
    editor.setGrammar(lumine.grammars.nullGrammar);
    action.selected();
    editor.setGrammar(grammar);
    main.checkerFor(editor);
    action.selected();
    expect(main.applyCorrection).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("misspeled word");
  });

  it("drops cached corrections, skips even explicit selections and resumes on a grammar", async () => {
    const grammar = lumine.grammars.grammarForScopeName("text.plain");
    editor.setGrammar(grammar);
    const checker = main.checkerFor(editor);
    checker.setSelectionMessages([
      {
        location: {
          position: [
            [0, 0],
            [0, 9],
          ],
        },
      },
    ]);
    checker.messages = [
      {
        location: {
          position: [
            [0, 0],
            [0, 9],
          ],
        },
      },
    ];
    editor.setGrammar(lumine.grammars.nullGrammar);
    expect(checker.messages).toEqual([]);
    expect(checker.selectionMessages).toEqual([]);
    expect(main.checkerFor(editor)).toBeNull();
    const queue = require("../lib/spell-check-queue");
    const manager = { check: jasmine.createSpy("check") };
    spyOn(editor.getBuffer(), "getText").and.callThrough();
    expect(await queue.check(manager, editor)).toEqual([]);
    expect(manager.check).not.toHaveBeenCalled();
    expect(editor.getBuffer().getText).not.toHaveBeenCalled();
    spyOn(main, "getInstance").and.callThrough();
    editor.selectAll();
    await main.checkSpelling({ target: editor.getElement() });
    expect(main.getInstance).not.toHaveBeenCalled();
    editor.setGrammar(grammar);
    expect(main.checkerFor(editor)).not.toBe(checker);
    expect(main.checkerFor(editor).spellCheckCurrentGrammar()).toBe(true);
  });
});
