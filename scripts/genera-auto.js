/* ============================================================================
   EUROPA AUTO — generatore pagine auto + feed Google
   ----------------------------------------------------------------------------
   Legge da Supabase le stesse auto che mostra vetrina.html (vista pubblica
   "vetrina", con ripiego su "magazzino"), applica gli stessi criteri di
   pubblicazione, e scrive file statici che Google puo' leggere davvero.

   Uso:  node scripts/genera-auto.js            (legge da Supabase)
         node scripts/genera-auto.js --prova    (usa dati finti, per controllare)

   Tutto cio' che si puo' voler cambiare e' qui sotto, in CONFIG.
   ============================================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const CONFIG = {
  SB_URL: 'https://jasrectyddshjizpxiia.supabase.co',
  SB_KEY: 'sb_publishable_Q2ROk7MEaOCpG2W2xZv_pQ_BDyLItzw',   /* chiave pubblica, la stessa della vetrina */

  BASE_URL: 'https://auto.europaautosrl.it',                /* dove stanno le pagine */
  VETRINA_URL: 'https://auto.europaautosrl.it/vetrina.html',
  LOGO_URL: 'https://auto.europaautosrl.it/logo.png',

  AZIENDA: 'Europa Auto',
  RAGIONE: 'Europa Auto S.r.l.',
  PIVA: '06440210968',
  TEL: '02 9181820',
  TEL_HREF: 'tel:029181820',
  WA_NUM: '39029181820',
  EMAIL: 'vendita@europaautosrl.it',
  INDIRIZZO: 'Via Nigra 4, 20037 Paderno Dugnano (MI)',
  SEDE2: 'Bovisio Masciago (MB)',

  /* Codice negozio: deve essere IDENTICO al "codice negozio" impostato sul
     profilo dell'attivita' Google (Business Profile) collegato a Merchant
     Center. Si imposta li' una volta sola. */
  STORE_CODE: '09508044153399500827',

  /* La rata sulle pagine e' spenta: per legge un esempio di finanziamento in
     pubblicita' richiede TAN, TAEG, durata e importo totale. Finche' non ci
     sono le diciture approvate dalla finanziaria, meglio niente. */
  MOSTRA_RATA: false,

  /* In Italia il telaio (VIN) e' FACOLTATIVO per gli annunci veicoli
     (guida Google "vin": optional in France, Germany, Italy, Japan, Spain,
     Netherlands, UK). Basta l'ID [id], che e' il riferimento (targa o codice
     EA...) scritto anche sulla pagina. Con il telaio obbligatorio nel feed
     entravano 5 auto su 60: sotto le 10 offerte minime la revisione
     iniziale di Google non parte nemmeno. */
  FEED_RICHIEDE_TELAIO: false,

  DIR_AUTO: 'auto',
  DIR_FEED: 'feed',
  FEED_FILE: 'veicoli.tsv'
};

/* ----------------------------- utilita' ---------------------------------- */
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function num(v){ if(v==null||v==='') return null; let s=String(v).replace(/[^\d,\.]/g,''); if(!s) return null;
  if(s.indexOf(',')>-1 && s.indexOf('.')>-1){ s=s.replace(/\./g,'').replace(',','.'); }
  else if(s.indexOf(',')>-1){ s=s.replace(',','.'); }
  else if(/\.\d{3}$/.test(s)){ s=s.replace(/\./g,''); }
  const n=parseFloat(s); return isNaN(n)?null:n; }
function euro(v){ const n=num(v); return n==null?null:n.toLocaleString('it-IT',{maximumFractionDigits:0})+' €'; }
function kmFmt(v){ const n=num(v); return n==null?null:n.toLocaleString('it-IT',{maximumFractionDigits:0})+' km'; }
function cap(s){ return String(s||'').split(/\s+/).map(w=> (w.length<=3||/\d/.test(w))?w:(w.charAt(0).toUpperCase()+w.slice(1).toLowerCase())).join(' '); }
function dataIT(v){ const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m?(m[3]+'/'+m[2]+'/'+m[1]):String(v||''); }
function annoDa(a){ if(a.anno) return String(a.anno).slice(0,4); if(a.dataImm){ const m=String(a.dataImm).match(/(\d{4})/); if(m) return m[1]; } return ''; }
/* Il riferimento e' quello che il cliente vede e che Google usa come
   identificativo: la targa se c'e', altrimenti un codice nostro tipo
   EA1855. L'id interno (sicom_...) non esce mai da qui. */
function rif(a){
  const t=String(a.targa||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  if(t) return t;
  const n=String(a.id||'').replace(/[^0-9]/g,'').slice(-6);
  return 'EA'+(n||'0');
}
function slug(a){
  const r=rif(a);
  if(String(a.targa||'').trim()) return r;
  const nome=(cap(a.marca)+' '+cap(a.modello)).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  return (nome?nome+'-':'')+r;
}
function tsv(v){ return String(v==null?'':v).replace(/[\t\r\n]+/g,' ').trim(); }

/* ------------------------------ dati ------------------------------------- */
const CAMPI=['marca','modello','allestimento','anno','km','colore','alimentazione','cambio','cilindrata','potenza','dataImm','targa','telaio','prezzoVen','listino','stato','ivaEsposta','estera','foto','dotazioni','etichetta','online','onlineTs','updatedAt','createdAt','carrozzeria','porte','posti','video','giro360'];

async function sbGet(p){
  const r=await fetch(CONFIG.SB_URL+p,{headers:{apikey:CONFIG.SB_KEY,Authorization:'Bearer '+CONFIG.SB_KEY}});
  if(!r.ok) throw new Error('Supabase '+r.status+' su '+p);
  return r.json();
}
async function leggi(){
  let rows=[];
  try{
    rows=await sbGet('/rest/v1/vetrina?select=*');
    const utile=rows.some(r=> r && (r.marca || (r.data&&r.data.marca)));
    if(!rows.length || !utile) throw new Error('vista vetrina vuota');
  }catch(e){
    console.log('vista vetrina non usabile ('+e.message+'), leggo magazzino');
    rows=await sbGet('/rest/v1/magazzino?select=id,data');
  }
  /* Video e giro 360 stanno nel record completo: se la vista non li espone,
     si leggono dal magazzino e si attaccano per id. */
  try{
    const manca=rows.some(r=> r && !(r.data&&typeof r.data==='object') && r.video===undefined && r.giro360===undefined);
    if(manca){
      const full=await sbGet('/rest/v1/magazzino?select=id,data');
      const byId={}; full.forEach(r=>{ const d=r&&r.data; if(d&&(d.id||r.id)) byId[String(d.id||r.id)]=d; });
      rows.forEach(r=>{ const d=byId[String((r.data&&r.data.id)||r.id)]; if(d){ if(r.video===undefined && d.video) r.video=d.video; if(r.giro360===undefined && d.giro360) r.giro360=d.giro360; } });
    }
  }catch(e){ console.log('video/giro360 non uniti:', e.message); }
  return rows;
}
function normalizza(raw){
  const src=(raw && raw.data && typeof raw.data==='object')?Object.assign({},raw.data,{id:raw.data.id||raw.id}):(raw||{});
  const a={};
  CAMPI.forEach(k=>{ if(src[k]!==undefined) a[k]=src[k]; else if(src[k.toLowerCase()]!==undefined) a[k]=src[k.toLowerCase()]; });
  a.id=src.id;
  if(typeof a.foto==='string'){ try{ a.foto=JSON.parse(a.foto); }catch(e){ a.foto=[]; } }
  if(!Array.isArray(a.foto)) a.foto=[];
  a.foto=a.foto.filter(f=>f&&f.url);
  a.estera=(a.estera===true||a.estera==='true');
  a.ivaEsposta=(a.ivaEsposta===true||a.ivaEsposta==='true');
  if(src.online!==undefined) a.online=(src.online===true||src.online==='true'||src.online===1||src.online==='1');
  return a;
}
/* Stessi criteri di vetrina.html: se una cosa non e' in vetrina, non va
   nemmeno su Google. */
function motivoScarto(a, controllaOnline){
  if(controllaOnline!==false && a.online!==true) return 'non in vetrina';
  const st=a.stato||'disponibile';
  if(!(st==='disponibile'||st==='prenotata'||st==='opzionata')) return 'stato: '+st;
  if(!a.marca||!a.modello) return 'marca o modello mancanti';
  if(num(a.prezzoVen)==null) return 'prezzo mancante';
  if(!a.foto.length) return 'senza foto';
  return '';
}

/* ------------------------------ pagina ----------------------------------- */
/* Rata indicativa mostrata sul sito: esempio rappresentativo, calcolato con
   i parametri qui sotto (ammortamento francese). I valori veri li fa il
   simulatore in sede: qui serve a far capire l'ordine di grandezza. */
CONFIG.RATA_TAN=7.95;        /* % annuo */
CONFIG.RATA_TAEG=9.20;       /* % annuo, indicativo (spese comprese) */
CONFIG.RATA_MESI=60;
CONFIG.RATA_ANTICIPO_PCT=0;  /* 0 = tutto finanziato */
CONFIG.RATA_SPESE=300;       /* istruttoria, €, nel TAEG */
CONFIG.COACH_NOME='Rudy';
CONFIG.COACH_RUOLO='Consulente alla vendita';
CONFIG.COACH_FOTO='https://auto.europaautosrl.it/coach.jpg';   /* se manca, iniziali */
CONFIG.COACH_TEL='02 9181820';
CONFIG.COACH_TEL_HREF='tel:029181820';
CONFIG.FONTE_LEAD='Sito web';

function rataIndicativa(prz){
  const p=num(prz); if(!p||p<1000) return null;
  const ant=Math.round(p*CONFIG.RATA_ANTICIPO_PCT/100);
  const C=p-ant+CONFIG.RATA_SPESE, i=CONFIG.RATA_TAN/100/12, n=CONFIG.RATA_MESI;
  const r=C*i/(1-Math.pow(1+i,-n));
  return { rata:Math.round(r), anticipo:ant, finanziato:C-CONFIG.RATA_SPESE, totale:Math.round(r*n), mesi:n, tan:CONFIG.RATA_TAN, taeg:CONFIG.RATA_TAEG };
}

const CSS=`
:root{--blu:#1a4fa0;--blu2:#143d7c;--ink:#0f172a;--grigio:#64748b;--linea:#e2e8f0;--verde:#16a34a;--chiaro:#f4f7fb}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif;color:var(--ink);background:var(--chiaro);line-height:1.5}
a{color:var(--blu)}
.top{background:var(--blu);color:#fff;font-size:13px;font-weight:700;text-align:center;padding:7px 12px;overflow:hidden;white-space:nowrap}.top span{margin:0 10px;white-space:nowrap}
.hd{background:#fff;border-bottom:1px solid var(--linea);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:0;z-index:5}
.hd .lg{font-weight:900;font-size:20px;letter-spacing:.02em;color:var(--blu);text-decoration:none}.hd .lg img{height:34px;display:block}
.hd .tl{display:flex;gap:8px}.hd .tl a{padding:8px 12px;border-radius:9px;font-weight:800;font-size:13px;text-decoration:none;border:1px solid var(--linea);color:var(--ink);background:#fff}.hd .tl a.wa{background:#16a34a;color:#fff;border-color:#16a34a}
.wrap{max-width:1180px;margin:0 auto;padding:16px}
.crumb{font-size:13px;color:var(--grigio);margin:4px 0 12px;display:flex;justify-content:space-between;gap:10px}.crumb a{text-decoration:none}
.grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.85fr);gap:18px;align-items:start}
.media{background:#fff;border:1px solid var(--linea);border-radius:16px;overflow:hidden}
.mtabs{display:flex;gap:4px;padding:8px 8px 0}.mtabs button{flex:1;padding:10px;border:none;border-radius:10px 10px 0 0;background:transparent;font-family:inherit;font-weight:800;font-size:13px;color:var(--grigio);cursor:pointer}.mtabs button.on{background:var(--chiaro);color:var(--blu)}
.mtabs button[disabled]{opacity:.35;cursor:default}
.stage{position:relative;background:#0f172a;aspect-ratio:4/3;max-height:560px}
.pane{position:absolute;inset:0;display:none}.pane.on{display:block}
.gal{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;height:100%;scrollbar-width:none}.gal::-webkit-scrollbar{display:none}
.gal img{flex:0 0 100%;scroll-snap-align:center;width:100%;height:100%;object-fit:contain;background:#0f172a}
.gnav{position:absolute;top:50%;transform:translateY(-50%);width:42px;height:42px;border-radius:50%;border:none;background:rgba(255,255,255,.92);font-size:20px;cursor:pointer;color:var(--ink)}.gnav.l{left:10px}.gnav.r{right:10px}
.gcnt{position:absolute;right:12px;bottom:12px;background:rgba(15,23,42,.75);color:#fff;font-size:12px;font-weight:700;padding:4px 9px;border-radius:999px}
.sconto{position:absolute;left:12px;bottom:12px;background:#0f172a;color:#fff;font-size:12.5px;font-weight:900;padding:6px 10px;border-radius:8px;letter-spacing:.02em}
.g360{width:100%;height:100%;object-fit:contain;user-select:none;cursor:grab;touch-action:pan-y}.g360hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(255,255,255,.9);border-radius:999px;padding:8px 14px;font-weight:900;font-size:14px;pointer-events:none;transition:opacity .4s}
video.vd{width:100%;height:100%;background:#000}
.thumbs{display:flex;gap:6px;overflow-x:auto;padding:8px}.thumbs img{height:60px;width:80px;object-fit:cover;border-radius:7px;border:2px solid transparent;cursor:pointer;flex:0 0 auto}.thumbs img.on{border-color:var(--blu)}
.card{background:#fff;border:1px solid var(--linea);border-radius:16px;padding:18px;margin-bottom:14px}
.card h1{margin:0;font-size:26px;line-height:1.15}.card .all{color:var(--grigio);font-weight:600;margin-top:3px}
.ptabs{display:flex;border:1px solid var(--linea);border-radius:10px;overflow:hidden;margin:14px 0 10px}.ptabs button{flex:1;padding:10px;border:none;background:#fff;font-family:inherit;font-weight:800;font-size:12.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--grigio);cursor:pointer}.ptabs button.on{background:var(--blu);color:#fff}
.pbig{font-size:38px;font-weight:900;color:var(--blu);line-height:1}.pbig small{font-size:16px;font-weight:800;color:var(--grigio)}
.psub{font-size:12.5px;color:var(--grigio);margin-top:6px;line-height:1.5}
.pdet{display:none;margin-top:10px;font-size:12.5px;color:var(--ink);background:var(--chiaro);border-radius:10px;padding:10px 12px}.pdet.on{display:block}.pdet div{display:flex;justify-content:space-between;padding:3px 0}
.specs{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;margin:14px 0 6px;font-size:14px}.specs div{display:flex;align-items:center;gap:8px}.specs .i{width:22px;text-align:center}
.btn{display:block;width:100%;text-align:center;padding:15px;border-radius:12px;font-weight:900;font-size:16px;text-decoration:none;border:none;cursor:pointer;font-family:inherit}
.btn.p{background:var(--blu);color:#fff}.btn.wa{background:#16a34a;color:#fff}.btn.o{background:#fff;color:var(--blu);border:2px solid var(--blu)}
.btns{display:grid;gap:10px;margin-top:14px}
.coach{display:flex;gap:14px;align-items:center}.coach .ph{width:72px;height:72px;border-radius:50%;object-fit:cover;background:var(--blu);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:24px;flex:0 0 auto}
.coach .n{font-size:17px;font-weight:900}.coach .r{color:var(--grigio);font-size:13px}.coach a{font-size:14px;font-weight:700;text-decoration:none}
.badges{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 0}.badge{background:#eff6ff;color:var(--blu);font-size:12px;font-weight:800;padding:5px 10px;border-radius:999px}.badge.o{background:#fff7ed;color:#9a3412}
.box{background:#fff;border:1px solid var(--linea);border-radius:16px;padding:18px;margin-bottom:14px}.box h2{margin:0 0 10px;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--grigio)}
.srow{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14.5px}.srow:last-child{border-bottom:0}.srow .k{color:var(--grigio)}.srow .v{font-weight:700;text-align:right}
.dot{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 14px;font-size:14px}.dot div:before{content:"\\2713 ";color:var(--verde);font-weight:900}
.form label{display:block;font-size:11px;font-weight:800;color:var(--grigio);text-transform:uppercase;margin:10px 0 4px}.form input,.form textarea{width:100%;padding:11px;border:1px solid #cbd5e1;border-radius:9px;font-family:inherit;font-size:14px}
.form .ok{display:none;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:10px;padding:12px;font-weight:700;margin-top:10px}
.permuta{display:flex;gap:14px;align-items:center;background:linear-gradient(135deg,#1a4fa0,#143d7c);color:#fff;border-radius:16px;padding:18px;margin-bottom:14px}.permuta .t{font-size:17px;font-weight:900}.permuta .s{font-size:13px;opacity:.9}.permuta a{background:#fff;color:var(--blu);padding:11px 16px;border-radius:10px;font-weight:900;text-decoration:none;white-space:nowrap}
.sedi{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sede .n{font-weight:800}.sede .a{font-size:13px;color:var(--grigio)}
.ft{margin:26px 0 20px;font-size:12px;color:var(--grigio);text-align:center;line-height:1.6}
.sticky{display:none}
@media(max-width:860px){.grid{display:flex;flex-direction:column;align-items:stretch}.grid>div{display:contents}.grid>div>*{width:100%}.b1{order:1}.b2{order:2}.b3{order:3}.b4{order:4}.b5{order:5}.b6{order:6}.b7{order:7}.b8{order:8}.b4,.b5,.b6{margin-top:0}.card h1{font-size:22px}.sedi{grid-template-columns:1fr}.permuta{flex-direction:column;align-items:flex-start}
 .top span:nth-child(3){display:none}.top{font-size:12px}
 .sticky{display:flex;position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--linea);padding:10px 12px;gap:8px;z-index:9}.sticky a{flex:1;text-align:center;padding:13px;border-radius:10px;font-weight:900;text-decoration:none;font-size:14px}.sticky .wa{background:#16a34a;color:#fff}.sticky .tel{background:var(--blu);color:#fff}body{padding-bottom:70px}}
`;

function paginaAuto(a){
  const nome=cap(a.marca)+' '+cap(a.modello);
  const titolo=nome+(a.allestimento?(' '+a.allestimento):'')+' usata a Paderno Dugnano — '+CONFIG.AZIENDA;
  const url=CONFIG.BASE_URL+'/'+CONFIG.DIR_AUTO+'/'+slug(a)+'.html';
  const anno=annoDa(a), kmN=num(a.km), prz=num(a.prezzoVen), lst=num(a.listino);
  const desc=[nome, a.allestimento, anno?('anno '+anno):'', kmFmt(a.km), a.alimentazione?cap(a.alimentazione):'', a.cambio?cap(a.cambio):'']
    .filter(Boolean).join(', ')+'. '+(prz?('Prezzo '+euro(prz)+'. '):'')+'Garanzia inclusa, permuta e finanziamento in sede. '+CONFIG.AZIENDA+', '+CONFIG.INDIRIZZO+'.';
  const fs_=a.foto;
  const giro=(a.giro360 && Array.isArray(a.giro360.frames) && a.giro360.frames.length>=8)?a.giro360.frames:null;
  const video=(a.video && a.video.url)?a.video.url:null;
  const rata=rataIndicativa(prz);
  const scontoPct=(lst&&prz&&lst>prz)?Math.round((lst-prz)/lst*100):0;
  const opz=(a.stato==='prenotata'||a.stato==='opzionata');

  /* --- media: foto / 360 / video --- */
  const gal='<div class="pane on" id="pane-foto"><div class="gal" id="gal">'+fs_.map((f,i)=>'<img src="'+esc(f.url)+'" alt="'+esc(nome)+' — foto '+(i+1)+'"'+(i>0?' loading="lazy"':'')+'>').join('')+'</div>'
    +(fs_.length>1?'<button class="gnav l" onclick="gNav(-1)" aria-label="precedente">&#8249;</button><button class="gnav r" onclick="gNav(1)" aria-label="successiva">&#8250;</button><div class="gcnt"><span id="gcur">1</span> / '+fs_.length+'</div>':'')
    +(scontoPct>=5?('<div class="sconto">VANTAGGIO DI PREZZO DEL '+scontoPct+'%</div>'):'')
    +'</div>';
  const p360=giro?('<div class="pane" id="pane-360"><img class="g360" id="g360" src="'+esc(giro[0])+'" alt="'+esc(nome)+' a 360°" draggable="false"><div class="g360hint" id="g360hint">&#8635; 360° — trascina per ruotare</div></div>'):'';
  const pvid=video?('<div class="pane" id="pane-video"><video class="vd" id="vd" controls preload="metadata" playsinline poster="'+esc(fs_[0].url)+'"><source src="'+esc(video)+'"></video></div>'):'';
  const tabs='<div class="mtabs"><button class="on" id="tab-foto" onclick="mTab(\'foto\')">📷 Foto ('+fs_.length+')</button>'
    +'<button id="tab-360" onclick="mTab(\'360\')"'+(giro?'':' disabled title="Giro 360° non ancora disponibile"')+'>&#8635; Vista 360°</button>'
    +'<button id="tab-video" onclick="mTab(\'video\')"'+(video?'':' disabled title="Video non ancora disponibile"')+'>&#9654; Video</button></div>';
  const thumbs=(fs_.length>1?('<div class="thumbs" id="thumbs">'+fs_.map((f,i)=>'<img src="'+esc(f.url)+'" alt="" loading="lazy" class="'+(i===0?'on':'')+'" onclick="gTo('+i+')">').join('')+'</div>'):'');

  /* --- prezzo / rata --- */
  const prezzoCard='<div class="card b2">'
    +'<h1>'+esc(nome)+'</h1>'+(a.allestimento?('<div class="all">'+esc(a.allestimento)+'</div>'):'')
    /* Riga sempre visibile, senza clic: prezzo, km, riferimento, telaio e
       sede. Sono i dati che Google pretende "al caricamento della pagina"
       per gli annunci veicoli; prima il prezzo in contanti stava dietro la
       linguetta "Acquisto in contanti". */
    +'<div class="idrow" style="display:flex;flex-wrap:wrap;gap:6px 14px;margin:6px 0 10px;font-size:13px;color:#334155;">'
      +(prz?('<span><b>Prezzo '+esc(euro(prz))+'</b></span>'):'')
      +(kmN!=null?('<span>'+esc(kmFmt(a.km))+'</span>'):'')
      +'<span>Rif. <b>'+esc(rif(a))+'</b></span>'
      +(a.telaio?('<span>Telaio '+esc(a.telaio)+'</span>'):'')
      +'<span>'+(opz?'Opzionata':'Disponibile')+' · '+esc(CONFIG.AZIENDA)+', Paderno Dugnano (MI)</span>'
    +'</div>'
    +'<div class="ptabs">'+(rata?'<button class="on" id="pt-fin" onclick="pTab(\'fin\')">Finanziamento</button>':'')+'<button'+(rata?'':' class="on"')+' id="pt-cash" onclick="pTab(\'cash\')">Acquisto in contanti</button></div>'
    +(rata?('<div id="pp-fin"><div class="pbig">'+esc(euro(rata.rata))+' <small>/ mese</small></div>'
      +'<div class="psub">'+rata.mesi+' rate'+(rata.anticipo?(' · anticipo '+esc(euro(rata.anticipo))):' · senza anticipo')+' · TAN '+rata.tan.toFixed(2).replace('.',',')+'% · TAEG '+rata.taeg.toFixed(2).replace('.',',')+'% <a href="#" onclick="document.getElementById(\'pdet\').classList.toggle(\'on\');return false;">Dettagli</a></div>'
      +'<div class="pdet" id="pdet"><div><span>Prezzo veicolo</span><b>'+esc(euro(prz))+'</b></div><div><span>Anticipo</span><b>'+esc(euro(rata.anticipo))+'</b></div><div><span>Importo finanziato</span><b>'+esc(euro(rata.finanziato))+'</b></div><div><span>Spese istruttoria</span><b>'+esc(euro(CONFIG.RATA_SPESE))+'</b></div><div><span>Durata</span><b>'+rata.mesi+' mesi</b></div><div><span>Importo totale dovuto</span><b>'+esc(euro(rata.totale+rata.anticipo))+'</b></div>'
      +'<div style="display:block;color:#64748b;font-size:11.5px;margin-top:6px;line-height:1.4">Esempio rappresentativo, salvo approvazione della finanziaria. Il piano definitivo, con le eventuali coperture assicurative, viene calcolato in sede sul simulatore della banca. Messaggio pubblicitario con finalità promozionale: fogli informativi disponibili in concessionaria.</div></div></div>'):'')
    +'<div id="pp-cash"'+(rata?' style="display:none"':'')+'><div class="pbig">'+esc(euro(prz))+'</div>'
    +'<div class="psub">'+(a.ivaEsposta?'IVA esposta · ideale per P.IVA e leasing':'prezzo in unica soluzione')
    +((lst&&prz&&lst>prz)?(' · da nuova <s>'+esc(euro(lst))+'</s> · <b style="color:#c81e1e;">risparmi '+esc(euro(lst-prz))+'</b>'):'')+'</div></div>'
    +'<div class="badges">'+(opz?'<span class="badge o">Opzionata — chiedi disponibilità</span>':'<span class="badge" style="background:#f0fdf4;color:#166534;">Disponibile in sede</span>')
    +(kmN!=null && kmN<=100?'<span class="badge">Km 0</span>':'')+'<span class="badge">Garanzia inclusa</span><span class="badge">Permuta del tuo usato</span></div>'
    +'<div class="btns"><a class="btn p" href="#richiesta">Richiesta veicolo</a>'
    +'<a class="btn wa" href="'+esc(waHref(a,nome))+'" target="_blank" rel="noopener">💬 Scrivici su WhatsApp</a></div>'
    +'</div>';

  const coach='<div class="card coach b3">'
    +'<img class="ph" src="'+esc(CONFIG.COACH_FOTO)+'" alt="'+esc(CONFIG.COACH_NOME)+'" onerror="this.outerHTML=\'<div class=ph>'+esc(CONFIG.COACH_NOME.charAt(0))+'</div>\'">'
    +'<div><div class="n">Ciao, sono '+esc(CONFIG.COACH_NOME)+'</div><div class="r">'+esc(CONFIG.COACH_RUOLO)+' · ti seguo io su questa auto</div>'
    +'<div style="margin-top:6px;display:flex;gap:12px;flex-wrap:wrap;"><a href="'+CONFIG.COACH_TEL_HREF+'">📞 '+esc(CONFIG.COACH_TEL)+'</a><a href="mailto:'+esc(CONFIG.EMAIL)+'">✉ '+esc(CONFIG.EMAIL)+'</a></div></div></div>';

  const rows=[
    ['Immatricolazione', a.dataImm?dataIT(a.dataImm):anno],
    ['Chilometri', kmFmt(a.km)],
    ['Alimentazione', a.alimentazione?cap(a.alimentazione):null],
    ['Cambio', a.cambio?cap(a.cambio):null],
    ['Cilindrata', a.cilindrata?(String(a.cilindrata).replace(/[^\d]/g,'')+' cc'):null],
    ['Potenza', num(a.potenza)!=null?(a.potenza+' kW ('+Math.round(num(a.potenza)*1.3596)+' CV)'):null],
    ['Colore', a.colore?cap(a.colore):null],
    ['Carrozzeria', a.carrozzeria?cap(a.carrozzeria):null],
    ['Porte / posti', (a.porte||a.posti)?([a.porte?(a.porte+' porte'):'',a.posti?(a.posti+' posti'):''].filter(Boolean).join(' · ')):null],
    ['Targa', a.targa||null],
    ['Telaio', a.telaio||null]
  ].filter(r=>r[1]);
  const dot=String(a.dotazioni||'').split(/\r?\n|;/).map(s=>s.replace(/^[-•·*\s]+/,'').trim()).filter(Boolean);

  const form='<div class="box form b7" id="richiesta"><h2>Richiesta veicolo</h2>'
    +'<div style="font-size:14px;color:#334155;">Ti richiamiamo noi: lascia i tuoi recapiti e ti diciamo tutto su questa '+esc(nome)+' (disponibilità, finanziamento, permuta).</div>'
    +'<form onsubmit="return inviaRichiesta(event)">'
    +'<label>Nome e cognome</label><input name="nome" required>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"><div><label>Telefono</label><input name="telefono" type="tel" required></div><div><label>Email</label><input name="email" type="email"></div></div>'
    +'<label>Messaggio (facoltativo)</label><textarea name="messaggio" rows="3" placeholder="es. Vorrei venire a vederla sabato mattina / ho una Panda del 2016 da permutare"></textarea>'
    +'<label style="display:flex;align-items:center;gap:8px;text-transform:none;font-weight:500;color:#475569;margin-top:10px;"><input type="checkbox" required style="width:auto;">Acconsento al trattamento dei dati per essere ricontattato (<a href="'+esc(CONFIG.BASE_URL)+'/privacy.html">privacy</a>)</label>'
    +'<button class="btn p" type="submit" style="margin-top:12px;">Invia richiesta</button>'
    +'<div class="ok" id="form-ok">✅ Richiesta inviata: ti richiamiamo al più presto. Se preferisci, <a href="'+esc(waHref(a,nome))+'" target="_blank">scrivici su WhatsApp</a>.</div>'
    +'</form></div>';

  const permuta='<div class="permuta b6"><div style="flex:1;"><div class="t">Hai un\'auto da permutare?</div><div class="s">La valutiamo in sede sul momento, senza impegno: mandaci targa e chilometri su WhatsApp e ti diciamo subito quanto vale.</div></div>'
    +'<a href="https://wa.me/'+CONFIG.WA_NUM+'?text='+encodeURIComponent('Buongiorno, vorrei una valutazione della mia auto in permuta per la '+nome+'. Targa: ... Km: ...')+'" target="_blank" rel="noopener">Valuta la mia auto</a></div>';

  const ld={ '@context':'https://schema.org', '@type':'Car', name:nome+(a.allestimento?(' '+a.allestimento):''), brand:{'@type':'Brand',name:cap(a.marca)}, model:cap(a.modello),
    vehicleModelDate:anno||undefined, mileageFromOdometer:kmN!=null?{'@type':'QuantitativeValue',value:kmN,unitCode:'KMT'}:undefined,
    fuelType:a.alimentazione||undefined, vehicleTransmission:a.cambio||undefined, color:a.colore||undefined, vehicleIdentificationNumber:a.telaio||undefined,
    image:fs_.map(f=>f.url), url:url, itemCondition:'https://schema.org/UsedCondition',
    offers:{ '@type':'Offer', price:prz, priceCurrency:'EUR', availability:'https://schema.org/InStock', url:url, seller:{'@type':'AutoDealer',name:CONFIG.RAGIONE,telephone:'+'+CONFIG.WA_NUM,address:CONFIG.INDIRIZZO} } };

  const JS=`
var _g=document.getElementById('gal'), _n=${fs_.length};
function gIdx(){ return _g?Math.round(_g.scrollLeft/Math.max(1,_g.clientWidth)):0; }
function gTo(i){ if(!_g) return; i=((i%_n)+_n)%_n; _g.scrollTo({left:i*_g.clientWidth,behavior:'smooth'}); }
function gNav(d){ gTo(gIdx()+d); }
if(_g) _g.addEventListener('scroll',function(){ var i=gIdx(); var c=document.getElementById('gcur'); if(c) c.textContent=i+1; var t=document.querySelectorAll('#thumbs img'); t.forEach(function(x,k){ x.classList.toggle('on',k===i); }); if(t[i]) t[i].scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'}); },{passive:true});
function mTab(k){ ['foto','360','video'].forEach(function(x){ var p=document.getElementById('pane-'+x), b=document.getElementById('tab-'+x); if(p) p.classList.toggle('on',x===k); if(b) b.classList.toggle('on',x===k); }); var v=document.getElementById('vd'); if(v && k!=='video') v.pause(); if(k==='360') g360init(); }
function pTab(k){ var f=document.getElementById('pp-fin'), c=document.getElementById('pp-cash'); if(f) f.style.display=(k==='fin')?'':'none'; if(c) c.style.display=(k==='cash')?'':'none'; var bf=document.getElementById('pt-fin'), bc=document.getElementById('pt-cash'); if(bf) bf.classList.toggle('on',k==='fin'); if(bc) bc.classList.toggle('on',k==='cash'); }
var _fr=${JSON.stringify(giro||[])}, _fi=0, _fdown=false, _fx=0, _fc=0, _finit=false;
function g360init(){ if(_finit||!_fr.length) return; _finit=true; var img=document.getElementById('g360'), hint=document.getElementById('g360hint'); _fr.forEach(function(u){ var i=new Image(); i.src=u; });
  var set=function(k){ _fi=((k%_fr.length)+_fr.length)%_fr.length; img.src=_fr[_fi]; };
  var px=function(e){ return (e.touches&&e.touches[0])?e.touches[0].clientX:e.clientX; };
  var st=function(e){ _fdown=true; _fx=px(e); _fc=_fi; if(hint) hint.style.opacity='0'; };
  var mv=function(e){ if(!_fdown) return; set(_fc+Math.round((px(e)-_fx)/(img.clientWidth/_fr.length))); };
  var en=function(){ _fdown=false; };
  img.addEventListener('mousedown',st); img.addEventListener('mousemove',mv); window.addEventListener('mouseup',en);
  img.addEventListener('touchstart',st,{passive:true}); img.addEventListener('touchmove',mv,{passive:true}); img.addEventListener('touchend',en);
  var auto=0, t=setInterval(function(){ if(_fdown||auto>=_fr.length){ clearInterval(t); return; } set(_fi+1); auto++; }, 90); }
function inviaRichiesta(ev){ ev.preventDefault(); var f=ev.target, b=f.querySelector('button[type=submit]'); b.disabled=true; b.textContent='Invio…';
  var d=new FormData(f); var rec={ id:'web_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), nome:(d.get('nome')||'').trim(), telefono:(d.get('telefono')||'').trim(), email:(d.get('email')||'').trim(), messaggio:(d.get('messaggio')||'').trim(),
    auto:${JSON.stringify(nome+(a.targa?(' '+a.targa):''))}, autoId:${JSON.stringify(String(a.id||''))}, prezzo:${JSON.stringify(prz)}, fonte:${JSON.stringify(CONFIG.FONTE_LEAD)}, canale:'mail', stato:'nuovo', ricevutaTs:Date.now(), pagina:location.href };
  fetch(${JSON.stringify(CONFIG.SB_URL+'/rest/v1/contatti_in')},{ method:'POST', headers:{ 'Content-Type':'application/json', 'apikey':${JSON.stringify(CONFIG.SB_KEY)}, 'Authorization':'Bearer '+${JSON.stringify(CONFIG.SB_KEY)}, 'Prefer':'return=minimal' }, body:JSON.stringify({ id:rec.id, data:rec }) })
  .then(function(r){ if(!r.ok) throw new Error(r.status); f.querySelectorAll('input,textarea').forEach(function(x){ x.disabled=true; }); b.style.display='none'; document.getElementById('form-ok').style.display='block'; })
  .catch(function(){ b.disabled=false; b.textContent='Invia richiesta'; var w=${JSON.stringify(waHref(a,nome))}; alert('Non siamo riusciti a registrare la richiesta: ti apriamo WhatsApp.'); window.open(w,'_blank'); });
  return false; }
`;

  return '<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<title>'+esc(titolo)+'</title><meta name="description" content="'+esc(desc)+'">'
    +'<link rel="canonical" href="'+esc(url)+'">'
    +'<meta property="og:type" content="product"><meta property="og:title" content="'+esc(nome+(prz?(' — '+euro(prz)):''))+'"><meta property="og:description" content="'+esc(desc)+'"><meta property="og:image" content="'+esc(fs_[0].url)+'"><meta property="og:url" content="'+esc(url)+'">'
    +'<script type="application/ld+json">'+JSON.stringify(ld)+'</script>'
    +'<style>'+CSS+'</style></head><body>'
    +'<div class="top"><span>✓ Auto selezionate e garantite</span><span>✓ Finanziamento in sede</span><span>✓ Permuta del tuo usato</span></div>'
    +'<header class="hd"><a class="lg" href="'+esc(CONFIG.VETRINA_URL)+'" style="display:flex;align-items:center;gap:10px;"><img src="'+esc(CONFIG.LOGO_URL)+'" alt="'+esc(CONFIG.AZIENDA)+'" onerror="this.replaceWith(document.createTextNode(\''+esc(CONFIG.AZIENDA)+'\'))"></a>'
    +'<div class="tl"><a href="'+CONFIG.TEL_HREF+'">'+esc(CONFIG.TEL)+'</a><a class="wa" href="'+esc(waHref(a,nome))+'" target="_blank" rel="noopener">WhatsApp</a></div></header>'
    +'<main class="wrap">'
    +'<div class="crumb"><span><a href="'+esc(CONFIG.VETRINA_URL)+'">‹ Tutte le auto</a></span><span>'+esc(nome)+'</span></div>'
    +'<div class="grid"><div>'
    +'<div class="media b1" style="margin-bottom:14px">'+tabs+'<div class="stage">'+gal+p360+pvid+'</div>'+thumbs+'</div>'
    +'<div class="box b4"><h2>Scheda tecnica</h2>'+rows.map(r=>'<div class="srow"><span class="k">'+esc(r[0])+'</span><span class="v">'+esc(r[1])+'</span></div>').join('')+'</div>'
    +(dot.length?('<div class="box b5"><h2>Equipaggiamento</h2><div class="dot">'+dot.map(d=>'<div>'+esc(d)+'</div>').join('')+'</div></div>'):'')
    +permuta
    +'</div><div>'
    +prezzoCard+coach+form
    +'<div class="box b8"><h2>Dove vederla</h2><div class="sedi">'
    +'<div class="sede"><div class="n">📍 Paderno Dugnano</div><div class="a">'+esc(CONFIG.INDIRIZZO)+'</div><a href="'+CONFIG.TEL_HREF+'">'+esc(CONFIG.TEL)+'</a></div>'
    +'<div class="sede"><div class="n">📍 '+esc(CONFIG.SEDE2)+'</div><div class="a">Seconda sede espositiva: chiedici dove si trova l\'auto.</div><a href="'+CONFIG.TEL_HREF+'">'+esc(CONFIG.TEL)+'</a></div>'
    +'</div></div>'
    +'</div></div>'
    +'<div class="ft">'+esc(CONFIG.RAGIONE)+' — '+esc(CONFIG.INDIRIZZO)+' — P.IVA '+esc(CONFIG.PIVA)+'<br>Prezzo e dotazioni possono variare: la disponibilità va confermata in sede. Questo sito non utilizza cookie di profilazione.</div>'
    +'</main>'
    +'<div class="sticky"><a class="wa" href="'+esc(waHref(a,nome))+'" target="_blank" rel="noopener">💬 WhatsApp</a><a class="tel" href="'+CONFIG.TEL_HREF+'">📞 Chiama</a></div>'
    +'<script>'+JS+'</script></body></html>';
}
function waHref(a,nome){
  const t='Buongiorno, vorrei informazioni su '+nome+(a.targa?(' (targa '+a.targa+')'):'')+' vista sul vostro sito.';
  return 'https://wa.me/'+CONFIG.WA_NUM+'?text='+encodeURIComponent(t);
}

function paginaIndice(lista){
  const url=CONFIG.BASE_URL+'/'+CONFIG.DIR_AUTO+'/';
  return '<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<title>Auto usate e km 0 disponibili — '+esc(CONFIG.AZIENDA)+' Paderno Dugnano</title>'
    +'<meta name="description" content="'+lista.length+' auto usate, km 0 e aziendali in pronta consegna a Paderno Dugnano e Bovisio Masciago. Garanzia, permuta e finanziamento in sede.">'
    +'<link rel="canonical" href="'+esc(url)+'"><style>'+CSS+'.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.card{background:#fff;border:1px solid var(--linea);border-radius:14px;overflow:hidden;text-decoration:none;color:var(--ink);display:block}.card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}.card .b{padding:10px 12px}.card .t{font-weight:800}.card .s{font-size:12.5px;color:var(--grigio)}.card .p{color:var(--blu);font-weight:900;font-size:18px;margin-top:6px}</style></head><body>'
    +'<header class="hd"><a class="lg" href="'+esc(CONFIG.VETRINA_URL)+'">'+esc(CONFIG.AZIENDA).toUpperCase()+'</a><div class="tl"><a href="'+CONFIG.TEL_HREF+'">'+esc(CONFIG.TEL)+'</a></div></header>'
    +'<main class="wrap"><h1 style="font-size:24px;">Auto disponibili in pronta consegna</h1><p style="color:var(--grigio);margin-top:0;">'+lista.length+' auto · Paderno Dugnano e Bovisio Masciago · <a href="'+esc(CONFIG.VETRINA_URL)+'">apri la vetrina con i filtri</a></p><div class="grid">'
    +lista.map(a=>{ const nome=cap(a.marca)+' '+cap(a.modello);
      return '<a class="card" href="'+esc(slug(a))+'.html"><img src="'+esc(a.foto[0].url)+'" alt="'+esc(nome)+'" loading="lazy"><div class="b"><div class="t">'+esc(nome)+'</div><div class="s">'+esc([annoDa(a),kmFmt(a.km),a.alimentazione?cap(a.alimentazione):'',a.cambio?cap(a.cambio):''].filter(Boolean).join(' · '))+'</div><div class="p">'+esc(euro(a.prezzoVen))+'</div></div></a>'; }).join('')
    +'</div></main></body></html>';
}

/* ------------------------------- feed ------------------------------------ */
/* ============================ FEED GOOGLE ================================
   I nomi delle colonne non sono liberi: Google accetta solo quelli della
   sua specifica per gli annunci di veicoli e scarta le righe con nomi
   diversi. Da qui in giu' e' tutto copiato da li'.
   Tre trappole gia' pagate: "availability" sui veicoli da' errore e non va
   inviato; per una sola sede basta store_code (niente vehicle_fulfillment);
   l'id deve comparire anche sulla pagina dell'auto. */
function engineVal(s){
  const t=String(s||'').toLowerCase();
  if(/plug|phev/.test(t)) return 'plug-in_hybrid';
  if(/ibrid|hybrid|mild|mhev/.test(t)) return 'hybrid';
  if(/elettr|electric|\bev\b/.test(t)) return 'electric';
  if(/diesel|gasolio/.test(t)) return 'diesel';
  if(/metano|cng/.test(t)) return 'methane';
  if(/gpl|lpg/.test(t)) return 'lpg';
  if(/benz|gasoline|petrol/.test(t)) return 'gasoline';
  return t?'other':'';
}
function primaImmat(a){          /* AAAA-MM, richiesto sull'usato */
  const m=String(a.dataImm||'').match(/^(\d{4})-(\d{2})/);
  if(m) return m[1]+'-'+m[2];
  const y=annoDa(a); return y?(y+'-01'):'';
}
const FEED_COLS=['id','VIN','google_product_category','store_code','title','brand','model','trim','year','mileage','price','condition','color','engine','date_first_registered','image_link','additional_image_link','link','link_template','description','included_destination','excluded_destination']  /* senza destinazioni Google le prende anche come prodotti Shopping: avviso sull'account e revisione infinita */;
function rigaFeed(a){
  const url=CONFIG.BASE_URL+'/'+CONFIG.DIR_AUTO+'/'+slug(a)+'.html';
  const kmN=num(a.km), prz=num(a.prezzoVen);
  const nome=cap(a.marca)+' '+cap(a.modello);
  const desc=[nome, a.allestimento, kmFmt(a.km), a.alimentazione?cap(a.alimentazione):'', a.cambio?cap(a.cambio):'', a.colore?cap(a.colore):'']
    .filter(Boolean).join(' \u00b7 ')+'. Garanzia inclusa, permuta e finanziamento in sede.';
  return [
    tsv(rif(a)),
    tsv(a.telaio||''),
    '916',
    CONFIG.STORE_CODE,
    /* Il titolo mancava, ed e' il motivo per cui Merchant Center segnava
       ogni riga come "Titolo in sospeso o mancante": marca e modello da
       soli non gli bastano, il titolo va scritto e mandato.
       Marca, modello e allestimento, senza l'anno: l'anno ha gia' la sua
       colonna e in vetrina il cliente legge il nome dell'auto. */
    tsv([cap(a.marca), cap(a.modello), a.allestimento||'']
        .filter(Boolean).join(' ').slice(0,150)),
    tsv(cap(a.marca)),
    tsv(cap(a.modello)),
    tsv(a.allestimento||''),
    tsv(annoDa(a)),
    kmN!=null?(Math.round(kmN)+' km'):'',
    prz!=null?(prz.toFixed(2)+' EUR'):'',
    /* Tutte "Used", anche le km 0.
       Per un periodo le auto sotto i 100 km sono state dichiarate "New",
       perche' "usata con 0 km" sembrava una contraddizione. Google le ha
       bocciate tutte e sei: sui veicoli NUOVI pretende co2_emissions,
       emissions_standard e fuel_consumption, dati che non abbiamo (il
       consumo non e' nemmeno sul libretto, sta solo nelle banche dati a
       pagamento).
       E a ben vedere "Used" e' anche piu' esatto: per Google "nuovo"
       significa MAI IMMATRICOLATO, mentre una km 0 italiana la targa ce
       l'ha, e infatti mandiamo pure date_first_registered.
       Se un domani si vorranno gli annunci "New", serviranno prima quei
       tre dati in magazzino. */
    'Used',
    tsv(a.colore?cap(a.colore):''),
    engineVal(a.alimentazione),
    primaImmat(a),
    tsv(a.foto[0].url),
    a.foto.slice(1,11).map(f=>tsv(f.url)).join(','),
    url,
    url+'?s={store_code}',
    tsv(desc),
    'vehicle_ads',
    'Shopping_ads,Free_listings,Display_ads,Free_local_listings,Local_inventory_ads'
  ].join('\t');
}

/* ----------------------------- esecuzione -------------------------------- */
async function main(){
  const prova=process.argv.includes('--prova');
  let rows;
  if(prova){
    rows=JSON.parse(fs.readFileSync(path.join(__dirname,'prova-auto.json'),'utf8'));
  } else {
    rows=await leggi();
  }
  const piatte=rows.map(r=> (r&&r.data&&typeof r.data==='object')?r:r);
  const haOnline=piatte.some(r=>{ const d=(r&&r.data)||r||{}; return d.online!==undefined; });
  const scarti={};
  const lista=piatte.map(normalizza).filter(a=>{ const m=motivoScarto(a,haOnline); if(m){ scarti[m]=(scarti[m]||0)+1; return false; } return true; });
  lista.sort((x,y)=> (num(y.onlineTs)||num(y.updatedAt)||0)-(num(x.onlineTs)||num(x.updatedAt)||0));

  const root=path.resolve(__dirname,'..');
  const dirAuto=path.join(root,CONFIG.DIR_AUTO), dirFeed=path.join(root,CONFIG.DIR_FEED);
  fs.mkdirSync(dirAuto,{recursive:true}); fs.mkdirSync(dirFeed,{recursive:true});

  /* pagine: si riscrive tutto e si tolgono quelle delle auto non piu' in vetrina */
  const attesi=new Set(['index.html']);
  lista.forEach(a=>{ const f=slug(a)+'.html'; attesi.add(f); fs.writeFileSync(path.join(dirAuto,f), paginaAuto(a)); });
  fs.writeFileSync(path.join(dirAuto,'index.html'), paginaIndice(lista));
  let tolte=0;
  fs.readdirSync(dirAuto).forEach(f=>{ if(f.endsWith('.html') && !attesi.has(f)){ fs.unlinkSync(path.join(dirAuto,f)); tolte++; } });

  /* feed */
  /* Nel feed vanno solo le auto che Google accetta: disponibili (le
     opzionate per lui sono "reserved", vietato) e con telaio. */
  const perFeed=lista.filter(a=> !(a.stato==='prenotata'||a.stato==='opzionata') && (!CONFIG.FEED_RICHIEDE_TELAIO || a.telaio));
  fs.writeFileSync(path.join(dirFeed,CONFIG.FEED_FILE), FEED_COLS.join('\t')+'\n'+perFeed.map(rigaFeed).join('\n')+(perFeed.length?'\n':''));
  console.log('Righe nel feed Google: '+perFeed.length+' su '+lista.length+' pubblicate');

  /* sitemap */
  const oggi=new Date().toISOString().slice(0,10);
  const urls=[CONFIG.VETRINA_URL, CONFIG.BASE_URL+'/'+CONFIG.DIR_AUTO+'/'].concat(lista.map(a=>CONFIG.BASE_URL+'/'+CONFIG.DIR_AUTO+'/'+slug(a)+'.html'));
  fs.writeFileSync(path.join(root,'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    +urls.map(u=>'  <url><loc>'+esc(u)+'</loc><lastmod>'+oggi+'</lastmod></url>').join('\n')+'\n</urlset>\n');

  console.log('Auto lette: '+piatte.length+' · pubblicate: '+lista.length+' · pagine tolte: '+tolte);
  Object.keys(scarti).forEach(k=> console.log('  scartate ('+k+'): '+scarti[k]));
  const senzaTelaio=lista.filter(a=>!a.telaio).length;
  if(senzaTelaio) console.log('  ATTENZIONE: '+senzaTelaio+' auto senza telaio: pagina fatta, ma FUORI dal feed Google');
}
main().catch(e=>{ console.error('ERRORE: '+(e&&e.message||e)); process.exit(1); });
