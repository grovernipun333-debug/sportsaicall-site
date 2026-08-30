// SportsAICall build script.
//
// Reads structured match data from content/matches/*.md (written through
// the /admin publishing form) and generates the pages the site actually
// serves: matches/<slug>.html for each match, and a regenerated index.html
// homepage that leads with the next upcoming match. how-it-works.html and
// assets/ are already static and are left untouched.
//
// Zero external dependencies on purpose (see lib/frontmatter.js) so a
// registry hiccup can never break a daily publish.

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./lib/frontmatter');

const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, 'content', 'matches');
const OUT_MATCHES_DIR = path.join(ROOT, 'matches');
const MATCH_TEMPLATE = fs.readFileSync(path.join(ROOT, 'templates', 'match-template.html'), 'utf8');
const INDEX_TEMPLATE = fs.readFileSync(path.join(ROOT, 'templates', 'index-template.html'), 'utf8');

// ---------- helpers ----------

function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pillClass(conf) {
  const c = String(conf || '').toLowerCase();
  if (c === 'high') return 'high';
  if (c === 'low') return 'low';
  return 'medium';
}

function fill(tpl, map) {
  let out = tpl;
  for (const [key, val] of Object.entries(map)) {
    out = out.split(key).join(val === undefined || val === null ? '' : String(val));
  }
  return out;
}

function isReviewed(m) {
  return m.reviewed === true || m.reviewed === 'true' || m.reviewed === 'Reviewed';
}

// ---------- load content ----------

fs.mkdirSync(OUT_MATCHES_DIR, { recursive: true });

const files = fs.existsSync(CONTENT_DIR)
  ? fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'))
  : [];

const allMatches = files.map((file) => {
  const raw = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8');
  const { data } = parseFrontmatter(raw);
  data._slug = file.replace(/\.md$/, '');
  return data;
});

const upcoming = allMatches
  .filter((m) => !isReviewed(m))
  .sort((a, b) => String(a.date_sort || '9999-99-99').localeCompare(String(b.date_sort || '9999-99-99')));

const reviewed = allMatches
  .filter(isReviewed)
  .sort((a, b) => String(b.date_sort || '').localeCompare(String(a.date_sort || '')));

const nextMatch = upcoming[0] || null;
const moreUpcoming = upcoming.slice(1);

// ---------- shared render blocks (used on both the homepage teaser and the full match page) ----------

function edgeSection(m) {
  const edges = Array.isArray(m.edges) ? m.edges.filter((e) => e && e.label) : [];
  if (!edges.length) return '';
  const cells = edges
    .map(
      (e) => `        <div class="edge-cell">
          <div class="edge-label">${esc(e.label)}</div>
          <div class="edge-value">${esc(e.value)}</div>
        </div>`
    )
    .join('\n');
  return `    <section>
      <div class="ai-tag">The Edges</div>
      <div class="edge-grid" style="margin-top:0;">
${cells}
      </div>
    </section>`;
}

function insightsSection(m, opts) {
  const insights = Array.isArray(m.insights) ? m.insights.filter(Boolean) : [];
  if (!insights.length) return '';
  const cards = insights
    .map(
      (t) => `        <div class="spotted-card">
          <p>${esc(t)}</p>
        </div>`
    )
    .join('\n');
  const seeMore = opts && opts.link
    ? `\n      <p style="margin-top:1rem;"><a href="${opts.link}">See the full analysis &rarr;</a></p>`
    : '';
  return `    <section>
      <div class="ai-tag">AI Spotted This</div>
      <div class="spotted-grid">
${cards}
      </div>${seeMore}
    </section>`;
}

function keyStatSection(m) {
  if (!m.key_stat_value || !m.key_stat_text) return '';
  return `    <section>
      <div class="ai-tag">The Stat That Could Change This Match</div>
      <div class="key-stat">
        <div class="stat-num">${esc(m.key_stat_value)}</div>
        <div class="stat-body">
          <p>${esc(m.key_stat_text)}</p>
          ${m.key_stat_note ? `<p class="stat-note">${esc(m.key_stat_note)}</p>` : ''}
        </div>
      </div>
    </section>`;
}

function matchupSection(m) {
  const matchups = Array.isArray(m.matchups) ? m.matchups.filter((x) => x && x.player_a) : [];
  if (!matchups.length) return '';
  const cards = matchups
    .map(
      (mu) => `        <div class="matchup-card">
          <div class="versus">${esc(mu.player_a)} <span class="vs">vs</span> ${esc(mu.player_b)}</div>
          <p>${esc(mu.note)}</p>
        </div>`
    )
    .join('\n');
  return `    <section>
      <div class="ai-tag">Matchups AI Is Watching</div>
      <div class="matchup-grid">
${cards}
      </div>
    </section>`;
}

function flipSection(m) {
  let factors = Array.isArray(m.flip_factors) ? m.flip_factors.filter((x) => x && x.label) : [];
  if (!factors.length && m.what_could_change) {
    factors = [{ label: 'Watch for', text: m.what_could_change }];
  }
  if (!factors.length) return '';
  const cards = factors
    .map(
      (f) => `        <div class="flip-card">
          <div class="flip-label">${esc(f.label)}</div>
          <p>${esc(f.text)}</p>
        </div>`
    )
    .join('\n');
  return `    <section>
      <div class="kicker"><span class="num">—</span><h2>What Could Flip the AI Call?</h2></div>
      <div class="flip-grid">
${cards}
      </div>
    </section>`;
}

function aiVsRealitySection(m) {
  if (!isReviewed(m)) return '';
  const items = Array.isArray(m.ai_vs_reality) ? m.ai_vs_reality.filter((x) => x && x.ai_saw) : [];
  if (!items.length) return '';
  const rows = items
    .map((it) => {
      const v = String(it.verdict || '').toLowerCase();
      const mark = v === 'held up' || v === 'held_up' || v === 'right' ? '&#10003;' : v === 'mixed' ? '&#8776;' : '&#10007;';
      const cls = v === 'held up' || v === 'held_up' || v === 'right' ? 'high' : v === 'mixed' ? 'medium' : 'low';
      return `        <div class="match-card" style="cursor:default; margin-bottom:0.8rem;">
          <p style="margin-bottom:0.4rem;"><strong>AI saw:</strong> ${esc(it.ai_saw)}</p>
          <p style="margin-bottom:0.6rem;"><strong>Actual:</strong> ${esc(it.actual)}</p>
          <span class="pill ${cls}">${mark} ${esc(it.verdict || '')}</span>
        </div>`;
    })
    .join('\n');
  return `    <section id="ai-vs-reality">
      <div class="ai-tag">AI vs Reality</div>
${rows}
    </section>`;
}

// ---------- match page ----------

for (const m of allMatches) {
  const probA = Math.max(1, Math.min(99, Number(m.prob_a) || 50));
  const probB = 100 - probA;
  const reviewedBadge = isReviewed(m)
    ? '<div class="ai-tag" style="background:var(--accent-soft); color:var(--accent-ink);">Reviewed &middot; AI vs Reality below</div>'
    : '';
  const confidenceNoteLine = m.confidence_note ? ` — ${esc(m.confidence_note)}` : '';

  const html = fill(MATCH_TEMPLATE, {
    '{{TITLE}}': `${esc(m.team_a)} vs ${esc(m.team_b)}, ${esc(m.match_label)} — AI Match Analysis | SportsAICall`,
    '{{META_DESC}}': `SportsAICall's AI match analysis for ${esc(m.team_a)} vs ${esc(m.team_b)}, ${esc(m.match_label)} — outlook, key matchups, and confidence.`,
    '{{SERIES}}': esc(m.series),
    '{{MATCH_LABEL}}': esc(m.match_label),
    '{{DATE_LABEL}}': esc(m.date_label),
    '{{TEAM_A}}': esc(m.team_a),
    '{{TEAM_B}}': esc(m.team_b),
    '{{TEAM_A_SHORT}}': esc(m.team_a_short || m.team_a),
    '{{TEAM_B_SHORT}}': esc(m.team_b_short || m.team_b),
    '{{VENUE}}': esc(m.venue) || 'TBC',
    '{{PROB_A}}': probA,
    '{{PROB_B}}': probB,
    '{{CONFIDENCE}}': esc(m.confidence) || 'Medium',
    '{{CONFIDENCE_CLASS}}': pillClass(m.confidence),
    '{{CONFIDENCE_NOTE_LINE}}': confidenceNoteLine,
    '{{REVIEWED_BADGE}}': reviewedBadge,
    '{{EDGE_SECTION}}': edgeSection(m),
    '{{INSIGHTS_SECTION}}': insightsSection(m),
    '{{KEY_STAT_SECTION}}': keyStatSection(m),
    '{{MATCHUP_SECTION}}': matchupSection(m),
    '{{FLIP_SECTION}}': flipSection(m),
    '{{AI_VS_REALITY_SECTION}}': aiVsRealitySection(m),
  });

  fs.writeFileSync(path.join(OUT_MATCHES_DIR, `${m._slug}.html`), html);
}

// ---------- homepage ----------

function heroSection() {
  if (!nextMatch) {
    return `<section class="hero">
  <div class="wrap">
    <p class="eyebrow">AI Match Outlook</p>
    <h1>No open AI Call right now — check back before the next big series.</h1>
    <p class="brand-line">SportsAICall &middot; Read the Game Before It Starts</p>
    <div class="hero-actions">
      <a class="btn primary" href="how-it-works.html">How the analysis engine works</a>
    </div>
  </div>
</section>`;
  }
  const m = nextMatch;
  const probA = Math.max(1, Math.min(99, Number(m.prob_a) || 50));
  const probB = 100 - probA;
  const edges = Array.isArray(m.edges) ? m.edges.filter((e) => e && e.label) : [];
  const edgeCells = edges
    .map(
      (e) => `          <div class="edge-cell">
            <div class="edge-label">${esc(e.label)}</div>
            <div class="edge-value">${esc(e.value)}</div>
          </div>`
    )
    .join('\n');
  const edgeGrid = edges.length ? `        <div class="edge-grid">\n${edgeCells}\n        </div>` : '';
  const countdown = m.date_sort
    ? `<span class="countdown" data-countdown="${esc(m.date_sort)}">First ball &middot; ${esc(m.date_label)}</span>`
    : `<span class="countdown">${esc(m.date_label)}</span>`;

  return `<section class="hero">
  <div class="wrap">
    <p class="eyebrow">Next AI Call</p>
    <div class="next-call">
      ${countdown}
      <div class="fixture-line">${esc(m.series)} &middot; ${esc(m.match_label)}</div>
      <div class="teams">${esc(m.team_a)} <span class="vs">vs</span> ${esc(m.team_b)}</div>
      <div class="outlook-label">AI Match Outlook</div>
      <div class="outlook-bars">
        <div class="outlook-row">
          <span class="name">${esc(m.team_a_short || m.team_a)}</span>
          <span class="track"><span class="fill" style="width:${probA}%"></span></span>
          <span class="pct">${probA}%</span>
        </div>
        <div class="outlook-row">
          <span class="name">${esc(m.team_b_short || m.team_b)}</span>
          <span class="track"><span class="fill b" style="width:${probB}%"></span></span>
          <span class="pct">${probB}%</span>
        </div>
      </div>
${edgeGrid}
      <div class="hero-actions">
        <a class="btn primary" href="matches/${m._slug}.html">See What AI Found</a>
        <a class="btn ghost" href="how-it-works.html">How this works</a>
      </div>
    </div>
    <p class="brand-line" style="margin-top:1.4rem; margin-bottom:0;">SportsAICall &middot; Read the Game Before It Starts</p>
  </div>
</section>
<script>
(function(){
  var el = document.querySelector('[data-countdown]');
  if (!el) return;
  var target = new Date(el.getAttribute('data-countdown') + 'T00:00:00Z').getTime();
  var diff = target - Date.now();
  if (diff > 0) {
    var days = Math.floor(diff / 86400000);
    var hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) {
      el.textContent = 'First ball in ' + days + 'd ' + hours + 'h';
    } else if (hours > 0) {
      el.textContent = 'First ball in ' + hours + 'h';
    }
  }
})();
</script>`;
}

function matchCard(m) {
  const probA = Math.max(1, Math.min(99, Number(m.prob_a) || 50));
  const probB = 100 - probA;
  const confClass = pillClass(m.confidence);
  return `        <a class="match-card" href="matches/${m._slug}.html">
          <div class="series">${esc(m.series)} &middot; ${esc(m.date_label)}</div>
          <h3>${esc(m.team_a)} vs ${esc(m.team_b)} — ${esc(m.match_label)}</h3>
          <div class="meta">Venue ${esc(m.venue) || 'TBC'} &middot; AI Confidence: <span class="pill ${confClass}">${esc(m.confidence) || 'Medium'}</span></div>
          <div class="prob">
            <span>${esc(m.team_a_short || m.team_a)} ${probA}%</span>
            <span class="bar"><span class="a" style="width:${probA}%"></span><span class="b" style="width:${probB}%"></span></span>
            <span>${probB}% ${esc(m.team_b_short || m.team_b)}</span>
          </div>
        </a>`;
}

function moreMatchesSection() {
  const rest = moreUpcoming.concat(reviewed.slice(0, 2));
  const cards = rest.length
    ? rest.map(matchCard).join('\n')
    : `        <div class="match-card" style="opacity:0.6; cursor:default;">
          <div class="series">More matches added as fixtures are confirmed</div>
          <h3>Next AI Call coming soon</h3>
          <div class="meta">New match breakdowns go up ahead of every major series</div>
        </div>`;
  return `    <section id="matches">
      <div class="kicker"><span class="num">—</span><h2>More Upcoming Matches</h2></div>
      <div class="match-grid">
${cards}
      </div>
    </section>`;
}

function trackRecordSection() {
  let held = 0;
  let mixed = 0;
  let missed = 0;
  for (const m of reviewed) {
    const items = Array.isArray(m.ai_vs_reality) ? m.ai_vs_reality : [];
    for (const it of items) {
      const v = String(it.verdict || '').toLowerCase();
      if (v === 'held up' || v === 'held_up' || v === 'right') held++;
      else if (v === 'mixed') mixed++;
      else if (v === 'missed' || v === 'wrong') missed++;
    }
  }
  const totalCalls = held + mixed + missed;
  if (reviewed.length === 0) {
    return `      <div class="callout">
        <span class="tag">Coming soon</span>
        <p>We haven't graded a call yet — the first published match will start the public record, and it stays here whether the call held up or not.</p>
      </div>`;
  }
  return `      <div class="scoreboard">
        <div class="score-cell"><div class="score-num">${reviewed.length}</div><div class="score-label">Matches Reviewed</div></div>
        <div class="score-cell"><div class="score-num">${held}</div><div class="score-label">Calls Held Up</div></div>
        <div class="score-cell"><div class="score-num">${mixed}</div><div class="score-label">Mixed</div></div>
        <div class="score-cell"><div class="score-num">${missed}</div><div class="score-label">Missed</div></div>
      </div>
      <p style="margin-top:1rem;">${totalCalls} individual AI reads graded across those matches. See the full breakdown on each <a href="#matches">match page</a>.</p>`;
}

const indexHtml = fill(INDEX_TEMPLATE, {
  '{{HERO_SECTION}}': heroSection(),
  '{{SPOTTED_SECTION}}': nextMatch ? insightsSection(nextMatch, { link: `matches/${nextMatch._slug}.html` }) : '',
  '{{KEY_STAT_SECTION}}': nextMatch ? keyStatSection(nextMatch) : '',
  '{{MATCHUP_SECTION}}': nextMatch ? matchupSection(nextMatch) : '',
  '{{FLIP_SECTION}}': nextMatch ? flipSection(nextMatch) : '',
  '{{MORE_MATCHES_SECTION}}': moreMatchesSection(),
  '{{TRACK_RECORD_SECTION}}': trackRecordSection(),
});

fs.writeFileSync(path.join(ROOT, 'index.html'), indexHtml);

console.log(
  `SportsAICall build: ${allMatches.length} match page(s) (${upcoming.length} upcoming, ${reviewed.length} reviewed). Next call: ${nextMatch ? nextMatch._slug : 'none'}.`
);
