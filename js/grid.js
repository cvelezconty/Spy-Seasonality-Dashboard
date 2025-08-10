/* js/grid.js
   Grid + heatmap renderer for monthly/weekly seasonality.
   Loads CSVs from the repo; if missing, falls back to a tiny demo.
*/

const BASE =
  "https://raw.githubusercontent.com/cvelezconty/Spy-Seasonality-Dashboard/main/";

const PATHS = {
  monthly: "seasonality_monthly.csv", // Year,1,2,...,12  (values = percent change, e.g., 0.0123 = +1.23%)
  weekly:  "seasonality_weekly.csv"   // Year,10,11,...,27
};

// Tiny demo data if CSVs aren’t present (values are percent, 0.012 = 1.2%)
const DEMO = {
  monthly: [
    { Year: 2023, 1: -0.022, 2: 0.014, 3: 0.006, 4: 0.018, 5: -0.007, 6: 0.004, 7: 0.010, 8: -0.012, 9: -0.018, 10: 0.011, 11: 0.023, 12: 0.006 },
    { Year: 2024, 1:  0.019, 2: -0.003, 3: 0.012, 4: -0.005, 5: 0.008,  6: 0.003, 7: -0.004, 8: 0.007,  9: -0.011, 10: 0.014, 11: 0.021, 12: 0.004 },
    { Year: 2025, 1:  0.012, 2: 0.006,  3: -0.004,4: 0.009,  5: 0.002,  6: -0.001,7: 0.004,  8: 0.003,  9: -0.006, 10: 0.010, 11: 0.016, 12: 0.005 }
  ],
  weekly: [
    { Year: 2024, 10: -0.012, 11: 0.003, 12: 0.004, 13: -0.006, 14: 0.011, 15: 0.006, 16: -0.004, 17: -0.003, 18: 0.007, 19: -0.011, 20: 0.009, 21: 0.005, 22: 0.004, 23: -0.004, 24: -0.002, 25: 0.006, 26: 0.004, 27: 0.003 },
    { Year: 2025, 10: 0.006,  11: 0.002, 12: -0.002, 13: 0.004, 14: 0.008, 15: -0.004, 16: -0.006, 17: 0.003, 18: -0.005, 19: 0.010, 20: 0.012, 21: -0.006, 22: 0.004, 23: 0.003,  24: -0.001, 25: 0.004, 26: 0.002, 27: 0.001 }
  ]
};

// ---- helpers --------------------------------------------------------------

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
      obj[h] = h === "Year" ? Number(raw) : (raw === "" ? null : Number(raw));
    });
    return obj;
  });
}

// red (neg) <-> white <-> green (pos) + force black text for readability
function heatColor(v) {
  // Always return both background and text color
  if (v == null || isNaN(v)) return { bg: "#ffffff", text: "#000000" };

  // clamp at ±5% for color scale
  const x = Math.max(-0.05, Math.min(0.05, v));
  if (x >= 0) {
    const g = Math.round(255 * (x / 0.05));
    return { bg: `rgb(${255 - g}, 255, ${255 - g})`, text: "#000000" }; // greenish
  } else {
    const r = Math.round(255 * (-x / 0.05));
    return { bg: `rgb(255, ${255 - r}, ${255 - r})`, text: "#000000" }; // reddish
  }
}

function pct(v) {
  if (v == null || isNaN(v)) return "";
  return (v * 100).toFixed(2) + "%";
}

function buildColumns(mode) {
  if (mode === "weekly") {
    const wk = [];
    for (let i = 10; i <= 27; i++) wk.push(String(i)); // week numbers across the top
    return wk;
  }
  return Array.from({ length: 12 }, (_, i) => String(i + 1)); // 1..12
}

// ---- render ---------------------------------------------------------------

function renderTable(rows, mode, opts) {
  const container = document.getElementById("grid");
  container.innerHTML = "";

  const cols = buildColumns(mode);

  // filter by year range
  const fromY = Number(opts.fromYear) || -Infinity;
  const toY = Number(opts.toYear) || Infinity;
  const data = rows
    .filter(r => r.Year >= fromY && r.Year <= toY)
    .sort((a, b) => a.Year - b.Year);

  // table + header
  const table = document.createElement("table");

  const thead = document.createElement("thead");
  const htr = document.createElement("tr");

  const th0 = document.createElement("th");
  th0.className = "sticky-left";
  th0.textContent = "Year/Period";
  htr.appendChild(th0);

  cols.forEach(c => {
    const th = document.createElement("th");
    th.textContent = c;                    // shows 10..27 in weekly mode
    th.style.color = "#000000";            // header text black
    htr.appendChild(th);
  });

  thead.appendChild(htr);
  table.appendChild(thead);

  // body
  const tbody = document.createElement("tbody");

  data.forEach(r => {
    const tr = document.createElement("tr");

    const y = document.createElement("td");
    y.className = "sticky-left";
    y.style.color = "#000000";
    y.textContent = r.Year;

    if (opts.showVix) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "VIX";
      y.appendChild(b);
    }
    if (opts.showFomc) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "FOMC";
      y.appendChild(b);
    }
    tr.appendChild(y);

    cols.forEach(c => {
      const td = document.createElement("td");
      const v = r[c];
      const { bg, text } = heatColor(v);
      td.style.backgroundColor = bg;
      td.style.color = text;               // <-- always black text
      td.textContent = pct(v);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

// ---- boot -----------------------------------------------------------------

async function loadData(mode) {
  const url = BASE + PATHS[mode];
  try {
    const arr = await fetchCSV(url);
    return arr;
  } catch (e) {
    console.warn(`Missing ${PATHS[mode]} — using demo`, e);
    return DEMO[mode];
  }
}

async function boot() {
  const modeSel  = document.getElementById("mode");
  const fromYear = document.getElementById("fromYear");
  const toYear   = document.getElementById("toYear");
  const showVix  = document.getElementById("showVix");
  const showFomc = document.getElementById("showFomc");
  const apply    = document.getElementById("apply");

  async function refresh() {
    const mode = modeSel.value;
    const rows = await loadData(mode);
    renderTable(rows, mode, {
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
