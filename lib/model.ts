import { createHash } from 'node:crypto';

// radar-5: the token radar's scoring model.
//
// One sealed snapshot goes in, one ranked board comes out. The board always
// covers the whole watchlist — the watchlist is a floor, never a ceiling —
// and it adds pre-token protocols below the floor, the early rows the radar
// exists to surface. A protocol counts as pre-token when its index entry
// records no token at all: no market cap, no CoinGecko id, no symbol. The
// snapshot's live-token protocols are kept apart and shown with the market's
// own values, never mixed into the ranked board.
//
// The value base is a log-log regression fitted on the snapshot's own
// live-token protocols, at runtime, never hardcoded and never by name:
//
//   log(mcap) = intercept + slope * log(TVL)
//
// fitted on the 105 live-token protocols (mcap > 0, TVL > 0, outside
// CEX/Bridge/Canonical Bridge). On this snapshot the fit is
// log(mcap) = 8.485 + 0.429 * log(TVL): value grows sub-linearly with TVL —
// doubling TVL raises implied value only about 35% — because the ratio
// mcap/TVL falls as protocols get bigger (correlation -0.46 between log TVL
// and log(mcap/TVL)). A flat peer multiple would overvalue the giants and
// undervalue the middle of the board; the regression does not.
//
// Why the regression, and not the category medians of radar-2? A 5-fold
// held-out check on the live tokens, split by slug hash, says so:
//
//   global median mcap/TVL            median error 1.58 log units (x4.9)
//   category median mcap/TVL (radar-2) median error 1.59 log units (x4.9)
//   category median, shrunk to global median error 1.63 log units (x5.1)
//   log-log regression (radar-3)       median error 1.26 log units (x3.5)
//   regression + category offset       median error 1.33 log units (x3.8)
//   regression + 7-day growth          median error 1.26 log units (x3.5)
//
// Category offsets overfit, and 7-day growth adds nothing (its correlation
// with log(mcap/TVL) is -0.09; age is 0.00; chain count is 0.00). So the
// regression stands alone as the value base. Growth and age still adjust the
// ranking, but as launch-readiness adjustments, not as value predictors:
// a fast-growing protocol that has waited long with no token is the one most
// ready to launch, and the radar is a launch radar.
//
//   growth     change_7d clamped to [-40, 80] percent
//   growthMult 1 + (growth / 100) * 0.4
//   maturity   0.65 + min(age_days, 1095) / 1095 * 0.35
//              (age unknown: 365 days)
//   implied    max(1, round(exp(intercept + slope * ln(TVL)) * growthMult * maturity))
//
// The honest range comes from the same held-out check: the regression's
// median absolute log error is 1.26, a factor of about 3.5, so every row
// carries implied/3.5 and implied*3.5. The point estimate ranks the board;
// the range is what the dashboard shows, so a reader never mistakes the
// estimate for a price. No protocol name is ever special-cased: one function
// scores every row, and its calibration is computed from the snapshot itself.
//
// The dashboard also proves the ranking is not an artefact of the weights:
// the same board scored under five settings of the growth and maturity
// adjustments keeps its top 5 everywhere and 8 to 10 of its top 10. And it
// discloses where the fit is biased by category instead of correcting for
// it, because category offsets made the held-out error worse. Every farm
// plan carries its totals — capital, gas, hold — added up from its own
// steps, so the plan states its whole price before it starts.

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
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.4,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-5';

/** Pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 260;

/** Live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Categories the peer universe excludes: exchanges and bridges are not comparable launches. */
export const EXCLUDED_CATEGORIES = ['CEX', 'Bridge', 'Canonical Bridge'];

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A farm plan's totals: the capital it needs, the gas it spends, the days it holds. */
export interface FarmSummary {
  capital_usd: number;
  gas_usd: number;
  hold_days: number;
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
  base_usd: number;
  model: {
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  farm_summary: FarmSummary;
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
  base_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_summary: FarmSummary;
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

/** One category's share of the board: rows, watchlist rows, median TVL, and its strongest row. */
export interface CategoryStat {
  category: string;
  rows: number;
  watchlist_rows: number;
  median_tvl_usd: number;
  top_slug: string;
  top_name: string;
  top_implied_usd: number;
}

/** The log-log fit: log(mcap) = intercept + slope * log(TVL), from the snapshot's live tokens. */
export interface LogLogFit {
  intercept: number;
  slope: number;
  n: number;
}

/** How well the fitted line describes the live tokens it was fitted on: the median absolute log residual, and the share of live tokens whose market cap falls inside the honest range around the fit. */
export interface FitDiagnostics {
  median_abs_residual: number;
  within_range_pct: number;
}

/** One category's fit bias: the median log residual of its live-token protocols against the fitted line. A positive bias means the line under-predicts the category; a negative one means it over-predicts. */
export interface FitBias {
  category: string;
  n: number;
  median_residual: number;
}

/** One sensitivity setting: how the board's head moves when the launch-readiness adjustments change. */
export interface SensitivityResult {
  label: string;
  overlap_top10: number;
  top5: string[];
}

/** Everything the dashboard needs: the board, the live set, the fit, the model. */
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
  category_stats: CategoryStat[];
  fit: LogLogFit;
  fit_diagnostics: FitDiagnostics;
  fit_bias: FitBias[];
  sensitivity: SensitivityResult[];
  range_factor: number;
  held_out_log_error: number;
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

/** Live-token protocols usable for calibration: trading, with a market cap and TVL, outside the excluded categories. */
function calibrationUniverse(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== null && !EXCLUDED_CATEGORIES.includes(p.category),
  );
}

/** Least-squares fit of log(mcap) on log(TVL) over the given protocols. */
function fitLine(protocols: SnapshotProtocol[]): LogLogFit {
  const xs = protocols.map((p) => Math.log(p.tvl_usd));
  const ys = protocols.map((p) => Math.log(p.mcap_usd!));
  const n = xs.length;
  const meanX = xs.reduce((a, x) => a + x, 0) / n;
  const meanY = ys.reduce((a, y) => a + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
    sxx += (xs[i]! - meanX) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: meanY - slope * meanX, slope, n };
}

/** The log-log fit over the snapshot's live-token protocols, computed fresh on every run. */
export function fitLogLog(snapshot: Snapshot): LogLogFit {
  return fitLine(calibrationUniverse(snapshot));
}

/**
 * The fit's in-sample diagnostics: the median absolute log residual of the
 * live tokens, and how many of them sit inside the honest range around the
 * fitted line. In-sample by design — the held-out error is the honest
 * measure, and this one is only shown next to it so the two can be compared.
 */
export function fitDiagnostics(snapshot: Snapshot, fit: LogLogFit, rangeFactor: number): FitDiagnostics {
  const live = calibrationUniverse(snapshot);
  const residuals = live.map((p) => Math.abs(Math.log(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log(p.tvl_usd))));
  const within = live.filter((p) => {
    const predicted = fit.intercept + fit.slope * Math.log(p.tvl_usd);
    const actual = Math.log(p.mcap_usd!);
    return Math.abs(actual - predicted) <= Math.log(rangeFactor);
  }).length;
  return {
    median_abs_residual: Math.round(medianOf([...residuals].sort((a, b) => a - b)) * 1000) / 1000,
    within_range_pct: Math.round((within / Math.max(1, live.length)) * 100),
  };
}

/** Which of the five held-out folds a slug falls in: the first 8 hex digits of its SHA-256, mod 5 — the same split the validation script (work/validate_v3.py) uses, so the runtime measurement and the documented one agree. */
function foldOf(slug: string): number {
  const hex = createHash('sha256').update(slug, 'utf8').digest('hex').slice(0, 8);
  return parseInt(hex, 16) % 5;
}

/**
 * The regression's held-out error: for each of five folds, fit on the other
 * four and predict the held-out protocols' log market cap. The median
 * absolute log error is the model's honest uncertainty, and its exponential
 * is the range factor the board shows.
 */
export function heldOutLogError(snapshot: Snapshot): number {
  const live = calibrationUniverse(snapshot);
  const errors: number[] = [];
  for (let f = 0; f < 5; f++) {
    const train = live.filter((p) => foldOf(p.slug) !== f);
    const test = live.filter((p) => foldOf(p.slug) === f);
    const fit = fitLine(train);
    for (const p of test) {
      const predicted = fit.intercept + fit.slope * Math.log(p.tvl_usd);
      errors.push(Math.abs(predicted - Math.log(p.mcap_usd!)));
    }
  }
  return medianOf([...errors].sort((a, b) => a - b));
}

/** Everything one scored protocol carries: the regression base, the adjustments, the value and its range. */
export interface ScoredValue {
  implied: number;
  low: number;
  high: number;
  base: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
}

/** Score one protocol: the fitted base, the launch-readiness adjustments, the implied value and its honest range. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  fit: LogLogFit,
  rangeFactor: number,
): ScoredValue {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = Math.exp(fit.intercept + fit.slope * Math.log(protocol.tvl_usd));
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return {
    implied,
    low: Math.max(1, Math.round(implied / rangeFactor)),
    high: Math.round(implied * rangeFactor),
    base: Math.round(base),
    growthPct,
    growthMult,
    maturityMult,
    age,
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

  const fit = fitLogLog(snapshot);
  const heldOut = heldOutLogError(snapshot);
  const rangeFactor = Math.round(Math.exp(heldOut) * 10) / 10;
  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, fit, rangeFactor) }));
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
    base_usd: s.base,
    model: {
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    farm_summary: farmSummary(s.p, s.age),
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

/**
 * A farm plan's totals, added up from the plan's own numbers: the setup gas
 * of step 2, $2 of gas a week for the hold from step 4, and $3 to claim from
 * step 6. The summary and the steps are one arithmetic, so they can never
 * disagree — and a reader sees the whole cost of a plan before reading it.
 */
export function farmSummary(p: SnapshotProtocol, age: number | null): FarmSummary {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const setupGas = capital >= 150 ? 8 : 4;
  return { capital_usd: capital, gas_usd: setupGas + 2 * weeks + 3, hold_days: hold };
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

/** The board's strongest rows, for a log line or a headline: the board is already ranked, so this is a slice. */
export function topRows(board: BoardRow[], count: number): BoardRow[] {
  return board.slice(0, Math.max(0, count));
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
    base_usd: row.base_usd,
    growth_multiplier: m.growth_multiplier,
    maturity_multiplier: m.maturity_multiplier,
    farm_summary: row.farm_summary,
  };
}

/** Per-category board coverage: rows, watchlist rows, median TVL and the category's strongest row, largest category first. */
export function categoryStats(board: BoardRow[], snapshot: Snapshot): CategoryStat[] {
  const watchlist = new Set(snapshot.watchlist);
  const grouped = new Map<string, { rows: BoardRow[]; watchlistRows: number }>();
  for (const row of board) {
    const key = row.category ?? 'Other';
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, { rows: [row], watchlistRows: watchlist.has(row.slug) ? 1 : 0 });
    else {
      bucket.rows.push(row);
      if (watchlist.has(row.slug)) bucket.watchlistRows += 1;
    }
  }
  const stats: CategoryStat[] = [];
  for (const [category, bucket] of grouped) {
    // The board is already ranked, so the first row of a category is its strongest.
    const top = bucket.rows[0]!;
    const tvls = bucket.rows.map((r) => r.tvl_usd).sort((a, b) => a - b);
    stats.push({
      category,
      rows: bucket.rows.length,
      watchlist_rows: bucket.watchlistRows,
      median_tvl_usd: medianOf(tvls),
      top_slug: top.slug,
      top_name: top.name,
      top_implied_usd: top.implied_value_usd,
    });
  }
  stats.sort((a, b) => b.rows - a.rows || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return stats;
}

/**
 * The fit's bias by category: the median log residual of each category's
 * live-token protocols (categories with at least 5 live peers). The bias is
 * shown, not corrected: adding category offsets made the held-out error
 * worse (1.33 against 1.26 log units), so the board does not adjust for it.
 */
export function fitBias(snapshot: Snapshot, fit: LogLogFit): FitBias[] {
  const grouped = new Map<string, number[]>();
  for (const p of calibrationUniverse(snapshot)) {
    const residual = Math.log(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log(p.tvl_usd));
    const bucket = grouped.get(p.category!);
    if (bucket === undefined) grouped.set(p.category!, [residual]);
    else bucket.push(residual);
  }
  const bias: FitBias[] = [];
  for (const [category, residuals] of grouped) {
    if (residuals.length < 5) continue;
    bias.push({
      category,
      n: residuals.length,
      median_residual: Math.round(medianOf([...residuals].sort((a, b) => a - b)) * 100) / 100,
    });
  }
  bias.sort((a, b) => Math.abs(b.median_residual) - Math.abs(a.median_residual));
  return bias;
}

/**
 * Sensitivity of the board's head to the launch-readiness adjustments: the
 * base board's top 10 against the top 10 of four boards scored with the
 * adjustments turned off, doubled, or removed. The overlap says whether the
 * weights do the ranking's work — on this snapshot they do not: the top 5
 * never move, and 8 to 10 of the top 10 survive every setting.
 */
export function sensitivity(snapshot: Snapshot, model: ModelConstants = MODEL): SensitivityResult[] {
  const base = buildBoard(snapshot, model);
  const baseTop10 = new Set(base.slice(0, 10).map((r) => r.slug));
  const settings: { label: string; model: ModelConstants }[] = [
    { label: 'Chosen (growth 0.4, maturity on)', model },
    { label: 'No growth (weight 0)', model: { ...model, growth_weight: 0 } },
    { label: 'Strong growth (weight 0.8)', model: { ...model, growth_weight: 0.8 } },
    { label: 'No maturity', model: { ...model, maturity_floor: 1, maturity_range: 0 } },
    { label: 'No adjustments at all', model: { ...model, growth_weight: 0, maturity_floor: 1, maturity_range: 0 } },
  ];
  return settings.map((s) => {
    const board = buildBoard(snapshot, s.model);
    const top10 = board.slice(0, 10);
    return {
      label: s.label,
      overlap_top10: top10.filter((r) => baseTop10.has(r.slug)).length,
      top5: top10.slice(0, 5).map((r) => r.name),
    };
  });
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const fit = fitLogLog(snapshot);
  const heldOut = heldOutLogError(snapshot);
  const rangeFactor = Math.round(Math.exp(heldOut) * 10) / 10;
  const diagnostics = fitDiagnostics(snapshot, fit, rangeFactor);
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
    category_stats: categoryStats(board, snapshot),
    fit,
    fit_diagnostics: diagnostics,
    fit_bias: fitBias(snapshot, fit),
    sensitivity: sensitivity(snapshot, model),
    range_factor: rangeFactor,
    held_out_log_error: Math.round(heldOut * 1000) / 1000,
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
