/* js/grid.js
   Grid + heatmap renderer for monthly/weekly seasonality.

   - SPY: uses two prepared CSVs in the repo root:
       seasonality_monthly.csv  (Year,1..12 values = decimal pct, e.g. 0.0123)
       seasonality_weekly.csv   (Year,10..27 values = decimal pct)
   - VIX / EPU: read a daily CSV and compute Monthly/Weekly close-to-close % change
     on the fly, then pivot to the same shape as SPY.
*/

const BASE = "https://raw.githubusercontent.com/cvelezconty/Spy-Seasonality-Dashboard/main/";

// file names in the repo root
const PATHS = {
  spyMonthly: "seasonality_monthly.csv",
  spyWeekly : "seasonality_weekly.csv",
  vixDaily  : "VIX_History.csv",
  epuDaily  : "USEPUINDXD.csv"
};

// ------------------------------------------------------
// helpers: fetch & CSV parsing
// ------------------------------------------------------
async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchCSV(url) {
  const text = await fetchText(url);
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map(h => h.trim());
  const rows = lines.map(line => {
    const cells = line.split(",");
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (cells[i] ?? "").trim()));
    return obj;
  });
  return { headers, rows };
}

// find a DATE column and a numeric VALUE column
function detectDateAndValue({ headers, rows }) {
  const dateCol = headers.find(h => /date/i.test(h)) || headers[0];
  const valueCol =
    headers.find(h => {
      if (/date/i.test(h)) return false;
      let n = 0;
      for (let i = 0; i < Math.min(40, rows.length); i++) {
        const v = Number(rows[i][h]);
        if (!Number.isNaN(v)) n++;
      }
      return n >= 5;
    }) || headers[1];
  return { dateCol, valueCol };
}

// ------------------------------------------------------
// color helpers
// ------------------------------------------------------
function textColorFromBG(bg) {
  // bg like "rgb(r,g,b)"
  const m = bg.match(/\d+/g);
  if (!m) return "#eee";
  const [r, g, b] = m.map(Number);
  // relative luminance, tweak threshold so dark cells show white
  const Y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return Y > 0.62 ? "#000" : "#fff";
}

// heat color with mapping -range..+range
function heatColor(v, range) {
  if (v == null || isNaN(v)) return "rgb(24,24,24)";
  const R = Math.max(1e-6, range);
  const x = Math.max(-R, Math.min(R, v)) / R; // -1..+1
  if (x >= 0) {
    // white -> green
    const g = Math.round(255 * x);
    return `rgb(${255 - g},255,${255 - g})`;
  } else {
    // white -> red
    const r = Math.round(255 * -x);
    return `rgb(255,${255 - r},${255 - r})`;
  }
}
const pct = v => (v == null || isNaN(v) ? "" : (v * 100).toFixed(2) + "%");

// ------------------------------------------------------
// date grouping from daily series
// ------------------------------------------------------
function isoWeek(date) {
  // ISO week-of-year (Mon-based)
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round((d - firstThursday) / 604800000);
}

function groupDailyToMonthly(daily) {
  // end-of-month close
  const map = new Map(); // key "YYYY-MM"
  for (const { date, value } of daily) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ date, value });
  }
  const out = [];
  for (const [key, arr] of [...map.entries()].sort()) {
    arr.sort((a, b) => a.date - b.date);
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7));
    const close = arr[arr.length - 1].value;
    out.push({ y, m, close });
  }
  const rows = [];
  for (let i = 0; i < out.length; i++) {
    const { y, m, close } = out[i];
    const prev = out[i - 1];
    const chg = prev ? close / prev.close - 1 : null;
    rows.push({ Year: y, Month: m, Pct: chg });
  }
  return rows;
}

function groupDailyToWeekly(daily) {
  // end-of-week (Friday or last day present) close
  const map = new Map(); // key "YYYY-WW"
  for (const { date, value } of daily) {
    const y = date.getUTCFullYear();
    const w = isoWeek(date);
    const key = `${y}-${String(w).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ date, value });
  }
  const out = [];
  for (const [key, arr] of [...map.entries()].sort()) {
    arr.sort((a, b) => a.date - b.date);
    const [ys, ws] = key.split("-");
    const y = Number(ys), w = Number(ws);
    const close = arr[arr.length - 1].value;
    out.push({ y, w, close });
  }
  const rows = [];
  for (let i = 0; i < out.length; i++) {
    const { y, w, close } = out[i];
    const prev = out[i - 1];
    const chg = prev ? close / prev.close - 1 : null;
    rows.push({ Year: y, Week: w, Pct: chg });
  }
  return rows;
}

function pivotMonthly(rows) {
  const byY = new Map();
  for (const r of rows) {
    if (!byY.has(r.Year)) byY.set(r.Year, { Year: r.Year });
    byY.get(r.Year)[String(r.Month)] = r.Pct;
  }
  return [...byY.values()].sort((a, b) => a.Year - b.Year);
}

function pivotWeekly(rows) {
  const byY = new Map();
  for (const r of rows) {
    if (!byY.has(r.Year)) byY.set(r.Year, { Year: r.Year });
    if (r.Week >= 10 && r.Week <= 27) {
      byY.get(r.Year)[String(r.Week)] = r.Pct;
    }
  }
  return [...byY.values()].sort((a, b) => a.Year - b.Year);
}

// ------------------------------------------------------
// data loading
// ------------------------------------------------------
async function loadSPY(mode) {
  const file = mode === "monthly" ? PATHS.spyMonthly : PATHS.spyWeekly;
  const { rows } = await fetchCSV(BASE + file);
  return rows.map(r => {
    const o = { Year: Number(r.Year) };
    for (const k of Object.keys(r)) {
      if (k !== "Year") o[k] = r[k] === "" ? null : Number(r[k]);
    }
    return o;
  });
}

async function loadDailyThenAggregate(pathDaily, mode) {
  const { headers, rows } = await fetchCSV(BASE + pathDaily);
  const { dateCol, valueCol } = detectDateAndValue({ headers, rows });
  const daily = rows
    .map(r => {
      const d = new Date(r[dateCol]);
      const v = Number(r[valueCol]);
      return (isFinite(d) && !Number.isNaN(v)) ? { date: d, value: v } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

  if (mode === "monthly") return pivotMonthly(groupDailyToMonthly(daily));
  return pivotWeekly(groupDailyToWeekly(daily));
}

async function loadData(dataset, mode) {
  if (dataset === "spy") return loadSPY(mode);
  if (dataset === "vix") return loadDailyThenAggregate(PATHS.vixDaily, mode);
  if (dataset === "epu") return loadDailyThenAggregate(PATHS.epuDaily, mode);
  throw new Error("Unknown dataset: " + dataset);
}

// ------------------------------------------------------
// rendering
// ------------------------------------------------------
function buildColumns(mode) {
  if (mode === "weekly") {
    const wk = [];
    for (let i = 10; i <= 27; i++) wk.push(String(i));
    return wk;
  }
  return Array.from({ length: 12 }, (_, i) => String(i + 1));
}

// compute scaling range
function computeRange(rows, cols, scaleMode) {
  if (scaleMode === "fixed") return 0.05; // ±5%

  if (scaleMode === "auto-table") {
    let maxAbs = 0;
    for (const r of rows) {
      for (const c of cols) {
        const v = r[c];
        if (v != null && !isNaN(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
      }
    }
    return Math.max(maxAbs, 0.01); // avoid tiny scales
  }

  // auto-column -> return an object map col->range
  const per = {};
  for (const c of cols) {
    let maxAbs = 0;
    for (const r of rows) {
      const v = r[c];
      if (v != null && !isNaN(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
    }
    per[c] = Math.max(maxAbs, 0.01);
  }
  return per;
}

function renderTable(rows, mode, opts) {
  const root = document.getElementById("grid");
  root.innerHTML = "";

  const cols = buildColumns(mode);
  const fromY = Number(opts.fromYear) || -Infinity;
  const toY   = Number(opts.toYear)   ||  Infinity;

  const data = rows.filter(r => r.Year >= fromY && r.Year <= toY).sort((a, b) => a.Year - b.Year);
  const scale = computeRange(data, cols, opts.scale);

  const table = document.createElement("table");

  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.className = "sticky-left";
  th0.textContent = "Year/Period";
  htr.appendChild(th0);
  cols.forEach(c => {
    const th = document.createElement("th");
    th.textContent = c;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  data.forEach(r => {
    const tr = document.createElement("tr");

    const y = document.createElement("td");
    y.className = "sticky-left";
    const wrap = document.createElement("div");
    wrap.className = "yearcell";
    wrap.textContent = r.Year;
    y.appendChild(wrap);
    tr.appendChild(y);

    cols.forEach(c => {
      const td = document.createElement("td");
      const v = r[c];
      const rng = typeof scale === "number" ? scale : (scale[c] ?? 0.05);
      const bg = heatColor(v, rng);
      td.style.background = bg;
      td.style.color = textColorFromBG(bg);
      td.textContent = pct(v);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  root.appendChild(table);
}

// ------------------------------------------------------
// boot
// ------------------------------------------------------
async function boot() {
  const dataset = document.getElementById("dataset");
  const modeSel = document.getElementById("mode");
  const scaleSel= document.getElementById("scale");
  const from    = document.getElementById("fromYear");
  const to      = document.getElementById("toYear");
  const apply   = document.getElementById("apply");
  const status  = document.getElementById("status");

  async function refresh() {
    try {
      status.textContent = "Loading…";
      const ds   = dataset.value;
      const mode = modeSel.value;
      const rows = await loadData(ds, mode);

      renderTable(rows, mode, {
        fromYear: from.value,
        toYear  : to.value,
        scale   : scaleSel.value
      });

      status.textContent =
        `Loaded ${rows.length} year rows • ${ds.toUpperCase()} • ${mode} • scale: ${scaleSel.value}`;
    } catch (e) {
      console.error(e);
      status.textContent = e.message || "Error loading data.";
      document.getElementById("grid").innerHTML = "";
    }
  }

  apply.addEventListener("click", refresh);
  await refresh();
}

boot().catch(err => console.error("Grid error:", err));
