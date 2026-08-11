# spell-check

Report misspelled words as linter diagnostics with contextual corrections.

Misspellings are reported to the [`linter`](https://github.com/lumine-code/linter) package, which
is what shows them: underlined in the editor, listed in its panel, walked with its navigation
commands, and marked on the scrollbar and minimap by `marker-linter`. **Without `linter` installed,
nothing is shown** — spell-check has no surfaces of its own.

## Features

- **Native checking**: uses system spelling services where supported and Hunspell dictionaries everywhere.
- **Scoped proofreading**: checks entire grammars or selected descendant scopes and respects exclusions.
- **Diagnostics**: reports each misspelling to the linter, so the panel, the navigation commands and the overview layer all cover spelling.
- **Code actions**: offers the dictionary's suggestions at the cursor, through the `intentions` package or a keystroke of its own.
- **Unsaved buffers**: checks a buffer that has never been saved, not only files on disk.
- **Known words**: keeps a configurable case-sensitive or case-insensitive personal word list.
- **Checker services**: combines optional spelling providers with the built-in native and locale checkers.

## Installation

To install `spell-check` search for _spell-check_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/spell-check`.

## Commands

Commands available in `lumine-workspace`:

- `spell-check:toggle`: enable or disable checking in the active editor,
- `spell-check:correct-misspelling`: show corrections for the misspelling under the cursor.

## Usage

A misspelling is reported as an error by default, which is the severity that renders the red
underline spelling conventionally uses. Set **Severity** to `hint` for the quiet tier instead: no
gutter dot, and no status-bar tile until something is found.

Corrections are code actions. With the `intentions` package installed they appear in its menu
alongside a language server's own fixes; the `spell-check:correct-misspelling` keystroke lists the
same set without it.

## Customization

Misspellings are the linter's markers, so they are styled with its severity classes. To make them
stand out from other diagnostics of the same severity, target the excerpt in your `styles.css`:

```css
.linter-row .linter-excerpt {
  font-style: italic;
}
```

## Services

- **[spell-check](docs/spell-check.md)** (`^1.0.0`): consumed to combine external checker modules with the built-in checkers.
- **linter.provider** (`1.0.0`): provided to report each misspelling as a diagnostic.
- **intentions.list** (`1.0.0`): provided to offer the corrections as code actions at the cursor.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
