-- Banco base do RangePass: papéis, perfis, configurações e histórico de alterações.
-- Todo acesso passa pelas Edge Functions (chave de serviço); anon e authenticated ficam bloqueados.

create extension if not exists btree_gist with schema extensions;

create type public.papel as enum ('cliente', 'atendente', 'almoxarifado', 'instrutor', 'administrativo', 'superadmin');

create table public.perfis (
    id uuid primary key references auth.users on delete restrict,
    nome_completo text not null,
    cpf text not null unique check (cpf ~ '^\d{11}$'),
    telefone text not null,
    data_nascimento date not null,
    cr text,
    orgao_expedidor text,
    ativo boolean not null default true,
    criado_em timestamptz not null default now()
);

-- Não depende de perfis, para que um usuário recém-criado já possa ter papel.
create table public.papeis_usuario (
    usuario_id uuid references auth.users,
    papel public.papel,
    primary key (usuario_id, papel)
);

create table public.configuracoes (
    chave text primary key,
    valor jsonb not null,
    atualizado_em timestamptz not null default now(),
    atualizado_por uuid references auth.users
);

create table public.historico_alteracoes (
    id bigint generated always as identity primary key,
    tabela text not null,
    registro_id text not null,
    acao text not null check (acao in ('insercao', 'alteracao')),
    antes jsonb,
    depois jsonb,
    feito_por uuid,
    feito_em timestamptz not null default now()
);

create function public.registrar_historico() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    novo jsonb := to_jsonb(NEW);
begin
    insert into public.historico_alteracoes (tabela, registro_id, acao, antes, depois, feito_por)
    values (
        TG_TABLE_NAME,
        coalesce(novo ->> 'id', novo ->> 'chave'),
        case when TG_OP = 'INSERT' then 'insercao' else 'alteracao' end,
        case when TG_OP = 'UPDATE' then to_jsonb(OLD) end,
        novo,
        nullif(current_setting('app.usuario_id', true), '')::uuid
    );
    return NEW;
end;
$$;

create trigger historico_configuracoes after insert or update on public.configuracoes
    for each row execute function public.registrar_historico();
create trigger historico_perfis after insert or update on public.perfis
    for each row execute function public.registrar_historico();

create function public.salvar_configuracao(p_chave text, p_valor jsonb, p_usuario uuid)
returns public.configuracoes
language plpgsql security definer set search_path = public as $$
declare
    resultado public.configuracoes;
begin
    perform set_config('app.usuario_id', coalesce(p_usuario::text, ''), true);
    insert into public.configuracoes (chave, valor, atualizado_em, atualizado_por)
    values (p_chave, p_valor, now(), p_usuario)
    on conflict (chave) do update
        set valor = excluded.valor, atualizado_em = now(), atualizado_por = excluded.atualizado_por
    returning * into resultado;
    return resultado;
end;
$$;

-- Bloqueio: repetir no fim de toda migração futura.
alter table public.perfis enable row level security;
alter table public.papeis_usuario enable row level security;
alter table public.configuracoes enable row level security;
alter table public.historico_alteracoes enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.salvar_configuracao(text, jsonb, uuid) to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
