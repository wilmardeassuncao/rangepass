-- Plano 6, Task 1: pistas e instrutores livres em cada hora, para a agenda visual.
-- Cada linha é uma hora [inicio, inicio + 1h). Os arrays vêm em ordem crescente e nunca são nulos.
-- As reservas do agendamento p_ignorar não contam (útil quando um agendamento muda de horário).
create function public.vagas_por_hora(p_inicios timestamptz[], p_ignorar uuid)
returns table (inicio timestamptz, pistas int[], instrutores uuid[])
language sql stable security definer set search_path = public as $$
    select h.inicio,
           coalesce((select array_agg(p.id order by p.id) from public.pistas p
                     where public.pista_livre(p.id, public.periodo_sessao(h.inicio, 1), p_ignorar)), '{}'::int[]),
           coalesce((select array_agg(i.id order by i.id) from public.instrutores_ativos() i
                     where public.instrutor_livre(i.id, public.periodo_sessao(h.inicio, 1), p_ignorar)), '{}'::uuid[])
    from unnest(p_inicios) as h(inicio)
    order by h.inicio;
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
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
