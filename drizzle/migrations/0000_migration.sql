create table if not exists public.opcoes_grade (
  id bigint generated always as identity primary key,
  ticker text not null, data_coleta date not null default current_date, ativo text, ativo_base text,
  tipo text, strike numeric, vencimento date, ultimo numeric, bid numeric, ask numeric,
  negocios int, volume numeric, iv numeric, delta numeric
);
create index if not exists opcoes_grade_ativo_idx on public.opcoes_grade (ativo, data_coleta desc);
create table if not exists public.scraper_status (
  id bigint generated always as identity primary key,
  executado_em timestamptz not null default now(), ativo text,
  status text not null check (status in ('OK','AVISO','REPARADO','QUEBRADO')), linhas int, notas text
);
create table if not exists public.ativos (ticker text primary key, nome text, setor text, preco numeric, atualizado_em timestamptz not null default now());
create table if not exists public.fundamentos (ticker text not null, data date not null, pl numeric, pvp numeric, dy numeric, roe numeric, divida_liquida_ebitda numeric, valuation_score numeric, primary key (ticker, data));
create table if not exists public.dividendos (id bigint generated always as identity primary key, ticker text not null, data_com date not null, data_pagamento date, tipo text not null default 'dividendo', valor numeric, unique (ticker, data_com, tipo));
create table if not exists public.eventos (id bigint generated always as identity primary key, ticker text not null, tipo text not null, data date not null, descricao text, unique (ticker, tipo, data));
create table if not exists public.noticias (id bigint generated always as identity primary key, ticker text not null, titulo text not null, fonte text, url text unique, publicado_em timestamptz, sentimento numeric check (sentimento between -1 and 1), resumo text);
create index if not exists noticias_ticker_idx on public.noticias (ticker, publicado_em desc);
create table if not exists public.sinais (
  id bigint generated always as identity primary key, chave text not null unique, ticker text not null, estrategia text not null,
  pernas jsonb not null, vencimento date not null, dias_vencimento int, preco_ativo numeric, credito_debito numeric,
  lucro_max numeric, perda_max numeric, breakevens jsonb, prob_lucro numeric, valor_esperado numeric, retorno_sobre_risco numeric,
  iv_rank numeric, score numeric, fatores jsonb, gregas jsonb, curva_payoff jsonb, motivos jsonb, riscos jsonb,
  status text not null default 'ativo' check (status in ('ativo','encerrado')),
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create index if not exists sinais_status_score_idx on public.sinais (status, score desc);
create table if not exists public.sinais_historico (id bigint generated always as identity primary key, sinal_id bigint not null references public.sinais(id) on delete cascade, momento timestamptz not null default now(), score numeric, prob_lucro numeric, preco_ativo numeric, observacao text);
create index if not exists sinais_hist_idx on public.sinais_historico (sinal_id, momento);
create table if not exists public.alertas (id bigint generated always as identity primary key, sinal_id bigint references public.sinais(id) on delete cascade, tipo text not null check (tipo in ('novo','score_subiu','score_caiu','encerrado','evento_proximo')), mensagem text not null, criado_em timestamptz not null default now(), lido boolean not null default false);
create index if not exists alertas_criado_idx on public.alertas (criado_em desc);
create table if not exists public.parametros (
  user_id uuid primary key, capital numeric, risco_max_pct numeric not null default 2,
  estrategias_ativas jsonb not null default '["venda_put","lancamento_coberto","collar","trava_alta_put","trava_baixa_call","trava_alta_call","trava_baixa_put","iron_condor"]',
  liquidez_min_negocios int not null default 10, spread_max_pct numeric not null default 15, prob_lucro_min numeric not null default 0.5,
  updated_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['opcoes_grade','scraper_status','ativos','fundamentos','dividendos','eventos','noticias','sinais','sinais_historico','alertas','parametros'] loop
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['opcoes_grade','scraper_status','ativos','fundamentos','dividendos','eventos','noticias','sinais','sinais_historico','alertas'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "leitura autenticada" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;
grant update (lido) on public.alertas to authenticated;
create policy "marcar alerta lido" on public.alertas for update to authenticated using (true) with check (true);
grant select, insert, update, delete on public.parametros to authenticated;
create policy "parametros proprios" on public.parametros for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.sinais, public.alertas, public.scraper_status;