-- Correções da revisão da gestão da equipe:
-- 1. "Pelo menos um superadmin" passa a contar só quem consegue entrar: tem o papel, o login não
--    está bloqueado no Auth e o perfil (quando existe) está ativo. Desativar uma conta também
--    passa pela mesma trava e pela mesma conferência, para que duas ações ao mesmo tempo não
--    deixem o sistema sem nenhum superadmin que consiga entrar.
-- 2. Desativar ou reativar quem não tem perfil passa a deixar histórico (tabela = 'contas').

-- Superadmins que conseguem entrar agora.
create function public.superadmins_ativos()
returns table (usuario_id uuid)
language sql stable security definer set search_path = public as $$
    select pu.usuario_id
    from public.papeis_usuario pu
    join auth.users u on u.id = pu.usuario_id
    left join public.perfis p on p.id = pu.usuario_id
    where pu.papel = 'superadmin'
      and (u.banned_until is null or u.banned_until <= now())
      and (p.id is null or p.ativo);
$$;

-- Igual à versão anterior, mas o RP101 só conta superadmins que conseguem entrar, e só é
-- levantado quando esta troca tira o papel do último deles (uma troca de papéis de outra pessoa
-- não é barrada só porque o banco já está sem superadmin ativo).
create or replace function public.definir_papeis(p_usuario uuid, p_papeis public.papel[], p_autor uuid)
returns public.papel[]
language plpgsql security definer set search_path = public as $$
declare
    v_antes public.papel[];
    v_depois public.papel[];
    v_era_ativo boolean;
begin
    perform pg_advisory_xact_lock(hashtext('papeis'));

    select coalesce(array_agg(papel order by papel), '{}') into v_antes
    from public.papeis_usuario where usuario_id = p_usuario;
    v_era_ativo := exists (select 1 from public.superadmins_ativos() s where s.usuario_id = p_usuario);

    delete from public.papeis_usuario where usuario_id = p_usuario;
    insert into public.papeis_usuario (usuario_id, papel)
    select distinct p_usuario, papel from unnest(coalesce(p_papeis, '{}')) as papel;

    if v_era_ativo and not exists (select 1 from public.superadmins_ativos()) then
        raise exception 'O sistema precisa de pelo menos um superadmin.' using errcode = 'RP101';
    end if;

    select coalesce(array_agg(papel order by papel), '{}') into v_depois
    from public.papeis_usuario where usuario_id = p_usuario;

    insert into public.historico_alteracoes (tabela, registro_id, acao, antes, depois, feito_por)
    values ('papeis_usuario', p_usuario::text, 'alteracao', to_jsonb(v_antes), to_jsonb(v_depois), p_autor);

    return v_depois;
end;
$$;

-- Marca a conta como ativa ou desativada, com o autor no histórico. Com perfil, muda perfis.ativo
-- (o gatilho grava o histórico); sem perfil, grava uma linha 'contas' no histórico.
-- Ao desativar, pega a mesma trava de definir_papeis e recusa (RP101) se a pessoa é o último
-- superadmin que consegue entrar. A Edge Function chama esta função ANTES de bloquear o login.
create or replace function public.marcar_conta(p_usuario uuid, p_ativa boolean, p_autor uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
    perform pg_advisory_xact_lock(hashtext('papeis'));
    perform set_config('app.usuario_id', coalesce(p_autor::text, ''), true);

    if not p_ativa
       and exists (select 1 from public.superadmins_ativos() s where s.usuario_id = p_usuario)
       and not exists (select 1 from public.superadmins_ativos() s where s.usuario_id <> p_usuario) then
        raise exception 'O sistema precisa de pelo menos um superadmin.' using errcode = 'RP101';
    end if;

    update public.perfis set ativo = p_ativa where id = p_usuario;
    if not found then
        insert into public.historico_alteracoes (tabela, registro_id, acao, antes, depois, feito_por)
        values (
            'contas', p_usuario::text, 'alteracao',
            jsonb_build_object('ativo', not p_ativa), jsonb_build_object('ativo', p_ativa), p_autor
        );
    end if;
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
grant execute on function public.salvar_cadastro(text, int, jsonb, uuid) to service_role;
grant execute on function public.reservas_futuras(text, int) to service_role;
grant execute on function public.registrar_acesso(uuid, text, text) to service_role;
grant execute on function public.buscar_pessoas(text) to service_role;
grant execute on function public.definir_papeis(uuid, public.papel[], uuid) to service_role;
grant execute on function public.marcar_conta(uuid, boolean, uuid) to service_role;
grant execute on function public.superadmins_ativos() to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
