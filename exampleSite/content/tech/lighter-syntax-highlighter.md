---
title: "Syntax Highlighting in Spin"
date: 2026-08-15
description: "Demonstration of code rendering and syntax highlighting."
tags: ["rust", "development", "syntax-highlighting"]
---

## Overview

Spin provides clean styling for code blocks and inline code elements. Standard Markdown fenced code blocks are highlighted using Hugo's built-in Chroma engine.

## Code Example

```rust
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Registry {
    entries: HashMap<String, String>,
}

impl Registry {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    pub fn insert(&mut self, key: &str, value: &str) {
        self.entries.insert(key.to_string(), value.to_string());
    }
}
```

### Highlights
- Clean dark theme typography.
- Horizontal scrolling on mobile screens.
- Standard Markdown compatibility.
