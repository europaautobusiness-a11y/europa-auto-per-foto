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

  BASE_URL: 'https://prenota.europaautosrl.it',                /* dove stanno le pagine */
  VETRINA_URL: 'https://prenota.europaautosrl.it/vetrina.html',
  LOGO_URL: 'https://prenota.europaautosrl.it/logo.png',

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

  /* Google vuole il telaio (VIN) su ogni riga del feed e lo vuole scritto
     anche sulla pagina. Senza telaio la riga verrebbe bocciata: meglio
     lasciarla fuori dal feed (la pagina resta, per il sito). */
  FEED_RICHIEDE_TELAIO: true,

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
function slug(a){
  const t=String(a.targa||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  if(t) return t;
  return 'id-'+String(a.id||'').replace(/[^A-Za-z0-9]/g,'').slice(0,24);
}
function tsv(v){ return String(v==null?'':v).replace(/[\t\r\n]+/g,' ').trim(); }

/* ------------------------------ dati ------------------------------------- */
const CAMPI=['marca','modello','allestimento','anno','km','colore','alimentazione','cambio','cilindrata','potenza','dataImm','targa','telaio','prezzoVen','listino','stato','ivaEsposta','estera','foto','dotazioni','etichetta','online','onlineTs','updatedAt','createdAt','carrozzeria','porte','posti'];

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
const CSS=`
:root{--blu:#1a4fa0;--ink:#0f172a;--grigio:#64748b;--linea:#e2e8f0;--verde:#16a34a}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif;color:var(--ink);background:#f8fafc;line-height:1.5}
a{color:var(--blu)}
.hd{background:#fff;border-bottom:1px solid var(--linea);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:0;z-index:5}
.hd .lg{font-weight:900;font-size:20px;letter-spacing:.02em;color:var(--blu);text-decoration:none}.hd .lg img{height:34px;display:block}
.hd .tl{display:flex;gap:8px}.hd .tl a{padding:8px 12px;border-radius:9px;font-weight:800;font-size:13px;text-decoration:none;border:1px solid var(--linea);color:var(--ink);background:#fff}.hd .tl a.wa{background:#25d366;border-color:#25d366;color:#fff}
.wrap{max-width:1040px;margin:0 auto;padding:16px}
.crumb{font-size:13px;color:var(--grigio);margin:4px 0 12px}.crumb a{text-decoration:none}
.gal{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:8px;border-radius:14px;background:#0f172a}
.gal img{flex:0 0 100%;scroll-snap-align:center;width:100%;aspect-ratio:4/3;object-fit:contain;background:#0f172a}
.thumbs{display:flex;gap:6px;overflow-x:auto;margin-top:8px}.thumbs img{height:58px;width:78px;object-fit:cover;border-radius:7px;border:2px solid transparent;cursor:pointer}
.tit{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:18px 0 10px}
.tit h1{margin:0;font-size:26px;line-height:1.15}.tit .all{color:var(--grigio);font-weight:600;margin-top:3px}
.prz{text-align:right}.prz .p{font-size:30px;font-weight:900;color:var(--blu);line-height:1}.prz .l{font-size:13px;color:var(--grigio);margin-top:4px}
.badges{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 18px}.badge{background:#eff6ff;color:var(--blu);font-size:12px;font-weight:800;padding:5px 10px;border-radius:999px}.badge.o{background:#fff7ed;color:#9a3412}
.box{background:#fff;border:1px solid var(--linea);border-radius:14px;padding:16px;margin-bottom:14px}.box h2{margin:0 0 10px;font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--grigio)}
.srow{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14.5px}.srow:last-child{border-bottom:0}.srow .k{color:var(--grigio)}.srow .v{font-weight:700;text-align:right}
.dot{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 14px;font-size:14px}.dot div:before{content:"✓ ";color:var(--verde);font-weight:900}
.cta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}.cta a{display:block;text-align:center;padding:15px;border-radius:12px;font-weight:900;font-size:16px;text-decoration:none}.cta .wa{background:#25d366;color:#fff}.cta .tel{background:var(--blu);color:#fff}
.sedi{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sede .n{font-weight:800}.sede .a{font-size:13px;color:var(--grigio)}
.ft{margin:26px 0 20px;font-size:12px;color:var(--grigio);text-align:center;line-height:1.6}
@media(max-width:640px){.tit h1{font-size:22px}.prz{text-align:left}.cta,.sedi{grid-template-columns:1fr}}
`;

function paginaAuto(a){
  const nome=cap(a.marca)+' '+cap(a.modello);
  const titolo=nome+(a.allestimento?(' '+a.allestimento):'')+' usata a Paderno Dugnano — '+CONFIG.AZIENDA;
  const url=CONFIG.BASE_URL+'/'+CONFIG.DIR_AUTO+'/'+slug(a)+'.html';
  const anno=annoDa(a), kmN=num(a.km), prz=num(a.prezzoVen), lst=num(a.listino);
  const desc=[nome, a.allestimento, anno?('anno '+anno):'', kmFmt(a.km), a.alimentazione?cap(a.alimentazione):'', a.cambio?cap(a.cambio):'']
    .filter(Boolean).join(', ')+'. '+(prz?('Prezzo '+euro(prz)+'. '):'')+'Garanzia inclusa, permuta e finanziamento in sede. '+CONFIG.AZIENDA+', '+CONFIG.INDIRIZZO+'.';
  const fs_=a.foto;
  const gal='<div class="gal" id="gal">'+fs_.map((f,i)=>'<img src="'+esc(f.url)+'" alt="'+esc(nome)+' — foto '+(i+1)+'"'+(i>0?' loading="lazy"':'')+'>').join('')+'</div>'
    +(fs_.length>1?('<div class="thumbs">'+fs_.map((f,i)=>'<img src="'+esc(f.url)+'" alt="" loading="lazy" onclick="document.getElementById(\'gal\').scrollTo({left:'+i+'*document.getElementById(\'gal\').clientWidth,behavior:\'smooth\'})">').join('')+'</div>'):'');
  const rows=[
    ['Immatricolazione', a.dataImm?dataIT(a.dataImm):anno],
    ['Chilometri', kmFmt(a.km)],
    ['Alimentazione', a.alimentazione?cap(a.alimentazione):null],
    ['Cambio', a.cambio?cap(a.cambio):null],
    ['Cilindrata', a.cilindrata?(String(a.cilindrata).replace(/[^\d]/g,'')+' cc'):null],
    ['Potenza', num(a.potenza)!=null?(a.potenza+' kW ('+Math.round(num(a.potenza)*1.3596)+' CV)'):null],
    ['Colore', a.colore?cap(a.colore):null],
    ['Carrozzeria', a.carrozzeria?cap(a.carrozzeria):null],
    ['Targa', a.targa||null]
  ].filter(r=>r[1]);
  const dot=String(a.dotazioni||'').split(/\r?\n|;/).map(s=>s.replace(/^[-\u2022\u00b7*\s]+/,'').trim()).filter(Boolean);
  let badges='';
  if((a.stato==='prenotata'||a.stato==='opzionata')) badges+='<span class="badge o">Opzionata — chiedi disponibilità</span>';
  if(kmN!=null && kmN<=100) badges+='<span class="badge">Km 0</span>';
  if(a.ivaEsposta) badges+='<span class="badge">IVA esposta · ideale P.IVA e leasing</span>';
  badges+='<span class="badge">Garanzia inclusa</span><span class="badge">Finanziamento in sede</span><span class="badge">Permuta del tuo usato</span>';
  const waTxt='Buongiorno, vorrei informazioni su '+nome+(a.targa?(' (targa '+a.targa+')'):'')+' vista sul vostro sito.';
  const waHref='https://wa.me/'+CONFIG.WA_NUM+'?text='+encodeURIComponent(waTxt);
  const ld={ '@context':'https://schema.org', '@type':'Car', name:nome+(a.allestimento?(' '+a.allestimento):''), brand:{'@type':'Brand',name:cap(a.marca)}, model:cap(a.modello),
    vehicleModelDate:anno||undefined, mileageFromOdometer:kmN!=null?{'@type':'QuantitativeValue',value:kmN,unitCode:'KMT'}:undefined,
    fuelType:a.alimentazione||undefined, vehicleTransmission:a.cambio||undefined, color:a.colore||undefined, vehicleIdentificationNumber:a.telaio||undefined,
    image:fs_.map(f=>f.url), url:url, itemCondition:'https://schema.org/UsedCondition',
    offers:{ '@type':'Offer', price:prz, priceCurrency:'EUR', availability:'https://schema.org/InStock', url:url, seller:{'@type':'AutoDealer',name:CONFIG.RAGIONE,telephone:'+'+CONFIG.WA_NUM,address:CONFIG.INDIRIZZO} } };
  return '<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<title>'+esc(titolo)+'</title><meta name="description" content="'+esc(desc)+'">'
    +'<link rel="canonical" href="'+esc(url)+'">'
    +'<meta property="og:type" content="product"><meta property="og:title" content="'+esc(nome+(prz?(' — '+euro(prz)):''))+'"><meta property="og:description" content="'+esc(desc)+'"><meta property="og:image" content="'+esc(fs_[0].url)+'"><meta property="og:url" content="'+esc(url)+'">'
    +'<script type="application/ld+json">'+JSON.stringify(ld)+'</script>'
    +'<style>'+CSS+'</style></head><body>'
    +'<header class="hd"><a class="lg" href="'+esc(CONFIG.VETRINA_URL)+'" style="display:flex;align-items:center;gap:10px;"><img src="'+esc(CONFIG.LOGO_URL)+'" alt="'+esc(CONFIG.AZIENDA)+'" onerror="this.replaceWith(document.createTextNode(\''+esc(CONFIG.AZIENDA).toUpperCase()+'\'))"><span style="font-size:12px;color:#64748b;font-weight:600;">'+esc(CONFIG.AZIENDA)+' · Paderno Dugnano (MI)</span></a>'
    +'<div class="tl"><a href="'+CONFIG.TEL_HREF+'">'+esc(CONFIG.TEL)+'</a><a class="wa" href="'+esc(waHref)+'" target="_blank" rel="noopener">WhatsApp</a></div></header>'
    +'<main class="wrap">'
    +'<div class="crumb"><a href="'+esc(CONFIG.VETRINA_URL)+'">Tutte le auto</a> › '+esc(nome)+'</div>'
    +gal
    +'<div class="tit"><div><h1>'+esc(nome)+'</h1>'+(a.allestimento?('<div class="all">'+esc(a.allestimento)+'</div>'):'')+'</div>'
    +'<div class="prz"><div class="p">'+esc(euro(prz))+'</div><div class="l">'+(a.ivaEsposta?'IVA inclusa':'prezzo in unica soluzione')
    +((lst&&prz&&lst>prz)?(' · da nuova <s>'+esc(euro(lst))+'</s> · <b style="color:#c81e1e;">risparmi '+esc(euro(lst-prz))+'</b>'):'')+'</div>'
    +'<div class="l" style="margin-top:6px;font-weight:700;color:#0f172a;">'+[kmFmt(a.km), anno?('anno '+anno):''].filter(Boolean).join(' · ')+'</div>'
    +'<div class="l"><b style="color:#16a34a;">'+((a.stato==='prenotata'||a.stato==='opzionata')?'Opzionata':'Disponibile in sede')+'</b>'+(a.telaio?(' · Telaio '+esc(a.telaio)):'')+'</div>'
    +'</div></div>'
    +'<div class="badges">'+badges+'</div>'
    +'<div class="cta"><a class="wa" href="'+esc(waHref)+'" target="_blank" rel="noopener">💬 Scrivici su WhatsApp</a><a class="tel" href="'+CONFIG.TEL_HREF+'">📞 Chiama '+esc(CONFIG.TEL)+'</a></div>'
    +'<div class="box"><h2>Scheda tecnica</h2>'+rows.map(r=>'<div class="srow"><span class="k">'+esc(r[0])+'</span><span class="v">'+esc(r[1])+'</span></div>').join('')+'</div>'
    +(dot.length?('<div class="box"><h2>Equipaggiamento</h2><div class="dot">'+dot.map(d=>'<div>'+esc(d)+'</div>').join('')+'</div></div>'):'')
    +'<div class="box"><h2>Dove vederla</h2><div class="sedi">'
    +'<div class="sede"><div class="n">📍 Paderno Dugnano</div><div class="a">'+esc(CONFIG.INDIRIZZO)+'</div><a href="'+CONFIG.TEL_HREF+'">'+esc(CONFIG.TEL)+'</a></div>'
    +'<div class="sede"><div class="n">📍 '+esc(CONFIG.SEDE2)+'</div><div class="a">Seconda sede espositiva: chiedici dove si trova l\'auto.</div><a href="'+CONFIG.TEL_HREF+'">'+esc(CONFIG.TEL)+'</a></div>'
    +'</div></div>'
    +'<div class="ft">'+esc(CONFIG.RAGIONE)+' — '+esc(CONFIG.INDIRIZZO)+' — P.IVA '+esc(CONFIG.PIVA)+'<br>Prezzo e dotazioni possono variare: la disponibilità va confermata in sede. Questo sito non utilizza cookie di profilazione.</div>'
    +'</main></body></html>';
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
function fuel(s){
  const t=String(s||'').toLowerCase();
  if(/plug|phev/.test(t)) return 'plug-in hybrid';
  if(/ibrid|hybrid|mild|mhev/.test(t)) return 'hybrid';
  if(/elettr|electric|ev\b/.test(t)) return 'electric';
  if(/diesel|gasolio/.test(t)) return 'diesel';
  if(/metano|cng|natural/.test(t)) return 'natural gas';
  if(/gpl|lpg/.test(t)) return 'lpg';
  if(/benz|gasoline|petrol/.test(t)) return 'gasoline';
  return t?'other':'';
}
function trasm(s){
  const t=String(s||'').toLowerCase();
  if(/auto|dsg|cvt|edc|dct|robot/.test(t)) return 'automatic';
  if(/man/.test(t)) return 'manual';
  return t?'other':'';
}
const FEED_COLS=['vehicle_id','vin','brand','model','trim','year','mileage','price','condition','image_link','additional_image_link','link','exterior_color','vehicle_fuel_type','vehicle_transmission','engine','store_code','availability'];
function rigaFeed(a){
  const url=CONFIG.BASE_URL+'/'+CONFIG.DIR_AUTO+'/'+slug(a)+'.html';
  const kmN=num(a.km), prz=num(a.prezzoVen);
  const cc=String(a.cilindrata||'').replace(/[^\d]/g,'');
  const kw=num(a.potenza);
  return [
    tsv(a.id),
    tsv(a.telaio||''),
    tsv(cap(a.marca)),
    tsv(cap(a.modello)),
    tsv(a.allestimento||''),
    tsv(annoDa(a)),
    kmN!=null?(Math.round(kmN)+' km'):'',
    prz!=null?(prz.toFixed(2)+' EUR'):'',
    'used',
    tsv(a.foto[0].url),
    a.foto.slice(1,11).map(f=>tsv(f.url)).join(','),
    url,
    tsv(a.colore?cap(a.colore):''),
    fuel(a.alimentazione),
    trasm(a.cambio),
    tsv([cc?(cc+' cc'):'', kw!=null?(Math.round(kw*1.3596)+' CV'):''].filter(Boolean).join(' ')),
    CONFIG.STORE_CODE,
    'in_stock'
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
