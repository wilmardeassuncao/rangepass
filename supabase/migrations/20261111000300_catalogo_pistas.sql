-- Catálogo de armas e munições, armas físicas do estande, pistas e interdições.

create table public.categorias (
    id serial primary key,
    nome text not null unique,
    ativo boolean not null default true
);

create table public.calibres (
    id serial primary key,
    nome text not null unique,
    ativo boolean not null default true
);

create table public.modelos (
    id serial primary key,
    categoria_id int not null references public.categorias,
    calibre_id int not null references public.calibres,
    marca text not null,
    nome text not null,
    ativo boolean not null default true,
    unique (marca, nome)
);

create table public.tipos_municao (
    id serial primary key,
    calibre_id int not null references public.calibres,
    nome text not null,
    ativo boolean not null default true,
    unique (calibre_id, nome)
);

create type public.situacao_unidade as enum ('disponivel', 'manutencao', 'desativada');

-- Cada arma física do estande. O número de registro nunca é mostrado ao cliente.
create table public.unidades_arma (
    id serial primary key,
    modelo_id int not null references public.modelos,
    numero_registro text not null unique,
    situacao public.situacao_unidade not null default 'disponivel'
);

create table public.pistas (
    id serial primary key,
    numero int not null unique check (numero > 0),
    ativa boolean not null default true
);

create table public.interdicoes (
    id bigint generated always as identity primary key,
    pista_id int not null references public.pistas,
    periodo tstzrange not null check (not isempty(periodo)),
    motivo text not null,
    criado_por uuid references auth.users,
    criado_em timestamptz default now(),
    ativa boolean not null default true
);

create trigger historico_modelos after insert or update on public.modelos
    for each row execute function public.registrar_historico();
create trigger historico_unidades_arma after insert or update on public.unidades_arma
    for each row execute function public.registrar_historico();
create trigger historico_pistas after insert or update on public.pistas
    for each row execute function public.registrar_historico();
create trigger historico_interdicoes after insert or update on public.interdicoes
    for each row execute function public.registrar_historico();

-- Bloqueio: repetir no fim de toda migração futura.
alter table public.categorias enable row level security;
alter table public.calibres enable row level security;
alter table public.modelos enable row level security;
alter table public.tipos_municao enable row level security;
alter table public.unidades_arma enable row level security;
alter table public.pistas enable row level security;
alter table public.interdicoes enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.salvar_configuracao(text, jsonb, uuid) to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
