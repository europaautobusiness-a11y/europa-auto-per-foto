/* ============================================================
   EUROPA AUTO — stato dei veicoli su Google Merchant Center
   Legge da Merchant Center (Content API v2.1) lo stato di approvazione di
   ogni prodotto e scrive feed/stato-google.json, che il gestionale usa per
   il pallino verde/arancio/rosso in "Auto online".

   Serve un account di servizio Google con accesso al Merchant Center:
     1. console.cloud.google.com → progetto (uno qualsiasi) → API e servizi
        → Libreria → attiva "Content API for Shopping".
     2. IAM e amministrazione → Account di servizio → Crea → scarica la
        chiave JSON.
     3. Merchant Center → Impostazioni → Persone e accesso → Aggiungi →
        incolla l'email dell'account di servizio (…@…iam.gserviceaccount.com)
        con ruolo Standard.
     4. GitHub → repo → Settings → Secrets and variables → Actions →
        New repository secret: nome GOOGLE_SA_JSON, valore = tutto il JSON.
     5. Nel workflow genera-auto.yml, dopo il passo che genera il feed:
          - name: Stato Google
            env: { GOOGLE_SA_JSON: ${{ secrets.GOOGLE_SA_JSON }} }
            run: node scripts/stato-google.js
   Senza il secret lo script non fa nulla e non fa fallire il workflow.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MERCHANT_ID = '5676521448';
const OUT = path.join(__dirname, '..', 'feed', 'stato-google.json');

function b64url(buf){ return Buffer.from(buf).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }

async function tokenDaServiceAccount(sa){
  const now = Math.floor(Date.now()/1000);
  const header = b64url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/content',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const sig = crypto.createSign('RSA-SHA256').update(header+'.'+claim).sign(sa.private_key);
  const jwt = header+'.'+claim+'.'+b64url(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+encodeURIComponent(jwt)
  });
  if(!r.ok) throw new Error('token: '+r.status+' '+(await r.text()));
  return (await r.json()).access_token;
}

async function main(){
  const raw = process.env.GOOGLE_SA_JSON;
  if(!raw){ console.log('stato-google: GOOGLE_SA_JSON assente, salto (il gestionale mostrera\' solo "nel feed").'); return; }
  let sa; try{ sa = JSON.parse(raw); }catch(e){ console.log('stato-google: GOOGLE_SA_JSON non e\' un JSON valido'); return; }
  const token = await tokenDaServiceAccount(sa);
  const prodotti = {};
  let pageToken = '', n = 0;
  do {
    const url = 'https://shoppingcontent.googleapis.com/content/v2.1/'+MERCHANT_ID+'/productstatuses?maxResults=250'+(pageToken?('&pageToken='+encodeURIComponent(pageToken)):'');
    const r = await fetch(url, { headers:{ Authorization:'Bearer '+token } });
    if(!r.ok) throw new Error('productstatuses: '+r.status+' '+(await r.text()));
    const j = await r.json();
    (j.resources||[]).forEach(p => {
      /* productId = "online:it:IT:EA1946" → l'ultimo pezzo e' il nostro id */
      const id = String(p.productId||'').split(':').pop().toUpperCase();
      if(!id) return;
      /* lo stato che conta e' quello della destinazione annunci veicoli;
         se manca si prende la prima disponibile */
      const ds = (p.destinationStatuses||[]);
      const d = ds.find(x => /vehicle/i.test(x.destination||'')) || ds[0] || {};
      const st = String(d.status||'').toLowerCase();   /* approved | pending | disapproved */
      const motivi = (p.itemLevelIssues||[]).filter(i => /vehicle/i.test(i.destination||'') || !i.destination)
        .filter(i => String(i.servability||'').toLowerCase()==='disapproved' || String(i.resolution||'').toLowerCase()==='merchant_action')
        .map(i => i.description || i.code).filter(Boolean);
      prodotti[id] = { stato: st || 'pending', motivo: motivi.slice(0,3).join(' · ') || undefined, titolo: p.title || undefined };
      n++;
    });
    pageToken = j.nextPageToken || '';
  } while(pageToken);
  fs.mkdirSync(path.dirname(OUT), { recursive:true });
  fs.writeFileSync(OUT, JSON.stringify({ aggiornato: new Date().toISOString(), merchant: MERCHANT_ID, prodotti }, null, 1));
  const ok = Object.values(prodotti).filter(p => p.stato==='approved').length;
  console.log('stato-google: '+n+' prodotti letti, '+ok+' approvati → '+path.relative(process.cwd(), OUT));
}

main().catch(e => { console.log('stato-google: '+(e && e.message || e)+' (il feed resta valido, salto lo stato)'); });
