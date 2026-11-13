-- Agendamentos, participantes e reservas de pista, instrutor e arma.
-- O próprio banco impede que um mesmo recurso seja reservado duas vezes no mesmo horário.

create type public.situacao_agendamento as enum ('aguardando_pagamento', 'pago', 'check_in', 'concluido', 'cancelado', 'nao_compareceu');
create type public.forma_pagamento as enum ('app', 'balcao');
create type public.modalidade as enum ('estande', 'arma_propria', 'tudo_proprio');

-- Período da sessão. Somar horas a um timestamptz não depende do fuso horário, então a função é imutável
-- (a soma comum é marcada só como "estável" e não pode ser usada direto numa coluna gerada).
create function public.periodo_sessao(p_inicio timestamptz, p_horas int) returns tstzrange
language sql immutable as $$
    select tstzrange(p_inicio, p_inicio + p_horas * interval '1 hour', '[)')
$$;

-- O limite de 3h para quem vai sozinho é regra da Edge Function (lido de configuracoes); o banco garante o teto de 6h.
create table public.agendamentos (
    id uuid primary key default gen_random_uuid(),
    responsavel_id uuid not null references public.perfis,
    inicio timestamptz not null,
    horas int not null check (horas between 1 and 6),
    periodo tstzrange generated always as (public.periodo_sessao(inicio, horas)) stored,
    situacao public.situacao_agendamento not null default 'aguardando_pagamento',
    forma_pagamento public.forma_pagamento not null,
    criado_em timestamptz default now()
);

create table public.participantes (
    id uuid primary key default gen_random_uuid(),
    agendamento_id uuid not null references public.agendamentos,
    nome_completo text not null,
    cpf text not null check (cpf ~ '^\d{11}$'),
    data_nascimento date not null,
    perfil_id uuid references public.perfis,
    modalidade public.modalidade not null,
    aceite_termo_em timestamptz,
    unique (agendamento_id, cpf),
    check (modalidade = 'estande' or aceite_termo_em is not null)
);

-- arma_propria: {modelo, calibre, numero_registro, responsavel}
create table public.itens_participante (
    id uuid primary key default gen_random_uuid(),
    participante_id uuid not null references public.participantes,
    modelo_id int references public.modelos,
    arma_propria jsonb,
    tipo_municao_id int references public.tipos_municao,
    municao_qtd int check (municao_qtd > 0)
);

create table public.agendamento_pistas (
    id bigint generated always as identity primary key,
    agendamento_id uuid not null references public.agendamentos,
    periodo tstzrange not null,
    ativo boolean not null default true,
    pista_id int not null references public.pistas
);

create table public.agendamento_instrutores (
    id bigint generated always as identity primary key,
    agendamento_id uuid not null references public.agendamentos,
    periodo tstzrange not null,
    ativo boolean not null default true,
    instrutor_id uuid not null references public.perfis,
    principal boolean not null default false
);

create table public.agendamento_unidades (
    id bigint generated always as identity primary key,
    agendamento_id uuid not null references public.agendamentos,
    periodo tstzrange not null,
    ativo boolean not null default true,
    unidade_id int not null references public.unidades_arma,
    participante_id uuid not null references public.participantes
);

-- O centro deste plano: o mesmo recurso não pode ter duas reservas ativas que se sobrepõem.
alter table public.agendamento_pistas      add constraint pista_sem_conflito     exclude using gist (pista_id with =, periodo with &&) where (ativo);
alter table public.agendamento_instrutores add constraint instrutor_sem_conflito exclude using gist (instrutor_id with =, periodo with &&) where (ativo);
alter table public.agendamento_unidades    add constraint unidade_sem_conflito   exclude using gist (unidade_id with =, periodo with &&) where (ativo);

-- Copia o período do agendamento para a reserva e marca se ela está ativa.
create function public.copiar_periodo_recurso() returns trigger
language plpgsql set search_path = public as $$
declare
    ag public.agendamentos;
begin
    select * into ag from public.agendamentos where id = NEW.agendamento_id;
    if not found then
        raise exception 'Agendamento % não encontrado.', NEW.agendamento_id using errcode = 'P0001';
    end if;
    NEW.periodo := ag.periodo;
    NEW.ativo := ag.situacao not in ('cancelado', 'nao_compareceu');
    return NEW;
end;
$$;

-- Quando o agendamento muda de horário ou de situação, as reservas acompanham.
-- Se isso criar um conflito, o erro 23P01 desfaz a alteração inteira.
create function public.sincronizar_recursos() returns trigger
language plpgsql set search_path = public as $$
declare
    ativo_novo boolean := NEW.situacao not in ('cancelado', 'nao_compareceu');
begin
    update public.agendamento_pistas      set periodo = NEW.periodo, ativo = ativo_novo where agendamento_id = NEW.id;
    update public.agendamento_instrutores set periodo = NEW.periodo, ativo = ativo_novo where agendamento_id = NEW.id;
    update public.agendamento_unidades    set periodo = NEW.periodo, ativo = ativo_novo where agendamento_id = NEW.id;
    return NEW;
end;
$$;

create function public.pista_nao_interditada() returns trigger
language plpgsql set search_path = public as $$
declare
    p public.pistas;
begin
    if not NEW.ativo then
        return NEW;
    end if;
    select * into p from public.pistas where id = NEW.pista_id;
    if not p.ativa then
        raise exception 'A pista % está desativada.', p.numero using errcode = 'P0001';
    end if;
    if exists (
        select 1 from public.interdicoes i
        where i.pista_id = NEW.pista_id and i.ativa and i.periodo && NEW.periodo
    ) then
        raise exception 'A pista % está interditada nesse horário.', p.numero using errcode = 'P0001';
    end if;
    return NEW;
end;
$$;

create function public.unidade_disponivel() returns trigger
language plpgsql set search_path = public as $$
begin
    if exists (select 1 from public.unidades_arma where id = NEW.unidade_id and situacao <> 'disponivel') then
        raise exception 'A arma escolhida não está disponível.' using errcode = 'P0001';
    end if;
    return NEW;
end;
$$;

-- Os gatilhos BEFORE disparam em ordem alfabética: "a_" copia o período antes de "b_" conferir.
create trigger a_copiar_periodo before insert on public.agendamento_pistas
    for each row execute function public.copiar_periodo_recurso();
create trigger a_copiar_periodo before insert on public.agendamento_instrutores
    for each row execute function public.copiar_periodo_recurso();
create trigger a_copiar_periodo before insert on public.agendamento_unidades
    for each row execute function public.copiar_periodo_recurso();
create trigger b_pista_nao_interditada before insert or update on public.agendamento_pistas
    for each row execute function public.pista_nao_interditada();
create trigger b_unidade_disponivel before insert on public.agendamento_unidades
    for each row execute function public.unidade_disponivel();

create trigger sincronizar_recursos after update of inicio, horas, situacao on public.agendamentos
    for each row execute function public.sincronizar_recursos();

create trigger historico_agendamentos after insert or update on public.agendamentos
    for each row execute function public.registrar_historico();
create trigger historico_agendamento_pistas after insert or update on public.agendamento_pistas
    for each row execute function public.registrar_historico();
create trigger historico_agendamento_instrutores after insert or update on public.agendamento_instrutores
    for each row execute function public.registrar_historico();
create trigger historico_agendamento_unidades after insert or update on public.agendamento_unidades
    for each row execute function public.registrar_historico();

-- Bloqueio: repetir no fim de toda migração futura.
alter table public.agendamentos enable row level security;
alter table public.participantes enable row level security;
alter table public.itens_participante enable row level security;
alter table public.agendamento_pistas enable row level security;
alter table public.agendamento_instrutores enable row level security;
alter table public.agendamento_unidades enable row level security;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.salvar_configuracao(text, jsonb, uuid) to service_role;
grant execute on function public.periodo_sessao(timestamptz, int) to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
