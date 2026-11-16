-- Plano 4: cadastros do superadmin (catálogo, armas do estande e pistas). Nada é apagado: só
-- se cria, edita ou desativa. Toda mudança fica no histórico com o autor.

-- Categorias, calibres e tipos de munição ainda não tinham histórico.
create trigger historico_categorias after insert or update on public.categorias
    for each row execute function public.registrar_historico();
create trigger historico_calibres after insert or update on public.calibres
    for each row execute function public.registrar_historico();
create trigger historico_tipos_municao after insert or update on public.tipos_municao
    for each row execute function public.registrar_historico();

-- Cria (p_id nulo) ou edita (só as chaves enviadas) um cadastro e devolve a linha.
-- p_dados já vem conferido pela Edge Function (_shared/catalogo.mjs), mas aqui também só entram
-- as chaves de uma lista fixa por tipo; nenhum nome de tabela ou coluna vem do pedido.
-- Erros: 22023 tipo ou chave não aceita; P0002 id inexistente na edição.
create function public.salvar_cadastro(p_tipo text, p_id int, p_dados jsonb, p_autor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_permitidas text[];
    v_chave text;
    v_id int;
    v_linha jsonb;
begin
    perform set_config('app.usuario_id', coalesce(p_autor::text, ''), true);

    -- Chaves aceitas: ao criar, todas as do tipo; ao editar, só as que podem mudar.
    v_permitidas := case p_tipo
        when 'categoria' then array['nome', 'ativo']
        when 'calibre' then array['nome', 'ativo']
        when 'modelo' then case when p_id is null
            then array['categoria_id', 'calibre_id', 'marca', 'nome', 'ativo']
            else array['categoria_id', 'marca', 'nome', 'ativo'] end
        when 'tipo_municao' then case when p_id is null
            then array['calibre_id', 'nome', 'ativo']
            else array['nome', 'ativo'] end
        when 'unidade' then case when p_id is null
            then array['modelo_id', 'numero_registro', 'situacao']
            else array['numero_registro', 'situacao'] end
        when 'pista' then case when p_id is null
            then array['numero', 'ativa']
            else array['ativa'] end
    end;
    if v_permitidas is null then
        raise exception 'Tipo de cadastro desconhecido.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_dados) is distinct from 'object' then
        raise exception 'Dados do cadastro inválidos.' using errcode = '22023';
    end if;
    for v_chave in select jsonb_object_keys(p_dados) loop
        if not v_chave = any(v_permitidas) then
            raise exception 'Campo não aceito: %', v_chave using errcode = '22023';
        end if;
    end loop;

    if p_tipo = 'categoria' then
        if p_id is null then
            insert into public.categorias (nome, ativo)
            values (p_dados ->> 'nome', coalesce((p_dados ->> 'ativo')::boolean, true))
            returning id into v_id;
        else
            update public.categorias set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.categorias t where t.id = v_id;

    elsif p_tipo = 'calibre' then
        if p_id is null then
            insert into public.calibres (nome, ativo)
            values (p_dados ->> 'nome', coalesce((p_dados ->> 'ativo')::boolean, true))
            returning id into v_id;
        else
            update public.calibres set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.calibres t where t.id = v_id;

    elsif p_tipo = 'modelo' then
        if p_id is null then
            insert into public.modelos (categoria_id, calibre_id, marca, nome, ativo)
            values (
                (p_dados ->> 'categoria_id')::int, (p_dados ->> 'calibre_id')::int,
                p_dados ->> 'marca', p_dados ->> 'nome', coalesce((p_dados ->> 'ativo')::boolean, true)
            )
            returning id into v_id;
        else
            update public.modelos set
                categoria_id = case when p_dados ? 'categoria_id' then (p_dados ->> 'categoria_id')::int else categoria_id end,
                marca = case when p_dados ? 'marca' then p_dados ->> 'marca' else marca end,
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.modelos t where t.id = v_id;

    elsif p_tipo = 'tipo_municao' then
        if p_id is null then
            insert into public.tipos_municao (calibre_id, nome, ativo)
            values ((p_dados ->> 'calibre_id')::int, p_dados ->> 'nome', coalesce((p_dados ->> 'ativo')::boolean, true))
            returning id into v_id;
        else
            update public.tipos_municao set
                nome = case when p_dados ? 'nome' then p_dados ->> 'nome' else nome end,
                ativo = case when p_dados ? 'ativo' then (p_dados ->> 'ativo')::boolean else ativo end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.tipos_municao t where t.id = v_id;

    elsif p_tipo = 'unidade' then
        if p_id is null then
            insert into public.unidades_arma (modelo_id, numero_registro, situacao)
            values (
                (p_dados ->> 'modelo_id')::int, p_dados ->> 'numero_registro',
                coalesce((p_dados ->> 'situacao')::public.situacao_unidade, 'disponivel')
            )
            returning id into v_id;
        else
            update public.unidades_arma set
                numero_registro = case when p_dados ? 'numero_registro' then p_dados ->> 'numero_registro' else numero_registro end,
                situacao = case when p_dados ? 'situacao' then (p_dados ->> 'situacao')::public.situacao_unidade else situacao end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.unidades_arma t where t.id = v_id;

    elsif p_tipo = 'pista' then
        if p_id is null then
            insert into public.pistas (numero, ativa)
            values ((p_dados ->> 'numero')::int, coalesce((p_dados ->> 'ativa')::boolean, true))
            returning id into v_id;
        else
            update public.pistas set
                ativa = case when p_dados ? 'ativa' then (p_dados ->> 'ativa')::boolean else ativa end
            where id = p_id
            returning id into v_id;
        end if;
        select to_jsonb(t) into v_linha from public.pistas t where t.id = v_id;
    end if;

    if v_id is null then
        raise exception 'Cadastro não encontrado.' using errcode = 'P0002';
    end if;
    return v_linha;
end;
$$;

-- Quantas reservas ativas de uma arma do estande ou de uma pista ainda não terminaram.
-- Serve para avisar o superadmin ao desativar; os agendamentos continuam como estão.
create function public.reservas_futuras(p_tipo text, p_id int)
returns int
language sql stable security definer set search_path = public as $$
    select case p_tipo
        when 'unidade' then (
            select count(*)::int from public.agendamento_unidades
            where unidade_id = p_id and ativo and upper(periodo) > now()
        )
        when 'pista' then (
            select count(*)::int from public.agendamento_pistas
            where pista_id = p_id and ativo and upper(periodo) > now()
        )
        else 0
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
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
