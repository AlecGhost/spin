(function () {
  'use strict';

  // Layout & sizing
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const LAYOUT_ITERATIONS = 300;
  const DRAG_THRESHOLD_PX = 6;
  const MIN_SCALE = 0.05;
  const MAX_SCALE = 4.0;
  const MAX_FIT_SCALE = 1.4;
  const FIT_PADDING_PX = 36;
  const ORPHAN_RADIUS = 3;
  const MIN_NODE_RADIUS = 3.5;
  const MAX_NODE_RADIUS = 12;
  const MIN_SCREEN_RADIUS_PX = 2.5;
  const LABEL_FONT_PX = 11;
  const ANIMATION_MS = 380;
  const DIM_ALPHA = 0.12;

  // Fallbacks used only when the theme CSS variables are missing.
  const DEFAULT_PALETTE = ['#a6e3a1', '#fab387', '#cba6f7', '#f9e2af', '#94e2d5', '#f5c2e7', '#74c7ec', '#eba0ac'];

  function cssVar(styles, name, fallback) {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  }

  function readTheme(el) {
    const styles = window.getComputedStyle(el);
    const paletteRaw = cssVar(styles, '--graph-palette', '');
    const palette = paletteRaw
      ? paletteRaw.split(',').map((c) => c.trim()).filter(Boolean)
      : DEFAULT_PALETTE;
    return {
      palette: palette.length > 0 ? palette : DEFAULT_PALETTE,
      standalone: cssVar(styles, '--graph-standalone', cssVar(styles, '--accent', '#89b4fa')),
      edge: cssVar(styles, '--graph-edge', cssVar(styles, '--surface-active', '#585b70')),
      edgeHighlight: cssVar(styles, '--graph-edge-highlight', cssVar(styles, '--accent', '#89b4fa')),
      textMain: cssVar(styles, '--text-main', '#cdd6f4'),
      textSecondary: cssVar(styles, '--text-secondary', '#a6adc8'),
      halo: cssVar(styles, '--bg-subtle', '#181825'),
      font: cssVar(styles, '--font-sans', 'sans-serif')
    };
  }

  function parseGraphPayload(scriptEl, theme) {
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
      const configuredColours =
        parsed.colours && typeof parsed.colours === 'object' ? parsed.colours : {};

      // Colours: explicit site config wins; otherwise collections take palette
      // entries in alphabetical order so colours are stable between builds.
      const collectionSlugs = Array.from(
        new Set(rawNodes.map((n) => String(n.collection || '').trim().toLowerCase()).filter(Boolean))
      ).sort();
      const normalise = (c) => String(c).replace(/\s+/g, '').toLowerCase();
      const standaloneColour = configuredColours[''] ? String(configuredColours['']) : theme.standalone;
      const claimed = new Set([normalise(standaloneColour)]);
      for (const slug of collectionSlugs) {
        if (configuredColours[slug]) claimed.add(normalise(configuredColours[slug]));
      }
      // Palette entries not already claimed by a configured colour come first
      const freePalette = theme.palette.filter((c) => !claimed.has(normalise(c)));
      const autoPalette = freePalette.length > 0 ? freePalette : theme.palette;

      const colourBySlug = new Map();
      let paletteIdx = 0;
      for (const slug of collectionSlugs) {
        if (configuredColours[slug]) {
          colourBySlug.set(slug, String(configuredColours[slug]));
        } else {
          colourBySlug.set(slug, autoPalette[paletteIdx % autoPalette.length]);
          paletteIdx += 1;
        }
      }

      const nodeById = new Map();
      const nodes = rawNodes.map((n) => {
        const id = String(n.id || n.url || '');
        const collection = String(n.collection || '').trim().toLowerCase();
        const node = {
          id,
          title: String(n.title || id),
          url: String(n.url || id),
          collection,
          collectionTitle: String(n.collectionTitle || '').trim() || 'Notes',
          colour: collection ? colourBySlug.get(collection) : standaloneColour,
          tags: Array.isArray(n.tags)
            ? n.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
            : [],
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          degree: 0,
          mass: 1,
          radius: ORPHAN_RADIUS,
          visible: true,
          isOrphan: false
        };
        nodeById.set(id, node);
        return node;
      });

      nodes.sort((a, b) => {
        if (a.collection !== b.collection) return a.collection.localeCompare(b.collection);
        return a.title.localeCompare(b.title);
      });

      const edges = [];
      for (const e of rawEdges) {
        if (!e || !e.source || !e.target) continue;
        const source = nodeById.get(String(e.source));
        const target = nodeById.get(String(e.target));
        if (source && target && source !== target) {
          edges.push({ source, target, active: true });
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
      const raw = new URLSearchParams(window.location.search).get('tags');
      if (!raw) return [];
      return raw
        .split(',')
        .map((t) => t.toLowerCase().trim())
        .filter(Boolean);
    } catch (_e) {
      return [];
    }
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

  function boxesOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function prefersReducedMotion() {
    return Boolean(
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  // ---------------------------------------------------------------------------
  // Layout: linked nodes run a force simulation with a gentle pull toward one
  // anchor per collection; unlinked notes are parked on rings around the core.
  // ---------------------------------------------------------------------------

  function layoutGraph(visibleNodes, activeEdges, aspect) {
    // Stretch the layout horizontally to match the viewport's shape
    const stretchX = Math.sqrt(aspect);
    const stretchY = 1 / stretchX;
    const linked = visibleNodes.filter((n) => !n.isOrphan);
    const orphans = visibleNodes.filter((n) => n.isOrphan);

    // One anchor per collection present in the linked core.
    const groups = new Map();
    for (const node of linked) {
      if (!groups.has(node.collection)) groups.set(node.collection, []);
      groups.get(node.collection).push(node);
    }
    const groupKeys = Array.from(groups.keys()).sort();
    const anchorRadius = groupKeys.length > 1 ? 45 * Math.sqrt(linked.length) : 0;
    const anchors = new Map();
    groupKeys.forEach((key, i) => {
      const angle = (i / groupKeys.length) * Math.PI * 2 - Math.PI / 2;
      anchors.set(key, {
        x: Math.cos(angle) * anchorRadius * stretchX,
        y: Math.sin(angle) * anchorRadius * stretchY
      });
    });

    // Deterministic seed positions around each anchor.
    for (const key of groupKeys) {
      const anchor = anchors.get(key);
      groups.get(key).forEach((node, i) => {
        const angle = i * GOLDEN_ANGLE;
        const dist = 30 * Math.sqrt(i + 0.5);
        node.x = anchor.x + Math.cos(angle) * dist;
        node.y = anchor.y + Math.sin(angle) * dist;
        node.vx = 0;
        node.vy = 0;
      });
    }

    simulate(linked, activeEdges, anchors);
    placeOrphans(linked, orphans, aspect);
  }

  function simulate(nodes, edges, anchors) {
    const count = nodes.length;
    if (count === 0) return;

    const repulsionStrength = 9000;
    const maxRepulsionDist = 400;
    const maxRepulsionDistSq = maxRepulsionDist * maxRepulsionDist;
    const linkDistance = 70;
    const springStrength = 0.08;
    const anchorStrength = 0.03;
    const decay = Math.pow(0.01, 1 / LAYOUT_ITERATIONS);
    let alpha = 1;

    for (let iter = 0; iter < LAYOUT_ITERATIONS; iter += 1) {
      // Repulsion
      for (let i = 0; i < count; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < count; j += 1) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          if (dx === 0 && dy === 0) {
            dx = (i % 2 === 0 ? 1 : -1) * 0.5;
            dy = (j % 2 === 0 ? 1 : -1) * 0.5;
          }
          const rawDistSq = dx * dx + dy * dy;
          if (rawDistSq >= maxRepulsionDistSq) continue;
          const distSq = Math.max(100, rawDistSq);
          const dist = Math.sqrt(distSq);
          const force = (repulsionStrength * alpha * (1 - dist / maxRepulsionDist)) / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx / a.mass;
          a.vy -= fy / a.mass;
          b.vx += fx / b.mass;
          b.vy += fy / b.mass;
        }
      }

      // Springs toward a preferred link length
      for (const edge of edges) {
        const u = edge.source;
        const v = edge.target;
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const k = (springStrength * alpha * (dist - linkDistance)) / dist;
        const fx = dx * k;
        const fy = dy * k;
        u.vx += fx / u.mass;
        u.vy += fy / u.mass;
        v.vx -= fx / v.mass;
        v.vy -= fy / v.mass;
      }

      // Pull toward the collection anchor, integrate
      for (const node of nodes) {
        const anchor = anchors.get(node.collection) || { x: 0, y: 0 };
        node.vx += (anchor.x - node.x) * anchorStrength * alpha;
        node.vy += (anchor.y - node.y) * anchorStrength * alpha;
        node.vx *= 0.6;
        node.vy *= 0.6;
        node.x += node.vx;
        node.y += node.vy;
      }

      if (alpha < 0.5) resolveCollisions(nodes);
      alpha *= decay;
    }

    // Recentre the core on the origin
    let cx = 0;
    let cy = 0;
    for (const node of nodes) {
      cx += node.x;
      cy += node.y;
    }
    cx /= count;
    cy /= count;
    for (const node of nodes) {
      node.x -= cx;
      node.y -= cy;
    }
  }

  function resolveCollisions(nodes) {
    const count = nodes.length;
    for (let i = 0; i < count; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < count; j += 1) {
        const b = nodes[j];
        const minDist = a.radius + b.radius + 18;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) >= minDist || Math.abs(dy) >= minDist) continue;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDist * minDist) continue;
        const dist = Math.sqrt(distSq) || 0.1;
        const overlap = (minDist - dist) * 0.5;
        const px = (dx / dist) * overlap;
        const py = (dy / dist) * overlap;
        const totalMass = a.mass + b.mass;
        a.x -= px * (b.mass / totalMass);
        a.y -= py * (b.mass / totalMass);
        b.x += px * (a.mass / totalMass);
        b.y += py * (a.mass / totalMass);
      }
    }
  }

  function placeOrphans(linked, orphans, aspect) {
    if (orphans.length === 0) return;

    // Without a linked core, lay orphans out on a compact sunflower instead.
    if (linked.length === 0) {
      orphans.forEach((node, i) => {
        const angle = i * GOLDEN_ANGLE;
        const dist = 26 * Math.sqrt(i + 0.5);
        node.x = Math.cos(angle) * dist * Math.sqrt(aspect);
        node.y = (Math.sin(angle) * dist) / Math.sqrt(aspect);
      });
      return;
    }

    // Smallest ellipse with the viewport's aspect that contains the core
    let coreRy = 0;
    for (const node of linked) {
      coreRy = Math.max(coreRy, Math.hypot(node.x / aspect, node.y) + node.radius);
    }
    let ry = coreRy + 45;
    let rx = ry * aspect;

    const spacing = 24;
    const ringGap = 24;
    let placed = 0;
    let ring = 0;
    while (placed < orphans.length) {
      // Ramanujan's approximation of the ellipse perimeter
      const h = Math.pow(rx - ry, 2) / Math.pow(rx + ry, 2);
      const perimeter = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
      const capacity = Math.max(6, Math.floor(perimeter / spacing));
      const onRing = Math.min(capacity, orphans.length - placed);
      const offset = ring % 2 === 0 ? 0 : Math.PI / capacity;
      for (let k = 0; k < onRing; k += 1) {
        const angle = offset - Math.PI / 2 + (k / onRing) * Math.PI * 2;
        const node = orphans[placed + k];
        node.x = Math.cos(angle) * rx;
        node.y = Math.sin(angle) * ry;
      }
      placed += onRing;
      rx += ringGap * aspect;
      ry += ringGap;
      ring += 1;
    }
  }

  // ---------------------------------------------------------------------------

  function initKnowledgeGraph() {
    const card = document.getElementById('knowledge-graph-card');
    const viewport = document.getElementById('knowledge-graph-viewport');
    const canvas = document.getElementById('knowledge-graph-canvas');
    const legendEl = document.getElementById('knowledge-graph-legend');
    const emptyEl = document.getElementById('knowledge-graph-empty');
    const tooltipEl = document.getElementById('knowledge-graph-tooltip');
    const hintEl = document.getElementById('knowledge-graph-hint');
    const expandBtn = document.getElementById('knowledge-graph-expand');
    const fitBtn = document.getElementById('knowledge-graph-fit');
    const zoomInBtn = document.getElementById('knowledge-graph-zoom-in');
    const zoomOutBtn = document.getElementById('knowledge-graph-zoom-out');
    const dataScript = document.getElementById('knowledge-graph-data');

    if (!card || !viewport || !canvas || !dataScript) return;

    const theme = readTheme(card);
    const parsedResult = parseGraphPayload(dataScript, theme);
    if (!parsedResult.ok) return;

    const { nodes, edges } = parsedResult.value;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

    const state = {
      width: 0,
      height: 0,
      dpr: window.devicePixelRatio || 1,
      panX: 0,
      panY: 0,
      scale: 1,
      fitScale: 1,
      userMovedCamera: false,
      rafId: null,
      animation: null,
      visibleNodes: [],
      activeEdges: [],
      adjacency: new Map(),
      labelRank: new Map(),
      hoveredNode: null,
      selectedNode: null,
      pointerDownNode: null,
      isPanning: false,
      pointerStartX: 0,
      pointerStartY: 0,
      lastPointerX: 0,
      lastPointerY: 0,
      didDrag: false,
      lastTouchTime: 0,
      pinch: null,
      isFullscreen: false,
      hintTimer: null,
      layoutAspect: null
    };

    // ---- Filtering & layout ------------------------------------------------

    function updateFilterState(activeTags, animate) {
      const tagSet = new Set(activeTags);
      const previous = new Map();
      for (const node of state.visibleNodes) previous.set(node, { x: node.x, y: node.y });

      for (const node of nodes) {
        node.visible = tagSet.size === 0 || Array.from(tagSet).every((t) => node.tags.includes(t));
        node.degree = 0;
      }
      for (const edge of edges) {
        edge.active = edge.source.visible && edge.target.visible;
        if (edge.active) {
          edge.source.degree += 1;
          edge.target.degree += 1;
        }
      }

      state.visibleNodes = nodes.filter((n) => n.visible);
      state.activeEdges = edges.filter((e) => e.active);
      state.adjacency = buildAdjacencyMap(state.activeEdges);

      let maxDegree = 1;
      for (const node of state.visibleNodes) maxDegree = Math.max(maxDegree, node.degree);
      for (const node of state.visibleNodes) {
        node.isOrphan = node.degree === 0;
        node.radius = node.isOrphan
          ? ORPHAN_RADIUS
          : MIN_NODE_RADIUS + (MAX_NODE_RADIUS - MIN_NODE_RADIUS) * Math.sqrt(node.degree / maxDegree);
        node.mass = 1 + node.degree;
      }

      // Label priority: most-linked first; orphans last.
      const ranked = state.visibleNodes
        .slice()
        .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title));
      state.labelRank = new Map(ranked.map((n, i) => [n, i]));

      if (state.hoveredNode && !state.hoveredNode.visible) {
        state.hoveredNode = null;
        canvas.classList.remove('is-over-node');
        renderTooltip();
      }
      if (state.selectedNode && !state.selectedNode.visible) setSelected(null);

      if (emptyEl) emptyEl.style.display = state.visibleNodes.length === 0 ? 'flex' : 'none';
      updateAriaLabel();
      renderLegend();

      state.layoutAspect = currentAspect();
      layoutGraph(state.visibleNodes, state.activeEdges, state.layoutAspect);

      const shouldAnimate = animate && previous.size > 0 && !prefersReducedMotion();
      if (shouldAnimate) {
        const targets = new Map();
        for (const node of state.visibleNodes) {
          targets.set(node, { x: node.x, y: node.y });
          const from = previous.get(node);
          if (from) {
            node.x = from.x;
            node.y = from.y;
          }
        }
        const camera = computeFitCamera(targets);
        startAnimation({ targets, camera });
      } else {
        fitToView(false);
      }
    }

    function currentAspect() {
      if (!state.width || !state.height) return 1.6;
      return Math.min(2.6, Math.max(1, state.width / state.height));
    }

    function updateAriaLabel() {
      const collections = new Set(state.visibleNodes.map((n) => n.collection || '__standalone__'));
      const orphanCount = state.visibleNodes.filter((n) => n.degree === 0).length;
      canvas.setAttribute(
        'aria-label',
        `Knowledge graph: ${state.visibleNodes.length} notes, ${state.activeEdges.length} links, ` +
          `${collections.size} collections, ${orphanCount} unlinked notes.`
      );
    }

    function renderLegend() {
      if (!legendEl) return;
      const seen = new Map();
      for (const node of state.visibleNodes) {
        const key = node.collection || '__standalone__';
        if (!seen.has(key)) seen.set(key, { title: node.collectionTitle, colour: node.colour });
      }
      if (seen.size <= 1) {
        legendEl.innerHTML = '';
        legendEl.style.display = 'none';
        return;
      }
      const entries = Array.from(seen.values()).sort((a, b) => a.title.localeCompare(b.title));
      legendEl.innerHTML = entries
        .map(
          (info) =>
            `<span class="knowledge-graph-legend-item"><span class="knowledge-graph-legend-dot" style="background:${escapeHtml(info.colour)}"></span>${escapeHtml(info.title)}</span>`
        )
        .join('');
      legendEl.style.display = 'flex';
    }

    // ---- Camera ------------------------------------------------------------

    function computeFitCamera(positions) {
      const list = state.visibleNodes;
      if (list.length === 0 || state.width === 0) return { panX: 0, panY: 0, scale: 1 };
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of list) {
        const p = positions ? positions.get(node) || node : node;
        minX = Math.min(minX, p.x - node.radius);
        maxX = Math.max(maxX, p.x + node.radius);
        minY = Math.min(minY, p.y - node.radius);
        maxY = Math.max(maxY, p.y + node.radius);
      }
      const legendSpace = legendEl && legendEl.style.display !== 'none' ? 28 : 0;
      const availW = Math.max(40, state.width - FIT_PADDING_PX * 2);
      const availH = Math.max(40, state.height - FIT_PADDING_PX * 2 - legendSpace);
      const boxW = Math.max(1, maxX - minX);
      const boxH = Math.max(1, maxY - minY);
      const scale = Math.max(MIN_SCALE, Math.min(MAX_FIT_SCALE, availW / boxW, availH / boxH));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      return { panX: -cx * scale, panY: -cy * scale - legendSpace / 2, scale };
    }

    function fitToView(animate) {
      cancelAnimation();
      const camera = computeFitCamera(null);
      state.userMovedCamera = false;
      if (animate && !prefersReducedMotion()) {
        startAnimation({ camera });
      } else {
        state.panX = camera.panX;
        state.panY = camera.panY;
        state.scale = camera.scale;
        state.fitScale = camera.scale;
        requestRender();
      }
    }

    function startAnimation({ targets, camera }) {
      const from = new Map();
      if (targets) {
        for (const [node] of targets) from.set(node, { x: node.x, y: node.y });
      }
      state.animation = {
        start: performance.now(),
        targets: targets || null,
        from,
        camFrom: { panX: state.panX, panY: state.panY, scale: state.scale },
        camTo: camera
      };
      state.fitScale = camera.scale;
      state.userMovedCamera = false;
      requestRender();
    }

    function stepAnimation(now) {
      const anim = state.animation;
      if (!anim) return false;
      const t = Math.min(1, (now - anim.start) / ANIMATION_MS);
      const e = easeInOut(t);
      if (anim.targets) {
        for (const [node, to] of anim.targets) {
          const from = anim.from.get(node);
          node.x = from.x + (to.x - from.x) * e;
          node.y = from.y + (to.y - from.y) * e;
        }
      }
      // Interpolate zoom geometrically so it feels even
      const s0 = anim.camFrom.scale;
      const s1 = anim.camTo.scale;
      state.scale = s0 * Math.pow(s1 / s0, e);
      state.panX = anim.camFrom.panX + (anim.camTo.panX - anim.camFrom.panX) * e;
      state.panY = anim.camFrom.panY + (anim.camTo.panY - anim.camFrom.panY) * e;
      if (t >= 1) {
        state.animation = null;
        return false;
      }
      return true;
    }

    function cancelAnimation() {
      if (!state.animation) return;
      // Jump node positions to their targets; keep the camera where it is.
      if (state.animation.targets) {
        for (const [node, to] of state.animation.targets) {
          node.x = to.x;
          node.y = to.y;
        }
      }
      state.animation = null;
    }

    function applyZoomAt(factor, screenX, screenY) {
      cancelAnimation();
      const cursorX = screenX - state.width / 2;
      const cursorY = screenY - state.height / 2;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * factor));
      const ratio = nextScale / state.scale;
      state.panX = cursorX - (cursorX - state.panX) * ratio;
      state.panY = cursorY - (cursorY - state.panY) * ratio;
      state.scale = nextScale;
      state.userMovedCamera = true;
      requestRender();
    }

    function zoomByButton(factor) {
      const camFrom = { panX: state.panX, panY: state.panY, scale: state.scale };
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * factor));
      const ratio = nextScale / state.scale;
      const camTo = { panX: state.panX * ratio, panY: state.panY * ratio, scale: nextScale };
      if (prefersReducedMotion()) {
        Object.assign(state, camTo);
        state.userMovedCamera = true;
        requestRender();
        return;
      }
      cancelAnimation();
      const fitScale = state.fitScale;
      state.animation = { start: performance.now(), targets: null, from: new Map(), camFrom, camTo };
      state.fitScale = fitScale;
      state.userMovedCamera = true;
      requestRender();
    }

    function screenPoint(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function screenToWorld(sx, sy) {
      return {
        x: (sx - state.width / 2 - state.panX) / state.scale,
        y: (sy - state.height / 2 - state.panY) / state.scale
      };
    }

    function worldToScreen(x, y) {
      return {
        x: x * state.scale + state.width / 2 + state.panX,
        y: y * state.scale + state.height / 2 + state.panY
      };
    }

    function drawRadius(node) {
      return Math.max(node.radius, MIN_SCREEN_RADIUS_PX / state.scale);
    }

    function findNodeAt(sx, sy, slopPx) {
      const world = screenToWorld(sx, sy);
      const slop = slopPx / state.scale;
      let best = null;
      let bestDist = Infinity;
      for (const node of state.visibleNodes) {
        const dist = Math.hypot(world.x - node.x, world.y - node.y);
        const hit = drawRadius(node) + slop;
        if (dist <= hit && dist < bestDist) {
          best = node;
          bestDist = dist;
        }
      }
      return best;
    }

    // ---- Rendering ---------------------------------------------------------

    function focusNode() {
      return state.selectedNode || state.hoveredNode;
    }

    function isInFocus(node, focus) {
      if (!focus) return true;
      if (node === focus) return true;
      const neighbours = state.adjacency.get(focus.id);
      return Boolean(neighbours && neighbours.has(node.id));
    }

    function labelBudget() {
      const zoom = state.scale / (state.fitScale || 1);
      const base = Math.max(5, Math.ceil(state.visibleNodes.length * 0.08));
      return Math.ceil(base * zoom * zoom);
    }

    function drawGraph() {
      const { width, height, dpr, scale } = state;
      if (width === 0 || height === 0) return;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (state.visibleNodes.length === 0) {
        ctx.restore();
        return;
      }

      ctx.translate(width / 2 + state.panX, height / 2 + state.panY);
      ctx.scale(scale, scale);

      const focus = focusNode();

      // Edges
      ctx.lineCap = 'round';
      for (const edge of state.activeEdges) {
        const touchesFocus = focus && (edge.source === focus || edge.target === focus);
        ctx.beginPath();
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);
        if (touchesFocus) {
          ctx.strokeStyle = theme.edgeHighlight;
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = 1.6 / scale;
        } else {
          ctx.strokeStyle = theme.edge;
          ctx.globalAlpha = focus ? DIM_ALPHA : 0.55;
          ctx.lineWidth = 1 / scale;
        }
        ctx.stroke();
      }

      // Nodes
      const occupied = [];
      for (const node of state.visibleNodes) {
        const inFocus = isInFocus(node, focus);
        const r = drawRadius(node);
        ctx.globalAlpha = inFocus ? (node.isOrphan && !focus ? 0.55 : 1) : DIM_ALPHA;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = node.colour;
        ctx.fill();

        if (node === focus) {
          ctx.lineWidth = 2 / scale;
          ctx.strokeStyle = theme.textMain;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 3 / scale, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (node === focus) {
          const pad = r + 4 / scale;
          occupied.push({ left: node.x - pad, right: node.x + pad, top: node.y - pad, bottom: node.y + pad });
        }
      }

      // Labels: drawn at a constant on-screen size.
      const fontSize = LABEL_FONT_PX / scale;
      ctx.font = `500 ${fontSize}px ${theme.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const budget = labelBudget();
      const zoom = scale / (state.fitScale || 1);
      const hasCore = state.activeEdges.length > 0;
      const candidates = [];
      if (focus) {
        candidates.push(focus);
        const neighbours = state.adjacency.get(focus.id) || new Set();
        for (const node of state.visibleNodes) {
          if (node !== focus && neighbours.has(node.id)) candidates.push(node);
        }
        candidates.sort((a, b) => (a === focus ? -1 : b === focus ? 1 : b.degree - a.degree));
      } else {
        for (const node of state.visibleNodes) {
          if (node.isOrphan && hasCore && zoom < 2.2) continue;
          if (state.labelRank.get(node) < budget) candidates.push(node);
        }
        candidates.sort((a, b) => state.labelRank.get(a) - state.labelRank.get(b));
      }

      const padX = 3 / scale;
      const padY = 2 / scale;
      for (const node of candidates) {
        const isFocus = node === focus;
        // The tooltip already shows the focused note's title
        if (isFocus && tooltipEl) continue;
        const label = node.title.length > 40 && !isFocus ? `${node.title.slice(0, 38)}…` : node.title;
        const labelY = node.y + drawRadius(node) + 4 / scale;
        const w = ctx.measureText(label).width;
        const box = {
          left: node.x - w / 2 - padX,
          right: node.x + w / 2 + padX,
          top: labelY - padY,
          bottom: labelY + fontSize + padY
        };
        if (!isFocus && occupied.some((o) => boxesOverlap(box, o))) continue;
        occupied.push(box);

        ctx.globalAlpha = isFocus ? 1 : 0.9;
        ctx.lineWidth = 3 / scale;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = theme.halo;
        ctx.strokeText(label, node.x, labelY);
        ctx.fillStyle = isFocus ? theme.textMain : theme.textSecondary;
        ctx.fillText(label, node.x, labelY);
      }

      ctx.restore();
      positionTooltip();
    }

    function requestRender() {
      if (state.rafId !== null) return;
      state.rafId = window.requestAnimationFrame((now) => {
        state.rafId = null;
        const running = stepAnimation(now);
        drawGraph();
        if (running) requestRender();
      });
    }

    // ---- Tooltip -----------------------------------------------------------

    function setSelected(node) {
      state.selectedNode = node;
      renderTooltip();
      requestRender();
    }

    function renderTooltip() {
      if (!tooltipEl) return;
      const node = focusNode();
      if (!node) {
        tooltipEl.hidden = true;
        return;
      }
      const pinned = node === state.selectedNode;
      const tags = node.tags.length
        ? `<span class="knowledge-graph-tooltip-tags">${node.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}</span>`
        : '';
      const links = node.degree === 1 ? '1 link' : `${node.degree} links`;
      tooltipEl.innerHTML =
        `<span class="knowledge-graph-tooltip-title">${escapeHtml(node.title)}</span>` +
        `<span class="knowledge-graph-tooltip-meta"><span class="knowledge-graph-legend-dot" style="background:${escapeHtml(node.colour)}"></span>${escapeHtml(node.collectionTitle)} · ${links}</span>` +
        tags +
        (pinned ? `<a class="knowledge-graph-tooltip-open" href="${escapeHtml(node.url)}">Open note →</a>` : '');
      tooltipEl.classList.toggle('is-pinned', pinned);
      tooltipEl.hidden = false;
      positionTooltip();
    }

    function positionTooltip() {
      if (!tooltipEl || tooltipEl.hidden) return;
      const node = focusNode();
      if (!node) return;
      const p = worldToScreen(node.x, node.y);
      const r = drawRadius(node) * state.scale;
      const tw = tooltipEl.offsetWidth;
      const th = tooltipEl.offsetHeight;
      let left = p.x - tw / 2;
      let top = p.y - r - th - 10;
      if (top < 6) top = p.y + r + 26;
      left = Math.max(6, Math.min(state.width - tw - 6, left));
      top = Math.max(6, Math.min(state.height - th - 6, top));
      tooltipEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    function showHint() {
      if (!hintEl) return;
      hintEl.textContent = isMac ? 'Hold ⌘ and scroll to zoom' : 'Hold Ctrl and scroll to zoom';
      hintEl.classList.add('visible');
      window.clearTimeout(state.hintTimer);
      state.hintTimer = window.setTimeout(() => hintEl.classList.remove('visible'), 1400);
    }

    // ---- Sizing & fullscreen ----------------------------------------------

    function resizeCanvas() {
      const rect = viewport.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const changed = width !== state.width || height !== state.height;
      state.width = width;
      state.height = height;
      state.dpr = window.devicePixelRatio || 1;
      canvas.width = width * state.dpr;
      canvas.height = height * state.dpr;
      const aspect = currentAspect();
      if (state.layoutAspect && Math.abs(aspect / state.layoutAspect - 1) > 0.15) {
        cancelAnimation();
        state.layoutAspect = aspect;
        layoutGraph(state.visibleNodes, state.activeEdges, aspect);
        fitToView(false);
      } else if (changed && !state.userMovedCamera && !state.animation) {
        fitToView(false);
      } else {
        requestRender();
      }
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
      state.userMovedCamera = false;
      resizeCanvas();
      fitToView(false);
    }

    // ---- Mouse -------------------------------------------------------------

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      cancelAnimation();
      const p = screenPoint(e.clientX, e.clientY);
      state.pointerDownNode = findNodeAt(p.x, p.y, 4);
      state.pointerStartX = e.clientX;
      state.pointerStartY = e.clientY;
      state.lastPointerX = e.clientX;
      state.lastPointerY = e.clientY;
      state.didDrag = false;
      state.isPanning = true;
      canvas.classList.add('is-panning');
    });

    window.addEventListener('mousemove', (e) => {
      if (state.isPanning) {
        if (Math.hypot(e.clientX - state.pointerStartX, e.clientY - state.pointerStartY) > DRAG_THRESHOLD_PX) {
          state.didDrag = true;
        }
        if (state.didDrag) {
          state.panX += e.clientX - state.lastPointerX;
          state.panY += e.clientY - state.lastPointerY;
          state.userMovedCamera = true;
          requestRender();
        }
        state.lastPointerX = e.clientX;
        state.lastPointerY = e.clientY;
        return;
      }
      // Ignore the compatibility mouse events browsers send right after touch
      if (e.target !== canvas || performance.now() - state.lastTouchTime < 800) return;
      const p = screenPoint(e.clientX, e.clientY);
      const hit = findNodeAt(p.x, p.y, 4);
      if (hit !== state.hoveredNode) {
        state.hoveredNode = hit;
        canvas.classList.toggle('is-over-node', Boolean(hit));
        renderTooltip();
        requestRender();
      }
    });

    window.addEventListener('mouseup', () => {
      if (!state.isPanning) return;
      state.isPanning = false;
      canvas.classList.remove('is-panning');
      if (!state.didDrag) {
        const node = state.pointerDownNode;
        if (node && node.url) {
          window.location.href = node.url;
          return;
        }
        if (state.selectedNode) setSelected(null);
      }
      state.pointerDownNode = null;
    });

    canvas.addEventListener('mouseleave', () => {
      if (state.hoveredNode) {
        state.hoveredNode = null;
        canvas.classList.remove('is-over-node');
        renderTooltip();
        requestRender();
      }
    });

    canvas.addEventListener('dblclick', (e) => {
      const p = screenPoint(e.clientX, e.clientY);
      if (!findNodeAt(p.x, p.y, 4)) fitToView(true);
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        // Embedded in the page, a plain wheel scrolls the page. Pinch on a
        // trackpad arrives as ctrlKey + wheel, so it still zooms.
        const wantsZoom = state.isFullscreen || e.ctrlKey || e.metaKey;
        if (!wantsZoom) {
          showHint();
          return;
        }
        e.preventDefault();
        const p = screenPoint(e.clientX, e.clientY);
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        // Trackpad pinches send small pixel deltas; mouse wheels send large ones
        const isPinch = e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaY) < 50;
        applyZoomAt(Math.exp(-delta * (isPinch ? 0.01 : 0.0015)), p.x, p.y);
      },
      { passive: false }
    );

    // ---- Touch -------------------------------------------------------------
    // Embedded: one finger scrolls the page, tap selects, two fingers pan/zoom.
    // Fullscreen: one finger pans as well.

    function touchMidpoint(touches) {
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
        dist: Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
      };
    }

    canvas.addEventListener(
      'touchstart',
      (e) => {
        state.lastTouchTime = performance.now();
        cancelAnimation();
        if (e.touches.length === 1) {
          const t = e.touches[0];
          state.pointerStartX = t.clientX;
          state.pointerStartY = t.clientY;
          state.lastPointerX = t.clientX;
          state.lastPointerY = t.clientY;
          state.didDrag = false;
          state.isPanning = state.isFullscreen;
          state.pinch = null;
        } else if (e.touches.length === 2) {
          e.preventDefault();
          state.isPanning = false;
          state.didDrag = true;
          const m = touchMidpoint(e.touches);
          state.pinch = { lastX: m.x, lastY: m.y, lastDist: m.dist };
        }
      },
      { passive: false }
    );

    canvas.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length === 2 && state.pinch) {
          e.preventDefault();
          const m = touchMidpoint(e.touches);
          state.panX += m.x - state.pinch.lastX;
          state.panY += m.y - state.pinch.lastY;
          const p = screenPoint(m.x, m.y);
          applyZoomAt(m.dist / (state.pinch.lastDist || m.dist), p.x, p.y);
          state.pinch = { lastX: m.x, lastY: m.y, lastDist: m.dist };
          return;
        }
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        if (Math.hypot(t.clientX - state.pointerStartX, t.clientY - state.pointerStartY) > DRAG_THRESHOLD_PX) {
          state.didDrag = true;
        }
        if (state.isPanning) {
          e.preventDefault();
          state.panX += t.clientX - state.lastPointerX;
          state.panY += t.clientY - state.lastPointerY;
          state.userMovedCamera = true;
          requestRender();
        }
        state.lastPointerX = t.clientX;
        state.lastPointerY = t.clientY;
      },
      { passive: false }
    );

    canvas.addEventListener('touchend', (e) => {
      state.lastTouchTime = performance.now();
      if (e.touches.length === 1) {
        // Pinch ended with one finger still down: carry on panning in fullscreen
        state.pinch = null;
        state.isPanning = state.isFullscreen;
        state.lastPointerX = e.touches[0].clientX;
        state.lastPointerY = e.touches[0].clientY;
        return;
      }
      if (e.touches.length > 0) return;
      const wasTap = !state.didDrag && !state.pinch;
      state.isPanning = false;
      state.pinch = null;
      if (!wasTap) return;
      e.preventDefault(); // suppress the synthetic mouse events
      const p = screenPoint(state.pointerStartX, state.pointerStartY);
      const node = findNodeAt(p.x, p.y, 12);
      if (node && node === state.selectedNode && node.url) {
        window.location.href = node.url;
        return;
      }
      state.hoveredNode = null;
      setSelected(node);
    });

    canvas.addEventListener('touchcancel', () => {
      state.isPanning = false;
      state.pinch = null;
    });

    // ---- Controls ----------------------------------------------------------

    if (expandBtn) expandBtn.addEventListener('click', () => setFullscreen(!state.isFullscreen));
    if (fitBtn) fitBtn.addEventListener('click', () => fitToView(true));
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => zoomByButton(1.4));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomByButton(1 / 1.4));

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (state.selectedNode) {
        setSelected(null);
      } else if (state.isFullscreen) {
        setFullscreen(false);
      }
    });

    window.addEventListener('spin:tags-change', (e) => {
      const tags = e.detail && Array.isArray(e.detail.activeTags) ? e.detail.activeTags : [];
      updateFilterState(tags, true);
    });

    if ('ResizeObserver' in window) {
      new ResizeObserver(() => resizeCanvas()).observe(viewport);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }

    resizeCanvas();
    updateFilterState(readInitialActiveTags(), false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKnowledgeGraph);
  } else {
    initKnowledgeGraph();
  }
})();
