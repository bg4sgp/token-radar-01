// Token Launch Radar: the board page. Everything renders from window.RADAR, the data file the
// entry's program writes beside this page; there is no fetch and no network. The view state
// (search, filters, sort, the open protocol) lives in the location hash, so a link or a
// screenshot can name one exact view: #p=<slug> opens a protocol, #cat=<category> filters.

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const maxRatio = Math.max(...rows.map((r) => r.implied_value_usd / r.tvl_usd));

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function money(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}
function pct(v) {
  if (v === null || v === undefined) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}
function ageText(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 365) return `${days}d`;
  return `${(days / 365).toFixed(1)}y`;
}

/** The view state out of the location hash. */
function readState() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  return {
    q: h.get('q') ?? '',
    cat: h.get('cat') ?? '',
    chain: h.get('chain') ?? '',
    watch: h.get('watch') === '1',
    sort: h.get('sort') ?? 'rank',
    view: h.get('view') === 'live' ? 'live' : 'board',
    p: h.get('p') ?? '',
  };
}

/** The view state back into the hash, without a history entry or a scroll jump. */
function writeState(s) {
  const h = new URLSearchParams();
  if (s.q) h.set('q', s.q);
  if (s.cat) h.set('cat', s.cat);
  if (s.chain) h.set('chain', s.chain);
  if (s.watch) h.set('watch', '1');
  if (s.sort !== 'rank') h.set('sort', s.sort);
  if (s.view === 'live') h.set('view', 'live');
  if (s.p) h.set('p', s.p);
  history.replaceState(null, '', `#${h.toString()}`);
}

let state = readState();

function filtered() {
  const q = state.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (state.watch && !r.watchlist) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    return true;
  });
}

function sorted(list) {
  const out = [...list];
  const by = (f) => (a, b) => f(b) - f(a) || a.rank - b.rank;
  switch (state.sort) {
    case 'tvl': return out.sort(by((r) => r.tvl_usd));
    case 'growth': return out.sort(by((r) => (r.change_7d === null ? -Infinity : r.change_7d)));
    case 'age': return out.sort(by((r) => (r.age_days === null ? -1 : r.age_days)));
    case 'multiple': return out.sort(by((r) => r.model.peer_multiple));
    default: return out.sort((a, b) => a.rank - b.rank);
  }
}

function renderBoard() {
  const list = sorted(filtered());
  const body = $('rows');
  body.replaceChildren();
  for (const r of list) {
    const tr = el('tr');
    tr.addEventListener('click', () => openDetail(r.slug, true));
    const rank = el('td', 'num rank', String(r.rank));
    const nameCell = el('td');
    const nm = el('span', 'name', r.name);
    nameCell.append(nm);
    if (r.watchlist) nameCell.append(el('span', 'badge', 'Watchlist'));
    nameCell.append(el('span', 'slug', r.slug));
    const cat = el('td', 'cat', r.category ?? '—');
    const chains = el('td', 'chains', r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''));
    const tvl = el('td', 'num', money(r.tvl_usd));
    const chg = el('td', `num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}`, pct(r.change_7d));
    const age = el('td', 'num', ageText(r.age_days));
    const mult = el('td', 'num', `${r.model.peer_multiple.toFixed(2)}x`);
    const iv = el('td', 'num iv', money(r.implied_value_usd));
    const barCell = el('td', 'bar-cell');
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${Math.max(2, Math.min(100, ((r.implied_value_usd / r.tvl_usd) / maxRatio) * 100))}%`;
    bar.append(fill);
    barCell.append(bar);
    tr.append(rank, nameCell, cat, chains, tvl, chg, age, mult, iv, barCell);
    body.append(tr);
  }
  $('empty').hidden = list.length > 0;
}

function renderLive() {
  const body = $('live-rows');
  body.replaceChildren();
  for (const p of R.live) {
    const tr = el('tr');
    tr.append(
      el('td', 'name', p.name),
      el('td', 'cat', p.symbol ?? '—'),
      el('td', 'cat', p.category ?? '—'),
      el('td', 'num', money(p.tvl_usd)),
      el('td', 'num', money(p.mcap_usd)),
      el('td', `num ${p.change_7d === null ? '' : p.change_7d >= 0 ? 'up' : 'down'}`, pct(p.change_7d)),
      el('td', 'num', p.mcap_tvl === null ? '—' : `${p.mcap_tvl.toFixed(2)}x`),
    );
    body.append(tr);
  }
}

function openDetail(slug, scroll) {
  const r = bySlug.get(slug);
  const box = $('detail');
  if (!r) {
    box.hidden = true;
    return;
  }
  state.p = slug;
  writeState(state);
  box.replaceChildren();
  const head = el('div', 'detail-head');
  const left = el('div');
  const title = el('h2', '', r.name);
  if (r.watchlist) title.append(el('span', 'badge', 'Watchlist'));
  left.append(title);
  left.append(el('p', 'sub', `${r.slug} · ${r.category ?? 'Uncategorised'} · ${r.chains.join(', ') || 'no chains recorded'} · records no token`));
  const right = el('div', 'big-iv');
  right.append(el('b', '', money(r.implied_value_usd)), el('span', '', `implied value · rank #${r.rank}`));
  const close = el('button', 'close', 'Close');
  close.type = 'button';
  close.addEventListener('click', () => {
    state.p = '';
    writeState(state);
    box.hidden = true;
  });
  head.append(left, right, close);

  const grid = el('div', 'detail-grid');
  const leftCol = el('div');
  leftCol.append(el('h4', '', 'The model’s working'));
  const calc = el('table', 'calc');
  const line = (label, value) => {
    const tr = el('tr');
    tr.append(el('td', '', label), el('td', '', value));
    return tr;
  };
  const m = r.model;
  calc.append(
    line('TVL', money(r.tvl_usd)),
    line(`Peer multiple (${m.multiple_source === 'category' ? `${m.peer_count} live ${r.category ?? ''} peers` : 'market-wide median'})`, `${m.peer_multiple.toFixed(2)}x`),
    line('Base value', money(m.base_value_usd)),
    line(`Growth factor (7d ${pct(m.growth_pct)})`, `x${m.growth_factor.toFixed(2)}`),
    line(`Maturity factor (${ageText(m.age_days)} with no token)`, `x${m.maturity_factor.toFixed(2)}`),
  );
  const total = line('Implied value', money(r.implied_value_usd));
  total.className = 'total';
  calc.append(total);
  leftCol.append(calc);
  leftCol.append(el('h4', '', 'The record'));
  const facts = el('dl', 'facts');
  const fact = (k, v) => {
    facts.append(el('dt', '', k), el('dd', '', v));
  };
  fact('First tracked', r.listed_at ?? 'not recorded');
  fact('Age', r.age_days === null ? 'unknown' : `${r.age_days} days`);
  fact('TVL change, 7d', pct(r.change_7d));
  fact('On the watchlist', r.watchlist ? `yes, above the ${money(R.floor_usd)} floor` : 'no, found below the floor');
  leftCol.append(facts);

  const rightCol = el('div');
  rightCol.append(el('h4', '', 'How to farm it'));
  const list = el('ol', 'farm');
  for (const s of r.farm) {
    const li = el('li');
    const text = el('div', 'step-text', s.action);
    const chips = el('div', 'chips');
    const cost = el('span', 'chip');
    cost.append(el('b', '', 'Cost '), document.createTextNode(s.cost));
    const time = el('span', 'chip');
    time.append(el('b', '', 'Time '), document.createTextNode(s.time));
    chips.append(cost, time);
    text.append(chips);
    li.append(text);
    list.append(li);
  }
  rightCol.append(list);
  grid.append(leftCol, rightCol);
  box.append(head, grid);
  box.hidden = false;
  if (scroll) box.scrollIntoView({ block: 'start' });
}

function render() {
  $('q').value = state.q;
  $('cat').value = state.cat;
  $('chain').value = state.chain;
  $('watch').checked = state.watch;
  $('sort').value = state.sort;
  $('view-board').classList.toggle('seg-on', state.view === 'board');
  $('view-live').classList.toggle('seg-on', state.view === 'live');
  $('board-wrap').hidden = state.view !== 'board';
  $('live-wrap').hidden = state.view !== 'live';
  renderBoard();
  renderLive();
  if (state.p && bySlug.has(state.p)) openDetail(state.p, false);
  else $('detail').hidden = true;
}

function init() {
  const stats = $('stats');
  const stat = (v, label) => {
    const d = el('div', 'stat');
    d.append(el('b', '', v), el('span', '', label));
    stats.append(d);
  };
  stat(String(R.scanned), 'protocols scanned');
  stat(String(R.board_size), 'pre-token ranked');
  stat(String(R.watchlist_size), 'on the watchlist');
  stat(R.as_of, 'snapshot date');
  $('model-line').innerHTML = '';
  $('model-line').append(
    document.createTextNode('The model, stated once and applied to every row alike: '),
    el('code', '', 'implied = TVL x peer multiple x growth factor x maturity factor'),
    document.createTextNode(` — the peer multiple is the median market cap per TVL dollar of the live-token protocols in the same category (this snapshot's market-wide median is ${R.global_multiple.toFixed(2)}x), the growth factor reads the 7-day TVL change, and the maturity factor reads how long the protocol has run with no token. No name is special-cased.`),
  );

  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  for (const c of cats) $('cat').append(new Option(c, c));
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  for (const c of chains) $('chain').append(new Option(c, c));

  const mb = $('model-body');
  mb.append(el('p', '', `Every protocol in the snapshot (${R.scanned}) is screened the way the watchlist is drawn: it must record no token, and it must not be a wrapped, staked or bridged product of a token that already trades, an exchange's own entry or a versioned pool. ${R.screened} pass; the board ranks all of them, the ${R.watchlist_size} watchlist protocols first among equals, and the ${R.early_size} found below the ${money(R.floor_usd)} floor are the early rows a radar exists for.`));
  mb.append(el('p', '', 'A protocol that already trades is never given a model value: it is the calibration set. Its market cap per dollar of TVL, grouped by category, is what a launch is priced against, so a lending protocol is valued like lending tokens and a DEX like DEX tokens. Growth and maturity then move the value the way the record moves: a protocol adding TVL is worth more than one leaking it, and one that has run for years with no token has shown more than one that appeared last month.'));
  const mults = $('mults');
  for (const m of R.multiples.slice(0, 24)) {
    const d = el('div', 'mult');
    const val = el('span', 'm-val');
    val.append(el('b', '', `${m.multiple.toFixed(2)}x`), document.createTextNode(` · ${m.peers} peers${m.source === 'global' ? ' · uses global' : ''}`));
    d.append(el('span', 'm-cat', m.category), val);
    mults.append(d);
  }
  $('foot').textContent = `Snapshot: DefiLlama protocol data as of ${R.as_of}, sealed with the bounty; the board is the entry's own claim about what each launch would be worth, worked out from that record alone. Model ${R.model_version}.`;

  const bind = (id, ev, fn) => $(id).addEventListener(ev, () => { fn(); writeState(state); render(); });
  bind('q', 'input', () => { state.q = $('q').value; });
  bind('cat', 'change', () => { state.cat = $('cat').value; });
  bind('chain', 'change', () => { state.chain = $('chain').value; });
  bind('watch', 'change', () => { state.watch = $('watch').checked; });
  bind('sort', 'change', () => { state.sort = $('sort').value; });
  $('view-board').addEventListener('click', () => { state.view = 'board'; writeState(state); render(); });
  $('view-live').addEventListener('click', () => { state.view = 'live'; writeState(state); render(); });
  window.addEventListener('hashchange', () => { state = readState(); render(); });
  render();
}

init();
