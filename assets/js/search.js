(function () {
  let searchData = [];
  let isInitialized = false;
  let currentCollection = 'all';
  let selectedIndex = -1;
  let collectionsMap = new Map(); // slug -> title

  const modal = document.getElementById('search-modal');
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  const modalFilterBar = document.getElementById('search-modal-filter-bar');

  const pageInput = document.getElementById('search-page-input');
  const pageResults = document.getElementById('search-page-results');
  const pageFilterBar = document.getElementById('search-page-filter-bar');

  function getSearchIndexUrl() {
    const metaTag = document.querySelector('meta[name="search-index"]');
    return metaTag ? metaTag.getAttribute('content') : '/index.json';
  }

  async function loadSearchData() {
    if (isInitialized && searchData.length > 0) return;
    try {
      const url = getSearchIndexUrl();
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' loading ' + url);
      searchData = await res.json();
      isInitialized = true;

      // Dynamically discover all collections from the data
      collectionsMap.clear();
      searchData.forEach((item) => {
        if (item.collection && item.collection.trim()) {
          const slug = item.collection.trim().toLowerCase();
          const title = item.collectionTitle || item.collection;
          if (!collectionsMap.has(slug)) {
            collectionsMap.set(slug, title);
          }
        }
      });

      renderFilterBars();
    } catch (err) {
      console.error('Failed to load search index:', err);
    }
  }

  function renderFilterBars() {
    // Populate Modal Filter Bar
    if (modalFilterBar) {
      let html = `<button class="filter-btn ${currentCollection === 'all' ? 'active' : ''}" data-collection="all">All</button>`;
      for (const [slug, title] of collectionsMap.entries()) {
        const active = currentCollection === slug ? 'active' : '';
        html += `<button class="filter-btn ${active}" data-collection="${escapeHtml(slug)}">${escapeHtml(title)}</button>`;
      }
      modalFilterBar.innerHTML = html;
      modalFilterBar.querySelectorAll('.filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          modalFilterBar.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          currentCollection = btn.getAttribute('data-collection') || 'all';
          performModalSearch();
        });
      });
    }

    // Populate Standalone Search Page Filter Bar
    if (pageFilterBar) {
      let html = `<button class="filter-btn ${currentCollection === 'all' ? 'active' : ''}" data-collection="all">All Collections</button>`;
      for (const [slug, title] of collectionsMap.entries()) {
        const active = currentCollection === slug ? 'active' : '';
        html += `<button class="filter-btn ${active}" data-collection="${escapeHtml(slug)}">${escapeHtml(title)}</button>`;
      }
      pageFilterBar.innerHTML = html;
      pageFilterBar.querySelectorAll('.filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          pageFilterBar.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          currentCollection = btn.getAttribute('data-collection') || 'all';
          performPageSearch();
        });
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlightMatches(text, terms) {
    if (!text) return '';
    let escaped = escapeHtml(text);
    if (!terms || !terms.length) return escaped;

    terms.forEach((term) => {
      if (!term || term.length === 0) return;
      const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
      escaped = escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
    });
    return escaped;
  }

  function extractContextSnippet(item, terms, maxLength = 160) {
    const fullText = (item.content || item.summary || '').trim();
    if (!fullText) return '';
    if (!terms || !terms.length) {
      return fullText.length > maxLength
        ? fullText.substring(0, maxLength).trim() + '...'
        : fullText;
    }

    const textLower = fullText.toLowerCase();
    let firstMatchIndex = -1;

    for (const term of terms) {
      const idx = textLower.indexOf(term.toLowerCase());
      if (idx !== -1 && (firstMatchIndex === -1 || idx < firstMatchIndex)) {
        firstMatchIndex = idx;
      }
    }

    if (firstMatchIndex === -1) {
      return fullText.length > maxLength
        ? fullText.substring(0, maxLength).trim() + '...'
        : fullText;
    }

    const contextBefore = 35;
    let start = Math.max(0, firstMatchIndex - contextBefore);
    let end = Math.min(fullText.length, firstMatchIndex + maxLength - contextBefore);

    if (start > 0) {
      const spaceIdx = fullText.lastIndexOf(' ', start);
      if (spaceIdx !== -1 && spaceIdx > start - 15) {
        start = spaceIdx + 1;
      }
    }

    if (end < fullText.length) {
      const spaceIdx = fullText.indexOf(' ', end);
      if (spaceIdx !== -1 && spaceIdx < end + 20) {
        end = spaceIdx;
      }
    }

    let snippet = fullText.substring(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) snippet = '...' + snippet;
    if (end < fullText.length) snippet = snippet + '...';

    return snippet;
  }

  function searchArticles(query, collection) {
    const rawTerms = query ? query.toLowerCase().trim().split(/\s+/).filter(Boolean) : [];
    let items = searchData;

    // Filter by collection if not "all"
    if (collection && collection !== 'all') {
      items = items.filter(
        (item) => item.collection && item.collection.toLowerCase() === collection.toLowerCase()
      );
    }

    if (!rawTerms.length) {
      return items.map((item) => ({ item, score: 1, terms: [] }));
    }

    const scored = [];

    for (const item of items) {
      const titleLower = (item.title || '').toLowerCase();
      const summaryLower = (item.summary || '').toLowerCase();
      const contentLower = (item.content || '').toLowerCase();
      const tagsLower = Array.isArray(item.tags) ? item.tags.join(' ').toLowerCase() : '';

      let score = 0;
      let matchedAll = true;

      for (const term of rawTerms) {
        let termScore = 0;

        if (titleLower.includes(term)) {
          termScore += titleLower === term ? 100 : titleLower.startsWith(term) ? 60 : 40;
        }
        if (tagsLower.includes(term)) {
          termScore += 30;
        }
        if (summaryLower.includes(term)) {
          termScore += 20;
        }
        if (contentLower.includes(term)) {
          termScore += 10;
        }

        if (termScore === 0) {
          matchedAll = false;
          break;
        }

        score += termScore;
      }

      if (matchedAll && score > 0) {
        scored.push({ item, score, terms: rawTerms });
      }
    }

    return scored.sort((a, b) => b.score - a.score);
  }

  function renderModalResults(results) {
    if (!resultsContainer) return;
    selectedIndex = -1;

    if (results.length === 0) {
      resultsContainer.innerHTML =
        '<div class="search-empty">No articles found matching your query.</div>';
      return;
    }

    const html = results
      .slice(0, 12)
      .map((r, index) => {
        const item = r.item;
        const displayCollection = item.collectionTitle || item.collection;
        const highlightedTitle = highlightMatches(item.title, r.terms);
        const snippetText = extractContextSnippet(item, r.terms, 150);
        const highlightedSnippet = highlightMatches(snippetText, r.terms);

        return `
        <li>
          <a href="${item.url}" class="search-result-item" data-index="${index}">
            <div class="search-result-header">
              <span class="search-result-title">${highlightedTitle}</span>
              ${
                displayCollection
                  ? `<span class="collection-badge">${escapeHtml(displayCollection)}</span>`
                  : ''
              }
            </div>
            ${
              highlightedSnippet
                ? `<div class="search-result-snippet">${highlightedSnippet}</div>`
                : ''
            }
          </a>
        </li>
      `;
      })
      .join('');

    resultsContainer.innerHTML = html;
  }

  async function performModalSearch() {
    await loadSearchData();
    const query = searchInput ? searchInput.value.trim() : '';
    const results = searchArticles(query, currentCollection);
    renderModalResults(results);
  }

  function openSearchModal() {
    if (!modal) return;
    modal.classList.add('open');
    loadSearchData().then(() => {
      performModalSearch();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    });
  }

  function closeSearchModal() {
    if (!modal) return;
    modal.classList.remove('open');
    if (searchInput) searchInput.value = '';
    selectedIndex = -1;
  }

  function updateSelection(items) {
    items.forEach((item, idx) => {
      if (idx === selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  // Keyboard Navigation
  document.addEventListener('keydown', (e) => {
    if (
      (e.key === 'k' && (e.metaKey || e.ctrlKey)) ||
      (e.key === '/' &&
        document.activeElement.tagName !== 'INPUT' &&
        document.activeElement.tagName !== 'TEXTAREA')
    ) {
      e.preventDefault();
      openSearchModal();
      return;
    }

    if (e.key === 'Escape' && modal && modal.classList.contains('open')) {
      closeSearchModal();
      return;
    }

    if (modal && modal.classList.contains('open')) {
      const items = resultsContainer.querySelectorAll('.search-result-item');
      if (!items.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % items.length;
        updateSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        updateSelection(items);
      } else if (e.key === 'Enter' && selectedIndex >= 0 && items[selectedIndex]) {
        e.preventDefault();
        window.location.href = items[selectedIndex].getAttribute('href');
      }
    }
  });

  if (searchInput) {
    searchInput.addEventListener('input', performModalSearch);
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeSearchModal();
      }
    });
  }

  document.querySelectorAll('.search-trigger-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openSearchModal();
    });
  });

  // Standalone Search Page Logic
  function renderPageResults(results) {
    if (!pageResults) return;
    if (results.length === 0) {
      pageResults.innerHTML = '<div class="search-empty">No results found matching your query.</div>';
      return;
    }

    pageResults.innerHTML = results
      .map((r) => {
        const item = r.item;
        const displayCollection = item.collectionTitle || item.collection;
        const highlightedTitle = highlightMatches(item.title, r.terms);
        const snippetText = extractContextSnippet(item, r.terms, 180);
        const highlightedSnippet = highlightMatches(snippetText, r.terms);

        return `
        <li style="margin-bottom: 0.75rem; list-style: none;">
          <a href="${item.url}" class="post-item">
            <div class="post-item-meta">
              ${
                displayCollection
                  ? `<span class="collection-badge">${escapeHtml(displayCollection)}</span>`
                  : ''
              }
              <span>${escapeHtml(item.date || '')}</span>
            </div>
            <h3 class="post-item-title">${highlightedTitle}</h3>
            ${
              highlightedSnippet
                ? `<p class="post-item-summary">${highlightedSnippet}</p>`
                : ''
            }
          </a>
        </li>
      `;
      })
      .join('');
  }

  async function performPageSearch() {
    await loadSearchData();
    const q = pageInput ? pageInput.value.trim() : '';
    const results = searchArticles(q, currentCollection);
    renderPageResults(results);
  }

  if (pageInput && pageResults) {
    pageInput.addEventListener('input', performPageSearch);
    loadSearchData().then(() => performPageSearch());
  }

  // Pre-fetch search data on idle
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => loadSearchData());
  } else {
    setTimeout(loadSearchData, 500);
  }
})();
