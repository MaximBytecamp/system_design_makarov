/* Рабочий стол практикума «Архитектор по заявке».

   1. Состояние и сохранение      5. Письма: схема, данные, изменения
   2. Рисование схемы (SVG)       6. Отчёт и выгрузка
   3. Мышь: перенос, связи        7. Запуск
   4. Палитра и свойства узла

   Работа студента хранится в localStorage этого браузера, отдельно по каждой
   заявке. Стереть её можно кнопкой «Начать заново» на вкладке «Отчёт». */
(() => {
  const { GROUPS, COMPONENTS, byId, groupById, defaults, CASES, COMMON, engine } = window.SD;
  const NODE_W = 200, NODE_H = 64, CANVAS_W = 1800, CANVAS_H = 1100;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const catalog = { byId, defaults };

  /* ── 1. Состояние и сохранение ──────────────────────────────── */
  const params = new URLSearchParams(location.search);
  const theCase = CASES.find(c => c.id === params.get('case'));
  const KEY = id => `sd-stol-v1-${id}`;

  const blank = () => ({
    nodes: [], edges: [], seq: 1,
    open: 1,                 // сколько писем открыто
    passed: {},              // { 1: true, 2: true, 3: true }
    checks: {},              // результаты последней проверки этапа и отпечаток схемы
    assign: {},              // сущность → [типы хранилищ]
    notes: { 1: '', 2: '', 3: '' },
  });

  const load = id => {
    try {
      const raw = localStorage.getItem(KEY(id));
      if (raw) return Object.assign(blank(), JSON.parse(raw));
    } catch (_) { /* приватный режим или повреждённые данные */ }
    return blank();
  };
  const loadStudent = () => {
    try { return JSON.parse(localStorage.getItem('sd-stol-student')) || { name: '', group: '' }; } catch (_) { return { name: '', group: '' }; }
  };

  let state = theCase ? load(theCase.id) : null;
  let student = loadStudent();
  let selected = null;       // { kind: 'node' | 'edge', id }
  let marks = { nodes: [], edges: [] };
  let tab = 1;
  const undo = [];

  const save = () => {
    if (!theCase) return;
    try { localStorage.setItem(KEY(theCase.id), JSON.stringify(state)); } catch (_) { /* место кончилось — работа живёт до закрытия вкладки */ }
  };
  const saveStudent = () => { try { localStorage.setItem('sd-stol-student', JSON.stringify(student)); } catch (_) { } };

  /* Перед каждым изменением схемы — снимок для отмены. */
  const remember = () => {
    undo.push(JSON.stringify({ nodes: state.nodes, edges: state.edges, seq: state.seq }));
    if (undo.length > 60) undo.shift();
  };
  const fingerprint = () => JSON.stringify([
    state.nodes.map(n => [n.id, n.type, n.settings]),
    state.edges.map(e => [e.from, e.to]),
  ]);

  const node = id => state.nodes.find(n => n.id === id);
  const label = n => n.label || byId[n.type].name;

  /* ── 2. Рисование схемы ──────────────────────────────────────── */
  const WINDOW_SHORT = { sec: 'в секунду', min: 'в минуту', hour: 'в час', day: 'в сутки' };
  const optLabel = (type, key, value) => {
    const s = (byId[type].settings || []).find(x => x.key === key);
    const o = s && s.options && s.options.find(x => x[0] === value);
    return o ? o[1] : value;
  };

  /* Строка настроек под названием узла. */
  const summary = n => {
    const s = Object.assign(defaults(n.type), n.settings);
    switch (n.type) {
      case 'app': case 'auth': case 'worker':
        return +s.instances > 1 ? `экземпляров: ${s.instances}` : '1 экземпляр';
      case 'lb': return optLabel('lb', 'algo', s.algo);
      case 'gateway': return s.auth === 'none' ? 'доступ не проверяет' : `проверяет: ${optLabel('gateway', 'auth', s.auth)}`;
      case 'ratelimit': return `${optLabel('ratelimit', 'key', s.key)} · ${s.limit} ${WINDOW_SHORT[s.window]}`;
      case 'postgres': return [`реплик: ${s.replicas}`, s.encrypt === 'да' ? 'шифрование' : ''].filter(Boolean).join(' · ');
      case 'mongo': return [`узлов: ${s.replicas}`, s.encrypt === 'да' ? 'шифрование' : ''].filter(Boolean).join(' · ');
      case 'redis': return s.roles.length ? s.roles.map(r => optLabel('redis', 'roles', r)).join(', ') : 'роль не выбрана';
      case 's3': return s.encrypt === 'да' ? 'шифрование' : byId.s3.short;
      default: return byId[n.type].short;
    }
  };

  /* Стрелка выходит из той стороны узла, которая смотрит на цель:
     цель правее — справа налево, левее — слева направо,
     прямо над или под узлом — через верх и низ. */
  const edgePath = (a, b) => {
    const H = NODE_H / 2;
    if (b.x >= a.x + NODE_W + 20) {
      const x1 = a.x + NODE_W, y1 = a.y + H, x2 = b.x - 2, y2 = b.y + H, dx = Math.max(40, (x2 - x1) / 2);
      return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    }
    if (b.x + NODE_W + 20 <= a.x) {
      const x1 = a.x, y1 = a.y + H, x2 = b.x + NODE_W + 2, y2 = b.y + H, dx = Math.max(40, (x1 - x2) / 2);
      return `M${x1},${y1} C${x1 - dx},${y1} ${x2 + dx},${y2} ${x2},${y2}`;
    }
    const down = b.y > a.y;
    const x1 = a.x + NODE_W / 2, y1 = down ? a.y + NODE_H : a.y;
    const x2 = b.x + NODE_W / 2, y2 = down ? b.y - 2 : b.y + NODE_H + 2;
    const dy = Math.max(30, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
  };

  /* Подгонка подписи под ширину узла: измеряем шрифтом, которым она нарисована. */
  const measure = document.createElement('canvas').getContext('2d');
  const fit = (text, font, width) => {
    measure.font = font;
    if (measure.measureText(text).width <= width) return text;
    let t = text;
    while (t.length > 1 && measure.measureText(t + '…').width > width) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  };

  /* Разметка схемы. С forExport — без интерактивных частей, с белым фоном
     и рамкой по содержимому: так её можно вставить в отчёт. */
  const schemeMarkup = forExport => {
    const font = "Inter, 'Segoe UI', Arial, sans-serif", mono = "'Roboto Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";
    const room = NODE_W - 26;
    let box = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    if (forExport && state.nodes.length) {
      const xs = state.nodes.map(n => n.x), ys = state.nodes.map(n => n.y);
      const x = Math.min(...xs) - 60, y = Math.min(...ys) - 80;
      box = { x, y, w: Math.max(...xs) + NODE_W + 60 - x, h: Math.max(...ys) + NODE_H + 60 - y };
    }
    const parts = [];
    parts.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#13202B"/></marker>`
      + `<marker id="arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#B8461B"/></marker>`
      + `<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.2" fill="#C8D2D9"/></pattern></defs>`);
    if (forExport) {
      parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#ffffff"/>`);
      parts.push(`<text x="${box.x + 40}" y="${box.y + 34}" font-family="${font}" font-size="18" font-weight="700" fill="#13202B">${esc(`«${theCase.company}» — схема системы`)}</text>`);
    } else {
      parts.push(`<rect class="bg" width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#dots)"/>`);
    }

    parts.push('<g class="edges">');
    state.edges.forEach(e => {
      const a = node(e.from), b = node(e.to);
      if (!a || !b) return;
      const bad = !forExport && marks.edges.includes(e.id);
      const sel = !forExport && selected && selected.kind === 'edge' && selected.id === e.id;
      const d = edgePath(a, b);
      parts.push(`<g class="edge${bad ? ' is-bad' : ''}${sel ? ' is-sel' : ''}" data-edge="${e.id}">`
        + (forExport ? '' : `<path class="edge__hit" d="${d}"/>`)
        + `<path class="edge__line" d="${d}" fill="none" stroke="${bad ? '#B8461B' : '#13202B'}" stroke-width="2" marker-end="url(#${bad ? 'arrow-bad' : 'arrow'})"/></g>`);
    });
    parts.push('</g><path class="ghost" d="" pointer-events="none" fill="none" stroke="#0B6E8A" stroke-width="2.5" stroke-dasharray="6 5" marker-end="url(#arrow)"/>');

    parts.push('<g class="nodes">');
    state.nodes.forEach(n => {
      const comp = byId[n.type], group = groupById[comp.group];
      const bad = !forExport && marks.nodes.includes(n.id);
      const sel = !forExport && selected && selected.kind === 'node' && selected.id === n.id;
      parts.push(`<g class="node${bad ? ' is-bad' : ''}${sel ? ' is-sel' : ''}" data-node="${n.id}" transform="translate(${n.x},${n.y})">`
        + `<rect class="node__box" width="${NODE_W}" height="${NODE_H}" rx="3" fill="#ffffff" stroke="#13202B" stroke-width="2"/>`
        + `<rect x="1" y="1" width="8" height="${NODE_H - 2}" fill="${group.color}"/>`
        + `<text x="18" y="18" font-family="${mono}" font-size="9.5" font-weight="700" letter-spacing=".6" fill="${group.color}">${esc(fit(comp.name.toUpperCase(), `700 9.5px ${mono}`, room - 10))}</text>`
        + `<text x="18" y="37" font-family="${font}" font-size="14" font-weight="700" fill="#13202B">${esc(fit(label(n), `700 14px ${font}`, room))}</text>`
        + `<text x="18" y="54" font-family="${font}" font-size="11" fill="#3E5162">${esc(fit(summary(n), `400 11px ${font}`, room))}</text>`
        + (forExport ? '' : `<circle class="port port--in" cx="0" cy="${NODE_H / 2}" r="5" fill="#ffffff" stroke="#13202B" stroke-width="2"/>`
          + `<circle class="port port--out" data-port="${n.id}" cx="${NODE_W}" cy="${NODE_H / 2}" r="7" fill="#ffffff" stroke="#13202B" stroke-width="2"><title>Потяните, чтобы провести стрелку</title></circle>`)
        + '</g>');
    });
    parts.push('</g>');

    return { box, inner: parts.join('') };
  };

  let svg = null;
  let zoom = 1;
  const ZOOMS = [0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3];
  const applyZoom = () => {
    if (!svg) return;
    svg.setAttribute('width', Math.round(CANVAS_W * zoom));
    svg.setAttribute('height', Math.round(CANVAS_H * zoom));
    const z = $('#tb-zoom');
    if (z) z.textContent = `${Math.round(zoom * 100)} %`;
  };
  const stepZoom = dir => {
    const i = ZOOMS.findIndex(v => v >= zoom - 1e-6);
    zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + dir))];
    applyZoom();
  };
  /* Вписать всю схему в видимую часть доски. */
  const fitZoom = () => {
    const holder = $('#canvas');
    if (!state.nodes.length) { zoom = 1; applyZoom(); return; }
    const xs = state.nodes.map(n => n.x), ys = state.nodes.map(n => n.y);
    const w = Math.max(...xs) + NODE_W + 40, h = Math.max(...ys) + NODE_H + 40;
    const want = Math.min(holder.clientWidth / w, holder.clientHeight / h, 1);
    zoom = [...ZOOMS].reverse().find(v => v <= want) || ZOOMS[0];
    applyZoom();
    holder.scrollTo(0, 0);
  };
  const drawScheme = () => {
    const holder = $('#canvas');
    if (!holder) return;
    const { inner } = schemeMarkup(false);
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg');
      applyZoom();
      svg.setAttribute('viewBox', `0 0 ${CANVAS_W} ${CANVAS_H}`);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Схема системы');
      holder.appendChild(svg);
      bindCanvas();
    }
    svg.innerHTML = inner;
    $('#empty').hidden = state.nodes.length > 0;
  };

  /* ── 3. Мышь: перенос узлов и проведение стрелок ────────────── */
  const point = event => {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX; pt.y = event.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  let drag = null;   // { kind: 'move', id, dx, dy, moved } | { kind: 'link', from }

  const bindCanvas = () => {
    svg.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const port = event.target.closest('[data-port]');
      const g = event.target.closest('[data-node]');
      const edge = event.target.closest('[data-edge]');
      if (port) {
        drag = { kind: 'link', from: port.dataset.port };
        svg.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      if (g) {
        const n = node(g.dataset.node), p = point(event);
        drag = { kind: 'move', id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false };
        select({ kind: 'node', id: n.id });
        svg.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      if (edge) { select({ kind: 'edge', id: edge.dataset.edge }); return; }
      select(null);
    });

    svg.addEventListener('pointermove', event => {
      if (!drag) return;
      const p = point(event);
      if (drag.kind === 'move') {
        const n = node(drag.id);
        if (!drag.moved) { remember(); drag.moved = true; }
        n.x = Math.round(Math.max(0, Math.min(CANVAS_W - NODE_W, p.x - drag.dx)));
        n.y = Math.round(Math.max(0, Math.min(CANVAS_H - NODE_H, p.y - drag.dy)));
        const g = svg.querySelector(`[data-node="${n.id}"]`);
        g.setAttribute('transform', `translate(${n.x},${n.y})`);
        g.classList.add('is-drag');
        state.edges.forEach(e => {
          if (e.from !== n.id && e.to !== n.id) return;
          const d = edgePath(node(e.from), node(e.to));
          svg.querySelectorAll(`[data-edge="${e.id}"] path`).forEach(path => path.setAttribute('d', d));
        });
      } else {
        const a = node(drag.from);
        const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, dx = Math.max(50, Math.abs(p.x - x1) / 2);
        svg.querySelector('.ghost').setAttribute('d', `M${x1},${y1} C${x1 + dx},${y1} ${p.x - dx},${p.y} ${p.x},${p.y}`);
        svg.querySelectorAll('.node.is-target').forEach(el => el.classList.remove('is-target'));
        const over = document.elementFromPoint(event.clientX, event.clientY);
        const g = over && over.closest && over.closest('[data-node]');
        if (g && g.dataset.node !== drag.from) g.classList.add('is-target');
      }
    });

    const finish = event => {
      if (!drag) return;
      const was = drag;
      drag = null;
      if (was.kind === 'move') {
        if (was.moved) save();
        drawScheme();
        return;
      }
      const over = document.elementFromPoint(event.clientX, event.clientY);
      const g = over && over.closest && over.closest('[data-node]');
      if (g) addEdge(was.from, g.dataset.node);
      else drawScheme();
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', () => { drag = null; drawScheme(); });

    /* Деталь, перетащенная с палитры. */
    const holder = $('#canvas');
    holder.addEventListener('dragover', event => {
      if (!event.dataTransfer.types.includes('text/sd-part')) return;
      event.preventDefault();
      holder.classList.add('is-drop');
    });
    holder.addEventListener('dragleave', () => holder.classList.remove('is-drop'));
    holder.addEventListener('drop', event => {
      holder.classList.remove('is-drop');
      const type = event.dataTransfer.getData('text/sd-part');
      if (!byId[type]) return;
      event.preventDefault();
      const p = point(event);
      addNode(type, p.x - NODE_W / 2, p.y - NODE_H / 2);
    });
  };

  const addNode = (type, x, y) => {
    remember();
    if (x == null) {
      // Без указанного места — первая свободная клетка в видимой части доски:
      // клетки идут слева направо, сверху вниз, узлы не ложатся друг на друга.
      const holder = $('#canvas');
      const free = (cx, cy) => state.nodes.every(n => Math.abs(n.x - cx) >= NODE_W + 20 || Math.abs(n.y - cy) >= NODE_H + 20);
      const cols = Math.max(1, Math.floor((holder.clientWidth - 40) / (NODE_W + 40)));
      x = holder.scrollLeft + 40; y = holder.scrollTop + 40;
      for (let i = 0; i < 400; i++) {
        const cx = holder.scrollLeft + 40 + (i % cols) * (NODE_W + 40);
        const cy = holder.scrollTop + 40 + Math.floor(i / cols) * (NODE_H + 40);
        if (cy > CANVAS_H - NODE_H) break;
        if (free(cx, cy)) { x = cx; y = cy; break; }
      }
    }
    const n = {
      id: 'n' + state.seq++, type, label: '',
      x: Math.round(Math.max(0, Math.min(CANVAS_W - NODE_W, x))),
      y: Math.round(Math.max(0, Math.min(CANVAS_H - NODE_H, y))),
      settings: defaults(type),
    };
    state.nodes.push(n);
    save();
    select({ kind: 'node', id: n.id }, true);
    refreshStores();
  };

  const addEdge = (from, to) => {
    if (from === to) { drawScheme(); return; }
    if (state.edges.some(e => e.from === from && e.to === to)) { drawScheme(); return; }
    remember();
    const back = state.edges.find(e => e.from === to && e.to === from);
    if (back) state.edges = state.edges.filter(e => e !== back);   // встречная стрелка заменяется новой
    const e = { id: 'e' + state.seq++, from, to };
    state.edges.push(e);
    save();
    select({ kind: 'edge', id: e.id });
  };

  const removeSelected = () => {
    if (!selected) return;
    remember();
    if (selected.kind === 'node') {
      state.nodes = state.nodes.filter(n => n.id !== selected.id);
      state.edges = state.edges.filter(e => e.from !== selected.id && e.to !== selected.id);
    } else {
      state.edges = state.edges.filter(e => e.id !== selected.id);
    }
    save();
    select(null);
    refreshStores();
  };

  /* keepTab — не переключать правую панель на «Свойства»: так после добавления
     детали с палитры можно сразу добавить следующую. */
  const select = (what, keepTab) => {
    selected = what;
    drawScheme();
    drawProps(keepTab);
  };

  document.addEventListener('keydown', event => {
    if (!theCase) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (typing) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault();
      removeSelected();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      doUndo();
    }
    if (event.key === 'Escape') select(null);
  });

  const doUndo = () => {
    const last = undo.pop();
    if (!last) return;
    Object.assign(state, JSON.parse(last));
    save();
    selected = null;
    drawScheme();
    drawProps();
    refreshStores();
  };

  /* ── 4. Палитра и свойства узла ──────────────────────────────── */
  let partsTab = 'palette';

  const drawParts = () => {
    $('#parts-tabs').innerHTML = [['palette', 'Детали'], ['props', 'Свойства']]
      .map(([id, name]) => `<button type="button" role="tab" data-ptab="${id}" aria-selected="${partsTab === id}">${name}</button>`).join('');
    $('#palette').hidden = partsTab !== 'palette';
    $('#props').hidden = partsTab !== 'props';
  };

  const drawPalette = () => {
    $('#palette').innerHTML = '<p class="palette__tip">Нажмите на деталь или перетащите её на схему. Стрелку проводят от правого кружка узла к другому узлу.</p>'
      + GROUPS.map(g => `<h3><i style="background:${g.color}"></i>${g.name}</h3>`
        + COMPONENTS.filter(c => c.group === g.id).map(c =>
          `<button type="button" class="part" draggable="true" data-part="${c.id}" title="${esc(c.what)}">`
          + `<i style="background:${g.color}"></i><span><b>${esc(c.name)}</b><small>${esc(c.short)}</small></span></button>`).join('')).join('');
  };

  const fieldFor = (n, s) => {
    const value = n.settings[s.key] != null ? n.settings[s.key] : s.default;
    const id = `set-${s.key}`;
    if (s.type === 'select') {
      return `<div class="field"><label for="${id}">${s.label}</label><select id="${id}" data-set="${s.key}">`
        + s.options.map(([v, t]) => `<option value="${esc(v)}"${String(value) === v ? ' selected' : ''}>${esc(t)}</option>`).join('')
        + '</select></div>';
    }
    if (s.type === 'number') {
      return `<div class="field"><label for="${id}">${s.label}</label><input id="${id}" type="number" data-set="${s.key}" min="${s.min}" max="${s.max}" value="${esc(value)}"></div>`;
    }
    return `<div class="field checks"><label>${s.label}</label>`
      + s.options.map(([v, t]) => `<label><input type="checkbox" data-multi="${s.key}" value="${v}"${value.includes(v) ? ' checked' : ''}> ${esc(t)}</label>`).join('')
      + '</div>';
  };

  const drawProps = keepTab => {
    const box = $('#props');
    if (!box) return;
    if (selected && selected.kind === 'node' && node(selected.id)) {
      const n = node(selected.id), c = byId[n.type], g = groupById[c.group];
      box.innerHTML = `<div class="props"><span class="props__kind" style="background:${g.color}">${esc(g.name)}</span>`
        + `<h3>${esc(c.name)}</h3>`
        + `<div class="field"><label for="node-label">Подпись на схеме</label><input id="node-label" type="text" maxlength="40" placeholder="${esc(c.name)}" value="${esc(n.label)}"></div>`
        + (c.settings || []).map(s => fieldFor(n, s)).join('')
        + `<div class="row"><button type="button" class="btn btn--danger" data-act="del">Удалить узел</button></div>`
        + `<div class="props__text"><b>Что это</b><p>${esc(c.what)}</p><b>Как подключают</b><p>${esc(c.links)}</p><b>Примеры</b><p>${esc(c.examples)}</p></div></div>`;
      if (!keepTab) partsTab = 'props';
    } else if (selected && selected.kind === 'edge') {
      const e = state.edges.find(x => x.id === selected.id);
      if (!e) { selected = null; return drawProps(keepTab); }
      box.innerHTML = `<div class="props"><span class="props__kind" style="background:var(--ink)">Стрелка</span>`
        + `<h3>${esc(label(node(e.from)))} → ${esc(label(node(e.to)))}</h3>`
        + `<p class="props__none">«${esc(label(node(e.from)))}» обращается к «${esc(label(node(e.to)))}».</p>`
        + `<div class="row"><button type="button" class="btn btn--ghost" data-act="flip">Развернуть</button>`
        + `<button type="button" class="btn btn--danger" data-act="del">Удалить</button></div></div>`;
      if (!keepTab) partsTab = 'props';
    } else {
      box.innerHTML = '<p class="props__none">Выберите узел или стрелку на схеме — здесь появятся его настройки и описание.</p>';
      if (partsTab === 'props' && !selected) partsTab = 'palette';
    }
    drawParts();
  };

  const bindParts = () => {
    $('#parts-tabs').addEventListener('click', event => {
      const b = event.target.closest('[data-ptab]');
      if (!b) return;
      partsTab = b.dataset.ptab;
      drawParts();
    });
    const pal = $('#palette');
    pal.addEventListener('click', event => {
      const b = event.target.closest('[data-part]');
      if (b) addNode(b.dataset.part);
    });
    pal.addEventListener('dragstart', event => {
      const b = event.target.closest('[data-part]');
      if (!b) return;
      event.dataTransfer.setData('text/sd-part', b.dataset.part);
      event.dataTransfer.effectAllowed = 'copy';
    });

    const props = $('#props');
    props.addEventListener('input', event => {
      if (!selected || selected.kind !== 'node') return;
      const n = node(selected.id);
      const t = event.target;
      if (t.id === 'node-label') n.label = t.value.trim();
      else if (t.dataset.set) {
        const s = byId[n.type].settings.find(x => x.key === t.dataset.set);
        if (s.type === 'number') {
          const v = Math.round(+t.value);
          if (!Number.isFinite(v)) return;
          n.settings[s.key] = Math.max(s.min, Math.min(s.max, v));
        } else n.settings[s.key] = t.value;
      } else if (t.dataset.multi) {
        n.settings[t.dataset.multi] = [...props.querySelectorAll(`[data-multi="${t.dataset.multi}"]:checked`)].map(x => x.value);
      } else return;
      save();
      drawScheme();
    });
    props.addEventListener('click', event => {
      const b = event.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'del') removeSelected();
      if (b.dataset.act === 'flip' && selected && selected.kind === 'edge') {
        const e = state.edges.find(x => x.id === selected.id);
        remember();
        state.edges = state.edges.filter(x => !(x.from === e.to && x.to === e.from));
        [e.from, e.to] = [e.to, e.from];
        save();
        select({ kind: 'edge', id: e.id });
      }
    });
  };

  /* ── 5. Письма ───────────────────────────────────────────────── */
  const TABS = [[1, 'Письмо 1'], [2, 'Письмо 2'], [3, 'Письмо 3'], [4, 'Отчёт']];
  const tabOpen = t => t === 4 || t <= state.open;

  const drawTabs = () => {
    $('#mail-tabs').innerHTML = TABS.map(([t, name]) =>
      `<button type="button" role="tab" data-tab="${t}" aria-selected="${tab === t}"${tabOpen(t) ? '' : ' disabled'}>${name}</button>`).join('');
    const steps = $('#steps');
    steps.innerHTML = [['Схема', 1], ['Данные', 2], ['Изменения', 3]].map(([name, t]) =>
      `<li class="${state.passed[t] ? 'is-done' : tabOpen(t) ? 'is-open' : ''}">${t} · ${name}</li>`).join('')
      + `<li class="${state.passed[3] ? 'is-open' : ''}">Отчёт</li>`;
  };

  const letterHtml = l => `<article class="letter"><div class="letter__head">От: <b>${esc(l.from)}</b>`
    + `<span class="letter__subject">${esc(l.subject)}</span></div>`
    + `<div class="letter__body">${l.body.map(p => `<p>${esc(p)}</p>`).join('')}</div>`
    + (l.facts ? `<table class="facts">${l.facts.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : '')
    + '</article>';

  const noteHtml = (t, title, placeholder) => `<div class="note-field"><label for="note-${t}">${title}</label>`
    + `<textarea id="note-${t}" data-note="${t}" placeholder="${esc(placeholder)}">${esc(state.notes[t] || '')}</textarea></div>`;

  /* Правила этапа: общие + письма 1, а на третьем этапе ещё и письма 3. */
  const rulesFor = t => t === 1
    ? [...COMMON, ...theCase.letters[0].rules]
    : [...COMMON, ...theCase.letters[0].rules, ...theCase.letters[2].rules];

  const resultsHtml = t => {
    const c = state.checks[t];
    if (!c) return '';
    const must = c.results.filter(r => r.level === 'must'), should = c.results.filter(r => r.level === 'should');
    const mustOk = must.filter(r => r.ok).length, shouldOk = should.filter(r => r.ok).length;
    const pass = mustOk === must.length;
    const item = r => `<li class="${r.ok ? 'ok' : r.level === 'must' ? 'fail' : 'warn'}"><span class="lvl">${r.level === 'must' ? 'обязательно' : 'рекомендуется'}</span>${esc(r.title)}`
      + (r.ok ? '' : `<span class="hint">${esc(r.hint)}</span>`) + '</li>';
    const ids3 = new Set(t === 3 ? theCase.letters[2].rules.map(r => r.id) : []);
    const block = (title, list) => list.length ? `<h4>${title}</h4>` + list.map(item).join('') : '';
    const sorted = list => [...list].sort((a, b) => a.ok - b.ok || (a.level === 'must' ? -1 : 1));
    return (fingerprint() !== c.print ? '<p class="stale">Схема изменилась после проверки. Нажмите «Проверить схему» ещё раз.</p>' : '')
      + `<p class="summary${pass ? ' is-pass' : ''}">Обязательных выполнено ${mustOk} из ${must.length} · рекомендованных ${shouldOk} из ${should.length}</p>`
      + '<ul class="results">'
      + (t === 3
        ? block('Письмо 3', sorted(c.results.filter(r => ids3.has(r.id)))) + block('Письмо 1 и общие правила', sorted(c.results.filter(r => !ids3.has(r.id))))
        : sorted(c.results).map(item).join(''))
      + '</ul>';
  };

  const checkScheme = t => {
    const results = engine.runRules({ nodes: state.nodes, edges: state.edges }, rulesFor(t), catalog);
    state.checks[t] = { print: fingerprint(), results: results.map(({ marks: _, ...r }) => r) };
    marks = { nodes: [], edges: [] };
    results.filter(r => !r.ok).forEach(r => {
      marks.nodes.push(...r.marks.nodes);
      marks.edges.push(...r.marks.edges);
    });
    const pass = results.filter(r => r.level === 'must').every(r => r.ok);
    if (pass) {
      state.passed[t] = true;
      if (t === 1) state.open = Math.max(state.open, 2);
    }
    save();
    drawScheme();
    drawMail();
    const sum = $('#mail .summary');
    if (sum) sum.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  /* Хранилища, которые есть на схеме, — варианты для письма 2. */
  const storesOnScheme = () => {
    const seen = [];
    state.nodes.forEach(n => {
      if (byId[n.type].group === 'data' && !seen.includes(n.type)) seen.push(n.type);
    });
    return seen;
  };
  const DATA_COLOR = { postgres: '#1E4E8C', mongo: '#0F7A46', redis: '#B42318', s3: '#8A5A00', search: '#7A3E9D', clickhouse: '#9A6B00' };

  const entityHtml = (e, stores, graded) => {
    const chosen = (state.assign[e.id] || []).filter(t => stores.includes(t));
    const grade = graded ? engine.gradeEntity(e, chosen) : null;
    const GR = { best: 'верно', ok: 'допустимо', wrong: 'неверно', empty: 'не выбрано' };
    const name = t => byId[t].name;
    return `<div class="ent" data-ent="${e.id}"><div class="ent__name"><span>${esc(e.name)}</span>`
      + (grade ? `<span class="grade grade--${grade}">${GR[grade]}</span>` : '') + '</div>'
      + `<div class="ent__sample">${esc(e.sample)}</div><div class="ent__vol">${esc(e.volume)}</div>`
      + `<div class="chips">${stores.map(t => `<button type="button" class="chip" style="--chip:${DATA_COLOR[t] || '#13202B'}" data-store="${t}" aria-pressed="${chosen.includes(t)}">${esc(name(t))}</button>`).join('')}</div>`
      + (grade && grade !== 'empty'
        ? `<p class="ent__why"><b>Лучший выбор: ${esc(e.best.map(name).join(' или '))}.</b>`
          + (e.also.length ? ` Можно добавить: ${esc(e.also.map(name).join(', '))}.` : '') + ` ${esc(e.why)}</p>`
        : '')
      + '</div>';
  };

  const checkData = () => {
    const stores = storesOnScheme();
    const ents = theCase.letters[1].entities;
    const grades = ents.map(e => engine.gradeEntity(e, (state.assign[e.id] || []).filter(t => stores.includes(t))));
    const good = grades.filter(g => g === 'best' || g === 'ok').length;
    state.checks[2] = { grades, good, total: ents.length, at: Date.now() };
    if (!grades.includes('empty') && good >= Math.ceil(ents.length * 0.7)) {
      state.passed[2] = true;
      state.open = Math.max(state.open, 3);
    }
    save();
    drawMail();
    const sum = $('#mail .summary');
    if (sum) sum.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const drawMail = () => {
    drawTabs();
    const box = $('#mail');
    const L = theCase.letters;
    let html = '';
    if (tab === 1) {
      html = letterHtml(L[0]) + `<div class="task"><b>Задание</b>${esc(L[0].task)}</div>`
        + '<div class="row"><button type="button" class="btn" data-check="1">Проверить схему</button></div>'
        + resultsHtml(1)
        + (state.passed[1] && state.open >= 2 ? '<p class="summary is-pass">Открыто письмо 2.</p>' : '')
        + noteHtml(1, 'Обоснование схемы', 'Почему на схеме именно эти детали и связи. Одна-две фразы на каждое решение со ссылкой на строку письма.');
    } else if (tab === 2) {
      const stores = storesOnScheme();
      const graded = !!state.checks[2];
      html = letterHtml(L[1]) + `<div class="task"><b>Задание</b>${esc(L[1].task)}</div>`
        + (stores.length ? '' : '<p class="nostore">На схеме пока нет ни одного хранилища. Добавьте их из группы «Хранение данных».</p>')
        + L[1].entities.map(e => entityHtml(e, stores, graded)).join('')
        + '<div class="row"><button type="button" class="btn" data-check="2">Проверить распределение</button></div>'
        + (graded ? `<p class="summary${state.passed[2] ? ' is-pass' : ''}">Верно или допустимо: ${state.checks[2].good} из ${state.checks[2].total}`
          + (state.passed[2] ? ' · открыто письмо 3' : ` · для письма 3 нужно ${Math.ceil(state.checks[2].total * 0.7)} и все сущности распределены`) + '</p>' : '')
        + noteHtml(2, 'Обоснование распределения', 'Для двух-трёх сущностей, где выбор был неочевиден: что выбрано и почему.');
    } else if (tab === 3) {
      html = letterHtml(L[2]) + `<div class="task"><b>Задание</b>${esc(L[2].task)}</div>`
        + '<div class="row"><button type="button" class="btn" data-check="3">Проверить схему</button></div>'
        + resultsHtml(3)
        + noteHtml(3, 'Что изменено и почему', 'Какие детали и связи добавлены или изменены и какую проблему из письма решает каждое изменение.');
    } else {
      html = reportHtml();
    }
    box.innerHTML = html;
  };

  const bindMail = () => {
    $('#mail-tabs').addEventListener('click', event => {
      const b = event.target.closest('[data-tab]');
      if (!b || b.disabled) return;
      tab = +b.dataset.tab;
      marks = { nodes: [], edges: [] };
      drawScheme();
      drawMail();
      $('#mail').parentElement.scrollTop = 0;
    });
    const box = $('#mail');
    box.addEventListener('click', event => {
      const c = event.target.closest('[data-check]');
      if (c) {
        if (c.dataset.check === '2') checkData(); else checkScheme(+c.dataset.check);
        return;
      }
      const chip = event.target.closest('[data-store]');
      if (chip) {
        const id = chip.closest('[data-ent]').dataset.ent, t = chip.dataset.store;
        const list = state.assign[id] || [];
        state.assign[id] = list.includes(t) ? list.filter(x => x !== t) : [...list, t];
        chip.setAttribute('aria-pressed', String(state.assign[id].includes(t)));
        save();
        return;
      }
      const act = event.target.closest('[data-report]');
      if (act) reportAction(act.dataset.report);
    });
    box.addEventListener('input', event => {
      const t = event.target;
      if (t.dataset.note) { state.notes[t.dataset.note] = t.value; save(); }
      if (t.dataset.student) { student[t.dataset.student] = t.value; saveStudent(); }
    });
  };

  /* Письмо 2 показывает хранилища со схемы — после правки схемы его нужно перерисовать. */
  const refreshStores = () => { if (tab === 2) drawMail(); };

  /* ── 6. Отчёт и выгрузка ─────────────────────────────────────── */
  const stageLine = t => {
    const c = state.checks[t];
    if (t === 2) return c ? `${c.good} из ${c.total} верно или допустимо` : 'не проверено';
    if (!c) return 'не проверено';
    const must = c.results.filter(r => r.level === 'must');
    const should = c.results.filter(r => r.level === 'should');
    return `обязательных ${must.filter(r => r.ok).length}/${must.length}, рекомендованных ${should.filter(r => r.ok).length}/${should.length}`;
  };

  const reportHtml = () => `<div class="task"><b>Что сдать</b>Файл отчёта <code>.md</code> и изображение схемы. Отчёт собирается из того, что сделано на вкладках писем: схема, распределение данных, результаты проверок и обоснования.</div>`
    + `<div class="field"><label for="st-name">Фамилия и имя</label><input id="st-name" type="text" data-student="name" value="${esc(student.name)}"></div>`
    + `<div class="field"><label for="st-group">Группа</label><input id="st-group" type="text" data-student="group" value="${esc(student.group)}"></div>`
    + `<ul class="progress"><li><span>Письмо 1 · схема</span><span>${stageLine(1)}</span></li>`
    + `<li><span>Письмо 2 · данные</span><span>${stageLine(2)}</span></li>`
    + `<li><span>Письмо 3 · изменения</span><span>${stageLine(3)}</span></li></ul>`
    + '<div class="row"><button type="button" class="btn" data-report="md">Скачать отчёт .md</button>'
    + '<button type="button" class="btn btn--ghost" data-report="png">Схема .png</button>'
    + '<button type="button" class="btn btn--ghost" data-report="svg">Схема .svg</button></div>'
    + '<p class="ent__vol">Работа хранится только в этом браузере. Перед сменой компьютера скачайте отчёт.</p>'
    + '<div class="row"><button type="button" class="btn btn--danger" data-report="reset">Начать заново</button></div>';

  const fileBase = () => {
    const who = (student.name || 'student').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '');
    return `arhitektor_${theCase.id}_${who}`;
  };

  const download = (name, blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  const exportSvg = () => {
    const { box, inner } = schemeMarkup(true);
    return `<svg xmlns="${SVG_NS}" width="${box.w}" height="${box.h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${inner}</svg>`;
  };

  const settingsText = n => {
    const c = byId[n.type];
    return (c.settings || []).map(s => {
      const v = Object.assign(defaults(n.type), n.settings)[s.key];
      const shown = s.type === 'multi' ? (v.length ? v.map(x => optLabel(n.type, s.key, x)).join(', ') : '—')
        : s.type === 'select' ? optLabel(n.type, s.key, v) : v;
      return `${s.label.toLowerCase()}: ${shown}`;
    }).join('; ') || '—';
  };

  const reportMd = () => {
    const md = [];
    const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    md.push(`# Практикум «Архитектор по заявке»: «${theCase.company}»`, '');
    md.push(`- Студент: ${student.name || '—'}`, `- Группа: ${student.group || '—'}`, `- Дата: ${new Date().toLocaleDateString('ru-RU')}`, '');
    md.push('## Часть 1. Схема системы', '', '### Узлы', '', '| Узел | Деталь | Настройки |', '|---|---|---|');
    state.nodes.forEach(n => md.push(`| ${cell(label(n))} | ${cell(byId[n.type].name)} | ${cell(settingsText(n))} |`));
    md.push('', '### Связи (кто к кому обращается)', '');
    state.edges.forEach(e => md.push(`- ${label(node(e.from))} → ${label(node(e.to))}`));
    const resMd = t => {
      const c = state.checks[t];
      if (!c) return ['Проверка не запускалась.'];
      return [`Итог: ${stageLine(t)}.`, '', ...c.results.map(r => `- [${r.ok ? 'x' : ' '}] ${r.level === 'must' ? '(обязательно)' : '(рекомендуется)'} ${r.title}`)];
    };
    md.push('', '### Проверка', '', ...resMd(1), '', '### Обоснование', '', state.notes[1] || '—', '');

    md.push('## Часть 2. Распределение данных', '', '| Сущность | Хранилища | Оценка |', '|---|---|---|');
    const stores = storesOnScheme();
    const GR = { best: 'верно', ok: 'допустимо', wrong: 'неверно', empty: 'не выбрано' };
    theCase.letters[1].entities.forEach(e => {
      const chosen = (state.assign[e.id] || []).filter(t => stores.includes(t));
      md.push(`| ${cell(e.name)} | ${cell(chosen.map(t => byId[t].name).join(', ') || '—')} | ${state.checks[2] ? GR[engine.gradeEntity(e, chosen)] : 'не проверено'} |`);
    });
    md.push('', `Итог: ${stageLine(2)}.`, '', '### Обоснование', '', state.notes[2] || '—', '');

    md.push('## Часть 3. Изменения после письма 3', '', '### Проверка', '', ...resMd(3), '', '### Что изменено и почему', '', state.notes[3] || '—', '');
    md.push('## Схема', '', `![Схема](${fileBase()}.png)`, '');
    return md.join('\n');
  };

  const exportPng = () => {
    const text = exportSvg();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => blob && download(`${fileBase()}.png`, blob), 'image/png');
    };
    img.src = url;
  };

  const reportAction = what => {
    if (what === 'md') download(`${fileBase()}.md`, new Blob([reportMd()], { type: 'text/markdown;charset=utf-8' }));
    if (what === 'svg') download(`${fileBase()}.svg`, new Blob([exportSvg()], { type: 'image/svg+xml' }));
    if (what === 'png') exportPng();
    if (what === 'reset' && confirm('Стереть схему, распределение и обоснования по этой заявке? Отменить будет нельзя.')) {
      state = blank();
      save();
      undo.length = 0;
      selected = null;
      tab = 1;
      drawScheme(); drawProps(); drawMail();
    }
  };

  /* ── 7. Запуск ───────────────────────────────────────────────── */
  const progressOf = c => {
    const s = load(c.id);
    if (s.passed[3]) return 'все три письма выполнены';
    if (s.nodes.length) return `открыто писем: ${s.open} из 3`;
    return 'не начата';
  };

  if (!theCase) {
    $('#pick-list').innerHTML = CASES.map(c => `<a class="case-card" href="?case=${c.id}">`
      + `<span class="case-card__band" style="background:${c.color}"></span><span class="case-card__body">`
      + `<span class="case-card__kind">${esc(c.kind)}</span><b>«${esc(c.company)}»</b><p>${esc(c.teaser)}</p>`
      + `<span class="case-card__state">${esc(progressOf(c))}</span></span></a>`).join('');
    $('#pick').hidden = false;
    $('#steps').hidden = true;
    return;
  }

  document.title = `«${theCase.company}» · Архитектор по заявке · System design`;
  $('#case-name').textContent = `«${theCase.company}» · ${theCase.kind}`;
  $('#desk').hidden = false;
  $('#tb-undo').addEventListener('click', doUndo);
  $('#tb-out').addEventListener('click', () => stepZoom(-1));
  $('#tb-in').addEventListener('click', () => stepZoom(1));
  $('#tb-fit').addEventListener('click', fitZoom);
  $('#tb-clear').addEventListener('click', () => {
    if (!state.nodes.length || !confirm('Убрать со схемы все узлы и стрелки? Вернуть можно кнопкой «Отменить».')) return;
    remember();
    state.nodes = []; state.edges = [];
    save(); select(null); refreshStores();
  });
  drawPalette();
  bindParts();
  bindMail();
  drawScheme();
  drawProps();
  drawMail();
})();
