import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceArea, BarChart, Bar, Cell, PieChart, Pie,
} from "recharts";
import {
  Crosshair, TrendingUp, TrendingDown, Shield, Swords, Radar as RadarIcon, Cloud,
  Award, Zap, ChevronDown, ChevronUp, Target, Activity, Map as MapIcon, Sparkles,
  Trophy, Loader2, Download, SlidersHorizontal, X, Camera, Flame,
} from "lucide-react";

function InstagramGlyph({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

/* ---------------------------------- DATA ---------------------------------- */

const AGENTS = [
  { name: "Jett", role: "Duelist", color: "#7DE0E6" },
  { name: "Reyna", role: "Duelist", color: "#B266FF" },
  { name: "Raze", role: "Duelist", color: "#FF8A3D" },
  { name: "Sova", role: "Initiator", color: "#5C9DFF" },
  { name: "Skye", role: "Initiator", color: "#8FD14F" },
  { name: "Fade", role: "Initiator", color: "#9391B8" },
  { name: "Omen", role: "Controller", color: "#8C7CE0" },
  { name: "Viper", role: "Controller", color: "#4CBB7A" },
  { name: "Astra", role: "Controller", color: "#C15CE0" },
  { name: "Killjoy", role: "Sentinel", color: "#FFC94A" },
  { name: "Cypher", role: "Sentinel", color: "#D9CBA0" },
  { name: "Chamber", role: "Sentinel", color: "#E0B15C" },
];

const MAPS = ["Ascent", "Bind", "Haven", "Split", "Icebox", "Breeze", "Fracture", "Pearl", "Lotus", "Sunset"];

const ROLE_ICONS = { Duelist: Swords, Initiator: RadarIcon, Controller: Cloud, Sentinel: Shield };

const TIERS = [
  { name: "Iron", color: "#8B8F97" },
  { name: "Bronze", color: "#B98555" },
  { name: "Silver", color: "#C3CAD1" },
  { name: "Gold", color: "#F2C14E" },
  { name: "Platinum", color: "#3FC1C0" },
  { name: "Diamond", color: "#C08CF0" },
  { name: "Ascendant", color: "#3ED07A" },
  { name: "Immortal", color: "#FF3B5C" },
  { name: "Radiant", color: "#FFE9A8" },
];
const TIER_SPAN = 300; // ladder units per tier (3 divisions x 100 RR)

/* --------------------------------- HELPERS --------------------------------- */

const REGIONS = [
  { value: "na", label: "NA" },
  { value: "eu", label: "EU" },
  { value: "ap", label: "AP" },
  { value: "kr", label: "KR" },
  { value: "latam", label: "LATAM" },
  { value: "br", label: "BR" },
];

const HENRIK_BASE = "https://api.henrikdev.xyz";

// ⚠️ Set this to your own HenrikDev API key before publishing.
// Anyone who opens this page's network tab can see it — that's an
// inherent tradeoff of a client-only app with no backend. Get a free
// "Basic" key at the HenrikDev Discord, #get-a-key channel.
const HENRIK_API_KEY = "HDEV-6bd9014f-cd49-4d9e-9d8f-e8704bdd741e";

// Parses HenrikDev's "currenttierpatched" strings like "Immortal 2" or "Radiant"
// into a { name, division } pair so we can plot it on the same TIERS/TIER_SPAN
// ladder the rest of the UI already understands.
function parseTierPatched(tierPatched) {
  const raw = (tierPatched || "Iron 1").trim();
  const parts = raw.split(/\s+/);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && /^[1-3]$/.test(last)) {
    return { name: parts.slice(0, -1).join(" "), division: parseInt(last, 10) };
  }
  return { name: raw, division: null };
}

function ladderFromTierRR(tierPatched, rr) {
  const { name, division } = parseTierPatched(tierPatched);
  let tierIdx = TIERS.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
  if (tierIdx < 0) tierIdx = 0; // unranked / unrecognized tier name — floor at Iron
  const safeRR = Number.isFinite(rr) ? rr : 0;
  if (TIERS[tierIdx].name === "Radiant") return tierIdx * TIER_SPAN + safeRR;
  const div = division || 1;
  return tierIdx * TIER_SPAN + (div - 1) * 100 + safeRR;
}

async function fetchTierIconMap() {
  const res = await fetch("https://valorant-api.com/v1/competitivetiers");
  const json = await res.json();
  const episodes = json?.data || [];
  const latest = episodes[episodes.length - 1];
  const map = {};
  (latest?.tiers || []).forEach((t) => {
    if (t.tierName) map[t.tierName.toLowerCase()] = { icon: t.largeIcon, color: t.color };
  });
  return map;
}

async function fetchAgentIconMap() {
  const res = await fetch("https://valorant-api.com/v1/agents?isPlayableCharacter=true");
  const json = await res.json();
  const map = {};
  (json?.data || []).forEach((a) => {
    if (a.displayName) map[a.displayName.toLowerCase()] = a.displayIcon;
  });
  return map;
}

async function fetchMapAssetMap() {
  const res = await fetch("https://valorant-api.com/v1/maps");
  const json = await res.json();
  const map = {};
  (json?.data || []).forEach((m) => {
    if (m.displayName) map[m.displayName.toLowerCase()] = { splash: m.splash, listIcon: m.listViewIcon };
  });
  return map;
}

// Best-effort extraction of per-weapon kill counts for one player from a raw
// HenrikDev v3 match object's round-by-round data. This part of the schema is
// less stable than the top-level stats, so every access is optional-chained
// and a match that doesn't have round data just contributes nothing.
function extractWeaponKills(raw, puuid) {
  const counts = {};
  const rounds = Array.isArray(raw?.rounds) ? raw.rounds : [];
  rounds.forEach((round) => {
    const playerStats = Array.isArray(round?.player_stats) ? round.player_stats : [];
    const playerRound = playerStats.find((p) => p.player_puuid === puuid);
    const kills = Array.isArray(playerRound?.kills) ? playerRound.kills : [];
    kills.forEach((k) => {
      const weapon = k?.finishing_damage?.damage_item || k?.damage_weapon_name;
      if (weapon && weapon.toLowerCase() !== "melee") {
        counts[weapon] = (counts[weapon] || 0) + 1;
      }
    });
  });
  return counts;
}

async function henrikFetch(path, apiKey) {
  const res = await fetch(`${HENRIK_BASE}${path}`, {
    headers: apiKey ? { Authorization: apiKey } : {},
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message || json?.message || `HTTP ${res.status} on ${path}`;
    throw new Error(msg);
  }
  return json;
}

// Turns one raw HenrikDev v3 match object into the flat shape the rest of
// this UI (MatchRow, agent/map aggregation, chart) already expects.
function normalizeMatch(raw, puuid, index) {
  const me = raw.players?.all_players?.find((p) => p.puuid === puuid);
  if (!me) return null;
  const myTeam = (me.team || "").toLowerCase();
  const otherTeam = myTeam === "red" ? "blue" : "red";
  const teamData = raw.teams?.[myTeam];
  const oppData = raw.teams?.[otherTeam];
  const win = !!teamData?.has_won;
  const scoreFor = teamData?.rounds_won ?? 0;
  const scoreAgainst = oppData?.rounds_won ?? 0;
  const rounds = raw.metadata?.rounds_played || scoreFor + scoreAgainst || 1;
  const stats = me.stats || {};
  const hsShots = (stats.headshots || 0);
  const totalShots = hsShots + (stats.bodyshots || 0) + (stats.legshots || 0);
  const agentMeta = AGENTS.find((a) => a.name.toLowerCase() === (me.character || "").toLowerCase());
  const allPlayers = Array.isArray(raw.players?.all_players) ? raw.players.all_players : [];
  const allScores = allPlayers.map((p) => p.stats?.score || 0);
  const scoresForMax = allScores.length ? allScores : [0];
  const mvp = win && (stats.score || 0) === Math.max(...scoresForMax);
  const startSec = raw.metadata?.game_start;
  const minutesAgo = startSec ? Math.max(0, Math.round((Date.now() / 1000 - startSec) / 60)) : index * 60;

  return {
    id: raw.metadata?.matchid || `match-${index}`,
    map: raw.metadata?.map || "Unknown",
    agent: me.character || "Unknown",
    role: agentMeta?.role || "Duelist",
    agentColor: agentMeta?.color || "#9391B8",
    result: win ? "WIN" : "LOSS",
    scoreFor, scoreAgainst,
    kills: stats.kills || 0, deaths: stats.deaths || 0, assists: stats.assists || 0,
    acs: Math.round((stats.score || 0) / rounds),
    hs: totalShots ? Math.round((hsShots / totalShots) * 100) : 0,
    firstBloods: null, // not exposed by this endpoint
    clutches: null,    // not exposed by this endpoint
    mvp,
    minutesAgo,
  };
}

function ladderInfo(ladderRaw) {
  const ladder = Math.max(0, ladderRaw);
  const tierIndex = Math.min(TIERS.length - 1, Math.floor(ladder / TIER_SPAN));
  const tier = TIERS[tierIndex];
  const remainder = ladder - tierIndex * TIER_SPAN;
  if (tier.name === "Radiant") {
    return { tierIndex, tierName: tier.name, tierColor: tier.color, division: null, rr: Math.round(remainder), label: "Radiant", sub: `${Math.round(remainder)} RR` };
  }
  const division = Math.min(3, Math.floor(remainder / 100) + 1);
  const rr = Math.round(remainder % 100);
  return { tierIndex, tierName: tier.name, tierColor: tier.color, division, rr, label: `${tier.name} ${division}`, sub: `${rr} RR` };
}

function formatTimeAgo(minutes) {
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ------------------------------- SUBCOMPONENTS ------------------------------ */

function RankDot(props) {
  const { cx, cy, payload, index } = props;
  const key = `dot-${index}`;
  if (payload.promotion) {
    return (
      <g key={key}>
        <circle cx={cx} cy={cy} r={7} fill="none" stroke="#FFE9A8" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={2.5} fill="#FFE9A8" />
      </g>
    );
  }
  if (payload.demotion) {
    return <circle key={key} cx={cx} cy={cy} r={4} fill="#FF3B5C" stroke="#0B0E14" strokeWidth={1} />;
  }
  return <circle key={key} cx={cx} cy={cy} r={2} fill={payload.result === "WIN" ? "#4CE0D2" : "#FF3B5C"} opacity={0.6} />;
}

function RankTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  const info = ladderInfo(p.ladder);
  return (
    <div className="hud-tooltip">
      <div className="hud-tooltip-rank" style={{ color: info.tierColor }}>{info.label} · {info.sub}</div>
      <div className="hud-tooltip-row">{p.map}{p.agent ? ` — ${p.agent}` : ""}</div>
      <div className={`hud-tooltip-row ${p.result === "WIN" ? "cyan" : "red"}`}>{p.result} · {p.rrDelta > 0 ? "+" : ""}{p.rrDelta} RR</div>
    </div>
  );
}

function AgentTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const a = payload[0].payload;
  return (
    <div className="hud-tooltip">
      <div className="hud-tooltip-rank" style={{ color: a.color }}>{a.name}</div>
      <div className="hud-tooltip-row">{a.winRate.toFixed(0)}% WR · {a.games} games</div>
      <div className="hud-tooltip-row">{a.avgAcs} ACS · {a.kd} K/D</div>
    </div>
  );
}

function StatChip({ icon: Icon, label, value, accent = "text" }) {
  return (
    <div className={`stat-chip accent-${accent}`}>
      <Icon size={15} className="stat-chip-icon" />
      <div>
        <div className="stat-chip-value">{value}</div>
        <div className="stat-chip-label">{label}</div>
      </div>
    </div>
  );
}

function PanelHeader({ icon: Icon, title, right }) {
  return (
    <div className="panel-header">
      <div className="panel-header-title"><Icon size={14} className="panel-header-icon" /> {title}</div>
      {right}
    </div>
  );
}

function FormStrip({ matches }) {
  const recent = matches.slice(-10);
  return (
    <div className="form-strip">
      {recent.map((m) => (
        <div
          key={m.id}
          className={`form-chip ${m.result === "WIN" ? "win" : "loss"}`}
          title={`${m.map} · ${m.agent} · ${m.result}`}
        >
          {m.result === "WIN" ? "W" : "L"}
        </div>
      ))}
    </div>
  );
}

function AgentIcon({ name, role, iconUrl, size }) {
  const RoleIcon = ROLE_ICONS[role] || ROLE_ICONS.Duelist;
  if (iconUrl) {
    return <img className="agent-icon-img" src={iconUrl} alt={name} width={size} height={size} loading="lazy" />;
  }
  return <RoleIcon size={Math.round(size * 0.55)} />;
}

function MatchRow({ m, expanded, onToggle, iconMap }) {
  const win = m.result === "WIN";
  return (
    <div className={`match-row ${win ? "win" : "loss"}`}>
      <button className="match-row-head" onClick={onToggle}>
        <span className="match-result-bar" />
        <span className={`match-result-badge ${win ? "win" : "loss"}`}>{win ? "WIN" : "LOSS"}</span>
        <span className="match-agent-badge" style={{ "--agent-color": m.agentColor }}>
          <AgentIcon name={m.agent} role={m.role} iconUrl={iconMap[m.agent.toLowerCase()]} size={40} />
        </span>
        <div className="match-main-info">
          <div className="match-title">{m.agent} <span className="dim">on</span> {m.map}</div>
          <div className="match-sub dim">
            {formatTimeAgo(m.minutesAgo)}
            {m.mvp && <span className="mvp-tag"><Award size={10} /> MVP</span>}
          </div>
        </div>
        <div className="match-score">{m.scoreFor}<span className="dim">–</span>{m.scoreAgainst}</div>
        <div className="match-kda-block">
          <span className="match-kda">{m.kills}<span className="dim">/</span>{m.deaths}<span className="dim">/</span>{m.assists}</span>
          <span className="match-kda-label dim">K / D / A</span>
        </div>
        <span className="match-stat-pill acs">{m.acs} <b>ACS</b></span>
        <span className={`match-stat-pill hs ${m.hs >= 25 ? "hot" : ""}`}>{m.hs}% <b>HS</b></span>
        {expanded ? <ChevronUp size={15} className="dim" /> : <ChevronDown size={15} className="dim" />}
      </button>
      {expanded && (
        <div className="match-detail">
          <div className="detail-chip"><Target size={12} /> HS {m.hs}%</div>
          <div className="detail-chip"><Activity size={12} /> {m.acs} ACS</div>
          <div className="detail-chip"><Crosshair size={12} /> {m.kills}/{m.deaths}/{m.assists} KDA</div>
          {m.mvp && <div className="detail-chip"><Award size={12} /> Match MVP</div>}
        </div>
      )}
    </div>
  );
}

const TABS = [
  { id: "overview", label: "OVERVIEW", icon: Activity },
  { id: "matches", label: "MATCH LOG", icon: Crosshair },
  { id: "agents", label: "AGENTS", icon: Swords },
  { id: "maps", label: "MAPS", icon: MapIcon },
  { id: "coach", label: "AI COACH", icon: Sparkles },
];

function TabNav({ active, onChange, onOpenAbout }) {
  return (
    <nav className="tab-nav">
      <div className="tab-nav-brand">
        <span className="brand-mark">◆</span>
        <div>
          <div className="brand-title">OPS<span className="accent">TRACK</span></div>
          <div className="brand-sub">TACTICAL PERFORMANCE READOUT</div>
        </div>
      </div>
      <div className="tab-nav-list">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} className={`tab-btn ${active === t.id ? "active" : ""}`} onClick={() => onChange(t.id)}>
              <span className="tab-btn-icon"><Icon size={15} /></span>
              <span>{t.label}</span>
              <span className="tab-btn-indicator" />
            </button>
          );
        })}
      </div>
      <button className="tab-nav-credit" onClick={onOpenAbout}>
        <InstagramGlyph size={13} />
        <span>Built by <b>Eslavath Kaushik Nandan</b></span>
      </button>
    </nav>
  );
}

function AboutModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="hud-panel about-card" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onClose}><X size={16} /></button>
        <div className="about-header">
          <span className="brand-mark">◆</span>
          <div className="about-header-title dim">ABOUT ME</div>
        </div>
        <div className="about-name">Eslavath Kaushik Nandan</div>
        <p className="about-bio">
          I'm Kaushik, a 14-year-old student and aspiring developer with a passion for technology, gaming, and creating
          modern web experiences. I enjoy building projects, exploring new ideas, and constantly learning new skills.
          Every project I create is another step toward becoming a better developer.
        </p>
        <div className="about-meta-row">
          <div className="about-meta"><span className="dim">AGE</span><b>14</b></div>
          <div className="about-meta"><span className="dim">ROLE</span><b>Student · Web Developer · Gamer</b></div>
        </div>
        <a className="coach-run-btn about-insta-btn" href="https://instagram.com/neo.x.unit" target="_blank" rel="noopener noreferrer">
          <InstagramGlyph size={15} /> @neo.x.unit
        </a>
      </div>
    </div>
  );
}

function RankRing({ pct, color, size = 64, children }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div className="rank-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} className="rank-ring-arc"
        />
      </svg>
      <div className="rank-ring-inner">{children}</div>
    </div>
  );
}

function TopBar({ player, currentInfo, matchesCount, onDisconnect, tierIcon }) {
  const progressPct = currentInfo.tierName === "Radiant" ? 100 : currentInfo.rr;
  return (
    <div className="topbar hud-panel" style={{ "--tier-color": currentInfo.tierColor }}>
      <div className="topbar-glow" />
      <div className="topbar-id">
        <RankRing pct={progressPct} color={currentInfo.tierColor} size={72}>
          {tierIcon ? <img src={tierIcon} alt={currentInfo.label} className="rank-ring-icon" /> : <span className="avatar-badge-fallback">{player.name.slice(0, 2).toUpperCase()}</span>}
        </RankRing>
        <div>
          <div className="topbar-name">{player.name}<span className="topbar-tag dim">#{player.tag}</span></div>
          <div className="topbar-rank" style={{ color: currentInfo.tierColor }}>{currentInfo.label} <span className="dim">· {currentInfo.sub}</span></div>
          <div className="topbar-rr-label dim">{currentInfo.tierName === "Radiant" ? "TOP OF THE LADDER" : `${100 - Math.round(currentInfo.rr)} RR TO NEXT RANK`}</div>
        </div>
      </div>
      <div className="topbar-right">
        <div className="topbar-feed-badge"><span className="feed-dot" />LIVE · {matchesCount} MATCHES LOADED</div>
        <button className="topbar-disconnect" onClick={onDisconnect}>SWITCH ACCOUNT</button>
      </div>
    </div>
  );
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCornerBracket(ctx, x, y, sx, sy, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + size * sy);
  ctx.lineTo(x, y);
  ctx.lineTo(x + size * sx, y);
  ctx.stroke();
}

async function drawRankCard(canvas, data) {
  const W = 1000, H = 560;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const agentImg = await loadImage(data.agentIconUrl);

  // base gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#0B0D12");
  grad.addColorStop(1, "#15181f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // faint scanline texture
  ctx.strokeStyle = "rgba(255,255,255,0.02)";
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // soft tier-color glow behind avatar
  ctx.save();
  ctx.filter = "blur(50px)";
  ctx.fillStyle = data.tierColor + "55";
  ctx.beginPath();
  ctx.arc(150, 210, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // outer border + corner brackets
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  const bs = 34;
  drawCornerBracket(ctx, 2, 2, 1, 1, bs, data.tierColor);
  drawCornerBracket(ctx, W - 2, 2, -1, 1, bs, data.tierColor);
  drawCornerBracket(ctx, 2, H - 2, 1, -1, bs, data.tierColor);
  drawCornerBracket(ctx, W - 2, H - 2, -1, -1, bs, data.tierColor);

  // header
  ctx.fillStyle = data.tierColor;
  ctx.font = "700 26px 'Chakra Petch', sans-serif";
  ctx.fillText("◆", 44, 66);
  ctx.fillStyle = "#F5F3FF";
  ctx.fillText("OPSTRACK", 74, 66);
  ctx.fillStyle = "#A79FC9";
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.fillText("TACTICAL PERFORMANCE READOUT", 74, 84);
  const headRule = ctx.createLinearGradient(44, 0, 640, 0);
  headRule.addColorStop(0, data.tierColor);
  headRule.addColorStop(1, "rgba(0,0,0,0)");
  ctx.strokeStyle = headRule;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(44, 100); ctx.lineTo(640, 100); ctx.stroke();

  // avatar — real agent portrait if we have one, else initials
  ctx.save();
  ctx.beginPath();
  ctx.arc(150, 210, 68, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fill();
  if (agentImg) {
    ctx.clip();
    const size = 136;
    ctx.drawImage(agentImg, 150 - size / 2, 210 - size / 2 - 10, size, size);
  }
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = data.tierColor;
  ctx.beginPath();
  ctx.arc(150, 210, 68, 0, Math.PI * 2);
  ctx.stroke();
  if (!agentImg) {
    ctx.fillStyle = "#F5F3FF";
    ctx.font = "700 46px 'Chakra Petch', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(data.initials, 150, 216);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  // name / rank
  ctx.fillStyle = "#F5F3FF";
  ctx.font = "700 34px 'Chakra Petch', sans-serif";
  ctx.fillText(data.name, 250, 190);
  ctx.fillStyle = "#A79FC9";
  ctx.font = "20px 'Chakra Petch', sans-serif";
  ctx.fillText(`#${data.tag}`, 250, 218);

  ctx.font = "700 30px 'Chakra Petch', sans-serif";
  const rankTextW = ctx.measureText(data.rankLabel).width;
  ctx.fillStyle = data.tierColor + "22";
  roundRect(ctx, 246, 236, rankTextW + 24, 40, 5);
  ctx.fill();
  ctx.fillStyle = data.tierColor;
  ctx.fillText(data.rankLabel, 258, 264);
  ctx.fillStyle = "#A79FC9";
  ctx.font = "16px 'JetBrains Mono', monospace";
  ctx.fillText(data.rankSub, 250, 300);

  // stat grid
  const stats = [
    ["WIN RATE", data.winRate, "#F5F3FF"],
    ["K/D RATIO", data.kd, "#F5F3FF"],
    ["HEADSHOT %", data.hs, "#F5F3FF"],
    ["AVG ACS", data.acs, "#F5F3FF"],
    ["STREAK", data.streak, data.streakIsWin ? "#61EBFF" : "#FF3B5C"],
    ["TOP AGENT", data.topAgent, "#F5F3FF"],
  ];
  const cols = 3, boxW = 292, boxH = 92, gap = 20, startX = 44, startY = 344;
  stats.forEach(([label, value, color], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = startX + col * (boxW + gap), y = startY + row * (boxH + gap);
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    roundRect(ctx, x, y, boxW, boxH, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, boxW, boxH, 6);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(x, y + 10, 3, boxH - 20);
    ctx.fillStyle = "#A79FC9";
    ctx.font = "10.5px 'JetBrains Mono', monospace";
    ctx.fillText(label, x + 20, y + 32);
    ctx.fillStyle = color;
    ctx.font = "700 27px 'Chakra Petch', sans-serif";
    ctx.fillText(String(value), x + 20, y + 66);
  });

  ctx.fillStyle = data.tierColor;
  ctx.font = "10px sans-serif";
  ctx.fillText("◆", 44, H - 23);
  ctx.fillStyle = "#6C6390";
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.fillText("GENERATED VIA OPSTRACK · REAL-TIME VALORANT PERFORMANCE READOUT", 58, H - 26);
}

function ShareCardButton({ cardData }) {
  const [open, setOpen] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (open && canvasRef.current) {
      // Fonts may still be loading on first paint — draw once immediately, then
      // again after fonts settle so text doesn't fall back to a serif font.
      drawRankCard(canvasRef.current, cardData);
      if (document.fonts?.ready) document.fonts.ready.then(() => canvasRef.current && drawRankCard(canvasRef.current, cardData));
    }
  }, [open, cardData]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cardData.name}-rank-card.png`;
    a.click();
  };

  return (
    <>
      <button className="share-card-trigger" onClick={() => setOpen(true)}><Camera size={14} /> SHARE RANK CARD</button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <canvas ref={canvasRef} className="rank-card-canvas" />
            <div className="modal-actions">
              <button className="coach-run-btn" onClick={download}><Download size={15} /> DOWNLOAD PNG</button>
              <button className="topbar-disconnect" onClick={() => setOpen(false)}>CLOSE</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OverviewTab({ stats, chartData, yDomain, tiersInRange, matches, player, currentInfo, agentStats, iconMap }) {
  const topAgent = agentStats[0]?.name || "—";
  const cardData = {
    name: player.name, tag: player.tag, initials: player.name.slice(0, 2).toUpperCase(),
    tierColor: currentInfo.tierColor, rankLabel: currentInfo.label, rankSub: currentInfo.sub,
    winRate: `${stats.winRate.toFixed(1)}%`, kd: stats.kd.toFixed(2), hs: `${Math.round(stats.avgHS)}%`,
    acs: Math.round(stats.avgACS), streak: `${stats.streakCount}${stats.streakType === "WIN" ? "W" : "L"}`,
    streakIsWin: stats.streakType === "WIN", topAgent, agentIconUrl: iconMap?.[topAgent.toLowerCase()] || null,
  };
  return (
    <div className="tab-stack">
      <div className="overview-top-row">
        <div className="chip-row">
        <StatChip icon={Trophy} label="WIN RATE" value={`${stats.winRate.toFixed(1)}%`} accent="cyan" />
        <StatChip icon={Crosshair} label="K/D RATIO" value={stats.kd.toFixed(2)} accent="text" />
        <StatChip icon={Target} label="HEADSHOT %" value={`${Math.round(stats.avgHS)}%`} accent="amber" />
        <StatChip icon={Activity} label="AVG ACS" value={Math.round(stats.avgACS)} accent="text" />
        <StatChip icon={stats.streakType === "WIN" ? TrendingUp : TrendingDown} label="STREAK" value={`${stats.streakCount}${stats.streakType === "WIN" ? "W" : "L"}`} accent={stats.streakType === "WIN" ? "cyan" : "red"} />
        <StatChip icon={Zap} label="AVG ASSISTS" value={stats.avgAssists.toFixed(1)} accent="amber" />
        </div>
        <ShareCardButton cardData={cardData} />
      </div>

      <div className="hud-panel">
        <PanelHeader icon={TrendingUp} title="RANK TRAJECTORY" right={<span className="panel-header-note dim">LAST {matches.length} MATCHES</span>} />
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 16, right: 12, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4CE0D2" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#4CE0D2" stopOpacity={0} />
              </linearGradient>
            </defs>
            {tiersInRange.map((t) => (
              <ReferenceArea
                key={t.name}
                y1={Math.max(yDomain[0], t.i * TIER_SPAN)}
                y2={Math.min(yDomain[1], (t.i + 1) * TIER_SPAN)}
                fill={t.color}
                fillOpacity={0.07}
                stroke="none"
                label={{ value: t.name.toUpperCase(), position: "insideTopLeft", fill: t.color, fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
              />
            ))}
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="match" tick={{ fill: "#A79FC9", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }} axisLine={{ stroke: "rgba(255,255,255,0.12)" }} tickLine={false} />
            <YAxis domain={yDomain} hide />
            <Tooltip content={<RankTooltip />} cursor={{ stroke: "#FF3B5C", strokeDasharray: "3 3" }} />
            <Area type="monotone" dataKey="ladder" stroke="none" fill="url(#areaGrad)" isAnimationActive={false} />
            <Line type="monotone" dataKey="ladder" stroke="#4CE0D2" strokeWidth={2.5} dot={<RankDot />} activeDot={{ r: 5, fill: "#0B0E14", stroke: "#4CE0D2", strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="chart-legend dim">
          <span><i className="legend-dot" style={{ background: "#FFE9A8" }} /> Rank up</span>
          <span><i className="legend-dot" style={{ background: "#FF3B5C" }} /> Rank down</span>
          <span><i className="legend-dot" style={{ background: "#4CE0D2", opacity: 0.7 }} /> Match result</span>
        </div>
      </div>

      <div className="hud-panel">
        <PanelHeader icon={Activity} title="RECENT FORM" right={<span className="panel-header-note dim">LAST 10</span>} />
        <FormStrip matches={matches} />
      </div>
    </div>
  );
}

function MatchesTab({ matches, expandedId, setExpandedId, iconMap }) {
  const [filterAgent, setFilterAgent] = useState("all");
  const [filterMap, setFilterMap] = useState("all");
  const [filterResult, setFilterResult] = useState("all");

  const agentOptions = useMemo(() => [...new Set(matches.map((m) => m.agent))].sort(), [matches]);
  const mapOptions = useMemo(() => [...new Set(matches.map((m) => m.map))].sort(), [matches]);

  const filtered = useMemo(() => {
    return matches.filter((m) =>
      (filterAgent === "all" || m.agent === filterAgent) &&
      (filterMap === "all" || m.map === filterMap) &&
      (filterResult === "all" || m.result === filterResult)
    );
  }, [matches, filterAgent, filterMap, filterResult]);

  const ordered = [...filtered].reverse();
  const filtersActive = filterAgent !== "all" || filterMap !== "all" || filterResult !== "all";

  return (
    <div className="hud-panel match-log">
      <PanelHeader icon={Crosshair} title="MATCH LOG" right={<span className="panel-header-note dim">{filtered.length} / {matches.length} GAMES</span>} />
      <div className="match-filters">
        <SlidersHorizontal size={13} className="dim" />
        <select className="filter-select" value={filterResult} onChange={(e) => setFilterResult(e.target.value)}>
          <option value="all">All results</option>
          <option value="WIN">Wins only</option>
          <option value="LOSS">Losses only</option>
        </select>
        <select className="filter-select" value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)}>
          <option value="all">All agents</option>
          {agentOptions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="filter-select" value={filterMap} onChange={(e) => setFilterMap(e.target.value)}>
          <option value="all">All maps</option>
          {mapOptions.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {filtersActive && (
          <button className="filter-clear" onClick={() => { setFilterAgent("all"); setFilterMap("all"); setFilterResult("all"); }}>
            <X size={12} /> Clear
          </button>
        )}
      </div>
      <div className="match-log-head-row dim">
        <span /><span /><span /><span>AGENT / MAP</span><span>SCORE</span><span>KDA</span><span>ACS</span><span>HS%</span><span />
      </div>
      <div className="match-list">
        {ordered.length === 0 ? (
          <div className="empty-note dim">No matches fit these filters.</div>
        ) : (
          ordered.map((m) => (
            <MatchRow key={m.id} m={m} expanded={expandedId === m.id} onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)} iconMap={iconMap} />
          ))
        )}
      </div>
    </div>
  );
}

function AgentsTab({ agentStats, iconMap, roleStats, weaponStats }) {
  return (
    <div className="tab-stack">
      <div className="deeper-stats-grid">
        <div className="hud-panel">
          <PanelHeader icon={RadarIcon} title="ROLE DISTRIBUTION" />
          <div className="role-donut-row">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={roleStats} dataKey="games" nameKey="name" innerRadius={38} outerRadius={62} paddingAngle={3} isAnimationActive={false}>
                  {roleStats.map((r) => <Cell key={r.name} fill={r.color} stroke="none" />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="role-legend">
              {roleStats.map((r) => (
                <div className="role-legend-row" key={r.name}>
                  <span className="role-legend-dot" style={{ background: r.color }} />
                  <span className="role-legend-name">{r.name}</span>
                  <span className="dim">{r.games} games · {((r.wins / r.games) * 100).toFixed(0)}% WR</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="hud-panel">
          <PanelHeader icon={Flame} title="TOP WEAPONS" right={<span className="panel-header-note dim">BY KILLS</span>} />
          {weaponStats.length === 0 ? (
            <div className="empty-note dim">Weapon-level data isn't available for this match set.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(140, weaponStats.length * 28)}>
              <BarChart data={weaponStats} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#A79FC9", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={78} tick={{ fill: "#F5F3FF", fontSize: 11, fontFamily: "Chakra Petch, sans-serif" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} contentStyle={{ background: "#14112a", border: "1px solid rgba(255,255,255,0.12)", fontSize: 12 }} labelStyle={{ color: "#F5F3FF" }} />
                <Bar dataKey="kills" radius={[0, 3, 3, 0]} fill="var(--cyan)" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <div className="hud-panel">
        <PanelHeader icon={Swords} title="AGENT WIN RATE" />
        <ResponsiveContainer width="100%" height={Math.max(180, agentStats.length * 34)}>
          <BarChart data={agentStats} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fill: "#A79FC9", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} tickLine={false} />
            <YAxis type="category" dataKey="name" width={78} tick={{ fill: "#F5F3FF", fontSize: 12, fontFamily: "Chakra Petch, sans-serif" }} axisLine={false} tickLine={false} />
            <Tooltip content={<AgentTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <Bar dataKey="winRate" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {agentStats.map((a) => <Cell key={a.name} fill={a.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="card-grid">
        {agentStats.map((a) => {
          return (
            <div className="hud-panel agent-card" key={a.name}>
              <div className="agent-card-top">
                <span className="agent-badge" style={{ "--agent-color": a.color }}>
                  <AgentIcon name={a.name} role={a.role} iconUrl={iconMap[a.name.toLowerCase()]} size={32} />
                </span>
                <div>
                  <div className="agent-card-name">{a.name}</div>
                  <div className="agent-card-role dim">{a.role}</div>
                </div>
                <div className="agent-card-wr" style={{ color: a.winRate >= 50 ? "var(--cyan)" : "var(--red)" }}>{a.winRate.toFixed(0)}%</div>
              </div>
              <div className="agent-card-stats dim">
                <span>{a.games} games</span><span>·</span><span>{a.kd} K/D</span><span>·</span><span>{a.avgAcs} ACS</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MapsTab({ mapStats, mapArt }) {
  return (
    <div className="hud-panel">
      <PanelHeader icon={MapIcon} title="MAP WIN RATE" right={<span className="panel-header-note dim">{mapStats.length} MAPS PLAYED</span>} />
      <div className="map-list">
        {mapStats.map((m) => {
          const art = mapArt[m.name.toLowerCase()];
          return (
            <div className="map-row" key={m.name} style={art ? { "--map-splash": `url(${art.splash})` } : undefined}>
              {art && <div className="map-row-splash" />}
              <div className="map-row-content">
                <div className="map-row-name">{m.name}</div>
                <div className="map-row-bar-track"><div className="map-row-bar-fill" style={{ width: `${m.winRate}%`, background: m.winRate >= 50 ? "var(--cyan)" : "var(--red)" }} /></div>
                <div className="map-row-wr">{m.winRate.toFixed(0)}%</div>
                <div className="map-row-games dim">{m.wins}W–{m.games - m.wins}L</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CoachTab({ coach, onRun, statsPreview }) {
  return (
    <div className="tab-stack">
      <div className="hud-panel coach-intro">
        <PanelHeader icon={Sparkles} title="AI PERFORMANCE ANALYST" />
        <p className="coach-desc">
          Sends your {statsPreview.matchCount} most recent ranked matches — rank trend, agent pool, map results, mechanics — to Claude for a tactical debrief.
        </p>
        <div className="coach-preview-chips dim">
          <span>{statsPreview.rank}</span><span>{statsPreview.winRate}% WR</span><span>{statsPreview.kd} K/D</span>
        </div>
        <button className="coach-run-btn" onClick={onRun} disabled={coach.status === "loading"}>
          {coach.status === "loading"
            ? <><Loader2 size={15} className="spin" /> DECRYPTING TRANSMISSION…</>
            : <><Sparkles size={15} /> {coach.status === "done" ? "RE-RUN ANALYSIS" : "RUN PERFORMANCE ANALYSIS"}</>}
        </button>
      </div>

      {coach.status === "error" && (
        <div className="hud-panel coach-error">
          <div className="coach-error-title">TRANSMISSION FAILED</div>
          <div className="coach-error-msg dim">{coach.error}</div>
        </div>
      )}

      {coach.status === "done" && coach.data && (
        <div className="tab-stack">
          <div className="hud-panel coach-callsign">
            <div className="callsign-label dim">ANALYST CALLSIGN FOR YOU</div>
            <div className="callsign-value">{coach.data.callsign}</div>
            <p className="coach-summary">{coach.data.summary}</p>
          </div>

          <div className="two-col">
            <div className="hud-panel">
              <PanelHeader icon={TrendingUp} title="STRENGTHS" />
              {coach.data.strengths?.map((s, i) => (
                <div className="insight-row cyan" key={i}>
                  <div className="insight-title">{s.title}</div>
                  <div className="insight-detail dim">{s.detail}</div>
                </div>
              ))}
            </div>
            <div className="hud-panel">
              <PanelHeader icon={TrendingDown} title="WEAKNESSES" />
              {coach.data.weaknesses?.map((s, i) => (
                <div className="insight-row red" key={i}>
                  <div className="insight-title">{s.title}</div>
                  <div className="insight-detail dim">{s.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="hud-panel">
            <PanelHeader icon={Target} title="FIELD ORDERS" />
            <ol className="tips-list">
              {coach.data.actionTips?.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </div>

          <div className="hud-panel mental-panel">
            <PanelHeader icon={Shield} title="MENTAL GAME" />
            <p className="mental-text">{coach.data.mentalGame}</p>
          </div>

          {coach.ranAt && <div className="coach-timestamp dim">Analysis generated {coach.ranAt.toLocaleTimeString()}</div>}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------- CSS ----------------------------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

.vt-root {
  --bg: #060512; --bg-alt: #0C0A22; --panel: rgba(24,20,48,0.6); --border: rgba(255,255,255,0.1);
  --red: #FF1F71; --red-dim: rgba(255,31,113,0.16); --cyan: #2EE6FF; --cyan-dim: rgba(46,230,255,0.15);
  --violet: #9D5CFF; --violet-dim: rgba(157,92,255,0.16);
  --amber: #FFB400; --text: #F5F3FF; --text-dim: #A79FC9; --text-dimmer: #6C6390;
  --display: 'Chakra Petch', sans-serif; --body: 'Inter', sans-serif; --mono: 'JetBrains Mono', monospace;
  font-family: var(--body); color: var(--text); background: var(--bg);
  background-image:
    radial-gradient(circle at 10% -10%, rgba(255,31,113,0.16), transparent 45%),
    radial-gradient(circle at 100% 0%, rgba(46,230,255,0.12), transparent 42%),
    radial-gradient(circle at 50% 120%, rgba(157,92,255,0.14), transparent 55%),
    repeating-linear-gradient(180deg, rgba(255,255,255,0.014) 0px, rgba(255,255,255,0.014) 1px, transparent 1px, transparent 3px);
  border-radius: 8px; overflow: hidden; -webkit-font-smoothing: antialiased;
}
.vt-root * { box-sizing: border-box; }
.dim { color: var(--text-dim); }
.vt-shell { display: flex; min-height: 620px; }

.tab-nav { position: relative; width: 224px; flex-shrink: 0; border-right: 1px solid var(--border); padding: 22px 14px; display: flex; flex-direction: column; gap: 22px; background: linear-gradient(180deg, var(--bg-alt), var(--bg)); overflow: hidden; }
.tab-nav::before { content: ""; position: absolute; inset: 0; background-image: repeating-linear-gradient(180deg, rgba(255,255,255,0.012) 0px, rgba(255,255,255,0.012) 1px, transparent 1px, transparent 22px); pointer-events: none; }
.tab-nav-brand { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; padding: 0 4px 16px; border-bottom: 1px solid var(--border); }
.brand-mark { color: var(--red); font-size: 19px; text-shadow: 0 0 14px rgba(255,31,113,0.65); }
.brand-title { font-family: var(--display); font-weight: 700; font-size: 15px; letter-spacing: 0.05em; }
.brand-title .accent { background: linear-gradient(100deg, var(--red), var(--violet)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.brand-sub { font-family: var(--mono); font-size: 8px; color: var(--text-dimmer); letter-spacing: 0.08em; margin-top: 3px; }
.tab-nav-list { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 4px; flex: 1; }
.tab-btn { position: relative; display: flex; align-items: center; gap: 11px; padding: 11px 12px; background: transparent; border: 1px solid transparent; color: var(--text-dim); font-family: var(--display); font-size: 12px; letter-spacing: 0.04em; cursor: pointer; border-radius: 3px; text-align: left; transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.15s ease; overflow: hidden; }
.tab-btn:hover { color: var(--text); background: rgba(255,255,255,0.035); transform: translateX(2px); }
.tab-btn.active { color: var(--red); background: linear-gradient(90deg, var(--red-dim), var(--violet-dim)); border-color: rgba(255,31,113,0.35); box-shadow: 0 0 18px -6px rgba(255,31,113,0.55); }
.tab-btn-icon { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 4px; background: rgba(255,255,255,0.04); flex-shrink: 0; transition: background 0.18s ease, color 0.18s ease; }
.tab-btn.active .tab-btn-icon { background: rgba(255,31,113,0.18); color: var(--red); }
.tab-btn-indicator { position: absolute; left: 0; top: 8%; bottom: 8%; width: 2.5px; background: linear-gradient(180deg, var(--red), var(--violet)); border-radius: 2px; transform: scaleY(0); transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
.tab-btn.active .tab-btn-indicator { transform: scaleY(1); }
.tab-nav-credit { position: relative; z-index: 1; display: flex; align-items: center; gap: 7px; padding: 10px 8px; color: var(--text-dim); font-size: 10.5px; text-decoration: none; border-top: 1px solid var(--border); transition: color 0.15s ease; background: transparent; border-left: none; border-right: none; border-bottom: none; cursor: pointer; width: 100%; }
.tab-nav-credit:hover { color: var(--cyan); }
.tab-nav-credit b { color: var(--text); font-weight: 600; }
.tab-nav-credit:hover b { color: var(--cyan); }
.tab-btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 1px; }

.vt-main { flex: 1; min-width: 0; padding: 20px 22px 36px; overflow-x: hidden; display: flex; flex-direction: column; gap: 16px; }

.hud-panel { position: relative; background: var(--panel); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid var(--border); padding: 16px 18px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 30px -14px rgba(0,0,0,0.6); clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px)); }
.tab-stack { display: flex; flex-direction: column; gap: 16px; }

.panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.panel-header-title { display: flex; align-items: center; gap: 7px; font-family: var(--display); font-size: 12.5px; letter-spacing: 0.06em; font-weight: 600; }
.panel-header-icon { color: var(--red); }
.panel-header-note { font-family: var(--mono); font-size: 10px; letter-spacing: 0.05em; }

.topbar { position: relative; display: flex; align-items: center; gap: 22px; flex-wrap: wrap; padding: 22px 26px; overflow: hidden; clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px)); }
.topbar-glow { position: absolute; top: -60px; left: -40px; width: 220px; height: 220px; background: radial-gradient(circle, var(--tier-color) 0%, transparent 70%); opacity: 0.22; filter: blur(10px); pointer-events: none; }
.topbar-id { position: relative; z-index: 1; display: flex; align-items: center; gap: 16px; }
.rank-ring { position: relative; flex-shrink: 0; }
.rank-ring-arc { transition: stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1); filter: drop-shadow(0 0 5px var(--tier-color)); }
.rank-ring-inner { position: absolute; inset: 6px; display: flex; align-items: center; justify-content: center; }
.rank-ring-icon { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 6px rgba(0,0,0,0.5)); }
.avatar-badge-fallback { font-family: var(--display); font-weight: 700; font-size: 16px; color: var(--tier-color); }
.topbar-name { font-family: var(--display); font-weight: 700; font-size: 19px; display: flex; align-items: baseline; gap: 7px; }
.topbar-tag { font-size: 12px; font-weight: 400; }
.topbar-rank { font-family: var(--display); font-size: 15px; margin-top: 3px; font-weight: 700; letter-spacing: 0.02em; }
.topbar-rr-label { font-family: var(--mono); font-size: 10px; margin-top: 4px; letter-spacing: 0.05em; }
.topbar-right { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.topbar-feed-badge { font-family: var(--mono); font-size: 9.5px; color: var(--cyan); letter-spacing: 0.05em; display: flex; align-items: center; white-space: nowrap; }
.feed-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--cyan); margin-right: 6px; animation: vt-pulse 1.6s ease-in-out infinite; }
.topbar-disconnect { background: transparent; border: 1px solid var(--border); color: var(--text-dim); font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.05em; padding: 6px 10px; cursor: pointer; white-space: nowrap; transition: border-color 0.15s ease, color 0.15s ease; }
.topbar-disconnect:hover { border-color: var(--red); color: var(--red); }

/* ------------------------------- SETUP SCREEN ------------------------------ */
.setup-shell { min-height: 640px; display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; align-items: stretch; padding: 24px 20px; max-width: 1080px; margin: 0 auto; }
.setup-visual { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; padding: 22px; min-height: 480px; background-color: #0d1016; animation: vt-fade-in 0.5s ease both; }
.setup-visual-scrim { position: absolute; inset: 0; background-image: var(--hero-map); background-size: cover; background-position: center 30%; opacity: 0.5; filter: saturate(0.75) brightness(0.85); animation: vt-map-drift 18s ease-in-out infinite alternate; }
.setup-visual-scrim::after { content: ""; position: absolute; inset: 0; background: linear-gradient(175deg, rgba(9,11,16,0.35) 0%, rgba(9,11,16,0.88) 55%, rgba(9,11,16,0.98) 100%); }
.setup-visual-grid { position: absolute; inset: -30%; width: 160%; height: 160%; background-image: radial-gradient(circle at 22% 25%, rgba(157,92,255,0.4), transparent 38%), radial-gradient(circle at 80% 20%, rgba(46,230,255,0.28), transparent 36%), radial-gradient(circle at 55% 85%, rgba(255,31,113,0.32), transparent 42%); filter: blur(50px); pointer-events: none; animation: vt-aurora-drift 16s ease-in-out infinite alternate; }
.setup-visual-sweep { position: absolute; top: 0; bottom: 0; width: 120px; background: linear-gradient(90deg, transparent, rgba(97,235,255,0.09), transparent); pointer-events: none; animation: vt-sweep 5s ease-in-out infinite; }
.setup-visual-top { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; }
.setup-online-dot-wrap { position: relative; width: 6px; height: 6px; }
.setup-online-dot { position: absolute; inset: 0; border-radius: 50%; background: var(--cyan); animation: vt-pulse 1.6s ease-in-out infinite; }
.setup-online-dot::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; border: 1px solid var(--cyan); opacity: 0; animation: vt-ring-out 1.8s ease-out infinite; }
.setup-online-label { font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em; color: var(--cyan); }
.setup-visual-body { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 14px; }
.setup-visual-title { font-size: 34px; letter-spacing: 0.02em; background: linear-gradient(100deg, #F5F3FF 30%, var(--cyan) 50%, #F5F3FF 70%); background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: vt-shimmer 5s ease-in-out infinite; }
.setup-visual-title .accent { -webkit-text-fill-color: initial; background: none; color: var(--red); }
.setup-visual-tagline { font-size: 13.5px; line-height: 1.6; color: var(--text-dim); max-width: 340px; margin: 0; }
.setup-feature-list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 11px; }
.setup-feature-list li { display: flex; align-items: center; gap: 9px; font-size: 12.5px; color: var(--text); opacity: 1; animation: vt-fade-in 0.5s ease both; }
.setup-feature-list li:nth-child(1) { animation-delay: 0.15s; }
.setup-feature-list li:nth-child(2) { animation-delay: 0.3s; }
.setup-feature-list li:nth-child(3) { animation-delay: 0.45s; }
.setup-feature-list svg { color: var(--cyan); flex-shrink: 0; }
.setup-agent-strip { position: relative; z-index: 1; display: flex; gap: 8px; }
.setup-agent-strip-img { width: 46px; height: 46px; object-fit: cover; object-position: center top; border: 1px solid rgba(255,255,255,0.14); filter: grayscale(0.15); opacity: 0.9; transition: transform 0.2s ease, filter 0.2s ease, opacity 0.2s ease; }
.setup-agent-strip-img:hover { transform: translateY(-4px) scale(1.06); filter: grayscale(0); opacity: 1; border-color: var(--cyan); }
.setup-card { display: flex; flex-direction: column; gap: 16px; justify-content: center; animation: vt-fade-in 0.5s ease 0.1s both; }
.setup-brand { display: flex; align-items: center; gap: 10px; }
.setup-desc { font-size: 12px; line-height: 1.6; color: var(--text-dim); margin: 0; }
.setup-row { display: flex; flex-direction: column; gap: 6px; }
.setup-label { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.08em; color: var(--text-dim); }
.setup-riotid { display: flex; align-items: center; gap: 6px; }
.setup-input { background: var(--bg); border: 1px solid var(--border); color: var(--text); font-family: var(--body); font-size: 13px; padding: 10px 12px; width: 100%; outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.setup-input:focus { border-color: var(--cyan); box-shadow: 0 0 0 3px var(--cyan-dim); }
.setup-tag { max-width: 90px; text-transform: uppercase; }
.setup-key { font-family: var(--mono); letter-spacing: 0.04em; }
.setup-hint { font-size: 10.5px; margin-top: 2px; }
.setup-region-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.region-chip { background: var(--bg); border: 1px solid var(--border); color: var(--text-dim); font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em; padding: 8px 0; cursor: pointer; transition: all 0.18s ease; }
.region-chip:hover { border-color: rgba(255,255,255,0.25); color: var(--text); transform: translateY(-1px); }
.region-chip.active { border-color: var(--cyan); color: var(--cyan); background: var(--cyan-dim); box-shadow: 0 0 12px -4px var(--cyan); }
.setup-error { display: flex; flex-direction: column; gap: 2px; border-left: 2px solid var(--red); padding: 8px 0 8px 10px; font-size: 12px; animation: vt-fade-in 0.25s ease both; }
.setup-error-title { font-family: var(--display); color: var(--red); font-size: 11px; letter-spacing: 0.05em; }
.setup-submit { justify-content: center; margin-top: 4px; position: relative; overflow: hidden; }
.setup-submit::after { content: ""; position: absolute; top: 0; bottom: 0; width: 60px; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.18), transparent); animation: vt-sweep 3.2s ease-in-out infinite; }
.setup-submit:hover:not(:disabled) { box-shadow: 0 0 20px -4px var(--red); }

@keyframes vt-map-drift { from { transform: scale(1.03) translate(0, 0); } to { transform: scale(1.08) translate(-1.5%, -1%); } }
@keyframes vt-grid-drift { from { transform: translate(0, 0); } to { transform: translate(26px, 26px); } }
@keyframes vt-aurora-drift { from { transform: translate(0, 0) scale(1); } to { transform: translate(4%, -3%) scale(1.08); } }
@keyframes vt-sweep { 0% { left: -20%; } 100% { left: 120%; } }
@keyframes vt-shimmer { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
@keyframes vt-ring-out { 0% { transform: scale(0.6); opacity: 0.6; } 100% { transform: scale(2.4); opacity: 0; } }

.chip-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.stat-chip { position: relative; display: flex; align-items: center; gap: 12px; padding: 16px 16px; background: linear-gradient(160deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015)); border: 1px solid var(--border); border-left: 3px solid var(--border); overflow: hidden; }
.stat-chip.accent-cyan { border-left-color: var(--cyan); } .stat-chip.accent-cyan .stat-chip-icon { color: var(--cyan); filter: drop-shadow(0 0 6px rgba(97,235,255,0.6)); }
.stat-chip.accent-red { border-left-color: var(--red); } .stat-chip.accent-red .stat-chip-icon { color: var(--red); filter: drop-shadow(0 0 6px rgba(255,31,113,0.6)); }
.stat-chip.accent-amber { border-left-color: var(--amber); } .stat-chip.accent-amber .stat-chip-icon { color: var(--amber); filter: drop-shadow(0 0 6px rgba(255,184,77,0.6)); }
.stat-chip.accent-text .stat-chip-icon { color: var(--text-dim); }
.stat-chip-icon { flex-shrink: 0; }
.stat-chip-value { font-family: var(--display); font-size: 21px; font-weight: 700; line-height: 1.1; }
.stat-chip-label { font-family: var(--mono); font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; margin-top: 3px; }

.chart-legend { display: flex; gap: 16px; margin-top: 10px; font-family: var(--mono); font-size: 9.5px; }
.chart-legend span { display: flex; align-items: center; gap: 5px; }
.legend-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; }

.hud-tooltip { background: #0B0E14; border: 1px solid var(--border); padding: 9px 11px; font-family: var(--mono); font-size: 11px; }
.hud-tooltip-rank { font-weight: 600; margin-bottom: 4px; }
.hud-tooltip-row { color: var(--text-dim); font-size: 10.5px; }
.hud-tooltip-row.cyan { color: var(--cyan); } .hud-tooltip-row.red { color: var(--red); }

.form-strip { display: flex; gap: 6px; flex-wrap: wrap; }
.form-chip { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-family: var(--display); font-size: 12px; font-weight: 700; cursor: default; }
.form-chip.win { background: var(--cyan-dim); color: var(--cyan); border: 1px solid rgba(46,230,255,0.4); }
.form-chip.loss { background: var(--red-dim); color: var(--red); border: 1px solid rgba(255,31,113,0.4); }

.match-log-head-row { display: grid; grid-template-columns: 6px 54px 44px 1fr 76px 90px 74px 74px 18px; gap: 12px; padding: 0 10px 8px 0; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.05em; }
.match-list { display: flex; flex-direction: column; gap: 6px; }
.match-row { position: relative; background: rgba(255,255,255,0.015); border: 1px solid var(--border); transition: border-color 0.15s ease, transform 0.15s ease; }
.match-row:hover { border-color: rgba(255,255,255,0.16); transform: translateX(2px); }
.match-row-head { position: relative; display: grid; grid-template-columns: 6px 54px 44px 1fr 76px 90px 74px 74px 18px; align-items: center; gap: 12px; width: 100%; background: transparent; border: none; padding: 12px 10px 12px 0; cursor: pointer; color: var(--text); font-family: var(--body); text-align: left; }
.match-row-head:focus-visible { outline: 2px solid var(--cyan); outline-offset: -2px; }
.match-result-bar { align-self: stretch; width: 4px; }
.match-row.win .match-result-bar { background: var(--cyan); box-shadow: 0 0 8px var(--cyan); }
.match-row.loss .match-result-bar { background: var(--red); box-shadow: 0 0 8px var(--red); }
.match-result-badge { font-family: var(--display); font-weight: 700; font-size: 10.5px; letter-spacing: 0.04em; padding: 5px 0; text-align: center; border-radius: 3px; }
.match-result-badge.win { color: var(--cyan); background: var(--cyan-dim); }
.match-result-badge.loss { color: var(--red); background: var(--red-dim); }
.match-agent-badge { width: 40px; height: 40px; border-radius: 5px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.03); border: 1px solid var(--agent-color); box-shadow: 0 0 10px -3px var(--agent-color); color: var(--agent-color); flex-shrink: 0; overflow: hidden; }
.match-title { font-size: 13.5px; font-weight: 600; }
.match-main-info { min-width: 0; overflow: hidden; }
.match-sub { font-family: var(--mono); font-size: 9.5px; margin-top: 2px; display: flex; align-items: center; gap: 8px; }
.mvp-tag { display: inline-flex; align-items: center; gap: 3px; color: var(--amber); }
.match-score { font-family: var(--display); font-size: 17px; font-weight: 700; }
.match-kda-block { display: flex; flex-direction: column; gap: 1px; }
.match-kda { font-family: var(--mono); font-size: 13px; font-weight: 600; }
.match-kda-label { font-size: 8.5px; letter-spacing: 0.06em; }
.match-stat-pill { font-family: var(--mono); font-size: 11px; color: var(--text-dim); background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 3px; padding: 5px 8px; text-align: center; white-space: nowrap; }
.match-stat-pill b { color: var(--text); font-size: 9px; margin-left: 2px; }
.match-stat-pill.hs.hot { color: var(--cyan); border-color: rgba(97,235,255,0.35); background: var(--cyan-dim); }
.match-stat-pill.hs.hot b { color: var(--cyan); }
.match-detail { display: flex; gap: 14px; flex-wrap: wrap; padding: 0 10px 14px 64px; }
.detail-chip { display: flex; align-items: center; gap: 5px; font-family: var(--mono); font-size: 10.5px; color: var(--text-dim); }

.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.agent-card-top { display: flex; align-items: center; gap: 10px; }
.agent-badge { width: 32px; height: 32px; border-radius: 4px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.03); border: 1px solid var(--agent-color); color: var(--agent-color); flex-shrink: 0; overflow: hidden; }
.agent-icon-img { object-fit: cover; object-position: center top; border-radius: 3px; }
.agent-card-name { font-family: var(--display); font-weight: 600; font-size: 13.5px; }
.agent-card-role { font-family: var(--mono); font-size: 9px; letter-spacing: 0.04em; margin-top: 1px; }
.agent-card-wr { margin-left: auto; font-family: var(--display); font-weight: 700; font-size: 15px; }
.agent-card-stats { display: flex; gap: 6px; font-family: var(--mono); font-size: 10.5px; margin-top: 10px; }

.map-list { display: flex; flex-direction: column; gap: 10px; }
.map-row { display: grid; grid-template-columns: 90px 1fr 44px 70px; align-items: center; gap: 12px; }
.map-row-name { font-family: var(--display); font-size: 12.5px; font-weight: 500; }
.map-row-bar-track { height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
.map-row-bar-fill { height: 100%; border-radius: 3px; }
.map-row-wr { font-family: var(--mono); font-size: 12px; font-weight: 600; text-align: right; }
.map-row-games { font-family: var(--mono); font-size: 10.5px; }

.coach-desc { font-size: 12.5px; line-height: 1.55; color: var(--text-dim); margin: 0 0 12px; }
.coach-preview-chips { display: flex; gap: 12px; font-family: var(--mono); font-size: 11px; margin-bottom: 14px; }
.coach-run-btn { display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(100deg, var(--red), #FF5FA3 50%, var(--violet)); border: none; color: #fff; font-family: var(--display); font-size: 12px; letter-spacing: 0.05em; font-weight: 700; padding: 11px 18px; cursor: pointer; transition: filter 0.15s ease, transform 0.15s ease; box-shadow: 0 6px 24px -8px rgba(255,31,113,0.6); }
.coach-run-btn:hover:not(:disabled) { filter: brightness(1.12); transform: translateY(-1px); }
.coach-run-btn:disabled { opacity: 0.6; cursor: default; }
.coach-run-btn:disabled { cursor: default; opacity: 0.75; }
.coach-run-btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.spin { animation: vt-spin 0.9s linear infinite; }

.coach-error-title { font-family: var(--display); color: var(--red); font-size: 12.5px; letter-spacing: 0.05em; margin-bottom: 4px; }
.coach-error-msg { font-size: 12px; }

.callsign-label { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.06em; margin-bottom: 4px; }
.callsign-value { font-family: var(--display); font-size: 19px; font-weight: 700; color: var(--amber); }
.coach-summary { font-size: 13px; line-height: 1.55; margin: 10px 0 0; }

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.insight-row { border-left: 2px solid var(--border); padding: 6px 0 10px 12px; margin-bottom: 4px; }
.insight-row.cyan { border-left-color: var(--cyan); } .insight-row.red { border-left-color: var(--red); }
.insight-title { font-family: var(--display); font-size: 12.5px; font-weight: 600; margin-bottom: 3px; }
.insight-detail { font-size: 12px; line-height: 1.5; }

.tips-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; line-height: 1.5; }
.tips-list li::marker { color: var(--amber); font-family: var(--mono); }

.mental-panel { background: linear-gradient(135deg, var(--panel), var(--bg-alt)); }
.mental-text { font-style: italic; font-size: 13px; line-height: 1.6; margin: 0; color: var(--text); }
.coach-timestamp { font-family: var(--mono); font-size: 10px; text-align: right; }

@keyframes vt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes vt-spin { to { transform: rotate(360deg); } }
@keyframes vt-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .vt-root * { animation: none !important; transition: none !important; } }

/* -------------------------------- POLISH -------------------------------- */
.tab-stack, .match-log, .hud-panel.topbar { animation: vt-fade-in 0.32s ease both; }
.hud-panel { transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.hud-panel:hover { border-color: rgba(255,255,255,0.16); }
.rr-bar-fill { transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
.stat-chip { transition: transform 0.15s ease, border-color 0.15s ease; }
.stat-chip:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.18); }
.agent-card, .map-row { transition: transform 0.15s ease; }
.agent-card:hover { transform: translateY(-2px); }
.empty-note { padding: 22px 6px; text-align: center; font-size: 12.5px; }

/* ------------------------------ MATCH FILTERS ---------------------------- */
.match-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-bottom: 12px; margin-bottom: 4px; border-bottom: 1px solid var(--border); }
.filter-select { background: var(--bg); border: 1px solid var(--border); color: var(--text-dim); font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.03em; padding: 6px 8px; cursor: pointer; outline: none; transition: border-color 0.15s ease, color 0.15s ease; }
.filter-select:hover, .filter-select:focus { border-color: rgba(255,255,255,0.25); color: var(--text); }
.filter-clear { display: inline-flex; align-items: center; gap: 4px; background: transparent; border: 1px solid rgba(255,31,113,0.35); color: var(--red); font-family: var(--mono); font-size: 10px; letter-spacing: 0.04em; padding: 6px 9px; cursor: pointer; margin-left: auto; transition: background 0.15s ease; }
.filter-clear:hover { background: var(--red-dim); }

/* -------------------------------- OVERVIEW ------------------------------- */
.overview-top-row { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.overview-top-row .chip-row { flex: 1; min-width: 260px; }
.share-card-trigger { display: inline-flex; align-items: center; gap: 7px; background: transparent; border: 1px solid var(--border); color: var(--text-dim); font-family: var(--display); font-size: 11px; letter-spacing: 0.04em; font-weight: 600; padding: 12px 16px; cursor: pointer; white-space: nowrap; transition: border-color 0.15s ease, color 0.15s ease; align-self: stretch; }
.share-card-trigger:hover { border-color: var(--cyan); color: var(--cyan); }

/* ---------------------------- DEEPER STATS (AGENTS) ------------------------ */
.deeper-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.role-donut-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.role-legend { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 140px; }
.role-legend-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.role-legend-dot { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
.role-legend-name { font-family: var(--display); font-weight: 600; min-width: 66px; }

/* -------------------------------- MAP SPLASH ------------------------------ */
.map-row { position: relative; grid-template-columns: none !important; display: block; overflow: hidden; padding: 0; border: 1px solid var(--border); }
.map-row-splash { position: absolute; inset: 0; background-image: var(--map-splash); background-size: cover; background-position: center 35%; opacity: 0.28; filter: saturate(0.7); }
.map-row-splash::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(11,14,20,0.92) 10%, rgba(11,14,20,0.55) 60%, rgba(11,14,20,0.85) 100%); }
.map-row-content { position: relative; z-index: 1; display: grid; grid-template-columns: 90px 1fr 44px 70px; align-items: center; gap: 12px; padding: 14px 16px; }

/* --------------------------------- SHARE CARD MODAL ----------------------- */
.modal-overlay { position: fixed; inset: 0; background: rgba(4,5,8,0.82); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; animation: vt-fade-in 0.2s ease both; }
.modal-card { display: flex; flex-direction: column; gap: 14px; max-width: min(92vw, 720px); }
.rank-card-canvas { width: 100%; height: auto; display: block; border: 1px solid var(--border); }
.modal-actions { display: flex; gap: 10px; justify-content: center; }

/* ---------------------------------- ABOUT --------------------------------- */
.about-card { position: relative; width: 100%; max-width: 460px; padding: 30px 28px; display: flex; flex-direction: column; gap: 14px; }
.about-close { position: absolute; top: 14px; right: 14px; background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 4px; transition: color 0.15s ease; }
.about-close:hover { color: var(--red); }
.about-header { display: flex; align-items: center; gap: 9px; }
.about-header-title { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.1em; }
.about-name { font-family: var(--display); font-weight: 700; font-size: 22px; }
.about-bio { font-size: 13px; line-height: 1.7; color: var(--text-dim); margin: 0; }
.about-meta-row { display: flex; gap: 10px; flex-wrap: wrap; }
.about-meta { flex: 1; min-width: 140px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.about-meta span { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.08em; }
.about-meta b { font-family: var(--display); font-size: 13px; font-weight: 600; }
.about-insta-btn { justify-content: center; text-decoration: none; margin-top: 4px; }

@media (max-width: 760px) {
  .vt-shell { flex-direction: column; }
  .tab-nav { width: 100%; flex-direction: row; align-items: center; gap: 14px; padding: 12px 14px; overflow-x: auto; }
  .tab-nav-list { flex-direction: row; gap: 4px; }
  .tab-btn > span:not(.tab-btn-icon) { display: none; }
  .brand-sub { display: none; }
  .two-col { grid-template-columns: 1fr; }
  .match-log-head-row { display: none; }
  .match-row-head, .match-log-head-row { grid-template-columns: 4px 40px 1fr 60px 18px; gap: 8px; }
  .match-result-badge, .match-kda-block, .match-stat-pill { display: none; }
  .setup-shell { grid-template-columns: 1fr; padding: 16px; }
  .setup-visual { min-height: 260px; }
  .setup-visual-title { font-size: 26px; }
}
`;

/* -------------------------------- SETUP SCREEN ------------------------------ */

function SetupScreen({ onConnect, status, error, mapArt, iconMap }) {
  const [riotName, setRiotName] = useState("");
  const [riotTag, setRiotTag] = useState("");
  const [region, setRegion] = useState("na");
  const loading = status === "loading";
  const keyMissing = !HENRIK_API_KEY || HENRIK_API_KEY === "PASTE_YOUR_HENRIKDEV_KEY_HERE";

  const heroMap = mapArt?.["ascent"] || mapArt?.["bind"] || Object.values(mapArt || {})[0];
  const heroAgents = ["jett", "reyna", "sova", "killjoy", "omen"].map((n) => iconMap?.[n]).filter(Boolean);

  const submit = (e) => {
    e.preventDefault();
    if (!riotName.trim() || !riotTag.trim() || keyMissing) return;
    onConnect({ riotName: riotName.trim(), riotTag: riotTag.trim().replace(/^#/, ""), region });
  };

  return (
    <div className="vt-root">
      <style>{CSS}</style>
      <div className="setup-shell">
        <div className="setup-visual hud-panel" style={{ "--hero-map": heroMap ? `url(${heroMap})` : "none" }}>
          <div className="setup-visual-scrim" />
          <div className="setup-visual-grid" />
          <div className="setup-visual-sweep" />
          <div className="setup-visual-top">
            <span className="setup-online-dot-wrap"><span className="setup-online-dot" /></span>
            <span className="setup-online-label">SYSTEM ONLINE</span>
          </div>
          <div className="setup-visual-body">
            <div className="brand-title setup-visual-title">OPS<span className="accent">TRACK</span></div>
            <p className="setup-visual-tagline">Real rank. Real matches. Real coaching — pulled straight from your account.</p>
            <ul className="setup-feature-list">
              <li><Activity size={14} /> Live rank trajectory &amp; RR history</li>
              <li><Crosshair size={14} /> Full match log with agent &amp; map breakdowns</li>
              <li><Sparkles size={14} /> AI performance analyst reviewing your last 25 games</li>
            </ul>
          </div>
          {heroAgents.length > 0 && (
            <div className="setup-agent-strip">
              {heroAgents.map((src, i) => <img key={i} src={src} alt="" className="setup-agent-strip-img" />)}
            </div>
          )}
        </div>

        <form className="hud-panel setup-card" onSubmit={submit}>
          <div className="setup-brand">
            <span className="brand-mark">◆</span>
            <div>
              <div className="brand-title">ACCOUNT LOOKUP</div>
              <div className="brand-sub">TACTICAL PERFORMANCE READOUT</div>
            </div>
          </div>
          <p className="setup-desc">
            Enter your Riot ID to pull your real rank, match history, and per-agent stats.
          </p>

          <div className="setup-row">
            <label className="setup-label">RIOT ID</label>
            <div className="setup-riotid">
              <input className="setup-input" placeholder="Name" value={riotName} onChange={(e) => setRiotName(e.target.value)} autoComplete="off" />
              <span className="dim">#</span>
              <input className="setup-input setup-tag" placeholder="TAG" value={riotTag} onChange={(e) => setRiotTag(e.target.value)} autoComplete="off" />
            </div>
          </div>

          <div className="setup-row">
            <label className="setup-label">REGION</label>
            <div className="setup-region-grid">
              {REGIONS.map((r) => (
                <button type="button" key={r.value} className={`region-chip ${region === r.value ? "active" : ""}`} onClick={() => setRegion(r.value)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {keyMissing && (
            <div className="setup-error"><span className="setup-error-title">SITE NOT CONFIGURED</span><span className="dim">Set HENRIK_API_KEY near the top of the file before publishing.</span></div>
          )}

          {status === "error" && (
            <div className="setup-error"><span className="setup-error-title">CONNECTION FAILED</span><span className="dim">{error}</span></div>
          )}

          <button className="coach-run-btn setup-submit" type="submit" disabled={loading || keyMissing}>
            {loading ? <><Loader2 size={15} className="spin" /> ESTABLISHING UPLINK…</> : <><Crosshair size={15} /> LOOK UP ACCOUNT</>}
          </button>
        </form>
      </div>
    </div>
  );
}

/* --------------------------------- APP ROOT --------------------------------- */

export default function ValorantOpsTracker() {
  const [session, setSession] = useState({ status: "idle" }); // idle | loading | error | ready
  const [iconMap, setIconMap] = useState({});
  const [mapArt, setMapArt] = useState({});
  const [tierIcons, setTierIcons] = useState({});
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    fetchTierIconMap().then(setTierIcons).catch(() => {});
  }, []);

  useEffect(() => {
    fetchAgentIconMap().then(setIconMap).catch(() => {}); // silently fall back to role icons if this fails
    fetchMapAssetMap().then(setMapArt).catch(() => {});
  }, []);
  const [activeTab, setActiveTab] = useState("overview");
  const [expandedId, setExpandedId] = useState(null);
  const [coach, setCoach] = useState({ status: "idle" });

  const connect = useCallback(async ({ riotName, riotTag, region }) => {
    setSession({ status: "loading" });
    const apiKey = HENRIK_API_KEY;
    try {
      const account = await henrikFetch(`/valorant/v2/account/${encodeURIComponent(riotName)}/${encodeURIComponent(riotTag)}`, apiKey);
      const puuid = account?.data?.puuid;
      const resolvedRegion = account?.data?.region || region;
      if (!puuid) throw new Error("Couldn't resolve that Riot ID to an account.");

      const [mmr, mmrHistory, matchHistory] = await Promise.all([
        henrikFetch(`/valorant/v2/mmr/${resolvedRegion}/${encodeURIComponent(riotName)}/${encodeURIComponent(riotTag)}`, apiKey).catch(() => null),
        henrikFetch(`/valorant/v1/mmr-history/${resolvedRegion}/${encodeURIComponent(riotName)}/${encodeURIComponent(riotTag)}`, apiKey).catch(() => null),
        henrikFetch(`/valorant/v3/matches/${resolvedRegion}/${encodeURIComponent(riotName)}/${encodeURIComponent(riotTag)}?size=25&mode=competitive`, apiKey),
      ]);

      const matchList = Array.isArray(matchHistory?.data) ? matchHistory.data : [];
      const matches = matchList
        .map((m, i) => normalizeMatch(m, puuid, i))
        .filter(Boolean);

      if (matches.length === 0) throw new Error("No competitive matches found for this account.");

      const weaponKills = {};
      matchList.forEach((raw) => {
        const counts = extractWeaponKills(raw, puuid);
        Object.entries(counts).forEach(([weapon, n]) => { weaponKills[weapon] = (weaponKills[weapon] || 0) + n; });
      });

      setSession({
        status: "ready",
        player: { name: account.data.name || riotName, tag: account.data.tag || riotTag, level: account.data.account_level },
        mmr: mmr?.data || null,
        mmrHistory: Array.isArray(mmrHistory?.data) ? mmrHistory.data : [],
        matches,
        weaponKills,
      });
    } catch (err) {
      setSession({ status: "error", error: err?.message || "Couldn't reach the API. Check the Riot ID and region." });
    }
  }, []);

  const disconnect = useCallback(() => {
    setSession({ status: "idle" });
    setCoach({ status: "idle" });
    setActiveTab("overview");
  }, []);

  const matches = session.matches || [];

  const currentInfo = useMemo(() => {
    if (!session.mmr?.current_data) return ladderInfo(0);
    const { currenttierpatched, ranking_in_tier } = session.mmr.current_data;
    return ladderInfo(ladderFromTierRR(currenttierpatched, ranking_in_tier));
  }, [session.mmr]);

  const peakInfo = useMemo(() => {
    const patched = session.mmr?.highest_rank?.patched_tier;
    if (!patched) return currentInfo;
    return ladderInfo(ladderFromTierRR(patched, 99));
  }, [session.mmr, currentInfo]);

  const stats = useMemo(() => {
    if (matches.length === 0) return { winRate: 0, kd: 0, avgHS: 0, avgACS: 0, avgAssists: 0, streakType: "WIN", streakCount: 0 };
    const wins = matches.filter((m) => m.result === "WIN").length;
    const winRate = (wins / matches.length) * 100;
    const totalKills = matches.reduce((a, m) => a + m.kills, 0);
    const totalDeaths = matches.reduce((a, m) => a + m.deaths, 0);
    const kd = totalDeaths ? totalKills / totalDeaths : totalKills;
    const avgHS = matches.reduce((a, m) => a + m.hs, 0) / matches.length;
    const avgACS = matches.reduce((a, m) => a + m.acs, 0) / matches.length;
    const avgAssists = matches.reduce((a, m) => a + m.assists, 0) / matches.length;
    let streakType = matches[matches.length - 1].result, streakCount = 0;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (matches[i].result === streakType) streakCount++; else break;
    }
    return { winRate, kd, avgHS, avgACS, avgAssists, streakType, streakCount };
  }, [matches]);

  const agentStats = useMemo(() => {
    const map = {};
    matches.forEach((m) => {
      if (!map[m.agent]) map[m.agent] = { name: m.agent, role: m.role, color: m.agentColor, games: 0, wins: 0, kills: 0, deaths: 0, acs: 0 };
      const e = map[m.agent];
      e.games++; if (m.result === "WIN") e.wins++;
      e.kills += m.kills; e.deaths += m.deaths; e.acs += m.acs;
    });
    return Object.values(map)
      .map((e) => ({ ...e, winRate: (e.wins / e.games) * 100, kd: (e.deaths ? e.kills / e.deaths : e.kills).toFixed(2), avgAcs: Math.round(e.acs / e.games) }))
      .sort((a, b) => b.games - a.games);
  }, [matches]);

  const mapStats = useMemo(() => {
    const map = {};
    matches.forEach((m) => {
      if (!map[m.map]) map[m.map] = { name: m.map, games: 0, wins: 0 };
      map[m.map].games++; if (m.result === "WIN") map[m.map].wins++;
    });
    return Object.values(map).map((e) => ({ ...e, winRate: (e.wins / e.games) * 100 })).sort((a, b) => b.winRate - a.winRate);
  }, [matches]);

  const ROLE_COLORS = { Duelist: "#FF6B6B", Initiator: "#5C9DFF", Controller: "#8C7CE0", Sentinel: "#FFC94A" };
  const roleStats = useMemo(() => {
    const map = {};
    matches.forEach((m) => {
      if (!map[m.role]) map[m.role] = { name: m.role, games: 0, wins: 0, color: ROLE_COLORS[m.role] || "#9391B8" };
      map[m.role].games++; if (m.result === "WIN") map[m.role].wins++;
    });
    return Object.values(map).sort((a, b) => b.games - a.games);
  }, [matches]);

  const weaponStats = useMemo(() => {
    return Object.entries(session.weaponKills || {})
      .map(([name, kills]) => ({ name, kills }))
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 8);
  }, [session.weaponKills]);

  const { chartData, yDomain, tiersInRange } = useMemo(() => {
    const history = [...(session.mmrHistory || [])].sort((a, b) => (a.date_raw || 0) - (b.date_raw || 0));
    if (history.length === 0) return { chartData: [], yDomain: [0, TIER_SPAN], tiersInRange: [] };

    let prevTierIdx = null, prevDivision = null;
    const data = history.map((h, i) => {
      const ladder = ladderFromTierRR(h.currenttierpatched, h.ranking_in_tier);
      const { name, division } = parseTierPatched(h.currenttierpatched);
      const tierIdx = Math.max(0, TIERS.findIndex((t) => t.name.toLowerCase() === name.toLowerCase()));
      const promotion = prevTierIdx !== null && (tierIdx > prevTierIdx || (tierIdx === prevTierIdx && division && prevDivision && division > prevDivision));
      const demotion = prevTierIdx !== null && (tierIdx < prevTierIdx || (tierIdx === prevTierIdx && division && prevDivision && division < prevDivision));
      prevTierIdx = tierIdx; prevDivision = division;
      return { match: i + 1, ladder, map: h.map?.name || "—", agent: "", result: (h.mmr_change_to_last_game || 0) >= 0 ? "WIN" : "LOSS", rrDelta: h.mmr_change_to_last_game || 0, promotion, demotion };
    });
    const allLadders = data.map((d) => d.ladder);
    const yMin = Math.max(0, Math.min(...allLadders) - 60);
    const yMax = Math.max(...allLadders) + 60;
    const tiers = TIERS.map((t, i) => ({ ...t, i })).filter((t) => t.i * TIER_SPAN < yMax && (t.i + 1) * TIER_SPAN > yMin);
    return { chartData: data, yDomain: [yMin, yMax], tiersInRange: tiers };
  }, [session.mmrHistory]);

  const runAnalysis = useCallback(async () => {
    setCoach({ status: "loading" });
    try {
      const sortedByWr = [...agentStats].sort((a, b) => a.winRate - b.winRate);
      const statsBrief = {
        currentRank: `${currentInfo.label} (${currentInfo.sub})`,
        peakRank: `${peakInfo.label} (${peakInfo.sub})`,
        last25MatchesWinRate: `${stats.winRate.toFixed(1)}%`,
        kd: stats.kd.toFixed(2),
        avgHeadshotPercent: Math.round(stats.avgHS),
        avgCombatScore: Math.round(stats.avgACS),
        currentStreak: `${stats.streakCount} ${stats.streakType}${stats.streakCount > 1 ? "s" : ""} in a row`,
        avgAssists: stats.avgAssists.toFixed(1),
        agentsPlayed: agentStats.map((a) => `${a.name} (${a.role}): ${a.games} games, ${a.winRate.toFixed(0)}% WR, ${a.avgAcs} ACS, ${a.kd} K/D`),
        weakestAgentByWinRate: sortedByWr[0] ? `${sortedByWr[0].name}: ${sortedByWr[0].winRate.toFixed(0)}% WR over ${sortedByWr[0].games} games` : "n/a",
        bestMap: mapStats[0] ? `${mapStats[0].name}: ${mapStats[0].winRate.toFixed(0)}% WR` : "n/a",
        worstMap: mapStats[mapStats.length - 1] ? `${mapStats[mapStats.length - 1].name}: ${mapStats[mapStats.length - 1].winRate.toFixed(0)}% WR` : "n/a",
        last10ResultsChronological: matches.slice(-10).map((m) => m.result[0]).join(""),
      };

      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statsBrief }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(errBody?.error || `Request failed (HTTP ${response.status})`);
      }
      const parsed = await response.json();
      setCoach({ status: "done", data: parsed, ranAt: new Date() });
    } catch (err) {
      setCoach({ status: "error", error: err?.message || "Analysis failed. Check your connection and try again." });
    }
  }, [currentInfo, peakInfo, stats, agentStats, mapStats, matches]);

  if (session.status !== "ready") {
    return <SetupScreen onConnect={connect} status={session.status} error={session.error} mapArt={mapArt} iconMap={iconMap} />;
  }

  return (
    <div className="vt-root">
      <style>{CSS}</style>
      <div className="vt-shell">
        <TabNav active={activeTab} onChange={setActiveTab} onOpenAbout={() => setShowAbout(true)} />
        <main className="vt-main">
          <TopBar player={session.player} currentInfo={currentInfo} matchesCount={matches.length} onDisconnect={disconnect} tierIcon={tierIcons[currentInfo.label.toLowerCase()]?.icon} />
          {activeTab === "overview" && <OverviewTab stats={stats} chartData={chartData} yDomain={yDomain} tiersInRange={tiersInRange} matches={matches} player={session.player} currentInfo={currentInfo} agentStats={agentStats} iconMap={iconMap} />}
          {activeTab === "matches" && <MatchesTab matches={matches} expandedId={expandedId} setExpandedId={setExpandedId} iconMap={iconMap} />}
          {activeTab === "agents" && <AgentsTab agentStats={agentStats} iconMap={iconMap} roleStats={roleStats} weaponStats={weaponStats} />}
          {activeTab === "maps" && <MapsTab mapStats={mapStats} mapArt={mapArt} />}
          {activeTab === "coach" && (
            <CoachTab
              coach={coach}
              onRun={runAnalysis}
              statsPreview={{ matchCount: matches.length, rank: currentInfo.label, winRate: stats.winRate.toFixed(0), kd: stats.kd.toFixed(2) }}
            />
          )}
        </main>
      </div>
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
}
