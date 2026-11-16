-- Plano 3: agendar de verdade. Termo de responsabilidade de quem traz arma própria e a RPC
-- criar_agendamento, que escolhe instrutores, pistas e armas livres dentro de uma única transação.

-- Pode ficar vazio: o cliente pode não ter preferência de instrutor.
alter table public.agendamentos
    add column instrutor_escolhido_id uuid references public.perfis;

-- Pode ficar vazio: quem usa só as armas do estande não aceita o termo.
alter table public.participantes
    add column termo_versao int;

insert into public.configuracoes (chave, valor) values
('termo', jsonb_build_object('versao', 1, 'texto',
'Termo de responsabilidade para quem traz arma própria.

Ao trazer a minha própria arma para a sessão, declaro que:

- a arma é legal e está registrada, com a documentação em dia;
- sou responsável pelo transporte da arma até o estande e na volta, de acordo com a lei;
- sou responsável pelo uso seguro da arma durante toda a sessão;
- sigo as instruções do instrutor e as regras do estande.

Texto provisório: deve ser revisado por um advogado antes do uso com clientes reais.'));

-- Funções internas (sem grant): só a RPC criar_agendamento as usa. Cada uma ignora as reservas
-- do agendamento p_ignorar (útil quando um agendamento muda de horário). Reserva ativa = ativo = true.

-- Instrutor livre: tem o papel, o perfil está ativo, o login não está bloqueado e não há reserva sobreposta.
create function public.instrutor_livre(p_instrutor uuid, p_periodo tstzrange, p_ignorar uuid)
returns boolean
language sql stable set search_path = public as $$
    select exists (select 1 from public.papeis_usuario where usuario_id = p_instrutor and papel = 'instrutor')
       and exists (select 1 from public.perfis where id = p_instrutor and ativo)
       and exists (select 1 from auth.users where id = p_instrutor and (banned_until is null or banned_until <= now()))
       and not exists (
           select 1 from public.agendamento_instrutores r
           where r.instrutor_id = p_instrutor and r.ativo and r.periodo && p_periodo
             and r.agendamento_id is distinct from p_ignorar
       );
$$;

-- Pista livre: ativa, sem interdição ativa sobreposta e sem reserva sobreposta.
create function public.pista_livre(p_pista int, p_periodo tstzrange, p_ignorar uuid)
returns boolean
language sql stable set search_path = public as $$
    select exists (select 1 from public.pistas where id = p_pista and ativa)
       and not exists (
           select 1 from public.interdicoes i
           where i.pista_id = p_pista and i.ativa and i.periodo && p_periodo
       )
       and not exists (
           select 1 from public.agendamento_pistas r
           where r.pista_id = p_pista and r.ativo and r.periodo && p_periodo
             and r.agendamento_id is distinct from p_ignorar
       );
$$;

-- Unidade (arma física do estande) livre: disponível e sem reserva sobreposta.
create function public.unidade_livre(p_unidade int, p_periodo tstzrange, p_ignorar uuid)
returns boolean
language sql stable set search_path = public as $$
    select exists (select 1 from public.unidades_arma where id = p_unidade and situacao = 'disponivel')
       and not exists (
           select 1 from public.agendamento_unidades r
           where r.unidade_id = p_unidade and r.ativo and r.periodo && p_periodo
             and r.agendamento_id is distinct from p_ignorar
       );
$$;

-- Quantas reservas ativas o instrutor tem que ainda não terminaram. Serve para dividir o trabalho.
create function public.carga_instrutor(p_instrutor uuid)
returns int
language sql stable set search_path = public as $$
    select count(*)::int from public.agendamento_instrutores
    where instrutor_id = p_instrutor and ativo and upper(periodo) > now();
$$;

-- Cria o agendamento com tudo o que ele reserva. p_pedido é o PedidoNormalizado da Edge Function
-- (já conferido lá). Se faltar algum recurso, o erro desfaz tudo:
--   RP001 instrutor escolhido ocupado, RP002 faltam instrutores, RP003 faltam pistas, RP004 falta arma do modelo.
-- Se duas pessoas pegarem o mesmo recurso ao mesmo tempo, as regras de conflito do banco dão o erro 23P01.
create function public.criar_agendamento(p_responsavel uuid, p_pedido jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
    v_id uuid;
    v_periodo tstzrange;
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

    insert into public.agendamentos (responsavel_id, inicio, horas, forma_pagamento, instrutor_escolhido_id)
    values (p_responsavel, (p_pedido ->> 'inicio')::timestamptz, (p_pedido ->> 'horas')::int, 'balcao', v_escolhido)
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
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
