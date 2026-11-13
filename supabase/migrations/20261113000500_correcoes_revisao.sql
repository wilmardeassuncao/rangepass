-- Correções da revisão final do plano 1.

-- 1) Mudar só a situação de um agendamento (pago, check-in, concluído...) não reconfere a pista.
--    A conferência de interdição e de pista desativada só roda quando a reserva é nova, quando
--    o horário ou a pista mudam, ou quando um agendamento cancelado volta a ficar ativo.
create or replace function public.pista_nao_interditada() returns trigger
language plpgsql set search_path = public as $$
declare
    p public.pistas;
begin
    if not NEW.ativo then
        return NEW;
    end if;
    if TG_OP = 'UPDATE' and OLD.ativo
        and NEW.periodo = OLD.periodo and NEW.pista_id = OLD.pista_id then
        return NEW;
    end if;
    select * into p from public.pistas where id = NEW.pista_id;
    if not p.ativa then
        raise exception 'A pista % está desativada.', p.numero using errcode = 'P0001';
    end if;
    if exists (
        select 1 from public.interdicoes i
        where i.pista_id = NEW.pista_id and i.ativa and i.periodo && NEW.periodo
    ) then
        raise exception 'A pista % está interditada nesse horário.', p.numero using errcode = 'P0001';
    end if;
    return NEW;
end;
$$;

-- 2) Funções criadas no futuro já nascem sem permissão pública de execução, mesmo que uma
--    migração esqueça o bloco de bloqueio. Sem "in schema": o REVOKE por schema não remove
--    a permissão global que o Postgres dá a PUBLIC.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Bloqueio: repetir no fim de toda migração futura.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.salvar_configuracao(text, jsonb, uuid) to service_role;
grant execute on function public.periodo_sessao(timestamptz, int) to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
