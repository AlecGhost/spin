(function () {
  'use strict';

  const PALETTE = {
    tech: '#a6e3a1',
    dnd: '#fab387',
    sla: '#fab387',
    lore: '#cba6f7',
    notes: '#89b4fa'
  };

  const FALLBACK_COLOURS = ['#f9e2af', '#94e2d5', '#f5c2e7', '#74c7ec'];

  const THEME = {
    bg: '#1e1e2e',
    edgeDefault: 'rgba(88, 91, 112, 0.45)',
    edgeHighlight: '#89b4fa',
    textMain: '#cdd6f4',
    textSecondary: '#a6adc8',
    nodeBorder: '#181825',
    hoverRing: '#cdd6f4',
    dimAlpha: 0.15
  };

  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const MIN_ALPHA = 0.005;
  const DRAG_THRESHOLD_PX = 4;
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 4.0;

  function parseGraphPayload(scriptEl) {
    if (!scriptEl || !scriptEl.textContent) {
      return { ok: false, error: 'Missing knowledge graph script element' };
    }
    try {
      const parsed = JSON.parse(scriptEl.textContent);
      if (!parsed || !Array.isArray(parsed.nodes)) {
        return { ok: false, error: 'Invalid graph payload structure' };
      }

      const rawNodes = parsed.nodes;
      const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];

      const collectionColourMap = new Map();
      let fallbackIdx = 0;

      function resolveCollectionColour(collectionSlug) {
        const key = (collectionSlug || '').toLowerCase();
        if (!key) return PALETTE.notes;
        if (PALETTE[key]) return PALETTE[key];
        if (!collectionColourMap.has(key)) {
          const colour = FALLBACK_COLOURS[fallbackIdx % FALLBACK_COLOURS.length];
          fallbackIdx += 1;
          collectionColourMap.set(key, colour);
        }
        return collectionColourMap.get(key);
      }

      const sortedRawNodes = rawNodes.slice().sort((a, b) => {
        const collA = String(a.collection || '');
        const collB = String(b.collection || '');
        if (collA !== collB) return collA.localeCompare(collB);
        return String(a.title || '').localeCompare(String(b.title || ''));
      });

      const nodeById = new Map();
      const nodes = sortedRawNodes.map((n, index) => {
        const id = String(n.id || n.url || '');
        const collection = String(n.collection || '').trim();
        const collectionTitle = String(n.collectionTitle || (collection ? collection : 'Notes')).trim();
        const tags = Array.isArray(n.tags)
          ? n.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
          : [];
        const angle = index * GOLDEN_ANGLE;
        const radiusDist = 22 * Math.sqrt(index + 1);

        const node = {
          id,
          title: String(n.title || id),
          url: String(n.url || id),
          collection,
          collectionTitle,
          colour: resolveCollectionColour(collection),
          tags,
          x: Math.cos(angle) * radiusDist,
          y: Math.sin(angle) * radiusDist,
          vx: 0,
          vy: 0,
          fx: null,
          fy: null,
          degree: 0,
          radius: 4.5,
          visible: true
        };
        nodeById.set(id, node);
        return node;
      });

      const edges = [];
      for (const e of rawEdges) {
        if (!e || !e.source || !e.target) continue;
        const sourceNode = nodeById.get(String(e.source));
        const targetNode = nodeById.get(String(e.target));
        if (sourceNode && targetNode && sourceNode !== targetNode) {
          edges.push({
            source: sourceNode,
            target: targetNode,
            active: true
          });
        }
      }

      return { ok: true, value: { nodes, edges } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'JSON parse error' };
    }
  }

  function readInitialActiveTags() {
    const activeChipEls = document.querySelectorAll('.tag-filter-container .tag-chip.active');
    if (activeChipEls.length > 0) {
      return Array.from(activeChipEls)
        .map((el) => (el.getAttribute('data-tag') || '').toLowerCase().trim())
        .filter(Boolean);
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('tags');
      if (!raw) return [];
      return raw
        .split(',')
        .map((t) => t.toLowerCase().trim())
        .filter(Boolean);
    } catch (_e) {
      return [];
    }
  }

  function computeNodeRadius(degree) {
    return 4.5 + Math.min(8, Math.sqrt(degree) * 2.2);
  }

  function buildAdjacencyMap(activeEdges) {
    const map = new Map();
    for (const edge of activeEdges) {
      if (!map.has(edge.source.id)) map.set(edge.source.id, new Set());
      if (!map.has(edge.target.id)) map.set(edge.target.id, new Set());
      map.get(edge.source.id).add(edge.target.id);
      map.get(edge.target.id).add(edge.source.id);
    }
    return map;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initKnowledgeGraph() {
    const card = document.getElementById('knowledge-graph-card');
    const viewport = document.getElementById('knowledge-graph-viewport');
    const canvas = document.getElementById('knowledge-graph-canvas');
    const legendEl = document.getElementById('knowledge-graph-legend');
    const emptyEl = document.getElementById('knowledge-graph-empty');
    const expandBtn = document.getElementById('knowledge-graph-expand');
    const dataScript = document.getElementById('knowledge-graph-data');

    if (!card || !viewport || !canvas || !dataScript) return;

    const parsedResult = parseGraphPayload(dataScript);
    if (!parsedResult.ok) return;

    const { nodes, edges } = parsedResult.value;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = {
      width: 0,
      height: 0,
      dpr: window.devicePixelRatio || 1,
      panX: 0,
      panY: 0,
      scale: 1,
      alpha: 1,
      rafId: null,
      visibleNodes: [],
      activeEdges: [],
      adjacency: new Map(),
      hoveredNode: null,
      draggedNode: null,
      isPanning: false,
      pointerStartX: 0,
      pointerStartY: 0,
      lastPointerX: 0,
      lastPointerY: 0,
      didDrag: false,
      pinchStartDist: null,
      pinchStartScale: 1,
      isFullscreen: false
    };

    function updateFilterState(activeTags) {
      const tagSet = new Set(activeTags);
      for (const node of nodes) {
        node.visible =
          tagSet.size === 0 || Array.from(tagSet).every((t) => node.tags.includes(t));
        node.degree = 0;
      }

      for (const edge of edges) {
        edge.active = edge.source.visible && edge.target.visible;
        if (edge.active) {
          edge.source.degree += 1;
          edge.target.degree += 1;
        }
      }

      for (const node of nodes) {
        node.radius = computeNodeRadius(node.degree);
      }

      state.visibleNodes = nodes.filter((n) => n.visible);
      state.activeEdges = edges.filter((e) => e.active);
      state.adjacency = buildAdjacencyMap(state.activeEdges);

      if (state.hoveredNode && !state.hoveredNode.visible) {
        state.hoveredNode = null;
      }

      if (emptyEl) {
        emptyEl.style.display = state.visibleNodes.length === 0 ? 'flex' : 'none';
      }

      renderLegend();
      reheatSimulation(0.5);
    }

    function renderLegend() {
      if (!legendEl) return;
      const seenCollections = new Map();
      for (const node of state.visibleNodes) {
        const key = node.collection || '__notes__';
        if (!seenCollections.has(key)) {
          seenCollections.set(key, {
            title: node.collectionTitle || 'Notes',
            colour: node.colour
          });
        }
      }

      if (seenCollections.size <= 1 && seenCollections.has('__notes__')) {
        legendEl.innerHTML = '';
        legendEl.style.display = 'none';
        return;
      }

      let html = '';
      for (const [, info] of seenCollections.entries()) {
        html += `<span class="knowledge-graph-legend-item"><span class="knowledge-graph-legend-dot" style="background:${escapeHtml(info.colour)}"></span>${escapeHtml(info.title)}</span>`;
      }
      legendEl.innerHTML = html;
      legendEl.style.display = html ? 'flex' : 'none';
    }

    function stepPhysics() {
      const visible = state.visibleNodes;
      const count = visible.length;
      if (count === 0) return;

      const alpha = state.alpha;
      const repulsionStrength = count > 80 ? 260 : 340;
      const gravityStrength = 0.022;
      const springStrength = 0.045;

      // 1. Repulsion between visible node pairs
      for (let i = 0; i < count; i += 1) {
        const a = visible[i];
        for (let j = i + 1; j < count; j += 1) {
          const b = visible[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          if (dx === 0 && dy === 0) {
            dx = (i % 2 === 0 ? 1 : -1) * 0.5;
            dy = (j % 2 === 0 ? 1 : -1) * 0.5;
          }
          const distSq = Math.max(80, dx * dx + dy * dy);
          const dist = Math.sqrt(distSq);
          const force = (repulsionStrength * alpha) / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // 2. Spring attraction along active edges
      for (const edge of state.activeEdges) {
        const u = edge.source;
        const v = edge.target;
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const restLength = 52 + (u.radius + v.radius) * 2.2;
        const displacement = dist - restLength;
        const force = displacement * springStrength * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        u.vx += fx;
        u.vy += fy;
        v.vx -= fx;
        v.vy -= fy;
      }

      // 3. Centring gravity and position integration
      for (let i = 0; i < count; i += 1) {
        const node = visible[i];
        if (node.fx !== null && node.fy !== null) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        node.vx -= node.x * gravityStrength * alpha;
        node.vy -= node.y * gravityStrength * alpha;

        node.vx *= 0.6;
        node.vy *= 0.6;

        node.x += node.vx;
        node.y += node.vy;
      }
    }

    function isNeighbourOfHovered(node) {
      if (!state.hoveredNode) return false;
      if (node.id === state.hoveredNode.id) return true;
      const neighbours = state.adjacency.get(state.hoveredNode.id);
      return Boolean(neighbours && neighbours.has(node.id));
    }

    function drawGraph() {
      const { width, height, dpr, panX, panY, scale, hoveredNode } = state;
      if (width === 0 || height === 0) return;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (state.visibleNodes.length === 0) {
        ctx.restore();
        return;
      }

      ctx.translate(width / 2 + panX, height / 2 + panY);
      ctx.scale(scale, scale);

      // Draw edges
      for (const edge of state.activeEdges) {
        const isHighlighted =
          hoveredNode &&
          (edge.source.id === hoveredNode.id || edge.target.id === hoveredNode.id);

        ctx.beginPath();
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);

        if (!hoveredNode) {
          ctx.strokeStyle = THEME.edgeDefault;
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1 / scale;
        } else if (isHighlighted) {
          ctx.strokeStyle = THEME.edgeHighlight;
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = 1.6 / scale;
        } else {
          ctx.strokeStyle = THEME.edgeDefault;
          ctx.globalAlpha = THEME.dimAlpha;
          ctx.lineWidth = 1 / scale;
        }
        ctx.stroke();
      }

      // Draw nodes
      for (const node of state.visibleNodes) {
        const isFocus = !hoveredNode || isNeighbourOfHovered(node);
        ctx.globalAlpha = isFocus ? 1 : THEME.dimAlpha;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.colour;
        ctx.fill();

        ctx.lineWidth = (hoveredNode && node.id === hoveredNode.id ? 2 : 1.2) / scale;
        ctx.strokeStyle =
          hoveredNode && node.id === hoveredNode.id ? THEME.hoverRing : THEME.nodeBorder;
        ctx.stroke();
      }

      // Draw labels
      const showAllLabels = state.visibleNodes.length <= 24 || scale >= 1.35;
      const fontSize = Math.max(9, Math.min(13, 11 / Math.pow(scale, 0.35)));
      ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      for (const node of state.visibleNodes) {
        let shouldShowLabel = false;
        let labelAlpha = 0.85;

        if (hoveredNode) {
          if (isNeighbourOfHovered(node)) {
            shouldShowLabel = true;
            labelAlpha = node.id === hoveredNode.id ? 1 : 0.92;
          }
        } else if (showAllLabels || node.degree >= 3 || (scale >= 0.95 && node.degree >= 1)) {
          shouldShowLabel = true;
          labelAlpha = Math.min(0.9, Math.max(0.55, (scale - 0.5) * 0.8));
        }

        if (!shouldShowLabel) continue;

        const labelY = node.y + node.radius + 4 / scale;
        ctx.globalAlpha = labelAlpha;
        ctx.lineWidth = 3 / scale;
        ctx.strokeStyle = 'rgba(24, 24, 37, 0.85)';
        ctx.strokeText(node.title, node.x, labelY);

        ctx.fillStyle =
          hoveredNode && node.id === hoveredNode.id ? THEME.textMain : THEME.textSecondary;
        ctx.fillText(node.title, node.x, labelY);
      }

      ctx.restore();
    }

    function tick() {
      state.rafId = null;
      if (state.alpha > MIN_ALPHA || state.draggedNode) {
        stepPhysics();
        if (!state.draggedNode) {
          state.alpha *= 0.982;
        }
      }
      drawGraph();
      if (state.alpha > MIN_ALPHA || state.draggedNode) {
        state.rafId = window.requestAnimationFrame(tick);
      }
    }

    function requestRender() {
      if (state.rafId === null) {
        state.rafId = window.requestAnimationFrame(tick);
      }
    }

    function reheatSimulation(targetAlpha) {
      state.alpha = Math.max(state.alpha, targetAlpha);
      requestRender();
    }

    function screenToWorld(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        x: (sx - state.width / 2 - state.panX) / state.scale,
        y: (sy - state.height / 2 - state.panY) / state.scale
      };
    }

    function findNodeAt(worldX, worldY) {
      const hitPadding = 5 / state.scale;
      for (let i = state.visibleNodes.length - 1; i >= 0; i -= 1) {
        const node = state.visibleNodes[i];
        const dx = worldX - node.x;
        const dy = worldY - node.y;
        const hitRadius = node.radius + hitPadding;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          return node;
        }
      }
      return null;
    }

    function resizeCanvas() {
      const rect = viewport.getBoundingClientRect();
      state.width = Math.max(1, Math.floor(rect.width));
      state.height = Math.max(1, Math.floor(rect.height));
      state.dpr = window.devicePixelRatio || 1;
      canvas.width = state.width * state.dpr;
      canvas.height = state.height * state.dpr;
      drawGraph();
    }

    function applyZoomAt(factor, clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const cursorX = clientX - rect.left - state.width / 2;
      const cursorY = clientY - rect.top - state.height / 2;

      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * factor));
      const ratio = nextScale / state.scale;

      state.panX = cursorX - (cursorX - state.panX) * ratio;
      state.panY = cursorY - (cursorY - state.panY) * ratio;
      state.scale = nextScale;
      requestRender();
    }

    function setFullscreen(enabled) {
      state.isFullscreen = enabled;
      card.classList.toggle('is-fullscreen', enabled);
      document.body.style.overflow = enabled ? 'hidden' : '';
      if (expandBtn) {
        expandBtn.setAttribute('aria-expanded', enabled ? 'true' : 'false');
        const expandIcon = expandBtn.querySelector('.icon-expand');
        const collapseIcon = expandBtn.querySelector('.icon-collapse');
        if (expandIcon) expandIcon.style.display = enabled ? 'none' : '';
        if (collapseIcon) collapseIcon.style.display = enabled ? '' : 'none';
      }
      resizeCanvas();
      reheatSimulation(0.15);
    }

    // Mouse Events
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const world = screenToWorld(e.clientX, e.clientY);
      const hit = findNodeAt(world.x, world.y);

      state.pointerStartX = e.clientX;
      state.pointerStartY = e.clientY;
      state.lastPointerX = e.clientX;
      state.lastPointerY = e.clientY;
      state.didDrag = false;

      if (hit) {
        state.draggedNode = hit;
        hit.fx = hit.x;
        hit.fy = hit.y;
        canvas.style.cursor = 'grabbing';
        reheatSimulation(0.35);
      } else {
        state.isPanning = true;
        canvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (state.draggedNode) {
        const moveDist = Math.hypot(
          e.clientX - state.pointerStartX,
          e.clientY - state.pointerStartY
        );
        if (moveDist > DRAG_THRESHOLD_PX) state.didDrag = true;
        const world = screenToWorld(e.clientX, e.clientY);
        state.draggedNode.fx = world.x;
        state.draggedNode.fy = world.y;
        state.alpha = Math.max(state.alpha, 0.25);
        requestRender();
        return;
      }

      if (state.isPanning) {
        const moveDist = Math.hypot(
          e.clientX - state.pointerStartX,
          e.clientY - state.pointerStartY
        );
        if (moveDist > DRAG_THRESHOLD_PX) state.didDrag = true;
        state.panX += e.clientX - state.lastPointerX;
        state.panY += e.clientY - state.lastPointerY;
        state.lastPointerX = e.clientX;
        state.lastPointerY = e.clientY;
        requestRender();
        return;
      }

      if (e.target === canvas) {
        const world = screenToWorld(e.clientX, e.clientY);
        const hit = findNodeAt(world.x, world.y);
        if (hit !== state.hoveredNode) {
          state.hoveredNode = hit;
          canvas.style.cursor = hit ? 'pointer' : 'grab';
          requestRender();
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (state.draggedNode) {
        const clickedNode = state.draggedNode;
        clickedNode.fx = null;
        clickedNode.fy = null;
        state.draggedNode = null;
        canvas.style.cursor = state.hoveredNode ? 'pointer' : 'grab';

        if (!state.didDrag && e.target === canvas && clickedNode.url) {
          window.location.href = clickedNode.url;
          return;
        }
        reheatSimulation(0.15);
      } else if (state.isPanning) {
        state.isPanning = false;
        canvas.style.cursor = state.hoveredNode ? 'pointer' : 'grab';
      }
    });

    canvas.addEventListener('mouseleave', () => {
      if (!state.draggedNode && state.hoveredNode) {
        state.hoveredNode = null;
        canvas.style.cursor = 'grab';
        requestRender();
      }
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        applyZoomAt(factor, e.clientX, e.clientY);
      },
      { passive: false }
    );

    // Touch Events
    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          const world = screenToWorld(touch.clientX, touch.clientY);
          const hit = findNodeAt(world.x, world.y);
          state.pointerStartX = touch.clientX;
          state.pointerStartY = touch.clientY;
          state.lastPointerX = touch.clientX;
          state.lastPointerY = touch.clientY;
          state.didDrag = false;

          if (hit) {
            state.draggedNode = hit;
            state.hoveredNode = hit;
            hit.fx = hit.x;
            hit.fy = hit.y;
            reheatSimulation(0.35);
          } else {
            state.isPanning = true;
            state.hoveredNode = null;
            requestRender();
          }
        } else if (e.touches.length === 2) {
          state.draggedNode = null;
          state.isPanning = false;
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          state.pinchStartDist = Math.hypot(dx, dy);
          state.pinchStartScale = state.scale;
        }
      },
      { passive: true }
    );

    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length === 1 && (state.draggedNode || state.isPanning)) {
          e.preventDefault();
          const touch = e.touches[0];
          const moveDist = Math.hypot(
            touch.clientX - state.pointerStartX,
            touch.clientY - state.pointerStartY
          );
          if (moveDist > DRAG_THRESHOLD_PX) state.didDrag = true;

          if (state.draggedNode) {
            const world = screenToWorld(touch.clientX, touch.clientY);
            state.draggedNode.fx = world.x;
            state.draggedNode.fy = world.y;
            state.alpha = Math.max(state.alpha, 0.25);
          } else if (state.isPanning) {
            state.panX += touch.clientX - state.lastPointerX;
            state.panY += touch.clientY - state.lastPointerY;
            state.lastPointerX = touch.clientX;
            state.lastPointerY = touch.clientY;
          }
          requestRender();
        } else if (e.touches.length === 2 && state.pinchStartDist) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const targetScale = state.pinchStartScale * (dist / state.pinchStartDist);
          applyZoomAt(targetScale / state.scale, midX, midY);
        }
      },
      { passive: false }
    );

    canvas.addEventListener('touchend', () => {
      if (state.draggedNode) {
        const tappedNode = state.draggedNode;
        tappedNode.fx = null;
        tappedNode.fy = null;
        state.draggedNode = null;
        if (!state.didDrag && tappedNode.url) {
          window.location.href = tappedNode.url;
          return;
        }
        reheatSimulation(0.15);
      }
      state.isPanning = false;
      state.pinchStartDist = null;
    });

    // Controls
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        setFullscreen(!state.isFullscreen);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.isFullscreen) {
        setFullscreen(false);
      }
    });

    window.addEventListener('spin:tags-change', (e) => {
      const tags = e.detail && Array.isArray(e.detail.activeTags) ? e.detail.activeTags : [];
      updateFilterState(tags);
    });

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => resizeCanvas());
      observer.observe(viewport);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }

    resizeCanvas();
    updateFilterState(readInitialActiveTags());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKnowledgeGraph);
  } else {
    initKnowledgeGraph();
  }
})();
