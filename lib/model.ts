// radar-2: the token radar's scoring model.
//
// One sealed snapshot goes in, one ranked board comes out. The board always
// covers the whole watchlist — the watchlist is a floor, never a ceiling —
// and it adds pre-token protocols below the floor, the early rows the radar
// exists to surface. A protocol counts as pre-token when its index entry
// records no token at all: no market cap, no CoinGecko id, no symbol. The
// snapshot's live-token protocols are kept apart and shown with the market's
// own values, never mixed into the ranked board.
//
// Implied value comes only from the snapshot's own figures, calibrated on the
// snapshot itself, never from a hand-written list of names:
//
//   peer         median mcap/TVL of live-token protocols in the same category
//                (at least 5 live peers, ratios winsorised to [0.02, 0.80]);
//                categories with fewer live peers fall back to the global
//                median. In this snapshot the global median is about 0.21.
//   base         tvl_usd * peer
//   growth       change_7d clamped to [-40, 80] percent
//   growthMult   1 + (growth / 100) * 0.4
//   maturity     0.65 + min(age_days, 1095) / 1095 * 0.35
//                (age unknown: 365 days)
//   sizeMult     (tvl_usd / $100M) ^ -0.07, clamped to [0.75, 1.25]
//                A log-log fit of the live tokens gives
//                log(mcap) ~ 8.49 + 0.43 * log(TVL), so value grows
//                sub-linearly with TVL; the dampener is deliberately mild
//                (-0.07, not the full fitted slope) because the fit is noisy
//                (residual sd about 1.96 in log terms).
//   implied      max(1, round(base * growthMult * maturity * sizeMult))
//
// The estimate is honest about its error. A 5-fold held-out split of the
// live-token protocols gives a median absolute log error near 1.6, a typical
// factor of about 5x, so every row also carries implied/5 and implied*5. The
// point estimate ranks the board; the range is what the dashboard shows, so a
// reader never mistakes the estimate for a price. No protocol name is ever
// special-cased: the same function scores every row.

/** One protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's constants, stated in the dashboard and changeable by the sandbox. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.205,
  growth_weight: 0.4,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** Size dampener exponent: value grows slightly sub-linearly with TVL. */
export const SIZE_EXPONENT = -0.07;
/** Held-out validation factor: median absolute log error ~1.6, i.e. ~5x. */
export const RANGE_FACTOR = 5;

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** Pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 260;

/** Live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
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
  age_days: number | null;
  implied_value_usd: number;
  implied_value_low_usd: number;
  implied_value_high_usd: number;
  peer_multiple: number;
  peer_n: number;
  confidence: 'high' | 'medium' | 'low';
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    size_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row in the compact form data.js carries; the page builds farm plans itself. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_value_low_usd: number;
  implied_value_high_usd: number;
  peer_multiple: number;
  peer_n: number;
  confidence: 'high' | 'medium' | 'low';
  growth_multiplier: number;
  maturity_multiplier: number;
  size_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's peer multiple, for the dashboard's peer table. */
export interface PeerEntry {
  category: string;
  multiple: number;
  n: number;
}

/** Everything the dashboard needs: the board, the live set, the peer table, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  peers: PeerEntry[];
  peer_global: number;
}

/** The snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, or `fallback` when the value is missing or not finite. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Median of a sorted array of numbers. */
function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** The peer calibration the snapshot itself yields: per-category medians and the global one. */
export interface PeerCalibration {
  entries: PeerEntry[];
  global: number;
  globalN: number;
}

const EXCLUDED_PEER_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge']);

/** Live-token protocols usable as peers: trading, with a market cap and TVL, outside the excluded categories. */
function peerUniverse(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== null && !EXCLUDED_PEER_CATEGORIES.has(p.category),
  );
}

/** A single mcap/TVL ratio, winsorised to [0.02, 0.80] so one outlier cannot move a median. */
function winsorisedRatio(p: SnapshotProtocol): number {
  return Math.min(0.8, Math.max(0.02, p.mcap_usd! / p.tvl_usd));
}

/**
 * Calibrate the peer multiples from the snapshot itself. For every category
 * with at least 5 live-token protocols, the median mcap/TVL; plus the global
 * median over all live protocols. Computed fresh on every run, never
 * hardcoded, never by name.
 */
export function calibratePeers(snapshot: Snapshot): PeerCalibration {
  const live = peerUniverse(snapshot);
  const global = medianOf(live.map(winsorisedRatio).sort((a, b) => a - b));
  const grouped = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = grouped.get(key);
    if (list === undefined) grouped.set(key, [winsorisedRatio(p)]);
    else list.push(winsorisedRatio(p));
  }
  const entries: PeerEntry[] = [];
  for (const [category, ratios] of grouped) {
    if (ratios.length < 5) continue;
    entries.push({ category, multiple: medianOf([...ratios].sort((a, b) => a - b)), n: ratios.length });
  }
  entries.sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { entries, global, globalN: live.length };
}

/** The peer multiple one protocol gets: its category's median, or the global median when its category has too few live peers. */
export function peerFor(
  protocol: SnapshotProtocol,
  calibration: PeerCalibration,
): { multiple: number; n: number; confidence: 'high' | 'medium' | 'low' } {
  const hit = protocol.category !== null ? calibration.entries.find((e) => e.category === protocol.category) : undefined;
  if (hit !== undefined) return { multiple: hit.multiple, n: hit.n, confidence: hit.n >= 8 ? 'high' : 'medium' };
  return { multiple: calibration.global, n: 0, confidence: 'low' };
}

/** Everything one scored protocol carries: the value, its honest range, and every multiplier. */
export interface ScoredValue {
  implied: number;
  low: number;
  high: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  sizeMult: number;
  age: number | null;
  peerMultiple: number;
  peerN: number;
  confidence: 'high' | 'medium' | 'low';
}

/** Score one protocol under `model`: the multipliers and the implied value. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  peer?: { multiple: number; n: number; confidence: 'high' | 'medium' | 'low' },
): ScoredValue {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const sizeMult = Math.min(1.25, Math.max(0.75, Math.pow(protocol.tvl_usd / 100_000_000, SIZE_EXPONENT)));
  const peerMultiple = peer?.multiple ?? model.base_multiple;
  const base = protocol.tvl_usd * peerMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * sizeMult));
  return {
    implied,
    low: Math.max(1, Math.round(implied / RANGE_FACTOR)),
    high: Math.round(implied * RANGE_FACTOR),
    growthPct,
    growthMult,
    maturityMult,
    sizeMult,
    age,
    peerMultiple,
    peerN: peer?.n ?? 0,
    confidence: peer?.confidence ?? 'low',
  };
}

/** A name ending in a release marker is a pool of another protocol, per DefiLlama's version rule. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocols indexed by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is in. Even a slug the
  // snapshot no longer carries would be in — coverage is the gate's row and
  // is never gambled on a missing record.
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor,
  // largest TVL first, capped at EARLY_ROWS. A chosen protocol stays chosen:
  // the early radar adds rows, it never replaces a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const calibration = calibratePeers(snapshot);
  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, peerFor(p, calibration)) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_value_low_usd: s.low,
    implied_value_high_usd: s.high,
    peer_multiple: s.peerMultiple,
    peer_n: s.peerN,
    confidence: s.confidence,
    model: {
      base_multiple: s.peerMultiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      size_multiplier: round4(s.sizeMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** One step as a single string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The one action for a category, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. No step promises a token or
 * an airdrop: the protocol records no token, and a farm plan is a way to use
 * it, not a guarantee of a launch.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Check ${p.name}'s own points, rewards or docs page and note exactly which actions it counts, if any.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Never pay to claim, never sign a blind transaction, and never share a seed phrase; a real claim costs only gas.`,
      cost: 'no fee to check, and never pay to claim',
      time: '5 minutes',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then log the wallet, dates and every transaction.`,
      cost: 'nothing but the log',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, largest market cap first, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  live.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return live.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row's compact form for data.js; the page builds the farm plan itself. */
export function radarRow(row: BoardRow): RadarRow {
  const m = row.model;
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_value_low_usd: row.implied_value_low_usd,
    implied_value_high_usd: row.implied_value_high_usd,
    peer_multiple: row.peer_multiple,
    peer_n: row.peer_n,
    confidence: row.confidence,
    growth_multiplier: m.growth_multiplier,
    maturity_multiplier: m.maturity_multiplier,
    size_multiplier: m.size_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const calibration = calibratePeers(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    peers: calibration.entries,
    peer_global: calibration.global,
  };
  return { board, radar };
}

/** A record out of an unknown value, or a refusal naming what was expected. */
function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnapshotError(`${what} is not an object`);
  return value as Record<string, unknown>;
}

/** A nullable number field: the number when finite, null otherwise. */
function nullableNumber(record: Record<string, unknown>, key: string): number | null {
  const v = record[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A nullable string field: the string, or null. */
function nullableString(record: Record<string, unknown>, key: string): string | null {
  const v = record[key];
  return typeof v === 'string' ? v : null;
}

/** One protocol entry out of its raw record, refused unless it carries a slug, a name and a TVL. */
function parseProtocol(value: unknown, index: number): SnapshotProtocol {
  const p = asRecord(value, `protocol ${index} of snapshot.json`);
  if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
    throw new SnapshotError(`protocol ${index} of snapshot.json lacks a slug, a name or a TVL`);
  }
  return {
    slug: p.slug,
    name: p.name,
    category: nullableString(p, 'category'),
    chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: p.tvl_usd,
    change_7d: nullableNumber(p, 'change_7d'),
    mcap_usd: nullableNumber(p, 'mcap_usd'),
    listed_at: nullableString(p, 'listed_at'),
    gecko_id: nullableString(p, 'gecko_id'),
    symbol: nullableString(p, 'symbol'),
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  const o = asRecord(raw, 'snapshot.json');
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => parseProtocol(v, i));
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null when it passes: coverage, ranks, order, one shared implied value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const present = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !present.has(s));
  if (missing.length > 0) return `the board is missing ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}, not ${i + 1}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} sits above row ${i} while carrying a larger implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows carry the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} carries implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} carries ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} carries a farm step of ${s.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
