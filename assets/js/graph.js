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
  const DRAG_THRESHOLD_PX = 4;
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 4.0;
  const MIN_NODE_RADIUS = 4;
  const MAX_NODE_RADIUS = 16;
  const MAX_RADIUS_DEGREE = 100;

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
        const title = String(n.title || id);
        const angle = index * GOLDEN_ANGLE;
        const radiusDist = 65 * Math.sqrt(index);

        const node = {
          id,
          title,
          url: String(n.url || id),
          collection,
          collectionTitle,
          colour: resolveCollectionColour(collection),
          tags,
          x: Math.cos(angle) * radiusDist,
          y: Math.sin(angle) * radiusDist,
          vx: 0,
          vy: 0,
          degree: 0,
          mass: 1,
          radius: MIN_NODE_RADIUS,
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
    const fraction = Math.min(1, Math.max(0, degree / MAX_RADIUS_DEGREE));
    return MIN_NODE_RADIUS + fraction * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
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
    canvas.style.cursor = 'grab';

    const state = {
      width: 0,
      height: 0,
      dpr: window.devicePixelRatio || 1,
      panX: 0,
      panY: 0,
      scale: 1,
      alpha: 0,
      rafId: null,
      visibleNodes: [],
      activeEdges: [],
      adjacency: new Map(),
      hoveredNode: null,
      clickedNode: null,
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

    function computeStaticLayout(iterations) {
      state.alpha = 1;
      const decay = Math.pow(0.015, 1 / iterations);
      for (let i = 0; i < iterations; i += 1) {
        stepPhysics();
        state.alpha *= decay;
      }
      state.alpha = 0;
    }

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
        node.mass = 1 + node.degree;
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
      computeStaticLayout(180);
      drawGraph();
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

    function resolveCollisions(visible, count) {
      for (let i = 0; i < count; i += 1) {
        const a = visible[i];
        for (let j = i + 1; j < count; j += 1) {
          const b = visible[j];
          const minDist = a.radius + b.radius + 54;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          if (Math.abs(dx) >= minDist || Math.abs(dy) >= minDist) continue;

          if (dx === 0 && dy === 0) {
            dx = (i % 2 === 0 ? 1 : -1) * 0.5;
            dy = (j % 2 === 0 ? 1 : -1) * 0.5;
          }

          const distSq = dx * dx + dy * dy;
          if (distSq >= minDist * minDist) continue;

          const dist = Math.sqrt(distSq) || 0.1;
          const overlap = (minDist - dist) * 0.5;
          const px = (dx / dist) * overlap;
          const py = (dy / dist) * overlap;

          const totalMass = a.mass + b.mass;
          const aShare = b.mass / totalMass;
          const bShare = a.mass / totalMass;
          a.x -= px * aShare;
          a.y -= py * aShare;
          b.x += px * bShare;
          b.y += py * bShare;
        }
      }
    }

    function stepPhysics() {
      const visible = state.visibleNodes;
      const count = visible.length;
      if (count === 0) return;

      const alpha = state.alpha;
      const repulsionStrength = 42000;
      const maxRepulsionDist = 520;
      const maxRepulsionDistSq = maxRepulsionDist * maxRepulsionDist;
      const springStrength = 0.28;

      // 1. Distance-limited repulsion weighted by node mass (Newton's 2nd law)
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
          const rawDistSq = dx * dx + dy * dy;
          if (rawDistSq >= maxRepulsionDistSq) continue;

          const distSq = Math.max(400, rawDistSq);
          const dist = Math.sqrt(distSq);
          const falloff = 1 - dist / maxRepulsionDist;
          const force = (repulsionStrength * alpha * falloff) / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          a.vx -= fx / a.mass;
          a.vy -= fy / a.mass;
          b.vx += fx / b.mass;
          b.vy += fy / b.mass;
        }
      }

      // 2. Barycentric edge attraction (pulls every node toward the centroid of its neighbours)
      for (const edge of state.activeEdges) {
        const u = edge.source;
        const v = edge.target;
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const k = springStrength * alpha;
        const fx = dx * k;
        const fy = dy * k;

        u.vx += fx / u.mass;
        u.vy += fy / u.mass;
        v.vx -= fx / v.mass;
        v.vy -= fy / v.mass;
      }

      // 3. Gentle gravity, integration, and centre-of-mass stabilisation
      let cx = 0;
      let cy = 0;

      for (let i = 0; i < count; i += 1) {
        const node = visible[i];
        const gravityStrength = node.degree === 0 ? 0.01 : 0.002;
        node.vx -= node.x * gravityStrength * alpha;
        node.vy -= node.y * gravityStrength * alpha;

        node.vx *= 0.65;
        node.vy *= 0.65;

        node.x += node.vx;
        node.y += node.vy;

        cx += node.x;
        cy += node.y;
      }

      if (count > 0) {
        cx /= count;
        cy /= count;
        for (let i = 0; i < count; i += 1) {
          visible[i].x -= cx;
          visible[i].y -= cy;
        }
      }

      // 4. Mass-weighted circular anti-overlap after initial topological crossing phase
      if (alpha < 0.6) {
        resolveCollisions(visible, count);
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

      // Draw nodes and record circle bounding boxes for active/focused nodes
      const occupiedBoxes = [];
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

        if (isFocus) {
          const rPad = node.radius + 2 / scale;
          occupiedBoxes.push({
            left: node.x - rPad,
            right: node.x + rPad,
            top: node.y - rPad,
            bottom: node.y + rPad
          });
        }
      }

      // Draw labels with priority ordering and strict bounding-box collision culling
      const fontSize = Math.max(9, Math.min(13, 11 / Math.pow(scale, 0.25)));
      ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const labelCandidates = state.visibleNodes.slice().sort((a, b) => {
        if (hoveredNode) {
          if (a.id === hoveredNode.id) return -1;
          if (b.id === hoveredNode.id) return 1;
          const aN = isNeighbourOfHovered(a);
          const bN = isNeighbourOfHovered(b);
          if (aN !== bN) return aN ? -1 : 1;
        }
        if (b.degree !== a.degree) return b.degree - a.degree;
        return a.title.localeCompare(b.title);
      });

      const padX = 4 / scale;
      const padY = 2 / scale;

      for (const node of labelCandidates) {
        const isHoveredSelf = Boolean(hoveredNode && node.id === hoveredNode.id);
        let shouldShowLabel = false;
        let labelAlpha = 0.88;

        if (hoveredNode) {
          if (isNeighbourOfHovered(node)) {
            shouldShowLabel = true;
            labelAlpha = isHoveredSelf ? 1 : 0.92;
          }
        } else if (scale >= 0.35) {
          shouldShowLabel = true;
          labelAlpha = Math.min(0.92, Math.max(0.6, (scale - 0.25) * 0.9));
        }

        if (!shouldShowLabel) continue;

        const labelText = isHoveredSelf && node.degree > 0 ? `${node.title} (${node.degree})` : node.title;
        const labelY = node.y + node.radius + 4 / scale;
        const measuredWidth = ctx.measureText(labelText).width;
        const labelBox = {
          left: node.x - measuredWidth / 2 - padX,
          right: node.x + measuredWidth / 2 + padX,
          top: labelY - padY,
          bottom: labelY + fontSize + padY
        };

        if (!isHoveredSelf) {
          let collides = false;
          for (let i = 0; i < occupiedBoxes.length; i += 1) {
            if (boxesOverlap(labelBox, occupiedBoxes[i])) {
              collides = true;
              break;
            }
          }
          if (collides) continue;
        }

        occupiedBoxes.push(labelBox);

        ctx.globalAlpha = labelAlpha;
        ctx.lineWidth = 3 / scale;
        ctx.strokeStyle = 'rgba(24, 24, 37, 0.85)';
        ctx.strokeText(labelText, node.x, labelY);

        ctx.fillStyle = isHoveredSelf ? THEME.textMain : THEME.textSecondary;
        ctx.fillText(labelText, node.x, labelY);
      }

      ctx.restore();
    }

    function requestRender() {
      if (state.rafId === null) {
        state.rafId = window.requestAnimationFrame(() => {
          state.rafId = null;
          drawGraph();
        });
      }
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
    }

    // Mouse Events: Pan, Zoom, Hover & Click-Navigation
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const world = screenToWorld(e.clientX, e.clientY);
      state.clickedNode = findNodeAt(world.x, world.y);

      state.pointerStartX = e.clientX;
      state.pointerStartY = e.clientY;
      state.lastPointerX = e.clientX;
      state.lastPointerY = e.clientY;
      state.didDrag = false;
      state.isPanning = true;
      canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (state.isPanning) {
        const moveDist = Math.hypot(
          e.clientX - state.pointerStartX,
          e.clientY - state.pointerStartY
        );
        if (moveDist > DRAG_THRESHOLD_PX) {
          state.didDrag = true;
          if (state.hoveredNode) {
            state.hoveredNode = null;
          }
        }
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
      if (state.isPanning) {
        state.isPanning = false;
        canvas.style.cursor = state.hoveredNode ? 'pointer' : 'grab';

        if (!state.didDrag && state.clickedNode && state.clickedNode.url) {
          window.location.href = state.clickedNode.url;
          return;
        }
        state.clickedNode = null;
      }
    });

    canvas.addEventListener('mouseleave', () => {
      if (state.hoveredNode) {
        state.hoveredNode = null;
        if (!state.isPanning) {
          canvas.style.cursor = 'grab';
        }
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

    // Touch Events: 1-finger Pan & Tap, 2-finger Pinch Zoom
    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          const world = screenToWorld(touch.clientX, touch.clientY);
          state.clickedNode = findNodeAt(world.x, world.y);
          state.pointerStartX = touch.clientX;
          state.pointerStartY = touch.clientY;
          state.lastPointerX = touch.clientX;
          state.lastPointerY = touch.clientY;
          state.didDrag = false;
          state.isPanning = true;

          if (state.clickedNode) {
            state.hoveredNode = state.clickedNode;
            requestRender();
          }
        } else if (e.touches.length === 2) {
          state.isPanning = false;
          state.clickedNode = null;
          state.hoveredNode = null;
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
        if (e.touches.length === 1 && state.isPanning) {
          e.preventDefault();
          const touch = e.touches[0];
          const moveDist = Math.hypot(
            touch.clientX - state.pointerStartX,
            touch.clientY - state.pointerStartY
          );
          if (moveDist > DRAG_THRESHOLD_PX) {
            state.didDrag = true;
            if (state.hoveredNode) {
              state.hoveredNode = null;
            }
          }
          state.panX += touch.clientX - state.lastPointerX;
          state.panY += touch.clientY - state.lastPointerY;
          state.lastPointerX = touch.clientX;
          state.lastPointerY = touch.clientY;
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
      if (!state.didDrag && state.clickedNode && state.clickedNode.url) {
        window.location.href = state.clickedNode.url;
        return;
      }
      state.isPanning = false;
      state.clickedNode = null;
      state.pinchStartDist = null;
      requestRender();
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
