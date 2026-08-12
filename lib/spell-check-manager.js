const env = require("./checker-env");
const { isDeepStrictEqual } = require("node:util");
let debug;

// Subtracts `b` from `a`, where both are ascending arrays of disjoint inclusive
// `[start, end]` pairs.
//
// `MultiRange#subtract` re-scans its own range array from the end for every
// range handed to it, which turns a whole-buffer subtraction into quadratic
// work. Both sides here are already sorted and disjoint, so one sweep does the
// same job in O(a + b).
function differenceOfSortedRanges(a, b) {
  const out = [];
  let j = 0;

  for (let i = 0; i < a.length; i++) {
    let start = a[i][0];
    const end = a[i][1];

    // Skip everything in `b` that ends before this range begins. `a` ascends,
    // so this cursor never has to move back.
    while (j < b.length && b[j][1] < start) j++;

    for (let k = j; k < b.length && b[k][0] <= end; k++) {
      if (b[k][0] > start) out.push([start, b[k][0] - 1]);
      if (b[k][1] >= start) start = b[k][1] + 1;
      if (start > end) break;
    }

    if (start <= end) out.push([start, end]);
  }

  return out;
}

class SpellCheckerManager {
  static initClass() {
    this.prototype.checkers = [];
    this.prototype.checkerPaths = [];
    this.prototype.checkersByPath = new Map();
    this.prototype.locales = [];
    this.prototype.localePaths = [];
    this.prototype.useLocales = false;
    this.prototype.systemChecker = null;
    this.prototype.knownWordsChecker = null;
    this.prototype.localeCheckers = null;
    this.prototype.knownWords = [];
    this.prototype.addKnownWords = false;
  }

  setGlobalArgs(data) {
    // Check to see if any values have changed. When they have, then clear out
    // the applicable checker which forces a reload. We have three basic
    // checkers that are packaged in this:
    // - system: Used for the built-in checkers for Windows and Mac
    // - knownWords: For a configuration-based collection of known words
    // - locale: For linux or when SPELLCHECKER_PREFER_HUNSPELL is set

    // Handle known words checker.
    let removeKnownWordsChecker = false;

    if (!isDeepStrictEqual(this.knownWords, data.knownWords)) {
      this.knownWords = data.knownWords;
      removeKnownWordsChecker = true;
    }
    if (this.addKnownWords !== data.addKnownWords) {
      this.addKnownWords = data.addKnownWords;
      removeKnownWordsChecker = true;
    }

    if (removeKnownWordsChecker && this.knownWordsChecker) {
      this.removeSpellChecker(this.knownWordsChecker);
      this.knownWordsChecker = null;
    }

    // Handle system checker. We also will remove the locale checkers if we
    // change the system checker because we show different messages if we cannot
    // find a locale based on the use of the system checker.
    let removeSystemChecker = false;
    let removeLocaleCheckers = false;

    if (this.useSystem !== data.useSystem) {
      this.useSystem = data.useSystem;
      removeSystemChecker = true;
      removeLocaleCheckers = true;
    }

    if (removeSystemChecker && this.systemChecker) {
      this.removeSpellChecker(this.systemChecker);
      this.systemChecker = undefined;
    }

    // Handle locale checkers.
    if (!isDeepStrictEqual(this.locales, data.locales)) {
      // If the locales is blank, then we always create a default one. However,
      // any new data.locales will remain blank.
      if (!this.localeCheckers || (data.locales != null ? data.locales.length : undefined) !== 0) {
        this.locales = data.locales;
        removeLocaleCheckers = true;
      }
    }
    if (!isDeepStrictEqual(this.localePaths, data.localePaths)) {
      this.localePaths = data.localePaths;
      removeLocaleCheckers = true;
    }
    if (this.useLocales !== data.useLocales) {
      this.useLocales = data.useLocales;
      removeLocaleCheckers = true;
    }

    if (removeLocaleCheckers && this.localeCheckers) {
      const checkers = this.localeCheckers;
      for (let checker of checkers) {
        this.removeSpellChecker(checker);
      }
      return (this.localeCheckers = null);
    }
  }

  /**
   * Teaches the known-words checker a word.
   *
   * Not gated by `addKnownWords`: that setting decides whether the action is
   * offered in a menu, not whether the editor can learn a word — a command that
   * says "add this word" is the user asking outright.
   * @param {string} word
   */
  addKnownWord(word) {
    this.init();
    return this.knownWordsChecker.add({}, { word });
  }

  addCheckerPath(checkerPath) {
    if (this.checkersByPath.has(checkerPath)) return this.checkersByPath.get(checkerPath);

    // Load the given path via require.
    let checker = require(checkerPath);

    // If this a ES6 module, then we need to construct it. We require
    // the coders to export it as `default` since we don't have another
    // way of figuring out which object to instantiate.
    if (checker.default) {
      checker = new checker.default();
    }

    // Add in the resulting checker and retain its identity for service teardown.
    this.addPluginChecker(checker);
    this.checkersByPath.set(checkerPath, checker);
    return checker;
  }

  removeCheckerPath(checkerPath) {
    const checker = this.checkersByPath.get(checkerPath);
    if (!checker) return false;

    this.checkersByPath.delete(checkerPath);
    this.checkerPaths = this.checkerPaths.filter(
      (registeredPath) => registeredPath !== checkerPath,
    );
    this.removeSpellChecker(checker);
    if (typeof checker.deactivate === "function") checker.deactivate();
    return true;
  }

  addPluginChecker(checker) {
    // Add the spell checker to the list.
    return this.addSpellChecker(checker);
  }

  addSpellChecker(checker) {
    return this.checkers.push(checker);
  }

  removeSpellChecker(spellChecker) {
    return (this.checkers = this.checkers.filter((plugin) => plugin !== spellChecker));
  }

  check(args, text) {
    // Make sure our deferred initialization is done.
    this.init();

    // We need a couple packages but we want to lazy load them to
    // reduce load time.
    const multirange = require("multi-integer-range");

    // For every registered spellchecker, we need to find out the ranges in the
    // text that the checker confirms are correct or indicates is a misspelling.
    // We keep these as separate lists since the different checkers may indicate
    // the same range for either and we need to be able to remove confirmed words
    // from the misspelled ones.
    const correct = new multirange.MultiRange([]);
    const incorrects = [];
    const promises = [];

    for (let checker of this.checkers) {
      // We only care if this plugin contributes to checking spelling.
      if (!checker.isEnabled() || !checker.providesSpelling(args)) {
        continue;
      }

      // Get the possibly asynchronous results which include positive
      // (correct) and negative (incorrect) ranges. If we have an incorrect
      // range but no correct, everything not in incorrect is considered correct.
      promises.push(Promise.resolve(checker.check(args, text)));
    }

    return Promise.all(promises).then((allResults) => {
      let range;
      if (this.log.enabled) {
        this.log("check results", allResults, text);
      }

      for (let results of allResults) {
        // A checker that sets `invertIncorrectAsCorrect` is saying "everything I
        // did not flag is correct" — the complement of its own `incorrect` set.
        // We never materialize that complement: it spans the whole buffer, and
        // subtracting it later costs more than the check itself. Intersecting
        // the `incorrect` sets below states the same rule directly.
        if (!results.invertIncorrectAsCorrect && results.correct) {
          for (range of results.correct) {
            correct.appendRange(range.start, range.end);
          }
        }

        if (results.incorrect) {
          const newIncorrect = new multirange.MultiRange([]);
          incorrects.push(newIncorrect);

          for (range of results.incorrect) {
            newIncorrect.appendRange(range.start, range.end);
          }
        }
      }

      // If we don't have any incorrect spellings, then there is nothing to worry
      // about, so just return and stop processing.
      if (this.log.enabled) {
        this.log("merged correct ranges", correct);
        this.log("merged incorrect ranges", incorrects);
      }

      if (incorrects.length === 0) {
        this.log("no spelling errors");
        return { misspellings: [] };
      }

      // Build up an intersection of all the incorrect ranges. We only treat a word
      // as being incorrect if *every* checker that provides negative values treats
      // it as incorrect. We know there is at least one item in this list, so pull
      // that out. If that is the only one, we don't have to do any additional work,
      // otherwise we intersect every other one against it, removing any elements
      // that aren't shared which (hopefully) will produce a smaller list with each
      // iteration.
      let intersection = null;

      for (let incorrect of incorrects) {
        if (intersection === null) {
          intersection = incorrect;
        } else {
          intersection.intersect(incorrect);
        }
      }

      // If we have no intersection, then nothing to report as a problem.
      if (intersection.length === 0) {
        this.log("no spelling after intersections");
        return { misspellings: [] };
      }

      // Remove all of the confirmed correct words from the resulting incorrect
      // list. This allows us to have correct-only providers as opposed to only
      // incorrect providers.
      let ranges = intersection.getRanges();
      if (correct.ranges.length > 0) {
        ranges = differenceOfSortedRanges(ranges, correct.getRanges());
      }

      if (this.log.enabled) {
        this.log("check intersections", ranges);
      }

      // Convert the text ranges (index into the string) into buffer
      // coordinates ( row and column).
      let row = 0;
      let rangeIndex = 0;
      let lineBeginIndex = 0;
      const misspellings = [];
      while (lineBeginIndex < text.length && rangeIndex < ranges.length) {
        // Figure out where the next line break is. If we hit -1, then we make sure
        // it is a higher number so our < comparisons work properly.
        let lineEndIndex = text.indexOf("\n", lineBeginIndex);
        if (lineEndIndex === -1) {
          lineEndIndex = Infinity;
        }

        // Loop through and get all the ranegs for this line.
        while (true) {
          range = ranges[rangeIndex];
          if (range && range[0] < lineEndIndex) {
            // Clip the range to this line. `addMisspellings` doesn't handle
            // jumping across lines easily, and the number ranges are inclusive.
            const clipped = [Math.max(lineBeginIndex, range[0]), Math.min(lineEndIndex, range[1])];

            // The range we have here includes whitespace between two concurrent
            // tokens ("zz zz zz" shows up as a single misspelling). The original
            // version would split the example into three separate ones, so we
            // do the same thing, but only for the ranges within the line.
            this.addMisspellings(misspellings, row, clipped, lineBeginIndex, text);

            // If this line is beyond the limits of our current range, we move to
            // the next one, otherwise we loop again to reuse this range against
            // the next line.
            if (lineEndIndex >= range[1]) {
              rangeIndex++;
            } else {
              break;
            }
          } else {
            break;
          }
        }

        lineBeginIndex = lineEndIndex + 1;
        row++;
      }

      // Return the resulting misspellings.
      return { misspellings };
    });
  }

  suggest(args, word) {
    // Make sure our deferred initialization is done.
    let checker, index, key, priority, suggestion;
    this.init();

    // Gather up a list of corrections and put them into a custom object that has
    // the priority of the plugin, the index in the results, and the word itself.
    // We use this to intersperse the results together to avoid having the
    // preferred answer for the second plugin below the least preferred of the
    // first.
    const suggestions = [];

    for (checker of this.checkers) {
      // We only care if this plugin contributes to checking to suggestions.
      if (!checker.isEnabled() || !checker.providesSuggestions(args)) {
        continue;
      }

      // Get the suggestions for this word.
      index = 0;
      priority = checker.getPriority();

      for (suggestion of checker.suggest(args, word)) {
        suggestions.push({
          isSuggestion: true,
          priority,
          index: index++,
          suggestion,
          label: suggestion,
        });
      }
    }

    // Once we have the suggestions, then sort them to intersperse the results.
    let keys = Object.keys(suggestions).sort(function (key1, key2) {
      const value1 = suggestions[key1];
      const value2 = suggestions[key2];
      const weight1 = value1.priority + value1.index;
      const weight2 = value2.priority + value2.index;

      if (weight1 !== weight2) {
        return weight1 - weight2;
      }

      return value1.suggestion.localeCompare(value2.suggestion);
    });

    // Go through the keys and build the final list of suggestions. As we go
    // through, we also want to remove duplicates.
    const results = [];
    const seen = new Set();
    for (key of keys) {
      const s = suggestions[key];
      if (seen.has(s.suggestion)) {
        continue;
      }
      results.push(s);
      seen.add(s.suggestion);
    }

    // We also grab the "add to dictionary" listings.
    const that = this;
    keys = Object.keys(this.checkers).sort(function (key1, key2) {
      const value1 = that.checkers[key1];
      const value2 = that.checkers[key2];
      return value1.getPriority() - value2.getPriority();
    });

    for (key of keys) {
      // We only care if this plugin contributes to checking to suggestions.
      checker = this.checkers[key];
      if (!checker.isEnabled() || !checker.providesAdding(args)) {
        continue;
      }

      // Add all the targets to the list.
      const targets = checker.getAddingTargets(args);
      for (let target of targets) {
        target.plugin = checker;
        target.word = word;
        target.isSuggestion = false;
        results.push(target);
      }
    }

    // Return the resulting list of options.
    return results;
  }

  addMisspellings(misspellings, row, range, lineBeginIndex, text) {
    // Get the substring of text, if there is no space, then we can just return
    // the entire result.
    const substring = text.substring(range[0], range[1]);

    if (/\s+/.test(substring)) {
      // We have a space, to break it into individual components and push each
      // one to the misspelling list.
      const parts = substring.split(/(\s+)/);
      let substringIndex = 0;
      for (let part of parts) {
        if (!/\s+/.test(part)) {
          const markBeginIndex = range[0] - lineBeginIndex + substringIndex;
          const markEndIndex = markBeginIndex + part.length;
          misspellings.push([
            [row, markBeginIndex],
            [row, markEndIndex],
          ]);
        }

        substringIndex += part.length;
      }

      return;
    }

    // There were no spaces, so just return the entire list.
    return misspellings.push([
      [row, range[0] - lineBeginIndex],
      [row, range[1] - lineBeginIndex],
    ]);
  }

  init() {
    // Set up logging.
    if (lumine.config.get("spell-check.enableDebug")) {
      debug = require("debug");
      this.log = debug("spell-check:spell-check-manager");
    } else {
      this.log = () => {};
    }

    // Set up the system checker, where the platform has one that can check a
    // whole buffer at a time — without the support check this added a checker
    // that could never answer.
    const hasSystemChecker = this.useSystem && env.isSystemSupported();
    if (hasSystemChecker && this.systemChecker === null) {
      const SystemChecker = require("./system-checker");
      this.systemChecker = new SystemChecker();
      this.addSpellChecker(this.systemChecker);
    }

    // Set up the known words.
    if (this.knownWordsChecker === null) {
      const KnownWordsChecker = require("./known-words-checker");
      this.knownWordsChecker = new KnownWordsChecker(this.knownWords);
      this.knownWordsChecker.enableAdd = this.addKnownWords;
      this.addSpellChecker(this.knownWordsChecker);
    }

    // See if we need to initialize the built-in checkers.
    if (this.useLocales && this.localeCheckers === null) {
      // Set up the locale checkers.
      let defaultLocale;
      this.localeCheckers = [];

      // If we have a blank location, use the default based on the process. If
      // set, then it will be the best language. We keep track if we are using
      // the default locale to control error messages.
      let inferredLocale = false;

      if (!this.locales.length) {
        defaultLocale = process.env.LANG;
        if (defaultLocale) {
          inferredLocale = true;
          this.locales = [defaultLocale.split(".")[0]];
        }
      }

      // If we can't figure out the language from the process, check the
      // browser. After testing this, we found that this does not reliably
      // produce a proper IEFT tag for languages; on OS X, it was providing
      // "English" which doesn't work with the locale selection. To avoid using
      // it, we use some tests to make sure it "looks like" an IEFT tag.
      if (!this.locales.length) {
        defaultLocale = Intl.DateTimeFormat().resolvedOptions().locale;
        if (defaultLocale && defaultLocale.length === 5) {
          const separatorChar = defaultLocale.charAt(2);
          if (separatorChar === "_" || separatorChar === "-") {
            inferredLocale = true;
            this.locales = [defaultLocale];
          }
        }
      }

      // If we still can't figure it out, use US English. It isn't a great
      // choice, but it is a reasonable default not to mention is can be used
      // with the fallback path of the `spellchecker` package.
      if (!this.locales.length) {
        inferredLocale = true;
        this.locales = ["en_US"];
      }

      // Go through the new list and create new locale checkers.
      const LocaleChecker = require("./locale-checker");
      return (() => {
        const result = [];
        for (let locale of this.locales) {
          const checker = new LocaleChecker(
            locale,
            this.localePaths,
            hasSystemChecker,
            inferredLocale,
          );
          this.addSpellChecker(checker);
          result.push(this.localeCheckers.push(checker));
        }
        return result;
      })();
    }
  }

  deactivate() {
    for (const checker of this.checkers) {
      if (typeof checker.deactivate === "function") checker.deactivate();
    }
    this.checkers = [];
    this.checkerPaths = [];
    this.checkersByPath = new Map();
    this.locales = [];
    this.localePaths = [];
    this.useSystem = false;
    this.useLocales = false;
    this.knownWords = [];
    this.addKnownWords = false;

    this.systemChecker = null;
    this.localeCheckers = null;
    return (this.knownWordsChecker = null);
  }

  reloadLocales() {
    if (this.localeCheckers) {
      for (let localeChecker of this.localeCheckers) {
        this.removeSpellChecker(localeChecker);
      }
      return (this.localeCheckers = null);
    }
  }

  reloadKnownWords() {
    if (this.knownWordsChecker) {
      this.removeSpellChecker(this.knownWordsChecker);
      return (this.knownWordsChecker = null);
    }
  }
}
SpellCheckerManager.initClass();

const manager = new SpellCheckerManager();
module.exports = manager;
