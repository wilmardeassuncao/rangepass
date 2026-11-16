-- Pendências do plano 3: instrutores elegíveis vindos do banco, a mesma pessoa em dois horários
-- (RP006), instrutor escolhido que não atende mais (RP007) e a chave de envio que evita
-- agendamento repetido quando o mesmo pedido chega duas vezes.

-- 1) Chave de envio: o navegador manda um uuid por pedido; o mesmo responsável não grava duas vezes
--    a mesma chave. Pode ficar vazia (agendamentos antigos e os feitos pelo estande).
alter table public.agendamentos
    add column chave_envio uuid,
    add constraint agendamentos_responsavel_chave_envio_key unique (responsavel_id, chave_envio);

-- 2) Instrutor elegível: tem o papel, o perfil está ativo e o login não está bloqueado.
--    Função interna (sem grant). Não olha reservas.
create function public.instrutor_elegivel(p_instrutor uuid)
returns boolean
language sql stable set search_path = public as $$
    select exists (select 1 from public.papeis_usuario where usuario_id = p_instrutor and papel = 'instrutor')
       and exists (select 1 from public.perfis where id = p_instrutor and ativo)
       and exists (select 1 from auth.users where id = p_instrutor and (banned_until is null or banned_until <= now()));
$$;

-- Instrutor livre: elegível e sem reserva sobreposta (fora a do agendamento p_ignorar).
create or replace function public.instrutor_livre(p_instrutor uuid, p_periodo tstzrange, p_ignorar uuid)
returns boolean
language sql stable set search_path = public as $$
    select public.instrutor_elegivel(p_instrutor)
       and not exists (
           select 1 from public.agendamento_instrutores r
           where r.instrutor_id = p_instrutor and r.ativo and r.periodo && p_periodo
             and r.agendamento_id is distinct from p_ignorar
       );
$$;

-- Instrutores que o cliente pode escolher, em ordem de nome. A função agendamentos usa esta lista.
create function public.instrutores_ativos()
returns table (id uuid, nome text)
language sql stable security definer set search_path = public as $$
    select p.id, p.nome_completo from public.perfis p
    where public.instrutor_elegivel(p.id)
    order by p.nome_completo, p.id;
$$;

-- 3) A mesma pessoa em dois agendamentos ao mesmo tempo. Verdadeiro se algum dos CPFs já está em
--    outro agendamento ativo (situação diferente de cancelado e não compareceu) com período
--    sobreposto. O agendamento p_ignorar não conta (útil quando ele muda de horário). Interna (sem grant).
create function public.cpf_ocupado(p_cpfs text[], p_periodo tstzrange, p_ignorar uuid)
returns boolean
language sql stable set search_path = public as $$
    select exists (
        select 1 from public.participantes pa
        join public.agendamentos a on a.id = pa.agendamento_id
        where pa.cpf = any (p_cpfs)
          and a.situacao not in ('cancelado', 'nao_compareceu')
          and a.periodo && p_periodo
          and a.id is distinct from p_ignorar
    );
$$;

-- Cria o agendamento com tudo o que ele reserva. p_pedido é o PedidoNormalizado da Edge Function
-- (já conferido lá), com a chave_envio opcional. Se faltar algum recurso, o erro desfaz tudo:
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

    insert into public.agendamentos (responsavel_id, inicio, horas, forma_pagamento, instrutor_escolhido_id, chave_envio)
    values (p_responsavel, (p_pedido ->> 'inicio')::timestamptz, (p_pedido ->> 'horas')::int, 'balcao', v_escolhido,
            (p_pedido ->> 'chave_envio')::uuid)
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
create or replace function public.alterar_horario_agendamento(p_agendamento uuid, p_inicio timestamptz, p_horas int, p_autor uuid)
returns public.agendamentos
language plpgsql security definer set search_path = public as $$
declare
    v_ag public.agendamentos;
    v_periodo tstzrange := public.periodo_sessao(p_inicio, p_horas);
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
    update public.agendamentos set inicio = p_inicio, horas = p_horas
    where id = p_agendamento
    returning * into v_ag;
    return v_ag;
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
grant execute on function public.alterar_horario_agendamento(uuid, timestamptz, int, uuid) to service_role;
grant execute on function public.cancelar_agendamento(uuid, uuid) to service_role;
grant execute on function public.instrutores_ativos() to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
