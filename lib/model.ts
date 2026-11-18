// The token launch radar's model: one sealed snapshot in, one ranked board out.
//
// The question the board answers: what would a protocol's token be worth if it launched at the
// value the market already puts on comparable protocols that do trade? The model never leaves
// the snapshot's own figures:
//
//   peers      = the live-token protocols in the same category, each with a market cap and a TVL
//   multiple   = the median market-cap / TVL of those peers (the global median when a category
//                has fewer than MIN_PEERS live peers to learn from)
//   base       = tvl_usd x multiple          (the protocol valued like its tokenised peers)
//   growth     = 1 + clamp(change_7d, -50, 100) / 100 x GROWTH_WEIGHT
//   maturity   = 0.55 + 0.45 x min(age_days, 1460) / 1460   (a longer tokenless record counts
//                for more; an unknown listing date is read as UNKNOWN_AGE_DAYS)
//   implied    = max(1, round(base x growth x maturity))
//
// The board covers every slug on the snapshot's watchlist and every other protocol that passes
// the watchlist's own product screen without its TVL floor: it records no token, and it is not a
// wrapped, staked or bridged product of a token that already trades, not an exchange's own entry
// and not a versioned pool of another protocol. Live-token protocols are never ranked; they are
// the calibration set, and the dashboard shows them apart with the market's own values.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-run the board by hand. */
export interface ModelConstants {
  min_peers: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_base: number;
  maturity_span: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  min_peers: 4,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_base: 0.55,
  maturity_span: 0.45,
  maturity_days: 1460,
  unknown_age_days: 270,
};

/** The model's version label, named in the dashboard and in every board row's breakdown. */
export const MODEL_VERSION = 'peer-multiple-2';

/** How many live-token protocols the dashboard's comparison view carries, by market cap. */
export const LIVE_ROWS = 30;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with the model's working shown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    version: string;
    peer_multiple: number;
    peer_count: number;
    multiple_source: 'category' | 'global';
    base_value_usd: number;
    growth_pct: number | null;
    growth_factor: number;
    maturity_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row, plus its farm plan in structured form. */
export interface RadarRow extends Omit<BoardRow, 'farm_steps' | 'model'> {
  model: BoardRow['model'];
  farm: FarmStep[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
  mcap_tvl: number | null;
}

/** One category's calibration: how many live peers priced it and the multiple they gave. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  multiple: number;
  source: 'category' | 'global';
}

/** Everything the dashboard renders, from the snapshot alone. */
export interface RadarData {
  as_of: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  scanned: number;
  screened: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when the date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records a token: any of a market cap, a CoinGecko id or a symbol. */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * The watchlist's product screen with no TVL floor: a protocol the radar may rank records no
 * token and is not a wrapped, staked or bridged product of one that trades, not an exchange's
 * own entry and not a versioned pool of another protocol.
 */
export function passesScreen(p: SnapshotProtocol): boolean {
  if (recordsToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `))) return false;
  return true;
}

/** The calibration the snapshot itself provides: a peer multiple for every category. */
export interface Calibration {
  global: number;
  byCategory: Map<string, { multiple: number; peers: number }>;
}

/** Learn the peer multiples from the snapshot's live-token protocols. */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    const key = p.category ?? '';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, list] of perCategory) byCategory.set(key, { multiple: median(list), peers: list.length });
  return { global: ratios.length > 0 ? median(ratios) : 0.2, byCategory };
}

/** The multiple one protocol is valued at, and where it came from. */
function multipleFor(p: SnapshotProtocol, cal: Calibration, model: ModelConstants): { multiple: number; peers: number; source: 'category' | 'global' } {
  const hit = p.category === null ? undefined : cal.byCategory.get(p.category);
  if (hit !== undefined && hit.peers >= model.min_peers) return { multiple: hit.multiple, peers: hit.peers, source: 'category' };
  return { multiple: cal.global, peers: hit?.peers ?? 0, source: 'global' };
}

/** One protocol's implied value and the model's working, under `model` and calibration `cal`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  cal: Calibration,
  model: ModelConstants = MODEL,
): { implied: number; base: number; multiple: number; peers: number; source: 'category' | 'global'; growthPct: number | null; growthFactor: number; maturityFactor: number; age: number | null } {
  const { multiple, peers, source } = multipleFor(p, cal, model);
  const base = p.tvl_usd * multiple;
  const growthPct = p.change_7d;
  const clamped = growthPct === null ? 0 : Math.min(model.growth_cap, Math.max(model.growth_floor, growthPct));
  const growthFactor = 1 + (clamped / 100) * model.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityFactor = model.maturity_base + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_span;
  const implied = Math.max(1, Math.round(base * growthFactor * maturityFactor));
  return { implied, base, multiple, peers, source, growthPct, growthFactor, maturityFactor, age };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: a younger record earns a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core position, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateralized')) return `Supply $${capital} of USDC to ${n} on ${chain} as collateral and leave the position open.`;
  if (c.includes('perp') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${n} and open one small hedged trade.`;
  if (c.includes('dex') || c.includes('exchange')) return `Provide $${capital} of liquidity to ${n}'s deepest pool on ${chain} and keep the LP position open.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${n} curated vault on ${chain} and keep the vault shares.`;
  if (c.includes('yield') || c.includes('aggregator') || c.includes('farm')) return `Deposit $${capital} into ${n}'s main vault on ${chain} and keep the receipt shares.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${n} and hold the staking receipt.`;
  if (c.includes('basis') || c.includes('cedefi') || c.includes('delta')) return `Deposit $${capital} of USDC into ${n}'s basis vault on ${chain} and keep the shares.`;
  if (c.includes('rwa') || c.includes('real estate')) return `Complete ${n}'s own onboarding, then mint $${capital} of its yield asset on ${chain} and hold it.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${n} and place one position in its most liquid market.`;
  if (c.includes('risk')) return `Deposit $${capital} into a ${n} risk-curated vault on ${chain} and keep the shares.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action, after the core position. */
function secondAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Borrow a small amount against the collateral on ${n} and repay it a week later, so the wallet shows both sides of the market.`;
  if (c.includes('perp') || c.includes('derivative')) return `Place two or three small trades on ${n} across the week rather than one, so the activity is not a single spike.`;
  if (c.includes('dex') || c.includes('exchange')) return `Make several swaps through ${n} on ${chain} in the same week, in both directions, and keep the amounts modest.`;
  if (c.includes('restak') || c.includes('staking')) return `Restake or delegate a second smaller tranche through ${n} and claim any staking rewards it issues.`;
  if (c.includes('prediction')) return `Take a position in a second market on ${n} and hold both to settlement or close.`;
  return `Repeat the core action on ${n} with a smaller amount a week later, so the wallet's history spans more than one snapshot.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL and age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      action: `Set up a fresh wallet for ${p.name} alone and fund it with gas on ${chain}; keep its seed phrase offline.`,
      cost: 'about $5 held for gas',
      time: '10 minutes',
    },
    {
      action: coreAction(p, capital, chain),
      cost: `$${capital} of capital plus about $6 of gas`,
      time: '20 minutes to set up',
    },
    {
      action: secondAction(p, chain),
      cost: 'about $4 of gas, no new capital',
      time: '15 minutes',
    },
    {
      action: `Open ${p.name}'s own app and look for its points or rewards page; if it runs one, enrol this same wallet and read its rules before doing more.`,
      cost: 'no fee to check, and never pay to enrol',
      time: '10 minutes',
    },
    {
      action: `Make one small qualifying action on ${p.name} every week, such as a deposit, a swap, a vote or a claim, so the wallet stays active.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      action: `Hold the position for at least ${hold} days, so the activity is counted across several weekly snapshots rather than one.`,
      cost: `the $${capital} stays deployed`,
      time: `${hold} days`,
    },
    {
      action: `Keep a farm log of the wallet, dates and transactions for ${p.name}, review it monthly, and withdraw only after checking its rewards page once more.`,
      cost: 'nothing but the log',
      time: '10 minutes a month',
    },
  ];
}

/** A step as one string for board.json: its action, then its cost and time. */
export function stepText(step: FarmStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s;
}

/** The protocols the board ranks: the whole watchlist, plus every screened protocol off it. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const cal = calibrate(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && passesScreen(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, cal, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      version: MODEL_VERSION,
      peer_multiple: round4(s.v.multiple),
      peer_count: s.v.peers,
      multiple_source: s.v.source,
      base_value_usd: Math.round(s.v.base),
      growth_pct: s.v.growthPct,
      growth_factor: round4(s.v.growthFactor),
      maturity_factor: round4(s.v.maturityFactor),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's comparison view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => recordsToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const cal = calibrate(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const rows: RadarRow[] = board.map((r) => {
    const p = bySlug.get(r.slug)!;
    return { ...r, farm: farmSteps(p, r.age_days) };
  });
  const multiples: CategoryMultiple[] = [...cal.byCategory.entries()]
    .map(([category, v]) => ({
      category: category === '' ? 'Uncategorised' : category,
      peers: v.peers,
      multiple: round4(v.multiple),
      source: (v.peers >= model.min_peers ? 'category' : 'global') as 'category' | 'global',
    }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    scanned: snapshot.protocols.length,
    screened: snapshot.protocols.filter((p) => passesScreen(p)).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    global_multiple: round4(cal.global),
    multiples,
    rows,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, size, ranks, order, values and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
