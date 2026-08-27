# spin

**spin** is a minimalist, modern dark-themed theme/module for [Hugo](https://gohugo.io/).

## Features

- **Catppuccin Mocha Aesthetic**: Sharp typography styled with the official [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) palette, flat contrast.
- **Dynamic Collections**: Automatically detects and renders navigation, cards, filter tabs, and breadcrumbs from any folder under `content/` without hardcoded menus.
- **Standalone Notes Category**: Mark general notes to appear in the overview and global search without creating a collection card or tab.
- **Instant Full-Text & Multi-Field Search**: Client-side fuzzy and keyword search with collection filtering tabs and match snippet highlighting.
- **Separate Homepage & Overview**: 3x2 square recent entry grid on the homepage and a chronological archive on `/overview/`.

## Quick Start

### 1. Installation

As a Git submodule in your Hugo site:
```bash
git submodule add https://github.com/AlecGhost/spin.git themes/spin
```

Or as a Hugo Module:
```toml
[module]
  [[module.imports]]
    path = "github.com/AlecGhost/spin"
```

### 2. Configuration (`hugo.toml`)

```toml
baseURL = "/"
title = "My Site"
theme = "spin"

[outputs]
  home = ["HTML", "RSS", "JSON"]
  section = ["HTML", "RSS"]

[outputFormats.JSON]
  mediaType = "application/json"
  baseName = "index"
  isPlainText = true

[markup]
  [markup.goldmark.renderer]
    unsafe = true

[params]
  author = "Your Name"
  brand = "YourName/SiteTitle"
  description = "A minimalist personal site."
  standaloneSection = "notes"
  github = "https://github.com/YourUsername"
```

## License

[MIT](LICENSE)
