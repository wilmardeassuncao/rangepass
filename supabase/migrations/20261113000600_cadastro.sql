-- Cadastro do cliente: aceite da política de privacidade e gravação do perfil com o autor no histórico.

-- Podem ficar vazios: a equipe cadastrada pelo superadmin pode não ter passado pelo aceite.
alter table public.perfis
    add column politica_versao int,
    add column politica_aceita_em timestamptz;

insert into public.configuracoes (chave, valor) values
('privacidade', jsonb_build_object('versao', 1, 'texto',
'Política de privacidade do estande.

Para usar o app, guardamos o seu nome completo, CPF, telefone, data de nascimento, e-mail e, se você informar, o seu CR e o órgão expedidor. Também guardamos os seus agendamentos, as armas e a munição usadas em cada sessão.

Usamos esses dados só para operar o estande (agendar, atender e cobrar) e para cumprir as obrigações legais do tiro desportivo, que exigem manter o registro de quem atirou, quando, com qual arma e quanta munição usou.

Você vê apenas os seus próprios dados, e a equipe vê apenas o que a função de cada um exige. Registramos quem acessa e altera os seus dados.

Você pode pedir, no atendimento do estande, para ver, corrigir ou excluir os seus dados. A exclusão é feita por anonimização: apagamos os seus dados pessoais e mantemos, sem identificar você, apenas os registros que a lei obriga a guardar.

Texto provisório: deve ser revisado por um advogado antes do uso com clientes reais.'));

-- Cria o perfil de um usuário. O autor no histórico é o próprio usuário. CPF repetido gera o erro 23505.
create function public.criar_perfil(p_usuario uuid, p_dados jsonb)
returns public.perfis
language plpgsql security definer set search_path = public as $$
declare
    resultado public.perfis;
begin
    perform set_config('app.usuario_id', coalesce(p_usuario::text, ''), true);
    insert into public.perfis (id, nome_completo, cpf, telefone, data_nascimento, cr, orgao_expedidor, politica_versao, politica_aceita_em)
    select p_usuario, d.nome_completo, d.cpf, d.telefone, d.data_nascimento, d.cr, d.orgao_expedidor, d.politica_versao, d.politica_aceita_em
    from jsonb_populate_record(null::public.perfis, p_dados) d
    returning * into resultado;
    return resultado;
end;
$$;

-- Muda só os campos editáveis que vierem em p_dados (null apaga o CR ou o órgão). Devolve null se o perfil não existir.
create function public.atualizar_perfil(p_usuario uuid, p_dados jsonb, p_autor uuid)
returns public.perfis
language plpgsql security definer set search_path = public as $$
declare
    resultado public.perfis;
begin
    perform set_config('app.usuario_id', coalesce(p_autor::text, ''), true);
    update public.perfis set
        nome_completo = case when p_dados ? 'nome_completo' then p_dados ->> 'nome_completo' else nome_completo end,
        telefone = case when p_dados ? 'telefone' then p_dados ->> 'telefone' else telefone end,
        cr = case when p_dados ? 'cr' then p_dados ->> 'cr' else cr end,
        orgao_expedidor = case when p_dados ? 'orgao_expedidor' then p_dados ->> 'orgao_expedidor' else orgao_expedidor end
    where id = p_usuario
    returning * into resultado;
    return resultado;
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
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
