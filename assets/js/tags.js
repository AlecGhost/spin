(function () {
  'use strict';

  function initTagFiltering() {
    const filterContainers = document.querySelectorAll('.tag-filter-container');
    if (!filterContainers.length) return;

    filterContainers.forEach((container) => {
      // Find the associated posts-list (sibling or within the same main/page wrapper)
      // Find all post items within the same page wrapper
      const pageWrapper = container.closest('.list-page, .overview-page, .site-main') || document.body;
      const postItems = Array.from(pageWrapper.querySelectorAll('.post-item'));
      if (!postItems.length) return;

      const chips = Array.from(container.querySelectorAll('.tag-chip'));
      const clearBtn = container.querySelector('.tag-filter-clear');
      const emptyMsg = container.querySelector('.tag-filter-empty');

      const activeTags = new Set();

      function updateUI() {
        // Update chips active state & aria-pressed
        chips.forEach((chip) => {
          const tag = chip.getAttribute('data-tag');
          const isActive = activeTags.has(tag);
          chip.classList.toggle('active', isActive);
          chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        // Show/hide clear button
        if (clearBtn) {
          clearBtn.classList.toggle('visible', activeTags.size > 0);
          clearBtn.style.display = activeTags.size > 0 ? 'inline-block' : 'none';
        }

        // Filter posts with AND logic
        let visibleCount = 0;
        postItems.forEach((post) => {
          if (activeTags.size === 0) {
            post.style.display = '';
            visibleCount++;
            return;
          }

          let postTags = [];
          try {
            const raw = post.getAttribute('data-tags');
            postTags = raw ? JSON.parse(raw) : [];
          } catch (e) {
            postTags = [];
          }

          // Strict AND logic: post must contain ALL active tags
          const matchesAll = Array.from(activeTags).every((tag) => postTags.includes(tag));
          if (matchesAll) {
            post.style.display = '';
            visibleCount++;
          } else {
            post.style.display = 'none';
          }
        });

        // Empty state
        if (emptyMsg) {
          if (activeTags.size > 0 && visibleCount === 0) {
            emptyMsg.classList.add('visible');
            emptyMsg.style.display = 'block';
          } else {
            emptyMsg.classList.remove('visible');
            emptyMsg.style.display = 'none';
          }
        }

        // Sync URL query params
        syncUrlParams();
      }

      function syncUrlParams() {
        try {
          const url = new URL(window.location.href);
          if (activeTags.size > 0) {
            url.searchParams.set('tags', Array.from(activeTags).join(','));
          } else {
            url.searchParams.delete('tags');
          }
          if (url.href !== window.location.href) {
            window.history.replaceState({ tags: Array.from(activeTags) }, '', url);
          }
        } catch (e) {
          // Ignore URL sync errors if environment restricts history
        }
      }

      function loadUrlParams() {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const rawTags = urlParams.get('tags');
          activeTags.clear();
          if (rawTags) {
            rawTags.split(',').forEach((t) => {
              const cleaned = t.trim().toLowerCase();
              if (cleaned) {
                // Ensure tag actually exists in chips
                const exists = chips.some((c) => c.getAttribute('data-tag') === cleaned);
                if (exists) {
                  activeTags.add(cleaned);
                }
              }
            });
          }
          updateUI();
        } catch (e) {
          // Ignore
        }
      }

      // Handle chip clicks
      chips.forEach((chip) => {
        chip.addEventListener('click', () => {
          const tag = chip.getAttribute('data-tag');
          if (!tag) return;

          if (activeTags.has(tag)) {
            // Clicking again disables it
            activeTags.delete(tag);
          } else {
            // Clicking once enables it
            activeTags.add(tag);
          }
          updateUI();
        });
      });

      // Handle clear button
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          activeTags.clear();
          updateUI();
        });
      }

      // Handle browser back/forward buttons
      window.addEventListener('popstate', () => {
        loadUrlParams();
      });

      // Initial load from URL
      loadUrlParams();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTagFiltering);
  } else {
    initTagFiltering();
  }
})();
