/* Движок проверки схемы. Без интерфейса: его же прогоняет tools/test-engine.js.

   Схема — { nodes: [{ id, type, label, x, y, settings }], edges: [{ id, from, to }] }.
   Стрелка from → to значит «from обращается к to».

   Селектор узлов в правилах:
     'postgres'          тип узла
     'group:clients'     все узлы группы
     ['app', 'auth']     любой из перечисленных
     n => …              функция от узла
     узел                конкретный узел

   При поиске пути стрелки, которые касаются очереди или журнала событий,
   проходятся в обе стороны: обработчик рисуется стрелкой к очереди,
   а задачи при этом идут от очереди к нему. */
(function (root) {
  function makeGraph(scheme, catalog) {
    const nodes = scheme.nodes.map(n => Object.assign({}, n, {
      group: catalog.byId[n.type] ? catalog.byId[n.type].group : 'unknown',
      settings: Object.assign(catalog.byId[n.type] ? catalog.defaults(n.type) : {}, n.settings || {}),
    }));
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
    const edges = scheme.edges.filter(e => byId[e.from] && byId[e.to] && e.from !== e.to);

    const out = Object.fromEntries(nodes.map(n => [n.id, []]));
    edges.forEach(e => {
      out[e.from].push(e.to);
      if (byId[e.from].group === 'async' || byId[e.to].group === 'async') out[e.to].push(e.from);
    });

    const match = sel => {
      if (sel == null) return () => false;
      if (typeof sel === 'function') return sel;
      if (Array.isArray(sel)) {
        const parts = sel.map(match);
        return n => parts.some(p => p(n));
      }
      if (typeof sel === 'object') return n => n.id === sel.id;
      if (sel.startsWith('group:')) {
        const g = sel.slice(6);
        return n => n.group === g;
      }
      return n => n.type === sel;
    };
    const pick = sel => nodes.filter(match(sel));

    /* Есть ли путь от любого узла a к любому узлу b, не заходя в узлы avoid. */
    const reach = (a, b, opts) => {
      const isTarget = match(b);
      const isAvoid = match(opts && opts.avoid);
      const seen = new Set();
      const queue = pick(a).map(n => n.id);
      queue.forEach(id => seen.add(id));
      while (queue.length) {
        const id = queue.shift();
        for (const next of out[id]) {
          if (seen.has(next)) continue;
          seen.add(next);
          const node = byId[next];
          if (isTarget(node)) return true;
          if (isAvoid(node)) continue;
          queue.push(next);
        }
      }
      return false;
    };

    const G = {
      nodes, edges, pick,
      has: (sel, min) => pick(sel).length >= (min || 1),
      edge: (a, b) => {
        const ma = match(a), mb = match(b);
        return edges.some(e => ma(byId[e.from]) && mb(byId[e.to]));
      },
      link: (a, b) => G.edge(a, b) || G.edge(b, a),
      reach,
      /* Путь к b есть, и каждый такой путь проходит через узел guard. */
      guarded: (a, b, guard) => reach(a, b) && !reach(a, b, { avoid: guard }),
      sum: (sel, key) => pick(sel).reduce((s, n) => s + (+n.settings[key] || 0), 0),
      any: (sel, fn) => pick(sel).some(fn),
      all: (sel, fn) => pick(sel).every(fn),
      /* Стрелки, которых быть не должно: правило выполнено, если таких нет. */
      badEdges: pred => {
        const bad = edges.filter(e => pred(byId[e.from], byId[e.to]));
        return { ok: bad.length === 0, marks: { edges: bad.map(e => e.id), nodes: [] } };
      },
      /* Узлы без единой стрелки. */
      lonely: () => {
        const linked = new Set();
        edges.forEach(e => { linked.add(e.from); linked.add(e.to); });
        const alone = nodes.filter(n => !linked.has(n.id));
        return { ok: alone.length === 0, marks: { nodes: alone.map(n => n.id), edges: [] } };
      },
    };
    return G;
  }

  /* Прогон списка правил. Ошибка внутри правила считается невыполнением. */
  function runRules(scheme, rules, catalog) {
    const G = makeGraph(scheme, catalog);
    return rules.map(rule => {
      let res;
      try { res = rule.check(G); } catch (err) { res = false; }
      const ok = typeof res === 'object' && res !== null ? !!res.ok : !!res;
      const marks = res && res.marks ? res.marks : { nodes: [], edges: [] };
      return { id: rule.id, level: rule.level, title: rule.title, hint: rule.hint, ok, marks };
    });
  }

  /* Оценка распределения одной сущности.
     'best'  выбрано лучшее хранилище и ничего лишнего
     'ok'    выбрано допустимое хранилище и ничего лишнего
     'wrong' не выбрано подходящее или отмечено лишнее
     'empty' ничего не выбрано */
  function gradeEntity(entity, chosen) {
    if (!chosen || !chosen.length) return 'empty';
    const best = entity.best || [], ok = entity.ok || [], also = entity.also || [];
    const allowed = new Set([...best, ...ok, ...also]);
    if (chosen.some(t => !allowed.has(t))) return 'wrong';
    if (chosen.some(t => best.includes(t))) return 'best';
    if (chosen.some(t => ok.includes(t))) return 'ok';
    return 'wrong';
  }

  const api = { makeGraph, runRules, gradeEntity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SD = Object.assign(root.SD || {}, { engine: api });
})(typeof window !== 'undefined' ? window : globalThis);
