# spell-check

Highlight misspelled words and offer contextual corrections.

## Features

- **Native checking**: uses system spelling services where supported and Hunspell dictionaries everywhere.
- **Scoped proofreading**: checks entire grammars or selected descendant scopes and respects exclusions.
- **Contextual corrections**: offers replacements at the cursor and directly in the editor context menu.
- **Known words**: keeps a configurable case-sensitive or case-insensitive personal word list.
- **Checker services**: combines optional spelling providers with the built-in native and locale checkers.

## Installation

To install `spell-check` search for _spell-check_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/spell-check`.

## Commands

Commands available in `lumine-workspace` and `lumine-text-editor`:

- `spell-check:toggle`: enable or disable checking in the active editor.
- `spell-check:correct-misspelling`: show corrections for the misspelling under the cursor.

## Configuration

- `spell-check.grammars`: scopes eligible for checking.
- `spell-check.excludedScopes`: descendant scopes that are never checked.
- `spell-check.useSystem`: use the operating system spelling service when supported.
- `spell-check.useLocales`: enable Hunspell locale dictionaries.
- `spell-check.locales`: locale identifiers to load.
- `spell-check.localePaths`: additional dictionary directories.
- `spell-check.knownWords`: words always considered correct.
- `spell-check.addKnownWords`: offer actions that extend Known Words.
- `spell-check.noticesMode`: choose popup and console reporting behavior.
- `spell-check.enableDebug`: emit checker diagnostics.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
