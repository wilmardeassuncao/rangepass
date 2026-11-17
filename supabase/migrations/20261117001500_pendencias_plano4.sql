-- Pendências do plano 4:
-- 1. A busca da equipe só procura no CPF com 3 ou mais dígitos (com 1 ou 2 dígitos, quase todo
--    CPF começaria igual e a busca devolveria gente demais).
-- 2. definir_papeis não grava histórico quando a lista nova é igual à antiga (nada mudou).

-- Igual à versão do plano 4, mas o CPF só entra na busca quando o texto tem 3 ou mais dígitos.
create or replace function public.buscar_pessoas(p_busca text)
returns table (id uuid, email text, nome_completo text, cpf text, papeis public.papel[], bloqueado boolean)
language sql stable security definer set search_path = public as $$
    with texto as (
        select btrim(coalesce(p_busca, '')) as t
    ), filtro as (
        select
            case when char_length(t) >= 2
                then '%' || replace(replace(replace(t, '\', '\'), '%', '\%'), '_', '\_') || '%'
            end as padrao,
            case when char_length(t) >= 2 and char_length(regexp_replace(t, '\D', '', 'g')) >= 3
                then regexp_replace(t, '\D', '', 'g')
            end as digitos
        from texto
    )
    select
        u.id,
        u.email::text,
        p.nome_completo,
        p.cpf,
        coalesce(
            (select array_agg(pu.papel order by pu.papel) from public.papeis_usuario pu where pu.usuario_id = u.id),
            '{}'::public.papel[]
        ),
        coalesce(u.banned_until > now(), false)
    from auth.users u
    left join public.perfis p on p.id = u.id
    cross join filtro f
    where case
        when f.padrao is null then exists (
            select 1 from public.papeis_usuario pu where pu.usuario_id = u.id and pu.papel <> 'cliente'
        )
        else coalesce(p.nome_completo ilike f.padrao, false)
            or coalesce(u.email ilike f.padrao, false)
            or (f.digitos is not null and coalesce(p.cpf like f.digitos || '%', false))
    end
    order by p.nome_completo nulls last, u.email
    limit 50;
$$;

-- Igual à versão de equipe_correcoes, mas só grava histórico quando os papéis mudaram de fato.
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

    if v_depois is distinct from v_antes then
        insert into public.historico_alteracoes (tabela, registro_id, acao, antes, depois, feito_por)
        values ('papeis_usuario', p_usuario::text, 'alteracao', to_jsonb(v_antes), to_jsonb(v_depois), p_autor);
    end if;

    return v_depois;
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
grant execute on function public.emails_dos_usuarios(uuid[]) to service_role;
grant execute on function public.painel_filtrar(timestamptz, timestamptz, public.situacao_agendamento, uuid, text) to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
