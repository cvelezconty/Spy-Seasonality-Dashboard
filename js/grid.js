/* js/grid.js
   Grid + heatmap renderer for monthly/weekly seasonality.
   SPY: uses prebuilt seasonality CSVs in the repo root (upload them).
   VIX / EPU: reads raw daily CSVs and computes seasonality on the fly.
*/
const BASE = "https://raw.githubusercontent.com/cvelezconty/Spy-Seasonality-Dashboard/main/";
const PATHS = {
  spyMonthly: "seasonality_monthly.csv",
  spyWeekly : "seasonality_weekly.csv",
  vixDaily  : "VIX_History.csv",
  epuDaily  : "USEPUINDXD.csv"
};

/* ---------- CSV helpers ---------- */
async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${url}`);
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
function detectDateAndValue({ headers, rows }) {
  const dateCol = headers.find(h => /date/i.test(h)) || headers[0];
  // first obviously numeric column
  const valueCol =
    headers.find(h => {
      if (/date/i.test(h)) return false;
      let ok = 0;
      for (let i = 0; i < Math.min(rows.length, 50); i++) {
        const s = rows[i][h].replace?.(/[^0-9.\-eE]/g, "");
        const v = Number(s);
        if (!Number.isNaN(v)) ok++;
      }
      return ok >= 5;
    }) || headers[1];
  return { dateCol, valueCol };
}

/* ---------- color helpers ---------- */
function pct(v) { return (v == null || isNaN(v)) ? "" : (v * 100).toFixed(2) + "%"; }
function textColor(bg) {
  const m = bg.match(/\d+/g);
  if (!m) return "#eee";
  const [r,g,b] = m.map(Number);
  const Y = (0.2126*r + 0.7152*g + 0.0722*b)/255;
  return Y > 0.62 ? "#000" : "#eee";
}
function heatColorFixed(v) {
  if (v == null || isNaN(v)) return "rgb(24,24,24)";
  const x = Math.max(-0.05, Math.min(0.05, v));
  if (x >= 0) {
    const g = Math.round(255 * (x / 0.05));
    return `rgb(${255 - g},255,${255 - g})`; // white→green
  } else {
    const r = Math.round(255 * (-x / 0.05));
    return `rgb(255,${255 - r},${255 - r})`; // white→red
  }
}
function heatColorAuto(v, min, max) {
  if (v == null || isNaN(v)) return "rgb(24,24,24)";
  if (min === max) return "rgb(240,240,240)";
  const mid = 0; // zero centered
  const span = Math.max(max - mid, mid - min);
  const x = Math.max(-span, Math.min(span, v));
  if (x >= 0) {
    const g = Math.round(255 * (x / span));
    return `rgb(${255 - g},255,${255 - g})`;
  } else {
    const r = Math.round(255 * (-x / span));
    return `rgb(255,${255 - r},${255 - r})`;
  }
}

/* ---------- aggregations from daily ---------- */
function groupByMonth(daily) {
  const map = new Map(); // key = YYYY-MM
  for (const { date, value } of daily) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ date, value });
  }
  const months = [];
  for (const [key, arr] of [...map.entries()].sort()) {
    arr.sort((a,b)=>a.date-b.date);
    const y = Number(key.slice(0,4));
    const m = Number(key.slice(5,7));
    const close = arr[arr.length-1].value;
    months.push({ y, m, close });
  }
  const rows = [];
  for (let i=0; i<months.length; i++) {
    const { y, m, close } = months[i];
    const prev = months[i-1];
    const chg = (prev && prev.close) ? (close/prev.close - 1) : null;
    rows.push({ Year: y, Month: m, Pct: chg });
  }
  return rows;
}
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(),0,4));
  const week = 1 + Math.round((d - firstThursday)/ (7*24*3600*1000));
  return { y: d.getUTCFullYear(), w: week };
}
function groupByWeek(daily) {
  const map = new Map(); // key = YYYY-WW
  for (const { date, value } of daily) {
    const { y, w } = isoWeek(date);
    const key = `${y}-${String(w).padStart(2,"0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ date, value });
  }
  const weeks = [];
  for (const [key, arr] of [...map.entries()].sort()) {
    arr.sort((a,b)=>a.date-b.date);
    const [ys, ws] = key.split("-");
    const y = Number(ys), w = Number(ws);
    const close = arr[arr.length-1].value;
    weeks.push({ y, w, close });
  }
  const rows = [];
  for (let i=0; i<weeks.length; i++) {
    const { y, w, close } = weeks[i];
    const prev = weeks[i-1];
    const chg = (prev && prev.close) ? (close/prev.close - 1) : null;
    rows.push({ Year: y, Week: w, Pct: chg });
  }
  return rows;
}
function pivotMonthly(monthRows) {
  const byY = new Map();
  for (const r of monthRows) {
    if (!byY.has(r.Year)) byY.set(r.Year, { Year: r.Year });
    byY.get(r.Year)[String(r.Month)] = r.Pct;
  }
  return [...byY.values()].sort((a,b)=>a.Year-b.Year);
}
function pivotWeekly(weekRows) {
  const byY = new Map();
  for (const r of weekRows) {
    if (!byY.has(r.Year)) byY.set(r.Year, { Year: r.Year });
    if (r.Week >= 10 && r.Week <= 27) {
      byY.get(r.Year)[String(r.Week)] = r.Pct;
    }
  }
  return [...byY.values()].sort((a,b)=>a.Year-b.Year);
}

/* ---------- dataset loaders ---------- */
async function loadSPY(mode) {
  const file = mode === "monthly" ? PATHS.spyMonthly : PATHS.spyWeekly;
  try {
    const { rows } = await fetchCSV(BASE + file);
    return rows.map(r => {
      const out = { Year: Number(r.Year) };
      Object.keys(r).forEach(k => {
        if (k !== "Year") out[k] = r[k] === "" ? null : Number(r[k]);
      });
      return out;
    });
  } catch (err) {
    throw new Error(`SPY ${file} not found. Upload it to the repo root.`);
  }
}
async function loadDailyThenAggregate(pathDaily, mode) {
  const { headers, rows } = await fetchCSV(BASE + pathDaily);
  const { dateCol, valueCol } = detectDateAndValue({ headers, rows });
  const daily = rows.map(r => {
      const d = new Date(r[dateCol]);
      const s = (r[valueCol] ?? "").replace(/[^0-9.\-eE]/g, "");
      const v = Number(s);
      return (isFinite(d) && !Number.isNaN(v)) ? { date: d, value: v } : null;
    })
    .filter(Boolean)
    .sort((a,b)=>a.date-b.date);

  return (mode === "monthly")
    ? pivotMonthly(groupByMonth(daily))
    : pivotWeekly(groupByWeek(daily));
}
async function loadData(dataset, mode) {
  if (dataset === "spy") return loadSPY(mode);
  if (dataset === "vix") return loadDailyThenAggregate(PATHS.vixDaily, mode);
  if (dataset === "epu") return loadDailyThenAggregate(PATHS.epuDaily, mode);
  throw new Error("Unknown dataset: " + dataset);
}

/* ---------- UI/render ---------- */
function columnsFor(mode) {
  if (mode === "weekly") return Array.from({length:18},(_,i)=>String(10+i)); // 10..27
  return Array.from({length:12},(_,i)=>String(i+1)); // 1..12
}
function computeMinMax(rows, cols) {
  let min = +Infinity, max = -Infinity;
  rows.forEach(r => cols.forEach(c => {
    const v = r[c];
    if (v!=null && !isNaN(v)) { if (v<min) min=v; if (v>max) max=v; }
  }));
  if (min === +Infinity) { min = -0.05; max = 0.05; }
  return { min, max };
}
function renderTable(rows, mode, opts) {
  const container = document.getElementById("grid");
  container.innerHTML = "";
  const cols = columnsFor(mode);

  const fromY = Number(opts.fromYear) || -Infinity;
  const toY   = Number(opts.toYear)   || Infinity;
  const data  = rows.filter(r => r.Year >= fromY && r.Year <= toY).sort((a,b)=>a.Year-b.Year);

  const { min, max } = (opts.scale === "auto") ? computeMinMax(data, cols) : {};

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const htr   = document.createElement("tr");
  const th0   = document.createElement("th");
  th0.className = "sticky-left";
  th0.textContent = "Year/Period";
  htr.appendChild(th0);
  cols.forEach(c => { const th=document.createElement("th"); th.textContent=c; htr.appendChild(th); });
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  data.forEach(r => {
    const tr = document.createElement("tr");
    const y  = document.createElement("td");
    y.className="sticky-left"; y.textContent = r.Year;
    tr.appendChild(y);
    cols.forEach(c => {
      const td = document.createElement("td");
      const v  = r[c];
      const bg = (opts.scale === "auto") ? heatColorAuto(v, min, max) : heatColorFixed(v);
      td.style.background = bg;
      td.style.color = textColor(bg);
      td.textContent = pct(v);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function setStatus(msg) {
  const el = document.getElementById("status");
  el.textContent = msg; 
}
function setError(msg) {
  const el = document.getElementById("error");
  if (!msg) { el.style.display="none"; el.textContent=""; return; }
  el.style.display="block"; el.textContent=msg;
}

/* ---------- boot ---------- */
async function boot() {
  const dataset = document.getElementById("dataset");
  const modeSel = document.getElementById("mode");
  const scaleSel= document.getElementById("scale");
  const from    = document.getElementById("fromYear");
  const to      = document.getElementById("toYear");
  const apply   = document.getElementById("apply");

  async function refresh() {
    setError("");
    setStatus("Loading…");
    try {
      const ds   = dataset.value;
      const mode = modeSel.value;
      const rows = await loadData(ds, mode);
      renderTable(rows, mode, {
        fromYear: from.value, toYear: to.value, scale: scaleSel.value
      });
      setStatus(`Loaded ${rows.length} year rows • ${ds.toUpperCase()} • ${mode} • scale: ${scaleSel.value}`);
    } catch (err) {
      setStatus("");
      setError(err.message);
      document.getElementById("grid").innerHTML = "";
      console.error(err);
    }
  }

  apply.addEventListener("click", refresh);
  await refresh();
}
boot().catch(err => console.error("Grid error:", err));
