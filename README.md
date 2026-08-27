# spin

A minimalist, dark-themed Hugo theme for notes, technical blogs, and documentation.

## Features

- **Auto-detected collections**: Folders in `content/` (e.g. `content/tech/`) automatically generate homepage cards and navigation links.
- **Standalone notes**: Optional `notes` section for loose posts that appear in search and the timeline without cluttering the main navigation.
- **Built-in search**: Fast client-side search modal (`⌘K` / `Ctrl+K`) with collection filters and keyword highlighting. Zero external dependencies.
- **Catppuccin Mocha palette**: Clean, low-contrast dark theme with no CSS frameworks.

## Installation

### As a Hugo Module (Recommended)

Add to your `hugo.toml`:

```toml
[module]
  [[module.imports]]
    path = "github.com/AlecGhost/spin"
```

*(Run `hugo mod init <your-repo>` first if you haven't initialized modules yet).*

### Or as a Git Submodule

```bash
git submodule add https://github.com/AlecGhost/spin.git themes/spin
```

And set `theme = "spin"` in `hugo.toml`.

## Minimum Configuration

Add this to your `hugo.toml` to get the site and search running:

```toml
baseURL = "/"
title = "My Site"

[module]
  [[module.imports]]
    path = "github.com/AlecGhost/spin"

# Required for search
[outputs]
  home = ["HTML", "RSS", "JSON"]

[outputFormats.JSON]
  mediaType = "application/json"
  baseName = "index"
  isPlainText = true
```

## Optional Configuration

```toml
[params]
  brand = "Username/Site"          # Splits into two styled parts in the navbar
  author = "Your Name"             # Footer author name
  description = "Site description" # Homepage subtitle and meta description
  github = "https://github.com/..."# Adds GitHub link to navbar and footer
  standaloneSection = "notes"      # Section excluded from collection cards (default: "notes")
```

## License

[MIT](LICENSE)
