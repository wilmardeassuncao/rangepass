-- Plano 4: gestão da equipe pelo superadmin. Procurar pessoas, trocar os papéis delas e
-- desativar ou reativar contas. Toda mudança fica no histórico com o autor, e toda busca por
-- dados pessoais fica registrada em acessos_dados.

-- Quem consultou dados pessoais de outras pessoas, o quê e quando.
create table public.acessos_dados (
    id bigint generated always as identity primary key,
    usuario_id uuid not null,
    recurso text not null,
    registro text,
    em timestamptz not null default now()
);
alter table public.acessos_dados enable row level security;

create function public.registrar_acesso(p_usuario uuid, p_recurso text, p_registro text)
returns void
language sql security definer set search_path = public as $$
    insert into public.acessos_dados (usuario_id, recurso, registro) values (p_usuario, p_recurso, p_registro);
$$;

-- Procura pessoas para a tela da equipe. Com 2 ou mais caracteres, procura no nome e no e-mail
-- (contendo o texto, sem diferenciar maiúsculas) e no CPF (começando pelos dígitos do texto).
-- % e _ no texto valem como letras comuns. Sem busca, devolve só quem tem algum papel além de
-- cliente. No máximo 50 linhas, em ordem de nome (sem nome por último, por e-mail).
-- bloqueado = o login está bloqueado no Supabase Auth.
create function public.buscar_pessoas(p_busca text)
returns table (id uuid, email text, nome_completo text, cpf text, papeis public.papel[], bloqueado boolean)
language sql stable security definer set search_path = public as $$
    with texto as (
        select btrim(coalesce(p_busca, '')) as t
    ), filtro as (
        select
            case when char_length(t) >= 2
                then '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            end as padrao,
            case when char_length(t) >= 2
                then nullif(regexp_replace(t, '\D', '', 'g'), '')
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

-- Troca todos os papéis de uma pessoa de uma vez e devolve a lista nova.
-- A trava impede que duas trocas ao mesmo tempo tirem o último superadmin; depois da troca,
-- confere no banco que ainda existe pelo menos um superadmin (senão RP101 e nada muda).
-- papeis_usuario não tem coluna id, então o histórico é gravado aqui, não pelo gatilho.
create function public.definir_papeis(p_usuario uuid, p_papeis public.papel[], p_autor uuid)
returns public.papel[]
language plpgsql security definer set search_path = public as $$
declare
    v_antes public.papel[];
    v_depois public.papel[];
begin
    perform pg_advisory_xact_lock(hashtext('papeis'));

    select coalesce(array_agg(papel order by papel), '{}') into v_antes
    from public.papeis_usuario where usuario_id = p_usuario;

    delete from public.papeis_usuario where usuario_id = p_usuario;
    insert into public.papeis_usuario (usuario_id, papel)
    select distinct p_usuario, papel from unnest(coalesce(p_papeis, '{}')) as papel;

    if not exists (select 1 from public.papeis_usuario where papel = 'superadmin') then
        raise exception 'O sistema precisa de pelo menos um superadmin.' using errcode = 'RP101';
    end if;

    select coalesce(array_agg(papel order by papel), '{}') into v_depois
    from public.papeis_usuario where usuario_id = p_usuario;

    insert into public.historico_alteracoes (tabela, registro_id, acao, antes, depois, feito_por)
    values ('papeis_usuario', p_usuario::text, 'alteracao', to_jsonb(v_antes), to_jsonb(v_depois), p_autor);

    return v_depois;
end;
$$;

-- Marca a conta como ativa ou desativada no perfil (quando há perfil), com o autor no histórico.
-- O bloqueio do login em si é feito pela Edge Function no Supabase Auth.
create function public.marcar_conta(p_usuario uuid, p_ativa boolean, p_autor uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
    perform set_config('app.usuario_id', coalesce(p_autor::text, ''), true);
    update public.perfis set ativo = p_ativa where id = p_usuario;
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
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
