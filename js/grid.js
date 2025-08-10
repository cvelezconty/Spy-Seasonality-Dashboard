/* js/grid.js
   Grid + heatmap renderer for monthly/weekly returns and VIX‑implied moves.
   Loads CSVs from repo; falls back to tiny demo only for returns.
*/
const BASE =
  "https://raw.githubusercontent.com/cvelezconty/Spy-Seasonality-Dashboard/main/";

const PATHS = {
  monthly: "seasonality_monthly.csv",  // Year,1..12  (returns, e.g. 0.0123)
  weekly:  "seasonality_weekly.csv",   // Year,10..27 (returns)
  vix:     "VIX_History.csv"           // Date, Close (or similar)
};

// --- small demo for returns if CSVs missing (not used for VIX) -------------
const DEMO = {
  monthly: [
    { Year: 2023, 1:-0.022,2:0.014,3:0.006,4:0.018,5:-0.007,6:0.004,7:0.010,8:-0.012,9:-0.018,10:0.011,11:0.023,12:0.006 },
    { Year: 2024, 1:0.019,2:-0.003,3:0.012,4:-0.005,5:0.008,6:0.003,7:-0.004,8:0.007,9:-0.011,10:0.014,11:0.021,12:0.004 },
    { Year: 2025, 1:0.012,2:0.006,3:-0.004,4:0.009,5:0.002,6:-0.001,7:0.004,8:0.003,9:-0.006,10:0.010,11:0.016,12:0.005 }
  ],
  weekly: [
    { Year: 2024, 10:-0.012,11:0.003,12:0.004,13:-0.006,14:0.011,15:0.006,16:-0.004,17:-0.003,18:0.007,19:-0.011,20:0.009,21:0.005,22:0.004,23:-0.004,24:-0.002,25:0.006,26:0.004,27:0.003 },
    { Year: 2025, 10:0.006,11:0.002,12:-0.002,13:0.004,14:0.008,15:-0.004,16:-0.006,17:0.003,18:-0.005,19:0.010,20:0.012,21:-0.006,22:0.004,23:0.003,24:-0.001,25:0.004,26:0.002,27:0.001 }
  ]
};

// ---------- CSV helpers -----------------------------------------------------
async function fetchCSV(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map(h => h.trim());
  return lines.map(line => {
    const cells = line.split(",");
    const obj = {};
    headers.forEach((h, i) => {
      const raw = (cells[i] ?? "").trim();
      obj[h] = raw;
    });
    return obj;
  });
}

// ---------- colors & formatting --------------------------------------------
function pct(v) {
  if (v == null || isNaN(v)) return "";
  return (v * 100).toFixed(2) + "%";
}

// diverging for signed returns, single‑hue for implied (non‑negative)
function heatColor(v, singleHue=false) {
  if (v == null || isNaN(v)) return { bg: "#ffffff", text: "#000" };
  if (singleHue) {
    // clamp 0..10% for color scale
    const x = Math.max(0, Math.min(0.10, v));
    const g = Math.round(255 - (x / 0.10) * 155); // 255->100
    return { bg: `rgb(${g},255,${g})`, text: "#000" }; // pale -> stronger green
  }
  // signed scale ±5%
  const x = Math.max(-0.05, Math.min(0.05, v));
  if (x >= 0) {
    const g = Math.round(255 * (x / 0.05));
    return { bg: `rgb(${255 - g},255,${255 - g})`, text: "#000" };
  } else {
    const r = Math.round(255 * (-x / 0.05));
    return { bg: `rgb(255,${255 - r},${255 - r})`, text: "#000" };
  }
}

function buildColumns(kind, period) {
  if (kind === "implied") {
    if (period === "daily")   return Array.from({length:31}, (_,i)=>String(i+1)); // 1..31 (day of month)
    if (period === "weekly")  return Array.from({length:18}, (_,i)=>String(10+i)); // 10..27
    return Array.from({length:12}, (_,i)=>String(i+1)); // monthly 1..12
  }
  // returns
  if (kind === "weekly") return Array.from({length:18}, (_,i)=>String(10+i));
  return Array.from({length:12}, (_,i)=>String(i+1));
}

// ---------- load returns (existing) ----------------------------------------
async function loadReturns(kind) {
  const path = kind === "monthly" ? PATHS.monthly : PATHS.weekly;
  try {
    const arr = await fetchCSV(BASE + path);
    // coerce numeric fields
    return arr.map(r => {
      const out = { Year: Number(r.Year) };
      Object.keys(r).forEach(k => {
        if (k !== "Year") out[k] = r[k] === "" ? null : Number(r[k]);
      });
      return out;
    });
  } catch (e) {
    console.warn(`Missing ${path} — using demo`, e);
    return DEMO[kind];
  }
}

// ---------- load & build implied from VIX ----------------------------------
function toDate(s) { return new Date(s); }

// N for horizon
const N_BY_PERIOD = { daily: 252, weekly: 52, monthly: 12 };

async function loadImplied(period) {
  // read VIX CSV (expects columns Date, Close OR something numeric in column 2)
  const rows = await fetchCSV(BASE + PATHS.vix);

  // normalize to {date: Date, vix: number}
  const parsed = rows.map(r => {
    const keys = Object.keys(r);
    const dkey = keys.find(k => /date/i.test(k)) || keys[0];
    const ckey = keys.find(k => /close|last|value/i.test(k)) || keys[1];
    const vix = Number(r[ckey]);
    const dt  = toDate(r[dkey]);
    return (isFinite(vix) && !isNaN(dt)) ? { date: dt, vix } : null;
  }).filter(Boolean);

  // implied move (sigma) for chosen period: vix/100 / sqrt(N)
  const N = N_BY_PERIOD[period];
  const per = parsed.map(p => ({
    year: p.date.getFullYear(),
    month: p.date.getMonth() + 1,
    day: p.date.getDate(),
    week: isoWeek(p.date),
    value: (p.vix / 100) / Math.sqrt(N) // always non‑negative
  }));

  // aggregate Year x Column
  const grid = new Map(); // year -> {col:value}
  const push = (y, c, v) => {
    if (!grid.has(y)) grid.set(y, { Year: y });
    const row = grid.get(y);
    if (!row[c]) row[c] = [];
    row[c].push(v);
  };

  per.forEach(p => {
    if (period === "daily")   push(p.year, String(p.day), p.value);
    else if (period === "weekly") {
      if (p.week >= 10 && p.week <= 27) push(p.year, String(p.week), p.value);
    } else /* monthly */ push(p.year, String(p.month), p.value);
  });

  // average per cell
  const out = Array.from(grid.values()).map(r => {
    Object.keys(r).forEach(k => {
      if (k === "Year") return;
      const arr = r[k];
      r[k] = Array.isArray(arr) ? (arr.reduce((s,x)=>s+x,0) / arr.length) : null;
    });
    return r;
  }).sort((a,b)=>a.Year-b.Year);

  return out;
}

// ISO week helper (Mon‑based)
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

// ---------- render ----------------------------------------------------------
function renderTable(rows, kind, options) {
  const container = document.getElementById("grid");
  container.innerHTML = "";

  const cols = buildColumns(kind, options.impliedPeriod);
  const fromY = Number(options.fromYear) || -Infinity;
  const toY   = Number(options.toYear)   ||  Infinity;
  const data  = rows.filter(r => r.Year >= fromY && r.Year <= toY)
                    .sort((a,b)=>a.Year-b.Year);

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const htr   = document.createElement("tr");

  const th0 = document.createElement("th");
  th0.className = "sticky-left";
  th0.textContent = "Year/Period";
  htr.appendChild(th0);

  cols.forEach(c => {
    const th = document.createElement("th");
    th.textContent = c;
    th.style.color = "#000";
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  data.forEach(r => {
    const tr = document.createElement("tr");

    const y = document.createElement("td");
    y.className = "sticky-left";
    y.style.color = "#000";
    y.textContent = r.Year;

    if (options.showVix)  { const b=document.createElement("span"); b.className="badge"; b.textContent="VIX";  y.appendChild(b); }
    if (options.showFomc) { const b=document.createElement("span"); b.className="badge"; b.textContent="FOMC"; y.appendChild(b); }
    tr.appendChild(y);

    cols.forEach(c => {
      const td = document.createElement("td");
      const v  = r[c];
      const { bg, text } = heatColor(v, kind === "implied"); // single‑hue for implied
      td.style.backgroundColor = bg;
      td.style.color = text;
      td.textContent = pct(v);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

// ---------- boot ------------------------------------------------------------
async function boot() {
  const modeSel       = document.getElementById("mode");
  const impliedPeriod = document.getElementById("impliedPeriod");
  const fromYear      = document.getElementById("fromYear");
  const toYear        = document.getElementById("toYear");
  const showVix       = document.getElementById("showVix");
  const showFomc      = document.getElementById("showFomc");
  const apply         = document.getElementById("apply");

  function toggleImpliedPeriod() {
    impliedPeriod.style.display = (modeSel.value === "implied") ? "" : "none";
  }
  modeSel.addEventListener("change", toggleImpliedPeriod);
  toggleImpliedPeriod();

  async function refresh() {
    const mode = modeSel.value;
    let rows;
    if (mode === "implied") {
      rows = await loadImplied(impliedPeriod.value);
    } else {
      rows = await loadReturns(mode);
    }
    renderTable(rows, mode, {
      impliedPeriod: impliedPeriod.value,
      fromYear: fromYear.value,
      toYear: toYear.value,
      showVix: showVix.checked,
      showFomc: showFomc.checked
    });
  }

  apply.addEventListener("click", refresh);
  await refresh();
}

boot().catch(err => console.error("Grid error:", err));
