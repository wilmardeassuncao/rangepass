-- Plano 5: preços. Preço da arma (por hora) e da munição (por unidade), a hora de pista nas
-- Configurações, as promoções (regras por dia e horário, campanhas, classes de desconto e pacotes)
-- e o preço congelado de cada agendamento. Dinheiro é sempre um inteiro de centavos.
-- Os "check" repetem as regras de _shared/precos.mjs e _shared/catalogo.mjs.

-- 1) Preço da arma do estande e da munição. Vazio = sem preço (não aparece para o cliente).
alter table public.modelos
    add column preco_hora_centavos int check (preco_hora_centavos > 0);
alter table public.tipos_municao
    add column preco_unidade_centavos int check (preco_unidade_centavos > 0);

-- 2) Hora de pista. Começa vazia: sem ela ninguém agenda.
insert into public.configuracoes (chave, valor) values ('precos', '{"hora_pista_centavos": null}');

-- 3) Promoções. Nada é apagado: só se cria, edita ou desativa (ativo).

-- Ajuste da hora de pista por dia da semana (0 = domingo) e horário. percentual: -90 a 200, sem 0.
-- Vale para a hora que começa entre hora_inicio (inclusive) e hora_fim (exclusive).
create table public.regras_preco (
    id serial primary key,
    nome text not null check (btrim(nome) <> ''),
    dias int[] not null check (cardinality(dias) > 0 and array_position(dias, null) is null and dias <@ '{0,1,2,3,4,5,6}'::int[]),
    hora_inicio time not null,
    hora_fim time not null,
    percentual int not null check (percentual between -90 and 200 and percentual <> 0),
    prioridade int not null default 0 check (prioridade >= 0),
    ativo boolean not null default true,
    check (hora_inicio < hora_fim)
);

-- Desconto em todo o pedido, pela data em que o cliente agenda (início e fim inclusivos).
create table public.campanhas (
    id serial primary key,
    nome text not null check (btrim(nome) <> ''),
    percentual int not null check (percentual between 1 and 90),
    inicio date not null,
    fim date not null,
    ativo boolean not null default true,
    check (fim >= inicio)
);

-- Desconto que o atendente aplica no balcão (etapa 8). Só o cadastro, neste plano.
create table public.classes_desconto (
    id serial primary key,
    nome text not null unique check (btrim(nome) <> ''),
    percentual int not null check (percentual between 1 and 90),
    ativo boolean not null default true
);

-- Preço fechado para as primeiras horas de uma pista, com aluguel de um modelo e munição opcionais.
-- A munição e a quantidade andam juntas.
create table public.pacotes (
    id serial primary key,
    nome text not null check (btrim(nome) <> ''),
    inicio date not null,
    fim date not null,
    preco_centavos int not null check (preco_centavos > 0),
    horas int not null check (horas between 1 and 6),
    modelo_id int references public.modelos,
    tipo_municao_id int references public.tipos_municao,
    municao_qtd int check (municao_qtd > 0),
    ativo boolean not null default true,
    check (fim >= inicio),
    check ((tipo_municao_id is null) = (municao_qtd is null))
);

create trigger historico_regras_preco after insert or update on public.regras_preco
    for each row execute function public.registrar_historico();
create trigger historico_campanhas after insert or update on public.campanhas
    for each row execute function public.registrar_historico();
create trigger historico_classes_desconto after insert or update on public.classes_desconto
    for each row execute function public.registrar_historico();
create trigger historico_pacotes after insert or update on public.pacotes
    for each row execute function public.registrar_historico();

alter table public.regras_preco enable row level security;
alter table public.campanhas enable row level security;
alter table public.classes_desconto enable row level security;
alter table public.pacotes enable row level security;

-- 4) Preço congelado do agendamento: o objeto Preco (_shared/precos.mjs) e o total.
--    Vazios nos agendamentos feitos antes dos preços. Os dois andam juntos.
alter table public.agendamentos
    add column preco_total_centavos int check (preco_total_centavos >= 0),
    add column preco_detalhe jsonb,
    add constraint agendamentos_preco_junto check ((preco_total_centavos is null) = (preco_detalhe is null));

-- 5) Cria (p_id nulo) ou edita (só as chaves enviadas) uma promoção e devolve a linha.
-- Como salvar_cadastro: p_dados já vem conferido pela Edge Function (_shared/precos.mjs), mas aqui
-- só entram as chaves de uma lista fixa por tipo; nenhum nome de tabela ou coluna vem do pedido.
-- Erros: 22023 tipo ou chave não aceita; P0002 id inexistente na edição; 23514 valor fora das regras.
create function public.salvar_promocao(p_tipo text, p_id int, p_dados jsonb, p_autor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_permitidas text[];
    v_chave text;
    v_id int;
    v_linha jsonb;
    v_dias int[];
begin
    perform set_config('app.usuario_id', coalesce(p_autor::text, ''), true);

    v_permitidas := case p_tipo
        when 'regra' then array['nome', 'dias', 'hora_inicio', 'hora_fim', 'percentual', 'prioridade', 'ativo']
        when 'campanha' then array['nome', 'percentual', 'inicio', 'fim', 'ativo']
        when 'classe' then array['nome', 'percentual', 'ativo']
        when 'pacote' then array['nome', 'inicio', 'fim', 'preco_centavos', 'horas', 'modelo_id', 'tipo_municao_id', 'municao_qtd', 'ativo']
    end;
    if v_permitidas is null then
        raise exception 'Tipo de promoção desconhecido.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_dados) is distinct from 'object' then
        raise exception 'Dados da promoção inválidos.' using errcode = '22023';
    end if;
    for v_chave in select jsonb_object_keys(p_dados) loop
        if not v_chave = any(v_permitidas) then
            raise exception 'Campo não aceito: %', v_chave using errcode = '22023';
        end if;
    end loop;

    if p_tipo = 'regra' then
        if p_dados ? 'dias' then
            if jsonb_typeof(p_dados -> 'dias') is distinct from 'array' then
                raise exception 'Dias inválidos.' using errcode = '22023';
            end if;
            v_dias := array(select jsonb_array_elements_text(p_dados -> 'dias')::int);
        end if;
        if p_id is null then
            insert into public.regras_preco (nome, dias, hora_inicio, hora_fim, percentual, prioridade, ativo)
            values (
                p_dados ->> 'nome', v_dias, (p_dados ->> 'hora_inicio')::time, (p_dados ->> 'hora_fim')::time,
                (p_dados ->> 'percentual')::int, coalesce((p_dados ->> 'prioridade')::int, 0),
                coalesce((p_dados ->> 'ativo')::boolean, true)
            )
            returning id into v_id;
        else
            update public.regras_preco set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                dias = case when p_dados ? 'dias' then v_dias else dias end,
                hora_inicio = case when p_dados ? 'hora_inicio' then (p_dados ->> 'hora_inicio')::time else hora_inicio end,
                hora_fim = case when p_dados ? 'hora_fim' then (p_dados ->> 'hora_fim')::time else hora_fim end,
                percentual = case when p_dados ? 'percentual' then (p_dados ->> 'percentual')::int else percentual end,
                prioridade = case when p_dados ? 'prioridade' then (p_dados ->> 'prioridade')::int else prioridade end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.regras_preco t where t.id = v_id;

    elsif p_tipo = 'campanha' then
        if p_id is null then
            insert into public.campanhas (nome, percentual, inicio, fim, ativo)
            values (
                p_dados ->> 'nome', (p_dados ->> 'percentual')::int, (p_dados ->> 'inicio')::date,
                (p_dados ->> 'fim')::date, coalesce((p_dados ->> 'ativo')::boolean, true)
            )
            returning id into v_id;
        else
            update public.campanhas set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                percentual = case when p_dados ? 'percentual' then (p_dados ->> 'percentual')::int else percentual end,
                inicio = case when p_dados ? 'inicio' then (p_dados ->> 'inicio')::date else inicio end,
                fim = case when p_dados ? 'fim' then (p_dados ->> 'fim')::date else fim end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.campanhas t where t.id = v_id;

    elsif p_tipo = 'classe' then
        if p_id is null then
            insert into public.classes_desconto (nome, percentual, ativo)
            values (p_dados ->> 'nome', (p_dados ->> 'percentual')::int, coalesce((p_dados ->> 'ativo')::boolean, true))
            returning id into v_id;
        else
            update public.classes_desconto set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                percentual = case when p_dados ? 'percentual' then (p_dados ->> 'percentual')::int else percentual end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.classes_desconto t where t.id = v_id;

    elsif p_tipo = 'pacote' then
        if p_id is null then
            insert into public.pacotes (nome, inicio, fim, preco_centavos, horas, modelo_id, tipo_municao_id, municao_qtd, ativo)
            values (
                p_dados ->> 'nome', (p_dados ->> 'inicio')::date, (p_dados ->> 'fim')::date,
                (p_dados ->> 'preco_centavos')::int, (p_dados ->> 'horas')::int, (p_dados ->> 'modelo_id')::int,
                (p_dados ->> 'tipo_municao_id')::int, (p_dados ->> 'municao_qtd')::int,
                coalesce((p_dados ->> 'ativo')::boolean, true)
            )
            returning id into v_id;
        else
            update public.pacotes set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                inicio = case when p_dados ? 'inicio' then (p_dados ->> 'inicio')::date else inicio end,
                fim = case when p_dados ? 'fim' then (p_dados ->> 'fim')::date else fim end,
                preco_centavos = case when p_dados ? 'preco_centavos' then (p_dados ->> 'preco_centavos')::int else preco_centavos end,
                horas = case when p_dados ? 'horas' then (p_dados ->> 'horas')::int else horas end,
                modelo_id = case when p_dados ? 'modelo_id' then (p_dados ->> 'modelo_id')::int else modelo_id end,
                tipo_municao_id = case when p_dados ? 'tipo_municao_id' then (p_dados ->> 'tipo_municao_id')::int else tipo_municao_id end,
                municao_qtd = case when p_dados ? 'municao_qtd' then (p_dados ->> 'municao_qtd')::int else municao_qtd end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.pacotes t where t.id = v_id;
    end if;

    if v_id is null then
        raise exception 'Promoção não encontrada.' using errcode = 'P0002';
    end if;
    return v_linha;
end;
$$;

-- 6) salvar_cadastro passa a gravar o preço do modelo e da munição (editáveis ao criar e depois).
--    O resto é igual à versão de 20261116001200_cadastros.sql.
create or replace function public.salvar_cadastro(p_tipo text, p_id int, p_dados jsonb, p_autor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_permitidas text[];
    v_chave text;
    v_id int;
    v_linha jsonb;
begin
    perform set_config('app.usuario_id', coalesce(p_autor::text, ''), true);

    -- Chaves aceitas: ao criar, todas as do tipo; ao editar, só as que podem mudar.
    v_permitidas := case p_tipo
        when 'categoria' then array['nome', 'ativo']
        when 'calibre' then array['nome', 'ativo']
        when 'modelo' then case when p_id is null
            then array['categoria_id', 'calibre_id', 'marca', 'nome', 'ativo', 'preco_hora_centavos']
            else array['categoria_id', 'marca', 'nome', 'ativo', 'preco_hora_centavos'] end
        when 'tipo_municao' then case when p_id is null
            then array['calibre_id', 'nome', 'ativo', 'preco_unidade_centavos']
            else array['nome', 'ativo', 'preco_unidade_centavos'] end
        when 'unidade' then case when p_id is null
            then array['modelo_id', 'numero_registro', 'situacao']
            else array['numero_registro', 'situacao'] end
        when 'pista' then case when p_id is null
            then array['numero', 'ativa']
            else array['ativa'] end
    end;
    if v_permitidas is null then
        raise exception 'Tipo de cadastro desconhecido.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_dados) is distinct from 'object' then
        raise exception 'Dados do cadastro inválidos.' using errcode = '22023';
    end if;
    for v_chave in select jsonb_object_keys(p_dados) loop
        if not v_chave = any(v_permitidas) then
            raise exception 'Campo não aceito: %', v_chave using errcode = '22023';
        end if;
    end loop;

    if p_tipo = 'categoria' then
        if p_id is null then
            insert into public.categorias (nome, ativo)
            values (p_dados ->> 'nome', coalesce((p_dados ->> 'ativo')::boolean, true))
            returning id into v_id;
        else
            update public.categorias set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.categorias t where t.id = v_id;

    elsif p_tipo = 'calibre' then
        if p_id is null then
            insert into public.calibres (nome, ativo)
            values (p_dados ->> 'nome', coalesce((p_dados ->> 'ativo')::boolean, true))
            returning id into v_id;
        else
            update public.calibres set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.calibres t where t.id = v_id;

    elsif p_tipo = 'modelo' then
        if p_id is null then
            insert into public.modelos (categoria_id, calibre_id, marca, nome, ativo, preco_hora_centavos)
            values (
                (p_dados ->> 'categoria_id')::int, (p_dados ->> 'calibre_id')::int,
                p_dados ->> 'marca', p_dados ->> 'nome', coalesce((p_dados ->> 'ativo')::boolean, true),
                (p_dados ->> 'preco_hora_centavos')::int
            )
            returning id into v_id;
        else
            update public.modelos set
                categoria_id = case when p_dados ? 'categoria_id' then (p_dados ->> 'categoria_id')::int else categoria_id end,
                marca = case when p_dados ? 'marca' then p_dados ->> 'marca' else marca end,
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end,
                preco_hora_centavos = case when p_dados ? 'preco_hora_centavos' then (p_dados ->> 'preco_hora_centavos')::int else preco_hora_centavos end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.modelos t where t.id = v_id;

    elsif p_tipo = 'tipo_municao' then
        if p_id is null then
            insert into public.tipos_municao (calibre_id, nome, ativo, preco_unidade_centavos)
            values (
                (p_dados ->> 'calibre_id')::int, p_dados ->> 'nome', coalesce((p_dados ->> 'ativo')::boolean, true),
                (p_dados ->> 'preco_unidade_centavos')::int
            )
            returning id into v_id;
        else
            update public.tipos_municao set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end,
                preco_unidade_centavos = case when p_dados ? 'preco_unidade_centavos' then (p_dados ->> 'preco_unidade_centavos')::int else preco_unidade_centavos end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.tipos_municao t where t.id = v_id;

    elsif p_tipo = 'unidade' then
        if p_id is null then
            insert into public.unidades_arma (modelo_id, numero_registro, situacao)
            values (
                (p_dados ->> 'modelo_id')::int, p_dados ->> 'numero_registro',
                coalesce((p_dados ->> 'situacao')::public.situacao_unidade, 'disponivel')
            )
            returning id into v_id;
        else
            update public.unidades_arma set
                numero_registro = case when p_dados ? 'numero_registro' then p_dados ->> 'numero_registro' else numero_registro end,
                situacao = case when p_dados ? 'situacao' then (p_dados ->> 'situacao')::public.situacao_unidade else situacao end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.unidades_arma t where t.id = v_id;

    elsif p_tipo = 'pista' then
        if p_id is null then
            insert into public.pistas (numero, ativa)
            values ((p_dados ->> 'numero')::int, coalesce((p_dados ->> 'ativa')::boolean, true))
            returning id into v_id;
        else
            update public.pistas set
                ativa = case when p_dados ? 'ativa' then (p_dados ->> 'ativa')::boolean else ativa end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.pistas t where t.id = v_id;
    end if;

    if v_id is null then
        raise exception 'Cadastro não encontrado.' using errcode = 'P0002';
    end if;
    return v_linha;
end;
$$;

-- 7) criar_agendamento passa a gravar o preço: p_pedido -> 'preco' (o objeto Preco) em
--    preco_detalhe e o total_centavos em preco_total_centavos. Sem 'preco', ficam vazios.
--    O resto é igual à versão de 20261116001100_pendencias_plano3.sql.
-- Cria o agendamento com tudo o que ele reserva. p_pedido é o PedidoNormalizado da Edge Function
-- (já conferido lá), com a chave_envio e o preco opcionais. Se faltar algum recurso, o erro desfaz tudo:
--   RP001 instrutor escolhido ocupado, RP002 faltam instrutores, RP003 faltam pistas, RP004 falta arma
--   do modelo, RP006 alguém do pedido já tem outro agendamento nesse horário (conferido antes de gravar).
-- Se duas pessoas pegarem o mesmo recurso ao mesmo tempo, as regras de conflito do banco dão o erro 23P01;
-- a mesma chave_envio duas vezes ao mesmo tempo dá 23505.
create or replace function public.criar_agendamento(p_responsavel uuid, p_pedido jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
    v_id uuid;
    v_periodo tstzrange := public.periodo_sessao((p_pedido ->> 'inicio')::timestamptz, (p_pedido ->> 'horas')::int);
    v_escolhido uuid := (p_pedido ->> 'instrutor_id')::uuid;
    v_necessarios int := coalesce((p_pedido ->> 'instrutores_necessarios')::int, 1);
    v_preco jsonb := nullif(p_pedido -> 'preco', 'null'::jsonb);
    v_faltam int;
    v_tem_principal boolean := false;
    v_instrutor uuid;
    v_pista int;
    v_pistas int := 0;
    v_part jsonb;
    v_part_id uuid;
    v_termo int;
    v_unidade int;
    v_unidades int[] := '{}';
begin
    perform set_config('app.usuario_id', coalesce(p_responsavel::text, ''), true);

    if public.cpf_ocupado(
        array(select value ->> 'cpf' from jsonb_array_elements(p_pedido -> 'participantes')),
        v_periodo, null
    ) then
        raise exception 'Uma das pessoas já tem outro agendamento nesse horário.' using errcode = 'RP006';
    end if;

    insert into public.agendamentos
        (responsavel_id, inicio, horas, forma_pagamento, instrutor_escolhido_id, chave_envio, preco_detalhe, preco_total_centavos)
    values (p_responsavel, (p_pedido ->> 'inicio')::timestamptz, (p_pedido ->> 'horas')::int, 'balcao', v_escolhido,
            (p_pedido ->> 'chave_envio')::uuid, v_preco, (v_preco ->> 'total_centavos')::int)
    returning id, periodo into v_id, v_periodo;

    -- Instrutores: o escolhido é o principal; os demais são os livres com menos reservas.
    v_faltam := v_necessarios;
    if v_escolhido is not null then
        if not public.instrutor_livre(v_escolhido, v_periodo, v_id) then
            raise exception 'O instrutor escolhido não está livre nesse horário.' using errcode = 'RP001';
        end if;
        insert into public.agendamento_instrutores (agendamento_id, instrutor_id, principal)
        values (v_id, v_escolhido, true);
        v_tem_principal := true;
        v_faltam := v_faltam - 1;
    end if;
    for v_instrutor in
        select p.usuario_id from public.papeis_usuario p
        where p.papel = 'instrutor' and p.usuario_id is distinct from v_escolhido
          and public.instrutor_livre(p.usuario_id, v_periodo, v_id)
        order by public.carga_instrutor(p.usuario_id), random()
        limit greatest(v_faltam, 0)
    loop
        insert into public.agendamento_instrutores (agendamento_id, instrutor_id, principal)
        values (v_id, v_instrutor, not v_tem_principal);
        v_tem_principal := true;
        v_faltam := v_faltam - 1;
    end loop;
    if v_faltam > 0 then
        raise exception 'Não há instrutores livres nesse horário.' using errcode = 'RP002';
    end if;

    -- Pistas: uma por instrutor, as livres de número menor primeiro.
    for v_pista in
        select id from public.pistas
        where public.pista_livre(id, v_periodo, v_id)
        order by numero
        limit v_necessarios
    loop
        insert into public.agendamento_pistas (agendamento_id, pista_id) values (v_id, v_pista);
        v_pistas := v_pistas + 1;
    end loop;
    if v_pistas < v_necessarios then
        raise exception 'Não há pistas livres nesse horário.' using errcode = 'RP003';
    end if;

    -- Participantes, um item cada e, para quem usa arma do estande, uma unidade livre do modelo.
    for v_part in select value from jsonb_array_elements(p_pedido -> 'participantes')
    loop
        v_termo := (v_part ->> 'termo_versao')::int;
        insert into public.participantes
            (agendamento_id, nome_completo, cpf, data_nascimento, perfil_id, modalidade, termo_versao, aceite_termo_em)
        values (
            v_id, v_part ->> 'nome_completo', v_part ->> 'cpf', (v_part ->> 'data_nascimento')::date,
            (v_part ->> 'perfil_id')::uuid, (v_part ->> 'modalidade')::public.modalidade,
            v_termo, case when v_termo is not null then now() end
        )
        returning id into v_part_id;

        insert into public.itens_participante (participante_id, modelo_id, arma_propria, tipo_municao_id, municao_qtd)
        values (
            v_part_id, (v_part ->> 'modelo_id')::int, nullif(v_part -> 'arma_propria', 'null'::jsonb),
            (v_part ->> 'tipo_municao_id')::int, (v_part ->> 'municao_qtd')::int
        );

        if v_part ->> 'modalidade' = 'estande' then
            select u.id into v_unidade from public.unidades_arma u
            where u.modelo_id = (v_part ->> 'modelo_id')::int
              and u.id <> all (v_unidades)
              and public.unidade_livre(u.id, v_periodo, v_id)
            order by u.id
            limit 1;
            if not found then
                raise exception 'Não há arma livre do modelo escolhido nesse horário.' using errcode = 'RP004';
            end if;
            insert into public.agendamento_unidades (agendamento_id, unidade_id, participante_id)
            values (v_id, v_unidade, v_part_id);
            v_unidades := v_unidades || v_unidade;
        end if;
    end loop;

    return v_id;
end;
$$;

-- 8) alterar_horario_agendamento com o preço novo (p_preco, o objeto Preco recalculado pela Edge
--    Function). p_preco nulo mantém o preço gravado. O resto é igual à versão de
--    20261116001100_pendencias_plano3.sql.
-- Muda o horário. Cada recurso que continua livre no período novo fica; o que não está livre é
-- trocado por outro livre que ainda não esteja neste agendamento:
--   instrutor pelo de menos reservas (RP002 se faltar), pista pela de número menor (RP003),
--   unidade por outra do mesmo modelo (RP004). O instrutor escolhido pelo cliente nunca é
--   trocado: se não atende mais (perfil inativo, login bloqueado ou sem o papel), RP007; se está
--   ocupado, RP001. Agendamento que não está ativo: RP005. Alguém do agendamento já tem outro
--   agendamento no período novo: RP006 (conferido antes de gravar). Qualquer erro desfaz tudo.
-- Cada reserva muda num só update, com o recurso e o período finais juntos: assim o gatilho de
-- interdição confere a pista certa no período certo, e as regras de conflito do banco (que não
-- são "deferrable") nunca veem uma combinação intermediária.
create function public.alterar_horario_agendamento(p_agendamento uuid, p_inicio timestamptz, p_horas int, p_autor uuid, p_preco jsonb)
returns public.agendamentos
language plpgsql security definer set search_path = public as $$
declare
    v_ag public.agendamentos;
    v_periodo tstzrange := public.periodo_sessao(p_inicio, p_horas);
    v_preco jsonb := nullif(p_preco, 'null'::jsonb);
    v_reserva record;
    v_instrutor uuid;
    v_pista int;
    v_unidade int;
begin
    perform set_config('app.usuario_id', coalesce(p_autor::text, ''), true);

    select * into v_ag from public.agendamentos where id = p_agendamento for update;
    if not found then
        raise exception 'Agendamento % não encontrado.', p_agendamento using errcode = 'P0002';
    end if;
    if v_ag.situacao not in ('aguardando_pagamento', 'pago') then
        raise exception 'Este agendamento não pode mais ser alterado.' using errcode = 'RP005';
    end if;

    if public.cpf_ocupado(
        array(select cpf from public.participantes where agendamento_id = p_agendamento),
        v_periodo, p_agendamento
    ) then
        raise exception 'Uma das pessoas já tem outro agendamento nesse horário.' using errcode = 'RP006';
    end if;

    -- Instrutores.
    for v_reserva in
        select id, instrutor_id from public.agendamento_instrutores
        where agendamento_id = p_agendamento and ativo
        order by principal desc, id
    loop
        v_instrutor := v_reserva.instrutor_id;
        if not public.instrutor_livre(v_instrutor, v_periodo, p_agendamento) then
            if v_instrutor = v_ag.instrutor_escolhido_id then
                if not public.instrutor_elegivel(v_instrutor) then
                    raise exception 'O instrutor escolhido não atende mais.' using errcode = 'RP007';
                end if;
                raise exception 'O instrutor escolhido não está livre nesse horário.' using errcode = 'RP001';
            end if;
            select p.usuario_id into v_instrutor from public.papeis_usuario p
            where p.papel = 'instrutor'
              and p.usuario_id not in (
                  select instrutor_id from public.agendamento_instrutores
                  where agendamento_id = p_agendamento and ativo
              )
              and public.instrutor_livre(p.usuario_id, v_periodo, p_agendamento)
            order by public.carga_instrutor(p.usuario_id), random()
            limit 1;
            if not found then
                raise exception 'Não há instrutores livres nesse horário.' using errcode = 'RP002';
            end if;
        end if;
        update public.agendamento_instrutores set instrutor_id = v_instrutor, periodo = v_periodo
        where id = v_reserva.id;
    end loop;

    -- Pistas.
    for v_reserva in
        select id, pista_id from public.agendamento_pistas
        where agendamento_id = p_agendamento and ativo
        order by id
    loop
        v_pista := v_reserva.pista_id;
        if not public.pista_livre(v_pista, v_periodo, p_agendamento) then
            select id into v_pista from public.pistas
            where id not in (
                  select pista_id from public.agendamento_pistas
                  where agendamento_id = p_agendamento and ativo
              )
              and public.pista_livre(id, v_periodo, p_agendamento)
            order by numero
            limit 1;
            if not found then
                raise exception 'Não há pistas livres nesse horário.' using errcode = 'RP003';
            end if;
        end if;
        update public.agendamento_pistas set pista_id = v_pista, periodo = v_periodo
        where id = v_reserva.id;
    end loop;

    -- Unidades (armas do estande). unidade_livre também confere se a unidade continua disponível,
    -- porque o gatilho de disponibilidade só roda quando a reserva é criada.
    for v_reserva in
        select r.id, r.unidade_id, u.modelo_id from public.agendamento_unidades r
        join public.unidades_arma u on u.id = r.unidade_id
        where r.agendamento_id = p_agendamento and r.ativo
        order by r.id
    loop
        v_unidade := v_reserva.unidade_id;
        if not public.unidade_livre(v_unidade, v_periodo, p_agendamento) then
            select u.id into v_unidade from public.unidades_arma u
            where u.modelo_id = v_reserva.modelo_id
              and u.id not in (
                  select unidade_id from public.agendamento_unidades
                  where agendamento_id = p_agendamento and ativo
              )
              and public.unidade_livre(u.id, v_periodo, p_agendamento)
            order by u.id
            limit 1;
            if not found then
                raise exception 'Não há arma livre do modelo escolhido nesse horário.' using errcode = 'RP004';
            end if;
        end if;
        update public.agendamento_unidades set unidade_id = v_unidade, periodo = v_periodo
        where id = v_reserva.id;
    end loop;

    -- As reservas já estão no período novo, então o gatilho sincronizar_recursos não muda nenhuma.
    -- O preço muda junto com o horário (um só registro no histórico); sem p_preco, fica o gravado.
    update public.agendamentos set
        inicio = p_inicio,
        horas = p_horas,
        preco_detalhe = case when v_preco is null then preco_detalhe else v_preco end,
        preco_total_centavos = case when v_preco is null then preco_total_centavos else (v_preco ->> 'total_centavos')::int end
    where id = p_agendamento
    returning * into v_ag;
    return v_ag;
end;
$$;

-- A versão de 4 argumentos fica, por enquanto, só repassando para a nova com p_preco nulo (mantém o
-- preço gravado): a função agendamentos publicada ainda a chama. Sai numa migração da Task 4.
create or replace function public.alterar_horario_agendamento(p_agendamento uuid, p_inicio timestamptz, p_horas int, p_autor uuid)
returns public.agendamentos
language sql security definer set search_path = public as $$
    select * from public.alterar_horario_agendamento(p_agendamento, p_inicio, p_horas, p_autor, null::jsonb);
$$;

-- Bloqueio: repetir no fim de toda migração futura.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.salvar_configuracao(text, jsonb, uuid) to service_role;
grant execute on function public.periodo_sessao(timestamptz, int) to service_role;
grant execute on function public.criar_perfil(uuid, jsonb) to service_role;
grant execute on function public.atualizar_perfil(uuid, jsonb, uuid) to service_role;
grant execute on function public.registrar_tentativa_cadastro(text, int) to service_role;
grant execute on function public.usuario_por_email(text) to service_role;
grant execute on function public.descartar_cadastro_pendente(uuid) to service_role;
grant execute on function public.criar_agendamento(uuid, jsonb) to service_role;
grant execute on function public.alterar_horario_agendamento(uuid, timestamptz, int, uuid) to service_role;
grant execute on function public.alterar_horario_agendamento(uuid, timestamptz, int, uuid, jsonb) to service_role;
grant execute on function public.cancelar_agendamento(uuid, uuid) to service_role;
grant execute on function public.instrutores_ativos() to service_role;
grant execute on function public.salvar_cadastro(text, int, jsonb, uuid) to service_role;
grant execute on function public.reservas_futuras(text, int) to service_role;
grant execute on function public.registrar_acesso(uuid, text, text) to service_role;
grant execute on function public.buscar_pessoas(text) to service_role;
grant execute on function public.definir_papeis(uuid, public.papel[], uuid) to service_role;
grant execute on function public.marcar_conta(uuid, boolean, uuid) to service_role;
grant execute on function public.superadmins_ativos() to service_role;
grant execute on function public.emails_dos_usuarios(uuid[]) to service_role;
grant execute on function public.painel_filtrar(timestamptz, timestamptz, public.situacao_agendamento, uuid, text) to service_role;
grant execute on function public.salvar_promocao(text, int, jsonb, uuid) to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
