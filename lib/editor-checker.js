const { CompositeDisposable, Range } = require("lumine");
const queue = require("./spell-check-queue");
const { scopeDescriptorMatchesSelector } = require("./scope-helper");

// Tests whether a grammar's root scope matches a scope specified in the
// `grammars` setting. Allows for a more generic name in the setting (e.g.,
// `source` to match all `source.[x]` grammars).
function topLevelScopeMatches(grammar, scope) {
  if (scope === grammar) return true;
  if (grammar.startsWith(`${scope}.`)) {
    return true;
  }
  return false;
}

// One editor's spell checking: whether its grammar is checked, which parts of it
// are, and the misspellings the last check found.
//
// The last result is kept because the code actions need it. Working out which
// word the cursor is in by checking again would cost a whole-buffer pass, and
// the answer is already here.
module.exports = class EditorChecker {
  constructor(editor, manager) {
    this.editor = editor;
    this.manager = manager;
    this.active = true;
    this.messages = [];
    // A checked selection's misspellings, kept separately because they outlive
    // an ordinary lint of the same buffer — that is the whole point of the
    // command, since such a file usually has nothing to report. Corrections
    // have to reach them too, or a word is underlined with no way to act on it.
    this.selectionMessages = [];
  }

  destroy() {
    queue.cancel(this.editor);
    this.messages = [];
    this.selectionMessages = [];
  }

  /**
   * Records what a checked selection found, so corrections reach those words.
   * @param {Array} messages
   */
  setSelectionMessages(messages) {
    this.selectionMessages = messages;
  }

  // Whether the user has switched checking off for this editor.
  setActive(active) {
    this.active = active;
  }

  /**
   * The linter messages for this editor.
   * @returns {Promise<Array|null>} Null leaves the previous messages alone;
   *   an empty array clears them.
   */
  async lint() {
    if (!this.active || !this.spellCheckCurrentGrammar()) {
      this.messages = [];
      return [];
    }

    this.scopesToSpellCheck = this.getSpellCheckScopesForCurrentGrammar();
    const misspellings = await queue.check(this.manager, this.editor);
    if (misspellings === null) {
      return null;
    }

    if (misspellings.length > 0 && this.filtersByScope()) {
      await this.whenTokenized();
      // The wait is unbounded — a large buffer takes as long as it takes — so
      // the editor may be gone by the end of it. Null leaves the previous
      // messages alone, which the linter clears with the editor anyway.
      if (this.editor.isDestroyed()) return null;
    }

    this.messages = this.buildMessages(misspellings);
    return this.messages;
  }

  // Whether the scope at a misspelling's position can change the outcome.
  //
  // Resolving one means walking the syntax tree, which costs far more than
  // building the message does — over a second for a large Markdown buffer. When
  // nothing narrows the checked region and nothing is excluded, no descriptor
  // can change anything, so none is asked for and nothing is waited on.
  filtersByScope() {
    const excludedScopes = lumine.config.get("spell-check.excludedScopes") || [];
    return Array.isArray(this.scopesToSpellCheck) || excludedScopes.length > 0;
  }

  // Resolves once the buffer's scopes are the real ones.
  //
  // A language mode that has not tokenized does not refuse a scope descriptor —
  // it answers every position with the root scope alone, so `markup.raw` and
  // `meta.embedded` are simply absent and `excludedScopes` matches nothing. The
  // linter lints an editor as it opens, before it is attached to anything, so a
  // check that comes back first would report every fenced block and inline code
  // span in the buffer as prose. Nothing re-lints when tokenizing catches up,
  // so those messages would stand until the next edit.
  whenTokenized() {
    const settled = this.tokenizationOf(this.editor.getBuffer().getLanguageMode());
    if (!settled) return Promise.resolve();

    return new Promise((resolve) => {
      const subscriptions = new CompositeDisposable();
      const finish = () => {
        subscriptions.dispose();
        resolve();
      };
      // A grammar change swaps the language mode out and a destroyed editor has
      // nothing left to scope: neither will ever tokenize, and both end the
      // wait rather than outlast it.
      subscriptions.add(this.editor.onDidChangeGrammar(finish), this.editor.onDidDestroy(finish));
      settled.then(finish, finish);
    });
  }

  // What a language mode settles on, or null when it has nothing to wait for.
  tokenizationOf(languageMode) {
    // A tree-sitter mode settles when its transaction does, which covers the
    // initial parse, the injection layers an inline code span's scopes come
    // from, and a re-parse still in flight after an edit.
    if (languageMode.atTransactionEnd) return languageMode.atTransactionEnd();

    // A TextMate mode tokenizes in background chunks, and only starts once the
    // editor has been shown — which an editor being linted as it opens has not
    // been, so the chunks are started here or the wait would never end. A mode
    // with no tokenizing of its own, the null grammar or a buffer past the
    // large-file cutoff, is already as tokenized as it will get.
    if (!languageMode.onDidTokenize || languageMode.fullyTokenized) return null;
    languageMode.startTokenizing?.();

    return new Promise((resolve) => {
      const subscription = languageMode.onDidTokenize(() => {
        subscription.dispose();
        resolve();
      });
    });
  }

  buildMessages(misspellings) {
    const severity = lumine.config.get("spell-check.severity") || "error";
    const excludedScopes = lumine.config.get("spell-check.excludedScopes") || [];
    const filePath = this.editor.getPath();
    // A buffer that has never been saved has no path for a message to name, so
    // it names the buffer instead.
    const target = filePath ? { file: filePath } : { buffer: this.editor.getBuffer() };

    const filtering = this.filtersByScope();

    const messages = [];
    for (const misspelling of misspellings) {
      if (filtering) {
        const scope = this.editor.scopeDescriptorForBufferPosition(misspelling[0]);
        if (this.scopeIsExcluded(scope, excludedScopes)) continue;
      }

      messages.push({
        severity,
        excerpt: `${this.editor.getTextInBufferRange(misspelling)} is not in the dictionary`,
        location: { ...target, position: misspelling },
      });
    }

    return messages;
  }

  /**
   * The range of the misspelling at a position, if there is one.
   *
   * Separate from `correctionsAt` because asking the dictionary for suggestions
   * costs about 26ms, and a caller that only needs to know which word it is
   * should not pay for a list it throws away.
   * @param {Object} bufferPosition
   * @returns {Object|null} A `Range`, or null away from a misspelling.
   */
  misspellingAt(bufferPosition) {
    const contains = (candidate) =>
      Range.fromObject(candidate.location.position).containsPoint(bufferPosition);
    const message = this.messages.find(contains) ?? this.selectionMessages.find(contains);
    return message ? Range.fromObject(message.location.position) : null;
  }

  /**
   * The corrections available at a position, and the range they replace.
   *
   * Suggesting for a word costs the dictionary a search of its whole word list,
   * so this is asked only when a user has actually pointed at something — never
   * as part of a check.
   * @param {Object} bufferPosition
   * @returns {Object|null} `{ range, corrections }`, or null away from a
   *   misspelling.
   */
  correctionsAt(bufferPosition) {
    const range = this.misspellingAt(bufferPosition);
    if (!range) return null;

    let projectPath = null;
    let relativePath = null;
    const filePath = this.editor.getPath();
    if (filePath) [projectPath, relativePath] = lumine.project.relativizePath(filePath);

    const corrections = this.manager.suggest(
      { projectPath, relativePath },
      this.editor.getTextInBufferRange(range),
    );
    return { range, corrections };
  }

  spellCheckCurrentGrammar() {
    const grammar = this.editor.getGrammar().scopeName;
    let grammars = lumine.config.get("spell-check.grammars");
    let topLevelScopes = grammars.map((rawScope) => {
      if (!rawScope.includes(" ")) return rawScope;
      return rawScope.substring(0, rawScope.indexOf(" "));
    });
    return topLevelScopes.some((scope) => {
      return topLevelScopeMatches(grammar, scope);
    });
  }

  // Returns:
  //
  // * `true` if the entire buffer should be checked;
  // * `false` if none of the buffer should be checked; or, if only certain
  //   parts of the buffer should be checked,
  // * an {Array} of scope names matching regions of the buffer that should
  //   be checked.
  getSpellCheckScopesForCurrentGrammar() {
    const grammar = this.editor.getGrammar().scopeName;
    let grammars = lumine.config.get("spell-check.grammars");
    let scopeList = [];
    // Despite the name of this setting, spell-checking is no longer all or
    // nothing on a per-grammar basis; we now allow users to opt into
    // checking subsections of a buffer by adding descendant scopes. Each
    // segment must begin with all or part of a root scope name (e.g.,
    // `source.js`, `text.html`, but otherwise any valid scope selector is
    // accepted here.)
    //
    // Examples:
    //
    // * `source.js comment.block`
    // * `source comment, source string.quoted`
    // * `text`
    //
    // The first example targets just JS block comments; the second targets
    // all comments and quoted strings in _all_ source files; and the third
    // targets any text format, whether HTML or Markdown or plaintext.
    //
    // This allows for more granular spell-checking than was possible
    // before, even if the `excludeScopes` setting was utilized.
    for (let rawScope of grammars) {
      if (!rawScope.includes(" ")) {
        // Any value that's just the bare root scope of the language
        // (like `source.python`) means that we're spell-checking the
        // entire buffer. This applies even if there's a later match
        // for this grammar that's more restrictive.
        if (topLevelScopeMatches(grammar, rawScope)) {
          return true;
        }
      } else {
        // If the value also includes a descendant scope, it means we're
        // spell-checking some subset of the buffer.
        let index = rawScope.indexOf(" ");
        let rootScope = rawScope.substring(0, index);
        if (topLevelScopeMatches(grammar, rootScope)) {
          // There could be multiple of these — e.g., `source.python string,
          // source.python comment` — so we won't return early.
          scopeList.push(rawScope);
        }
      }
    }
    return scopeList.length > 0 ? scopeList : false;
  }

  scopeIsExcluded(scopeDescriptor, excludedScopes) {
    // Practically speaking, `this.scopesToSpellCheck` will either be `true`
    // or an array of scope selectors. If it's the latter, then we should
    // apply whitelisting and exclude anything that doesn't match.
    if (Array.isArray(this.scopesToSpellCheck)) {
      // If we know none of the subscopes match this region, we can
      // exclude it even before we get to the `excludedScopes` setting.
      let someMatch = this.scopesToSpellCheck.some((scopeToSpellCheck) => {
        return scopeDescriptorMatchesSelector(scopeDescriptor, scopeToSpellCheck);
      });
      if (!someMatch) return true;
    }
    // Whether or not we applied whitelisting above, excluded scopes take
    // precedence; anything that doesn't make it through this gauntlet
    // gets excluded.
    return excludedScopes.some((excludedScope) => {
      return scopeDescriptorMatchesSelector(scopeDescriptor, excludedScope);
    });
  }
};
