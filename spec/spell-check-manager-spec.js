const manager = require("../lib/spell-check-manager");

// A checker whose results are dictated by the spec. `incorrect` ranges use the
// half-open `{ start, end }` shape the native spellchecker returns.
function fakeChecker(id, results, { priority = 100, enabled = true } = {}) {
  return {
    getId: () => id,
    getName: () => id,
    getPriority: () => priority,
    isEnabled: () => enabled,
    getStatus: () => "ok",
    providesSpelling: () => true,
    providesSuggestions: () => false,
    providesAdding: () => false,
    check: () => ({ id, ...results }),
    suggest: () => [],
  };
}

// Finds every occurrence of `word` in `text` as an `incorrect` range.
function occurrences(text, word) {
  const found = [];
  let index = text.indexOf(word);
  while (index !== -1) {
    found.push({ start: index, end: index + word.length });
    index = text.indexOf(word, index + 1);
  }
  return found;
}

describe("SpellCheckerManager#check", () => {
  let savedCheckers;

  beforeEach(() => {
    savedCheckers = manager.checkers;
    manager.checkers = [];
    manager.log = () => {};
    // `check` calls `init`, which would otherwise append the real system,
    // known-words and locale checkers to whatever the spec set up.
    spyOn(manager, "init").and.callFake(() => {});
  });

  afterEach(() => {
    manager.checkers = savedCheckers;
  });

  const check = (text) => manager.check({ projectPath: null, relativePath: "a.txt" }, text);

  it("reports nothing when no checker flags anything", async () => {
    manager.checkers = [fakeChecker("a", { invertIncorrectAsCorrect: true, incorrect: [] })];

    const { misspellings } = await check("every word here is fine");

    expect(misspellings).toEqual([]);
  });

  it("converts a flagged range into buffer coordinates", async () => {
    const text = "one thiss two";
    manager.checkers = [
      fakeChecker("a", { invertIncorrectAsCorrect: true, incorrect: occurrences(text, "thiss") }),
    ];

    const { misspellings } = await check(text);

    expect(misspellings).toEqual([
      [
        [0, 4],
        [0, 9],
      ],
    ]);
  });

  it("keeps each row's columns relative to that row", async () => {
    const text = "alpha thiss\nbeta thiss gamma\n\nthiss";
    manager.checkers = [
      fakeChecker("a", { invertIncorrectAsCorrect: true, incorrect: occurrences(text, "thiss") }),
    ];

    const { misspellings } = await check(text);

    expect(misspellings).toEqual([
      [
        [0, 6],
        [0, 11],
      ],
      [
        [1, 5],
        [1, 10],
      ],
      [
        [3, 0],
        [3, 5],
      ],
    ]);
  });

  it("splits a run of adjacent flagged words instead of marking the whitespace", async () => {
    const text = "zz zz zz";
    manager.checkers = [
      fakeChecker("a", {
        invertIncorrectAsCorrect: true,
        incorrect: [
          { start: 0, end: 2 },
          { start: 3, end: 5 },
          { start: 6, end: 8 },
        ],
      }),
    ];

    const { misspellings } = await check(text);

    expect(misspellings).toEqual([
      [
        [0, 0],
        [0, 2],
      ],
      [
        [0, 3],
        [0, 5],
      ],
      [
        [0, 6],
        [0, 8],
      ],
    ]);
  });

  it("flags a word only when every inverting checker flags it", async () => {
    const text = "alpha bravo charlie";
    manager.checkers = [
      fakeChecker("a", {
        invertIncorrectAsCorrect: true,
        incorrect: [...occurrences(text, "alpha"), ...occurrences(text, "bravo")],
      }),
      fakeChecker("b", {
        invertIncorrectAsCorrect: true,
        incorrect: [...occurrences(text, "bravo"), ...occurrences(text, "charlie")],
      }),
    ];

    const { misspellings } = await check(text);

    // Only `bravo` is in both.
    expect(misspellings).toEqual([
      [
        [0, 6],
        [0, 11],
      ],
    ]);
  });

  it("reports nothing when two inverting checkers agree on nothing", async () => {
    const text = "alpha bravo";
    manager.checkers = [
      fakeChecker("a", { invertIncorrectAsCorrect: true, incorrect: occurrences(text, "alpha") }),
      fakeChecker("b", { invertIncorrectAsCorrect: true, incorrect: occurrences(text, "bravo") }),
    ];

    const { misspellings } = await check(text);

    expect(misspellings).toEqual([]);
  });

  it("lets a positive-only provider clear a word the dictionary flagged", async () => {
    const text = "alpha bravo charlie";
    manager.checkers = [
      fakeChecker("dictionary", {
        invertIncorrectAsCorrect: true,
        incorrect: [...occurrences(text, "alpha"), ...occurrences(text, "charlie")],
      }),
      fakeChecker("known-words", { correct: occurrences(text, "charlie") }),
    ];

    const { misspellings } = await check(text);

    expect(misspellings).toEqual([
      [
        [0, 0],
        [0, 5],
      ],
    ]);
  });

  it("clears a word in the middle of a flagged run", async () => {
    const text = "aa bb cc";
    manager.checkers = [
      fakeChecker("dictionary", {
        invertIncorrectAsCorrect: true,
        incorrect: [
          { start: 0, end: 2 },
          { start: 3, end: 5 },
          { start: 6, end: 8 },
        ],
      }),
      fakeChecker("known-words", { correct: [{ start: 3, end: 5 }] }),
    ];

    const { misspellings } = await check(text);

    expect(misspellings).toEqual([
      [
        [0, 0],
        [0, 2],
      ],
      [
        [0, 6],
        [0, 8],
      ],
    ]);
  });

  it("ignores a disabled checker entirely", async () => {
    const text = "alpha bravo";
    manager.checkers = [
      fakeChecker(
        "off",
        { invertIncorrectAsCorrect: true, incorrect: occurrences(text, "alpha") },
        { enabled: false },
      ),
      fakeChecker("on", {
        invertIncorrectAsCorrect: true,
        incorrect: occurrences(text, "bravo"),
      }),
    ];

    const { misspellings } = await check(text);

    expect(misspellings).toEqual([
      [
        [0, 6],
        [0, 11],
      ],
    ]);
  });

  // The old implementation built the complement of the misspelling set — every
  // correctly spelled span in the buffer — and subtracted it at the end. That
  // subtraction was quadratic in the number of misspellings, so a buffer with
  // four times as many took roughly sixteen times as long. Scaling is the
  // property worth pinning; the absolute numbers belong to whatever machine is
  // running the suite.
  it("scales with the number of misspellings, not their square", async () => {
    // Alternate a flagged word with a clean one. Ranges that sit a single
    // character apart merge into one under the inclusive range arithmetic, and
    // a buffer of nothing but misspellings would collapse to a single range and
    // measure nothing.
    const build = (count) => {
      let text = "";
      const incorrect = [];
      const correct = [];
      for (let i = 0; i < count; i++) {
        incorrect.push({ start: text.length, end: text.length + 4 });
        // Every third word is also cleared by a positive provider, which is the
        // shape a populated Known Words list produces.
        if (i % 3 === 0) correct.push({ start: text.length, end: text.length + 4 });
        text += "zzzz good ";
      }
      return { text, incorrect, correct };
    };

    const time = async (count) => {
      const { text, incorrect, correct } = build(count);
      manager.checkers = [
        fakeChecker("dictionary", { invertIncorrectAsCorrect: true, incorrect }),
        fakeChecker("known-words", { correct }),
      ];

      // Best of several runs; one garbage collection should not decide this.
      let best = Infinity;
      for (let run = 0; run < 4; run++) {
        const started = performance.now();
        const { misspellings } = await check(text);
        best = Math.min(best, performance.now() - started);
        expect(misspellings.length).toBe(count - correct.length);
      }
      return best;
    };

    const small = await time(4000);
    const large = await time(16000);

    // Four times the misspellings. Linear lands near 4x. The version that built
    // the complement of the buffer took ~15x — 41ms against 636ms on the
    // machine this was written on, where the linear one takes under 2ms at both
    // sizes. The slack keeps a loaded runner green without letting quadratic
    // back in.
    expect(large).toBeLessThan(small * 8 + 100);
  });

  it("does not report a misspelling that lands past the last newline", async () => {
    const text = "first line\nsecond thiss";
    manager.checkers = [
      fakeChecker("a", { invertIncorrectAsCorrect: true, incorrect: occurrences(text, "thiss") }),
    ];

    const { misspellings } = await check(text);

    expect(misspellings).toEqual([
      [
        [1, 7],
        [1, 12],
      ],
    ]);
  });
});
