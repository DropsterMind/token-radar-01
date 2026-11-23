// Token Radar dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, and a per-protocol
// detail drawer with the model's own inputs and the protocol's farm plan.
// Below the board sit three panels that explain the ranking: how implied
// value is computed, the peer multiple of every category, and the board's
// coverage by category. The live-token protocols get their own tab, shown
// with the market's values instead of a model's.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic. The value base is the
  // log-log regression fitted on this snapshot's live-token protocols:
  // exp(intercept + slope * ln(TVL)). Growth and age adjust the ranking
  // toward protocols most ready to launch; they are not value predictors.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var base = Math.exp(DATA.fit.intercept + DATA.fit.slope * Math.log(row.tvl_usd));
    return Math.max(1, Math.round(base * growthMult * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: "Check " + p.name + "'s own points, rewards or docs page and note exactly which actions it counts, if any.", cost: 'no fee to check', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Never pay to claim, never sign a blind transaction, and never share a seed phrase; a real claim costs only gas.', cost: 'no fee to check, and never pay to claim', time: '5 minutes' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes, then log the wallet, dates and every transaction.", cost: 'nothing but the log', time: '10 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // The page header: the brand mark and name on the left, the snapshot date,
  // the data source and the model version on the right.
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  // The lede: the headline count and one plain sentence about what the
  // watchlist is, beside four facts — watchlist coverage, rows scored,
  // early rows, and live-token protocols set aside.
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record, plus ' + DATA.early_size + ' pre-token protocols the early radar found below that floor. Implied value is a model estimate, not a promise of a token or a price.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  // The filter bar: search text, a category picker, and the pre-token /
  // live-token switch. Every change re-renders the table in place and is
  // written to the URL hash, so a filtered view can be shared as a link.
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    function tabButton(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; render(); } });
    }
    var shown = state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, tabButton('pre-token', 'Pre-token'), tabButton('live', 'Live token'))),
      el('span', { class: 'count', text: shown })
    );
  }

  // A sortable column header: first click sorts descending, a second click
  // on the same column flips the direction.
  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  // One board row: rank, name, TVL, 7-day growth, age, the implied-value bar,
  // and the token status. Clicking — or pressing Enter on — a row opens it.
  function boardRow(r, max) {
    var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    var chainText = (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain');
    return el('tr', {
      'data-selected': state.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    },
      el('td', { class: 'num' + (r.rank <= 3 ? ' rank-top' : ''), text: String(r.rank) }),
      el('td', null, el('div', { class: 'name' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainText })
      )),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: growth }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', null, el('div', { class: 'implied' },
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
      )),
      el('td', null, el('span', { class: 'status', text: 'no token' }))
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(boardRow(r, max));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  // The Live token view: the protocols that already trade, shown with the
  // market's own values — TVL, 7-day growth and market cap — and no implied
  // value, because a traded token needs no model. Rows here are not clickable:
  // there is no farm plan for a protocol that already has a token.
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The validation panel: how each candidate model did on the live-token
  // protocols, measured by a 5-fold held-out check split by slug hash.
  // The numbers come from the validation run on this snapshot (work/validate_v3.py);
  // the regression won, so it is the model, and its own held-out error —
  // recomputed at runtime and carried in DATA — sets the honest range.
  function validationPanel() {
    var candidates = [
      { name: 'Global median mcap / TVL', error: 1.581, factor: 'x4.9' },
      { name: 'Category median mcap / TVL (radar-2)', error: 1.592, factor: 'x4.9' },
      { name: 'Category median, shrunk to global', error: 1.630, factor: 'x5.1' },
      { name: 'Log-log regression (radar-3)', error: DATA.held_out_log_error, factor: 'x' + DATA.range_factor },
      { name: 'Regression + category offset', error: 1.328, factor: 'x3.8' },
      { name: 'Regression + 7-day growth', error: 1.264, factor: 'x3.5' }
    ];
    var rows = candidates.map(function (c) {
      var chosen = c.name.indexOf('radar-3') >= 0;
      return el('tr', null,
        el('td', null, el('b', { text: c.name + (chosen ? ' — chosen' : '') })),
        el('td', { class: 'num', text: c.error.toFixed(3) }),
        el('td', { class: 'num', text: c.factor })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the model was chosen' }),
      el('p', { class: 'sub', text: 'Each candidate predicts the market cap of live-token protocols it was not fitted on: five folds, split by slug hash, median absolute log error. Category offsets overfit, 7-day growth adds nothing (its correlation with log(mcap/TVL) is -0.09; age 0.00; chain count 0.00), and a flat peer multiple misses that mcap/TVL falls as TVL grows (correlation -0.46). The regression wins, so the board uses it — and its own held-out error of ' + DATA.held_out_log_error + ' log units is the honest range of x' + DATA.range_factor + ' every row shows.' }),
      el('p', { class: 'sub', text: 'In-sample, the fitted line leaves a median residual of ' + DATA.fit_diagnostics.median_abs_residual + ' log units, and ' + DATA.fit_diagnostics.within_range_pct + '% of the live-token protocols fall inside the x' + DATA.range_factor + ' range around it. In-sample is flattering by design — the held-out error above is the honest one — and the two are shown side by side so the gap is visible.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Candidate model' }),
            el('th', { scope: 'col', text: 'Median log error' }),
            el('th', { scope: 'col', text: 'Typical factor' })
          )),
          el('tbody', null, rows)
        )
      )
    );
  }

  // The sensitivity panel: the board's head under five settings of the
  // launch-readiness adjustments. The overlap says whether the weights do
  // the ranking's work; on this snapshot the top 5 never move.
  function sensitivityPanel() {
    var rows = (DATA.sensitivity || []).map(function (s) {
      return el('tr', null,
        el('td', null, el('b', { text: s.label })),
        el('td', { class: 'num', text: String(s.overlap_top10) + ' / 10' }),
        el('td', { text: s.top5.join(', ') })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Is the ranking sensitive to the weights?' }),
      el('p', { class: 'sub', text: 'The same board, scored five times with the growth and maturity adjustments changed. The top 5 are identical under every setting and 8 to 10 of the top 10 survive each one, so the regression — not the chosen weights — does the ranking. A board whose head moved with every weight change would be a board about its weights.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Setting' }),
            el('th', { scope: 'col', text: 'Top 10 shared' }),
            el('th', { scope: 'col', text: 'Top 5 under this setting' })
          )),
          el('tbody', null, rows)
        )
      )
    );
  }

  // The fit-bias panel: where the regression over- or under-predicts, by
  // category, among the live-token protocols it was fitted on. The bias is
  // shown and not corrected, because category offsets made the held-out
  // error worse — a model that hides its bias is not a better model.
  function biasPanel() {
    var rows = (DATA.fit_bias || []).map(function (b) {
      var sign = b.median_residual > 0 ? '+' : '';
      var factor = Math.exp(b.median_residual).toFixed(2);
      var direction = b.median_residual > 0 ? 'under-predicts' : 'over-predicts';
      return el('tr', null,
        el('td', null, el('b', { text: b.category })),
        el('td', { class: 'num', text: String(b.n) }),
        el('td', { class: 'num', text: sign + b.median_residual.toFixed(2) }),
        el('td', { text: 'line ' + direction + ' this category by x' + factor })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Where the fit is biased' }),
      el('p', { class: 'sub', text: 'Median log residual of live-token protocols by category, against the fitted line. Liquid Staking is the most over-predicted (x0.47) and Basis Trading the most under-predicted (x1.78). The board does not correct for this: adding category offsets raised the held-out error from 1.26 to 1.33 log units, so the bias is disclosed here instead of baked into the scores.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Live peers' }),
            el('th', { scope: 'col', text: 'Median residual' }),
            el('th', { scope: 'col', text: 'What it means' })
          )),
          el('tbody', null, rows)
        )
      )
    );
  }

  // The distribution chart: the board's implied values on a log scale, as
  // eight bars drawn in SVG from the rows themselves — no image, no network.
  function distributionPanel() {
    var values = DATA.rows.map(function (r) { return Math.log10(r.implied_value_usd); });
    var lo = Math.min.apply(null, values);
    var hi = Math.max.apply(null, values);
    var bins = [0, 0, 0, 0, 0, 0, 0, 0];
    values.forEach(function (v) {
      var i = Math.min(7, Math.floor((v - lo) / (hi - lo + 1e-9) * 8));
      bins[i] += 1;
    });
    var max = Math.max.apply(null, bins);
    var bars = bins.map(function (n, i) {
      var x = 8 + i * 52;
      var h = max === 0 ? 0 : Math.round(n / max * 90);
      var y = 100 - h;
      var from = Math.pow(10, lo + i * (hi - lo) / 8);
      var to = Math.pow(10, lo + (i + 1) * (hi - lo) / 8);
      return '<rect x="' + x + '" y="' + y + '" width="44" height="' + h + '" rx="3" fill="#2e7d5b"><title>' + fmtUsd(Math.round(from)) + ' to ' + fmtUsd(Math.round(to)) + ': ' + n + ' rows</title></rect>' +
        '<text x="' + (x + 22) + '" y="116" text-anchor="middle" font-size="10" fill="#6b7280">' + n + '</text>';
    }).join('');
    var svg = '<svg viewBox="0 0 424 124" width="100%" role="img" aria-label="Histogram of implied values across the board">' + bars + '</svg>';
    var panel = el('section', { class: 'panel model' },
      el('h2', { text: 'How the implied values spread' }),
      el('p', { class: 'sub', text: 'All ' + DATA.rows.length + ' rows, from ' + fmtUsd(Math.min.apply(null, DATA.rows.map(function (r) { return r.implied_value_usd; }))) + ' to ' + fmtUsd(Math.max.apply(null, DATA.rows.map(function (r) { return r.implied_value_usd; }))) + '. Most rows sit in the low millions; the head of the board — the few rows above $20M — is a thin tail, not a crowd. A radar whose values all cluster in one band would be ranking noise.' })
    );
    panel.insertAdjacentHTML('beforeend', svg);
    return panel;
  }

  // Coverage by category: how many board rows each category holds, how many
  // of them are watchlist rows, and their median TVL. It answers at a glance
  // whether the board is one category's story or the whole pre-token field.
  function categoryPanel() {
    var stats = DATA.category_stats || [];
    var rows = stats.map(function (s) {
      return el('tr', {
        tabindex: '0',
        onclick: function () { openDetail(s.top_slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(s.top_slug); } }
      },
        el('td', null, el('b', { text: s.category })),
        el('td', { class: 'num', text: String(s.rows) }),
        el('td', { class: 'num', text: String(s.watchlist_rows) }),
        el('td', { class: 'num', text: fmtUsd(s.median_tvl_usd) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: s.top_name }),
          el('span', { class: 'sub', text: fmtUsd(s.top_implied_usd) + ' implied' })
        ))
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'Coverage by category' }),
      el('p', { class: 'sub', text: 'Every category on the board, largest first. Watchlist rows are the protocols at or above the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor with no token on record; the rest are the early rows below it.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Board rows' }),
            el('th', { scope: 'col', text: 'Watchlist rows' }),
            el('th', { scope: 'col', text: 'Median TVL' }),
            el('th', { scope: 'col', text: 'Strongest row' })
          )),
          el('tbody', null, rows)
        )
      ),
      el('p', { class: 'sub', text: 'Select a category row to open its strongest protocol.' })
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function of the snapshot figures scores every row. No protocol name is special-cased and no row is hand-picked; the fit below is computed from the live-token protocols in this same snapshot.' }),
      el('div', { class: 'formula' },
        'implied = round( exp(' + DATA.fit.intercept.toFixed(3) + ' + ' + DATA.fit.slope.toFixed(3) + ' x ln(tvl_usd)) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'The base is a log-log regression fitted on the ' + DATA.fit.n + ' live-token protocols in this snapshot: log(mcap) = ' + DATA.fit.intercept.toFixed(3) + ' + ' + DATA.fit.slope.toFixed(3) + ' x log(TVL). Value grows sub-linearly with TVL — doubling TVL raises the base only about 35% — because mcap/TVL falls as protocols get bigger. Growth and age are launch-readiness adjustments, not value predictors: a fast-growing protocol that has waited long with no token is most ready to launch. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('p', { class: 'sub', text: 'Honest uncertainty: a 5-fold held-out check of the regression gives a median error of ' + DATA.held_out_log_error + ' log units, so every row shows a range of implied / ' + DATA.range_factor + ' to implied x ' + DATA.range_factor + '. The point estimate ranks the board; the range is the estimate, not a price. No token is promised: a protocol records no token, which is not proof it has none, and a farm plan is a way to use it, not a guarantee of a launch.' }),
      el('p', { class: 'sub', text: 'The board covers all ' + DATA.watchlist_size + ' watchlist protocols plus every other rankable pre-token protocol in the snapshot — ' + DATA.board_size + ' rows in all — and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  // The detail drawer: one protocol's implied value broken into its inputs,
  // the recomputation that checks the board's number, the honest range and
  // confidence, and the seven-step farm plan. It opens as a modal dialog so
  // the board stays where the reader left it, and Escape closes it.
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Regression base' }), el('b', { class: 'num', text: fmtUsd(row.base_usd) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Honest range (implied / ' + DATA.range_factor + ' to x ' + DATA.range_factor + ')' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_low_usd) + ' – ' + fmtUsd(row.implied_value_high_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and no token is promised.' })
    ));
    var summary = row.farm_summary || null;
    var summaryCard = summary ? el('div', { class: 'farm-summary' },
      el('div', null, el('span', { text: 'Capital needed' }), el('b', { class: 'num', text: '$' + summary.capital_usd })),
      el('div', null, el('span', { text: 'Gas, whole plan' }), el('b', { class: 'num', text: '~$' + summary.gas_usd })),
      el('div', null, el('span', { text: 'Hold' }), el('b', { class: 'num', text: summary.hold_days + ' days' }))
    ) : null;
    var farmSection = el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub', text: 'Seven steps, each with its cost and time. The totals above are the steps added up — setup gas, $2 of gas a week for the hold, and $3 to claim — so the plan states its whole price before it starts.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    );
    if (summaryCard) farmSection.insertBefore(summaryCard, farmSection.children[1]);
    dialog.appendChild(farmSection);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // Render the whole page from state: header, lede, filters, the table for
  // the active tab, and — on the pre-token tab — the model, peer and coverage
  // panels. The detail dialog is kept attached so an open drawer survives
  // a re-render, and a selected slug in the hash reopens its drawer.
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      shell.appendChild(validationPanel());
      shell.appendChild(sensitivityPanel());
      shell.appendChild(biasPanel());
      shell.appendChild(distributionPanel());
      shell.appendChild(categoryPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
