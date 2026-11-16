-- Plano 3: alterar o horário e cancelar um agendamento. Quem pode fazer isso (dono, situação)
-- é conferido na Edge Function; aqui só fica o que precisa acontecer dentro de uma transação.

-- Muda o horário. Cada recurso que continua livre no período novo fica; o que não está livre é
-- trocado por outro livre que ainda não esteja neste agendamento:
--   instrutor pelo de menos reservas (RP002 se faltar), pista pela de número menor (RP003),
--   unidade por outra do mesmo modelo (RP004). O instrutor escolhido pelo cliente nunca é
--   trocado: se não estiver livre, RP001. Qualquer erro desfaz tudo.
-- Cada reserva muda num só update, com o recurso e o período finais juntos: assim o gatilho de
-- interdição confere a pista certa no período certo, e as regras de conflito do banco (que não
-- são "deferrable") nunca veem uma combinação intermediária.
create function public.alterar_horario_agendamento(p_agendamento uuid, p_inicio timestamptz, p_horas int, p_autor uuid)
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

    -- Instrutores.
    for v_reserva in
        select id, instrutor_id from public.agendamento_instrutores
        where agendamento_id = p_agendamento and ativo
        order by principal desc, id
    loop
        v_instrutor := v_reserva.instrutor_id;
        if not public.instrutor_livre(v_instrutor, v_periodo, p_agendamento) then
            if v_instrutor = v_ag.instrutor_escolhido_id then
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

    -- O gatilho sincronizar_recursos copia o mesmo período de novo para as reservas (sem mudar nada).
    update public.agendamentos set inicio = p_inicio, horas = p_horas
    where id = p_agendamento
    returning * into v_ag;
    return v_ag;
end;
$$;

-- Cancela. O gatilho sincronizar_recursos desativa as reservas, liberando os recursos.
create function public.cancelar_agendamento(p_agendamento uuid, p_autor uuid)
returns public.agendamentos
language plpgsql security definer set search_path = public as $$
declare
    v_ag public.agendamentos;
begin
    perform set_config('app.usuario_id', coalesce(p_autor::text, ''), true);
    update public.agendamentos set situacao = 'cancelado'
    where id = p_agendamento
    returning * into v_ag;
    if not found then
        raise exception 'Agendamento % não encontrado.', p_agendamento using errcode = 'P0002';
    end if;
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
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
