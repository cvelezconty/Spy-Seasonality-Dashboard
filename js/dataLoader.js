// js/dataLoader.js
// Minimal CSV Loader + global store.
// ZeroA: loads VIX and FOMC CSVs from your GitHub repo. (SPY XLSX comes in Step 2)

window.dataStore = { vix: [], fomc: [] };

const $ = (id) => document.getElementById(id);

async function loadCSV(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${url} -> ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return lines.map(line => {
    const cells = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] ?? "").trim()]));
  });
}

async function bootLoad() {
  const base =
    "https://raw.githubusercontent.com/cvelezconty/Spy-Seasonality-Dashboard/main/";
  const paths = {
    vix:  "VIX_History.csv",
    // note the encoded space in the filename:
    fomc: "MODIFIED%20FOMC_Seasonality_Pivot.csv"
  };

  const status = $("status");
  const debug  = $("debug");

  status.textContent = "Loading VIX & FOMC…";

  try {
    const [vix, fomc] = await Promise.all([
      loadCSV(base + paths.vix),
      loadCSV(base + paths.fomc),
    ]);

    window.dataStore.vix  = vix;
    window.dataStore.fomc = fomc;

    status.innerHTML =
      `<span class="ok">Loaded datasets</span> — VIX: ${vix.length.toLocaleString()} rows, FOMC: ${fomc.length.toLocaleString()} rows`;

    // small debug dump (first 3 rows of each) so you can see structure
    const sample = {
      vix_sample:  vix.slice(0, 3),
      fomc_sample: fomc.slice(0, 3),
    };
    debug.textContent = JSON.stringify(sample, null, 2);
    console.log("Loaded datasets:", { vix: vix.length, fomc: fomc.length });

  } catch (err) {
    status.innerHTML =
      `<span class="err">Data load error</span> — ${String(err && err.message || err)}`;
    console.error("Data load error:", err);
  }
}

bootLoad();
