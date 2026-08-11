const spellchecker = require("@lumine-code/spellchecker");
const pathspec = require("./pathspec");
const env = require("./checker-env");

let debug;

// The most text the Windows spelling service is asked to check in one call.
//
// That service costs about 13ms per kilobyte however the text is divided, so a
// large buffer is not slow through it — it is gone: minutes of checking that the
// consumer's timeout then throws away, while the queue serializes every other
// buffer behind it. This much takes about two seconds, which lint-on-change can
// live with. Hunspell has no such limit; a checker only lands on the service at
// all when no dictionary for its locale could be found anywhere.
const SYSTEM_CHECK_LIMIT = 128 * 1024;

// The locale checker is a checker that takes a locale string (`en-US`) and
// optionally a path and then checks it.
class LocaleChecker {
  static initClass() {
    this.prototype.spellchecker = null;
    this.prototype.locale = null;
    this.prototype.enabled = true;
    this.prototype.reason = null;
    this.prototype.paths = null;
    this.prototype.checkDictionaryPath = true;
    this.prototype.checkDefaultPaths = true;
    // Where the dictionary came from once one is found: a search path, the
    // dictionary packaged with the library, or the operating system's service.
    // Which one it is decides how fast checking will be, so it is worth being
    // able to see.
    this.prototype.source = null;
  }

  constructor(locale, paths, hasSystemChecker, inferredLocale) {
    this.locale = locale;
    this.paths = paths;
    this.enabled = true;
    this.hasSystemChecker = hasSystemChecker;
    this.inferredLocale = inferredLocale;
    if (lumine.config.get("spell-check.enableDebug")) {
      debug = require("debug");
      this.log = debug("spell-check:locale-checker").extend(locale);
    } else {
      this.log = (_) => {};
    }
    this.log(
      "enabled",
      this.isEnabled(),
      "hasSystemChecker",
      this.hasSystemChecker,
      "inferredLocale",
      this.inferredLocale,
    );
  }

  deactivate() {}

  getId() {
    return "spell-check:locale:" + this.locale.toLowerCase().replace("_", "-");
  }
  getName() {
    return "Locale Dictionary (" + this.locale + ")";
  }
  getPriority() {
    return 100;
  } // Hard-coded system level data, has no user input.
  isEnabled() {
    return this.enabled;
  }
  getStatus() {
    return this.reason;
  }
  providesSpelling(_args) {
    return this.enabled;
  }
  providesSuggestions(_args) {
    return this.enabled;
  }
  providesAdding(_args) {
    return false;
  }

  check(args, text) {
    this.deferredInit();
    const id = this.getId();
    if (!this.enabled) {
      return { id, status: this.getStatus() };
    }
    if (this.source === "system" && text.length > SYSTEM_CHECK_LIMIT) {
      this.log("refusing oversized text on the system service", text.length);
      return {
        id,
        status:
          `No local dictionary was found for \`${this.locale}\`, and the operating system's ` +
          `spelling service is too slow for a buffer this large.`,
      };
    }
    return this.spellchecker.checkSpellingAsync(text).then((incorrect) => {
      if (this.log.enabled) {
        this.log("check", incorrect);
      }
      return { id, invertIncorrectAsCorrect: true, incorrect };
    });
  }

  suggest(args, word) {
    this.deferredInit();
    return this.spellchecker.getCorrectionsForMisspelling(word);
  }

  deferredInit() {
    // If we already have a spellchecker, then we don't have to do anything.
    let path;
    if (this.spellchecker) {
      return;
    }

    // Initialize the spell checker which can take some time. We also force
    // the use of the Hunspell library even on Mac OS X. The "system checker"
    // is the one that uses the built-in dictionaries from the operating system.
    const checker = new spellchecker.Spellchecker();
    checker.setSpellcheckerType(spellchecker.ALWAYS_USE_HUNSPELL);

    // Build up a list of paths we are checking so we can report them fully
    // to the user if we fail.
    const searchPaths = [];
    for (path of this.paths) {
      searchPaths.push(pathspec.getPath(path));
    }

    // Add operating system specific paths to the search list.
    if (this.checkDefaultPaths) {
      if (env.isLinux()) {
        searchPaths.push("/usr/share/hunspell");
        searchPaths.push("/usr/share/myspell");
        searchPaths.push("/usr/share/myspell/dicts");
      }

      if (env.isDarwin()) {
        searchPaths.push("/");
        searchPaths.push("/System/Library/Spelling");
      }

      if (env.isWindows()) {
        searchPaths.push("C:\\");
      }
    }

    // Attempt to load all the paths for the dictionary until we find one.
    this.log("checking paths", searchPaths);
    for (path of searchPaths) {
      if (checker.setDictionary(this.locale, path)) {
        this.log("found checker", path);
        this.source = path;
        this.spellchecker = checker;
        return;
      }
    }

    // Then the dictionary packaged with the `spellchecker` library.
    if (this.checkDictionaryPath) {
      if (checker.setDictionary(this.locale, spellchecker.getDictionaryPath())) {
        this.log("using packaged locale");
        this.source = "packaged";
        this.spellchecker = checker;
        return;
      }
    }

    // On Windows, a locale with no Hunspell dictionary anywhere can still be
    // checked through the operating system's spelling API. It is the last
    // resort and not a close one: it costs about 13ms per kilobyte and gets
    // worse as the buffer grows, where Hunspell is closer to 0.05ms. Slow
    // checking beats none for a language nobody ships a dictionary for, but
    // anything with a dictionary must reach it first.
    if (env.isWindows()) {
      const systemChecker = new spellchecker.Spellchecker();
      systemChecker.setSpellcheckerType(spellchecker.ALWAYS_USE_SYSTEM);
      if (systemChecker.setDictionary(this.locale, "")) {
        this.log("using Windows Spell API");
        this.source = "system";
        this.spellchecker = systemChecker;
        return;
      }
    }

    // If we are using the system checker and we infered the locale, then we
    // don't want to show an error. This is because the system checker may have
    // handled it already.
    if (this.hasSystemChecker && this.inferredLocale) {
      this.log("giving up quietly because of system checker and inferred locale");
      this.enabled = false;
      this.reason =
        "Cannot load the locale dictionary for `" +
        this.locale +
        "`. No warning because system checker is in use and locale is inferred.";
      return;
    }

    // If we fell through all the if blocks, then we couldn't load the dictionary.
    this.enabled = false;
    this.reason = "Cannot load the locale dictionary for `" + this.locale + "`.";
    const message =
      "The package `spell-check` cannot load the " +
      "checker for `" +
      this.locale +
      "`." +
      " See the settings for ways of changing the languages used, " +
      " resolving missing dictionaries, or hiding this warning.";

    let searches =
      "\n\nThe plugin checked the following paths for dictionary files:\n* " +
      searchPaths.join("\n* ");

    if (!env.useLocales()) {
      searches = "\n\nThe plugin tried to use the system dictionaries to find the locale.";
    }

    const noticesMode = lumine.config.get("spell-check.noticesMode");

    if (noticesMode === "console" || noticesMode === "both") {
      console.log(this.getId(), message + searches);
    }
    if (noticesMode === "popup" || noticesMode === "both") {
      return lumine.notifications.addWarning(message, {
        buttons: [
          {
            className: "btn",
            onDidClick() {
              return lumine.workspace.open("lumine://config/packages/spell-check");
            },
            text: "Settings",
          },
        ],
      });
    }
  }
}
LocaleChecker.initClass();

module.exports = LocaleChecker;
