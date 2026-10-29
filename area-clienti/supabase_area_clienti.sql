-- ============================================================
--  EUROPA AUTO — AREA CLIENTI (app per il cliente)
--  Da incollare su supabase.com → progetto jasrectyddshjizpxiia
--  → SQL Editor → Run. Si può rilanciare senza danni.
-- ============================================================

-- 1) Chi è "staff" (vede e gestisce tutte le richieste).
create or replace function public.is_staff()
returns boolean language sql stable as $$
  select coalesce(
    lower(coalesce(auth.email(),'')) in (
      'europaautobusiness@gmail.com',
      'amministrazione@europaautosrl.it',
      'contabilita@europaautosrl.it',
      'vendita@europaautosrl.it',
      'no.reply.europaauto@gmail.com',
      'ariannapresta80@gmail.com',
      'contabilitaeuropaauto@gmail.com'
    ) or lower(coalesce(auth.email(),'')) like '%@europaautosrl.it', false);
$$;

-- 2) Collegamenti manuali: una pratica si può mostrare anche a un'email
--    diversa da quella scritta sul contratto (prove, familiari, ecc.).
create table if not exists public.app_cliente_link (
  email text not null,
  cv_id text not null,
  creato_da text,
  created_at timestamptz default now(),
  primary key (email, cv_id)
);
alter table public.app_cliente_link enable row level security;
drop policy if exists "staff gestisce link" on public.app_cliente_link;
create policy "staff gestisce link" on public.app_cliente_link
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 3) Le pratiche del cliente collegato: SOLO i campi che servono all'app,
--    mai il contratto intero (prezzi d'acquisto, margini, note interne).
create or replace function public.mie_pratiche()
returns jsonb language sql stable security definer set search_path = public as $$
  with mie as (
    select p.id, p.data
    from public.preventivi p
    where (p.data->>'isContratto') = 'true'
      and coalesce(p.data->>'deleted','false') <> 'true'
      and coalesce(p.data->>'annullato','false') <> 'true'
      and (
        lower(trim(coalesce(p.data->'cliente'->>'email',''))) = lower(coalesce(auth.email(),''))
        or lower(trim(coalesce(p.data->'cliente'->>'email2',''))) = lower(coalesce(auth.email(),''))
        or p.id in (select l.cv_id from public.app_cliente_link l where lower(l.email) = lower(coalesce(auth.email(),'')))
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', mie.id,
    'marca', coalesce(m.data->>'marca', mie.data->'autoSnapshot'->>'marca', ''),
    'modello', coalesce(m.data->>'modello', mie.data->'autoSnapshot'->>'modello', mie.data->>'autoDesc', ''),
    'allestimento', coalesce(m.data->>'allestimento',''),
    'targa', coalesce(nullif(mie.data->>'nuovaTarga',''), mie.data->'autoSnapshot'->>'targa', m.data->>'targa', ''),
    'telaio', coalesce(mie.data->'autoSnapshot'->>'telaio', m.data->>'telaio', ''),
    'dataImm', coalesce(m.data->>'dataImm', mie.data->'autoSnapshot'->>'dataImm', ''),
    'km', coalesce(nullif(mie.data->>'kmAgg',''), m.data->>'km', ''),
    'colore', coalesce(m.data->>'colore',''),
    'alimentazione', coalesce(m.data->>'alimentazione',''),
    'foto', coalesce(m.data->'foto'->0->>'url', ''),
    'consegnatoTs', mie.data->>'consegnatoTs',
    'contrattoTs', mie.data->>'contrattoTs',
    'statoVendita', mie.data->>'statoVendita',
    'garanziaMesi', mie.data->>'garanziaMesi',
    'assicOn', mie.data->'assicOn',
    'assicMesi', mie.data->>'assicMesi',
    'polizzaTipo', mie.data->>'polizzaTipo',
    'finDelibera', case when (mie.data->'finDelibera'->>'confermata') = 'true'
        then jsonb_build_object(
          'finanziaria', mie.data->'finDelibera'->>'finanziaria',
          'durata', mie.data->'finDelibera'->>'durata',
          'rata', mie.data->'finDelibera'->>'rata',
          'data', mie.data->'finDelibera'->>'data')
        else null end,
    'finPagamento', (
        select jsonb_build_object('rate', x->>'rate', 'importoRata', x->>'importoRata', 'metodo', x->>'metodo')
        from jsonb_array_elements(coalesce(mie.data->'pagamenti','[]'::jsonb)) x
        where lower(coalesce(x->>'metodo','')) like '%finanziamento%' limit 1)
  )), '[]'::jsonb)
  from mie left join public.magazzino m on m.id = (mie.data->>'autoId');
$$;
revoke all on function public.mie_pratiche() from public;
grant execute on function public.mie_pratiche() to authenticated;

-- 4) Scadenze che il gestionale non conosce (RC auto, bollo, ultimo
--    tagliando): le scrive il cliente nell'app.
create table if not exists public.scadenze_cliente (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  cv_id text not null,
  tipo text not null,          -- rc | bollo | tagliando | revisione | altro
  data date,
  note text,
  updated_at timestamptz default now(),
  unique (user_id, cv_id, tipo)
);
alter table public.scadenze_cliente enable row level security;
drop policy if exists "cliente le sue scadenze" on public.scadenze_cliente;
create policy "cliente le sue scadenze" on public.scadenze_cliente
  for all to authenticated using (user_id = auth.uid() or public.is_staff())
  with check (user_id = auth.uid() or public.is_staff());

-- 5) Le richieste del cliente (assistenza, tagliando, carrozzeria...).
create table if not exists public.richieste_cliente (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  email text not null default coalesce(auth.email(),''),
  nome text,
  telefono text,
  cv_id text,
  targa text,
  auto text,
  tipo text not null,          -- assistenza | tagliando | carrozzeria | gomme | finanziamento | cambio_auto | altro
  testo text,
  data_pref date,
  foto jsonb default '[]'::jsonb,
  stato text not null default 'ricevuta',   -- ricevuta | in_lavorazione | chiusa
  risposta text,
  risposta_ts timestamptz,
  gestita_da text,
  avvisata boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.richieste_cliente enable row level security;
drop policy if exists "legge le sue o staff" on public.richieste_cliente;
create policy "legge le sue o staff" on public.richieste_cliente
  for select to authenticated using (user_id = auth.uid() or public.is_staff());
drop policy if exists "cliente inserisce" on public.richieste_cliente;
create policy "cliente inserisce" on public.richieste_cliente
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "staff aggiorna" on public.richieste_cliente;
create policy "staff aggiorna" on public.richieste_cliente
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "cliente annulla la sua se ricevuta" on public.richieste_cliente;
create policy "cliente annulla la sua se ricevuta" on public.richieste_cliente
  for delete to authenticated using (user_id = auth.uid() and stato = 'ricevuta');

-- 6) Per la PROVA: collega una o più pratiche alla tua email.
--    Sostituisci gli id con quelli delle pratiche che vuoi vedere
--    (li trovi nel gestionale, scheda pratica → Storico, oppure nell'URL).
-- insert into public.app_cliente_link(email, cv_id, creato_da)
-- values ('europaautobusiness@gmail.com', 'cv_1760000000000', 'prova')
-- on conflict do nothing;
