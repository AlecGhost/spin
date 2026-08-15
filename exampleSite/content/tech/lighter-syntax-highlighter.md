---
title: "Custom Syntax Highlighting with Lighter & Catppuccin Mocha"
date: 2026-08-15
description: "Exploring semantic syntax highlighting output from lighter with custom HTML tokens and Catppuccin Mocha styling."
tags: ["rust", "compilers", "syntax-highlighting", "catppuccin"]
---

## Overview

Modern code editors and documentation sites often rely on token-based lexers or client-side runtime parsers. With **Lighter**, the AST parser emits pre-rendered semantic HTML elements (such as `<a-k>`, `<a-f>`, `<a-t>`, `<a-v>`) that map directly to standard CSS design tokens.

By decoupling the syntax analysis from client runtime scripts, HTML code blocks render instantaneously without layout shifts or heavy JavaScript parsing libraries.

## Embedded Code Snippet

The code block below is linked directly from the external file `lighter.html` and rendered with the **Catppuccin Mocha** dark theme:

{{< lighter file="lighter.html" title="lighter.rs" lang="Rust" >}}

## How It Works

1. **Static HTML Generation**: The compiler produces semantic tags for language constructs (keywords, functions, types, constants, variables).
2. **CSS Token Mapping**: `catppuccin-mocha.css` defines variables such as `--arb-k-dark` (keywords), `--arb-f-dark` (functions), and `--arb-t-dark` (types).
3. **Arborium Styles**: `arborium.css` applies the color rules to custom elements (`a-k`, `a-f`, `a-t`, etc.).
4. **Clean Code Box Chrome**: The outer box provides file naming, language tagging, and one-click clipboard copying.

### Highlights
- Zero JavaScript required to render the highlighted syntax.
- Exact theme matching across IDE and web views.
- Fully accessible with pure semantic markup.
