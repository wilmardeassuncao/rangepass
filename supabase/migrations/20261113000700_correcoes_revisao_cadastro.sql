-- Correções da revisão final do plano 2.

-- 1) Limite de tentativas de cadastro por endereço de internet (IP), para que ninguém descubra em massa
--    quais CPFs são clientes do estande. O limite fica nas Configurações.
update public.configuracoes
set valor = valor || '{"tentativas_por_hora": 10}'::jsonb
where chave = 'cadastro';

create table public.tentativas_cadastro (
    id bigint generated always as identity primary key,
    ip text not null,
    criado_em timestamptz not null default now()
);
create index tentativas_cadastro_ip_criado_em on public.tentativas_cadastro (ip, criado_em);

-- Registra uma tentativa e diz se ela está dentro do limite da última hora.
-- O IP é dado pessoal: as tentativas com mais de 1 dia são apagadas a cada chamada.
create function public.registrar_tentativa_cadastro(p_ip text, p_limite int)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
    perform pg_advisory_xact_lock(hashtext('tentativas_cadastro:' || p_ip));
    delete from public.tentativas_cadastro where criado_em < now() - interval '1 day';
    if (select count(*) from public.tentativas_cadastro
        where ip = p_ip and criado_em > now() - interval '1 hour') >= p_limite then
        return false;
    end if;
    insert into public.tentativas_cadastro (ip) values (p_ip);
    return true;
end;
$$;

-- 2) Conta pendente (e-mail nunca confirmado) não "reserva" e-mail nem CPF.
create function public.usuario_por_email(p_email text)
returns uuid
language sql security definer set search_path = public as $$
    select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

-- Apaga o perfil e o histórico do perfil de uma conta que nunca confirmou o e-mail e não é da equipe.
-- Devolve true se a conta pode ser descartada (o login é apagado depois, pela Edge Function).
create function public.descartar_cadastro_pendente(p_usuario uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from auth.users where id = p_usuario and email_confirmed_at is null)
        or exists (select 1 from public.papeis_usuario where usuario_id = p_usuario) then
        return false;
    end if;
    delete from public.perfis where id = p_usuario;
    delete from public.historico_alteracoes where tabela = 'perfis' and registro_id = p_usuario::text;
    return true;
end;
$$;

-- Bloqueio: repetir no fim de toda migração futura.
alter table public.tentativas_cadastro enable row level security;
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
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
