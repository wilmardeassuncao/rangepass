-- Visão do administrativo (Edge Function painel-agendamentos): e-mails dos responsáveis e
-- autores do histórico, e o filtro da lista de agendamentos.

-- E-mail de cada usuário pedido (os que não existem no Auth ficam de fora).
create function public.emails_dos_usuarios(p_ids uuid[])
returns table (id uuid, email text)
language sql stable security definer set search_path = public as $$
    select u.id, u.email::text from auth.users u where u.id = any (coalesce(p_ids, '{}'));
$$;

-- Agendamentos com início em [p_inicio, p_fim), com os filtros opcionais (nulos = sem filtro):
--   p_situacao: a situação do agendamento;
--   p_instrutor: o instrutor tem (ou teve, se o agendamento foi cancelado) reserva nele;
--   p_busca: o responsável tem o texto no nome ou no e-mail (sem diferenciar maiúsculas; % e _
--            valem como letras comuns) ou, com 3 dígitos ou mais no texto, o CPF começa por eles.
-- A Edge Function ordena, limita e junta as reservas (o resultado é do tipo agendamentos).
create function public.painel_filtrar(
    p_inicio timestamptz, p_fim timestamptz, p_situacao public.situacao_agendamento, p_instrutor uuid, p_busca text
)
returns setof public.agendamentos
language sql stable security definer set search_path = public as $$
    with texto as (
        select btrim(coalesce(p_busca, '')) as t
    ), filtro as (
        select
            case when t <> ''
                then '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            end as padrao,
            case when char_length(regexp_replace(t, '\D', '', 'g')) >= 3
                then regexp_replace(t, '\D', '', 'g')
            end as digitos
        from texto
    )
    select a.*
    from public.agendamentos a
    cross join filtro f
    where a.inicio >= p_inicio and a.inicio < p_fim
      and (p_situacao is null or a.situacao = p_situacao)
      and (p_instrutor is null or exists (
          select 1 from public.agendamento_instrutores r
          where r.agendamento_id = a.id and r.instrutor_id = p_instrutor
      ))
      and (f.padrao is null or exists (
          select 1
          from public.perfis p
          left join auth.users u on u.id = p.id
          where p.id = a.responsavel_id
            and (p.nome_completo ilike f.padrao
                 or coalesce(u.email ilike f.padrao, false)
                 or (f.digitos is not null and p.cpf like f.digitos || '%'))
      ));
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
