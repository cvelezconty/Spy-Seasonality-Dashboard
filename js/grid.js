/* js/grid.js
   Seasonality grid renderer.
   - SPY uses prebuilt seasonality CSVs in the repo root
   - VIX / EPU read daily CSVs and compute monthly/weekly % change
   - VIX / FOMC checkboxes just add badges beside Year (for SPY view or any dataset)
*/
const BASE = "https://raw.githubusercontent.com/cvelezconty/Spy-Seasonality-Dashboard/main/";

const PATHS = {
  spyMonthly: "seasonality_monthly.csv",
  spyWeekly : "seasonality_weekly.csv",
  vixDaily  : "VIX_History.csv",
  epuDaily  : "USEPUINDXD.csv"
};

/* ---------- CSV helpers ---------- */
async function fetchText(url){
  const res = await fetch(url,{cache:"no-store"});
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
async function fetchCSV(url){
  const text = await fetchText(url);
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map(h=>h.trim());
  const rows = lines.map(line=>{
    const cells = line.split(",");
    const o={}; headers.forEach((h,i)=>o[h]=(cells[i]??"").trim());
    return o;
  });
  return {headers,rows};
}

/* auto-detect date/value columns for arbitrary daily CSVs */
function detectDateAndValue({headers,rows}){
  const dateCol = headers.find(h=>/date/i.test(h)) || headers[0];
  const valueCol = headers.find(h=>{
    if (/date/i.test(h)) return false;
    let cnt=0; for(let i=0;i<Math.min(40,rows.length);i++){
      if(!Number.isNaN(Number(rows[i][h]))) cnt++;
    }
    return cnt>=5;
  }) || headers[1];
  return {dateCol,valueCol};
}

/* ---------- color helpers ---------- */
function heatColor(v,scaleMode,range){
  if(v==null || isNaN(v)) return "#19191f";
  if(scaleMode==="auto" && range){
    const [vmin,vmax] = range; // map vmin->red, 0->white, vmax->green
    const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
    const x = clamp((v-0)/(v>=0 ? (vmax||0.0001) : (Math.abs(vmin)||0.0001)), -1, 1);
    if(x>=0){ const g=Math.round(255*x); return `rgb(${255-g},255,${255-g})`; }
    const r=Math.round(255*Math.abs(x));  return `rgb(255,${255-r},${255-r})`;
  }
  // fixed ±5%
  const x=Math.max(-0.05,Math.min(0.05,v));
  if(x>=0){ const g=Math.round(255*(x/0.05)); return `rgb(${255-g},255,${255-g})`; }
  const r=Math.round(255*(-x/0.05));        return `rgb(255,${255-r},${255-r})`;
}
function pct(v){ return (v==null||isNaN(v)) ? "" : (v*100).toFixed(2)+"%"; }
function textColor(bg){
  const m = bg.match(/\d+/g); if(!m) return "#eaeaf0";
  const [r,g,b] = m.map(Number);
  const Y = (0.2126*r+0.7152*g+0.0722*b)/255;
  return Y>0.60 ? "#111" : "#fff";
}

/* ---------- build headers ---------- */
function buildColumns(mode){
  if(mode==="weekly"){ const wk=[]; for(let i=10;i<=27;i++) wk.push(String(i)); return wk; }
  return Array.from({length:12},(_,i)=>String(i+1));
}

/* ---------- aggregate daily to monthly/weekly % ---------- */
function groupByMonth(daily){
  const byKey=new Map(); // YYYY-MM -> array
  daily.forEach(({date,value})=>{
    const y=date.getUTCFullYear(), m=date.getUTCMonth()+1;
    const key=`${y}-${String(m).padStart(2,"0")}`;
    if(!byKey.has(key)) byKey.set(key,[]);
    byKey.get(key).push({date,value});
  });
  const eom = [...byKey.entries()].sort().map(([k,arr])=>{
    arr.sort((a,b)=>a.date-b.date);
    const y=Number(k.slice(0,4)), m=Number(k.slice(5,7));
    return {y,m,close:arr[arr.length-1].value};
  });
  const out=[]; for(let i=0;i<eom.length;i++){
    const {y,m,close}=eom[i], prev=eom[i-1];
    out.push({Year:y,Month:m,Pct:(prev? close/prev.close-1 : null)});
  }
  return out;
}
function isoWeek(date){
  const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  const day=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-day+3);
  const firstThu=new Date(Date.UTC(d.getUTCFullYear(),0,4));
  const week=1+Math.round((d-firstThu)/(7*24*3600*1000));
  return {y:d.getUTCFullYear(),w:week};
}
function groupByWeek(daily){
  const byKey=new Map();
  daily.forEach(({date,value})=>{
    const {y,w}=isoWeek(date); const key=`${y}-${String(w).padStart(2,"0")}`;
    if(!byKey.has(key)) byKey.set(key,[]); byKey.get(key).push({date,value});
  });
  const eow=[...byKey.entries()].sort().map(([k,arr])=>{
    arr.sort((a,b)=>a.date-b.date);
    const [ys,ws]=k.split("-"); return {y:Number(ys),w:Number(ws),close:arr[arr.length-1].value};
  });
  const out=[]; for(let i=0;i<eow.length;i++){
    const {y,w,close}=eow[i], prev=eow[i-1];
    out.push({Year:y,Week:w,Pct:(prev? close/prev.close-1 : null)});
  }
  return out;
}
function pivotMonthly(rows){
  const map=new Map();
  rows.forEach(r=>{ if(!map.has(r.Year)) map.set(r.Year,{Year:r.Year}); map.get(r.Year)[String(r.Month)]=r.Pct; });
  return [...map.values()].sort((a,b)=>a.Year-b.Year);
}
function pivotWeekly(rows){
  const map=new Map();
  rows.forEach(r=>{
    if(!map.has(r.Year)) map.set(r.Year,{Year:r.Year});
    if(r.Week>=10 && r.Week<=27) map.get(r.Year)[String(r.Week)]=r.Pct;
  });
  return [...map.values()].sort((a,b)=>a.Year-b.Year);
}

/* ---------- loaders ---------- */
async function loadSPY(mode){
  const file = (mode==="monthly") ? PATHS.spyMonthly : PATHS.spyWeekly;
  const {rows} = await fetchCSV(BASE+file);
  return rows.map(r=>{
    const o={Year:Number(r.Year)}; Object.keys(r).forEach(k=>{
      if(k!=="Year") o[k]=(r[k]===""? null : Number(r[k]));
    }); return o;
  });
}
async function loadDailyThenAggregate(pathDaily,mode){
  const {headers,rows}=await fetchCSV(BASE+pathDaily);
  const {dateCol,valueCol}=detectDateAndValue({headers,rows});
  const daily = rows.map(r=>{
    const d=new Date(r[dateCol]); const v=Number(r[valueCol]);
    return (isFinite(d) && !Number.isNaN(v)) ? {date:d,value:v} : null;
  }).filter(Boolean).sort((a,b)=>a.date-b.date);
  if(mode==="monthly") return pivotMonthly(groupByMonth(daily));
  return pivotWeekly(groupByWeek(daily));
}
async function loadData(dataset,mode){
  if(dataset==="spy") return loadSPY(mode);
  if(dataset==="vix") return loadDailyThenAggregate(PATHS.vixDaily,mode);
  if(dataset==="epu") return loadDailyThenAggregate(PATHS.epuDaily,mode);
  throw new Error("Unknown dataset "+dataset);
}

/* ---------- render ---------- */
function extent(rows,cols){
  let mn=Infinity,mx=-Infinity;
  rows.forEach(r=>cols.forEach(c=>{
    const v=r[c]; if(v!=null && !isNaN(v)){ if(v<mn) mn=v; if(v>mx) mx=v; }
  }));
  if(mn===Infinity) return null;
  return [mn,mx];
}
function buildColumns(mode){
  if(mode==="weekly"){ const wk=[]; for(let i=10;i<=27;i++) wk.push(String(i)); return wk; }
  return Array.from({length:12},(_,i)=>String(i+1));
}
function renderTable(rows,mode,opts){
  const container=document.getElementById("grid");
  container.innerHTML="";
  const cols=buildColumns(mode);

  const fromY=Number(opts.fromYear)||-Infinity;
  const toY  =Number(opts.toYear)|| Infinity;
  const data = rows.filter(r=>r.Year>=fromY && r.Year<=toY).sort((a,b)=>a.Year-b.Year);

  const rng = (opts.scale==="auto") ? extent(data,cols) : null;

  const table=document.createElement("table");
  const thead=document.createElement("thead");
  const htr=document.createElement("tr");

  const th0=document.createElement("th"); th0.className="sticky-left"; th0.textContent="Year/Period";
  htr.appendChild(th0);
  cols.forEach(c=>{const th=document.createElement("th"); th.textContent=c; htr.appendChild(th);});
  thead.appendChild(htr); table.appendChild(thead);

  const tbody=document.createElement("tbody");
  data.forEach(r=>{
    const tr=document.createElement("tr");
    const y=document.createElement("td"); y.className="sticky-left"; y.textContent=r.Year;

    if(opts.showVix){ const b=document.createElement("span"); b.className="badge"; b.textContent="VIX";  y.appendChild(b); }
    if(opts.showFomc){const b=document.createElement("span"); b.className="badge"; b.textContent="FOMC"; y.appendChild(b); }

    tr.appendChild(y);

    cols.forEach(c=>{
      const td=document.createElement("td");
      const v=r[c];
      const bg=heatColor(v,opts.scale,rng);
      td.style.background=bg;
      td.style.color=textColor(bg);
      td.textContent=pct(v);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  // tiny status line (what got loaded)
  const info=document.createElement("div");
  info.className="note";
  info.textContent = `Loaded ${data.length} year rows • ${opts.dataset.toUpperCase()} • ${opts.mode} • scale: ${opts.scale}`;
  container.parentElement.insertBefore(info,container);
}

/* ---------- boot ---------- */
async function boot(){
  const dataset = document.getElementById("dataset");
  const modeSel = document.getElementById("mode");
  const scaleSel= document.getElementById("scale");
  const from    = document.getElementById("fromYear");
  const to      = document.getElementById("toYear");
  const showVix = document.getElementById("showVix");
  const showFmc = document.getElementById("showFomc");
  const apply   = document.getElementById("apply");

  async function refresh(){
    const ds   = dataset.value;
    const mode = modeSel.value;
    const rows = await loadData(ds,mode);
    renderTable(rows,mode,{
      dataset: ds, mode,
      fromYear: from.value, toYear: to.value,
      scale: scaleSel.value,
      showVix: showVix.checked, showFomc: showFmc.checked
    });
  }
  apply.addEventListener("click",refresh);
  // sensible defaults
  if(!from.value) from.value = "2010";
  if(!to.value)   to.value   = new Date().getFullYear();
  await refresh();
}

boot().catch(err=>console.error("Grid error:",err));
