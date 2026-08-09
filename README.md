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

Commands available in `lumine-workspace`:

- `spell-check:toggle`: enable or disable checking in the active editor.

Commands available in `lumine-text-editor`:

- `spell-check:correct-misspelling`: show corrections for the misspelling under the cursor.

## Customization

Adjust misspelling markers in your `styles.css`:

```css
.spell-check-misspelling .region {
  border-color: var(--text-color-warning);
  border-width: 3px;
}
```

## Services

- **[spell-check](docs/spell-check.md)** (`^1.0.0`): consumed to combine external checker modules with the built-in checkers.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
