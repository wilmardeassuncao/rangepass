-- Plano 8A, Task 1: a base do check-in na Recepção do estande.
-- Classes de desconto com um percentual por parte do preço, custo de compra da munição, os pagamentos
-- feitos no balcão e a função fazer_check_in, que grava o pagamento e muda a situação numa transação só.
-- Dinheiro é sempre um inteiro de centavos.

-- 1) Classes de desconto: um percentual para cada parte do preço que o estande controla (pista,
--    aluguel de armas e munição), de 0 a 90, com pelo menos um maior que 0. Cada classe existente
--    recebe o percentual antigo nas três partes; depois a coluna antiga sai.
alter table public.classes_desconto
    add column percentual_pista int,
    add column percentual_aluguel int,
    add column percentual_municao int;

update public.classes_desconto set
    percentual_pista = percentual,
    percentual_aluguel = percentual,
    percentual_municao = percentual;

alter table public.classes_desconto
    alter column percentual_pista set not null,
    alter column percentual_aluguel set not null,
    alter column percentual_municao set not null,
    add constraint classes_desconto_percentual_pista_check check (percentual_pista between 0 and 90),
    add constraint classes_desconto_percentual_aluguel_check check (percentual_aluguel between 0 and 90),
    add constraint classes_desconto_percentual_municao_check check (percentual_municao between 0 and 90),
    add constraint classes_desconto_algum_percentual check (percentual_pista + percentual_aluguel + percentual_municao > 0),
    drop column percentual;

-- 2) Custo de compra da munição (centavos por unidade). Vazio = sem custo (o desconto não tem limite).
alter table public.tipos_municao
    add column custo_compra_centavos int check (custo_compra_centavos > 0);

-- 3) Pagamentos feitos no balcão, no check-in. Um por agendamento.
--    conta: a conta do desconto de classe por parte (percentuais, valores antes e depois e se o limite
--    do custo da munição agiu), montada pela Edge Function (_shared/precos.mjs).
--    Com classe, o documento conferido é obrigatório (1 a 60 caracteres); sem classe, fica vazio.
create type public.forma_pagamento_balcao as enum ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito');

create table public.pagamentos (
    id bigint generated always as identity primary key,
    agendamento_id uuid not null unique references public.agendamentos,
    valor_centavos int not null check (valor_centavos >= 0),
    forma public.forma_pagamento_balcao not null,
    classe_id int references public.classes_desconto,
    documento text check (char_length(btrim(documento)) between 1 and 60),
    conta jsonb,
    desconto_centavos int not null default 0 check (desconto_centavos >= 0),
    registrado_por uuid not null,
    registrado_em timestamptz not null default now(),
    check ((classe_id is null) = (documento is null))
);

create trigger historico_pagamentos after insert or update on public.pagamentos
    for each row execute function public.registrar_historico();

alter table public.pagamentos enable row level security;

-- 4) Check-in de um agendamento. p_pagamento é o pagamento do balcão, já conferido pela Edge Function:
--    { valor_centavos, forma, classe_id, documento, conta, desconto_centavos }. Agendamento pago pelo
--    app faz o check-in sem pagamento (p_pagamento nulo). A regra "só a sessão de hoje" fica na Edge
--    Function, que sabe o fuso do estande. Qualquer erro desfaz tudo.
-- Erros: P0002 agendamento inexistente; P0001 situação que não permite o check-in;
--        23514 classe sem documento (ou documento sem classe) e valores fora das regras.
create function public.fazer_check_in(p_agendamento uuid, p_pagamento jsonb, p_autor uuid)
returns public.agendamentos
language plpgsql security definer set search_path = public as $$
declare
    v_ag public.agendamentos;
    v_pagamento jsonb := nullif(p_pagamento, 'null'::jsonb);
begin
    perform set_config('app.usuario_id', coalesce(p_autor::text, ''), true);

    select * into v_ag from public.agendamentos where id = p_agendamento for update;
    if not found then
        raise exception 'Não encontramos este agendamento.' using errcode = 'P0002';
    end if;

    if v_ag.situacao in ('check_in', 'concluido') then
        raise exception 'O check-in deste agendamento já foi feito.' using errcode = 'P0001';
    elsif v_ag.situacao = 'cancelado' then
        raise exception 'Este agendamento foi cancelado.' using errcode = 'P0001';
    elsif v_ag.situacao = 'nao_compareceu' then
        raise exception 'Este agendamento foi marcado como não compareceu.' using errcode = 'P0001';
    elsif v_ag.situacao = 'aguardando_pagamento' and v_pagamento is null then
        raise exception 'Registre o pagamento para fazer o check-in.' using errcode = 'P0001';
    elsif v_ag.situacao = 'pago' and v_pagamento is not null then
        raise exception 'Este agendamento já foi pago pelo app.' using errcode = 'P0001';
    end if;

    if v_pagamento is not null then
        insert into public.pagamentos
            (agendamento_id, valor_centavos, forma, classe_id, documento, conta, desconto_centavos, registrado_por)
        values (
            p_agendamento, (v_pagamento ->> 'valor_centavos')::int,
            (v_pagamento ->> 'forma')::public.forma_pagamento_balcao,
            (v_pagamento ->> 'classe_id')::int, v_pagamento ->> 'documento',
            nullif(v_pagamento -> 'conta', 'null'::jsonb),
            coalesce((v_pagamento ->> 'desconto_centavos')::int, 0), p_autor
        );
    end if;

    update public.agendamentos set situacao = 'check_in'
    where id = p_agendamento
    returning * into v_ag;
    return v_ag;
end;
$$;

-- 5) salvar_promocao com os três percentuais da classe no lugar do percentual único.
--    O resto é igual à versão de 20261117001600_precos.sql.
-- Cria (p_id nulo) ou edita (só as chaves enviadas) uma promoção e devolve a linha.
-- Como salvar_cadastro: p_dados já vem conferido pela Edge Function (_shared/precos.mjs), mas aqui
-- só entram as chaves de uma lista fixa por tipo; nenhum nome de tabela ou coluna vem do pedido.
-- Erros: 22023 tipo ou chave não aceita; P0002 id inexistente na edição; 23514 valor fora das regras.
create or replace function public.salvar_promocao(p_tipo text, p_id int, p_dados jsonb, p_autor uuid)
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
        when 'classe' then array['nome', 'percentual_pista', 'percentual_aluguel', 'percentual_municao', 'ativo']
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
            insert into public.classes_desconto (nome, percentual_pista, percentual_aluguel, percentual_municao, ativo)
            values (
                p_dados ->> 'nome', (p_dados ->> 'percentual_pista')::int, (p_dados ->> 'percentual_aluguel')::int,
                (p_dados ->> 'percentual_municao')::int, coalesce((p_dados ->> 'ativo')::boolean, true)
            )
            returning id into v_id;
        else
            update public.classes_desconto set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                percentual_pista = case when p_dados ? 'percentual_pista' then (p_dados ->> 'percentual_pista')::int else percentual_pista end,
                percentual_aluguel = case when p_dados ? 'percentual_aluguel' then (p_dados ->> 'percentual_aluguel')::int else percentual_aluguel end,
                percentual_municao = case when p_dados ? 'percentual_municao' then (p_dados ->> 'percentual_municao')::int else percentual_municao end,
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

-- 6) salvar_cadastro passa a gravar o custo de compra da munição (editável ao criar e depois).
--    O resto é igual à versão de 20261117001600_precos.sql.
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
            then array['calibre_id', 'nome', 'ativo', 'preco_unidade_centavos', 'custo_compra_centavos']
            else array['nome', 'ativo', 'preco_unidade_centavos', 'custo_compra_centavos'] end
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
            insert into public.tipos_municao (calibre_id, nome, ativo, preco_unidade_centavos, custo_compra_centavos)
            values (
                (p_dados ->> 'calibre_id')::int, p_dados ->> 'nome', coalesce((p_dados ->> 'ativo')::boolean, true),
                (p_dados ->> 'preco_unidade_centavos')::int, (p_dados ->> 'custo_compra_centavos')::int
            )
            returning id into v_id;
        else
            update public.tipos_municao set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end,
                preco_unidade_centavos = case when p_dados ? 'preco_unidade_centavos' then (p_dados ->> 'preco_unidade_centavos')::int else preco_unidade_centavos end,
                custo_compra_centavos = case when p_dados ? 'custo_compra_centavos' then (p_dados ->> 'custo_compra_centavos')::int else custo_compra_centavos end
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
grant execute on function public.vagas_por_hora(timestamptz[], uuid) to service_role;
grant execute on function public.fazer_check_in(uuid, jsonb, uuid) to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
