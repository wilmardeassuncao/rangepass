// tests/integracao/rp101-sql.test.mjs
// O último superadmin que consegue entrar não pode perder o papel nem ser desativado (RP101),
// conferido sem gravar nada nas contas reais do banco.
//
// Como: um bloco SQL roda pela Management API do Supabase. Dentro dele, todos os outros
// superadmins (inclusive contas reais) ficam inutilizáveis e o superadmin de teste A vira o último.
// O bloco confere o RP101 e termina SEMPRE com o erro OK_SENTINELA: um erro desfaz tudo o que o
// bloco fez, então nenhuma conta real muda de verdade. Depois, o teste confere que os superadmins
// de antes continuam ativos.
//
// Precisa de SUPABASE_ACCESS_TOKEN no .env.teste (veja o README). Sem ele, o teste é pulado.
import test, { after } from 'node:test';
import assert from 'node:assert';
import { URL, rest, rpc, criarUsuario, usuarioDoAuth, apagarTudoCriado } from './apoio.mjs';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const REF = new globalThis.URL(URL).hostname.split('.')[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

after(apagarTudoCriado);

async function rodarSql(query) {
    const resposta = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    return { status: resposta.status, texto: await resposta.text() };
}

// Bloco que só termina em erro: OK_SENTINELA quando tudo deu certo, FALHA: ... quando não.
function blocoRp101(idA) {
    if (!UUID.test(idA)) throw new Error(`id inválido: ${idA}`);
    return `
do $$
declare
    v_a uuid := '${idA}';
    v_recusou boolean;
begin
    if not exists (select 1 from public.superadmins_ativos() s where s.usuario_id = v_a) then
        raise exception 'FALHA: o superadmin de teste não está ativo';
    end if;

    -- Só dentro deste bloco (desfeito no fim): os outros superadmins deixam de conseguir entrar.
    update public.perfis set ativo = false
    where id in (select s.usuario_id from public.superadmins_ativos() s where s.usuario_id <> v_a);
    update auth.users set banned_until = now() + interval '1 day'
    where id in (select s.usuario_id from public.superadmins_ativos() s where s.usuario_id <> v_a);

    if exists (select 1 from public.superadmins_ativos() s where s.usuario_id <> v_a) then
        raise exception 'FALHA: ainda há outro superadmin ativo';
    end if;

    v_recusou := false;
    begin
        perform public.definir_papeis(v_a, '{}'::public.papel[], v_a);
    exception when sqlstate 'RP101' then
        v_recusou := true;
    end;
    if not v_recusou then
        raise exception 'FALHA: definir_papeis tirou o último superadmin sem dar RP101';
    end if;

    v_recusou := false;
    begin
        perform public.marcar_conta(v_a, false, v_a);
    exception when sqlstate 'RP101' then
        v_recusou := true;
    end;
    if not v_recusou then
        raise exception 'FALHA: marcar_conta desativou o último superadmin sem dar RP101';
    end if;

    raise exception 'OK_SENTINELA';
end
$$;`;
}

async function superadminsAtivos() {
    const r = await rpc('superadmins_ativos');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    return r.dados.map(l => l.usuario_id).sort();
}

// Confere, pela API, que a pessoa continua superadmin, com o perfil (se houver) ativo e sem bloqueio no login.
async function confereSuperadminIntacto(id) {
    const papeis = await rest(`papeis_usuario?usuario_id=eq.${id}&papel=eq.superadmin&select=papel`);
    assert.strictEqual(papeis.dados.length, 1, `${id} perdeu o superadmin: ${JSON.stringify(papeis.dados)}`);
    const perfil = await rest(`perfis?id=eq.${id}&select=ativo`);
    assert.ok(perfil.dados.every(p => p.ativo === true), `${id} ficou desativado: ${JSON.stringify(perfil.dados)}`);
    const usuario = await usuarioDoAuth(id);
    assert.ok(!usuario.banned_until || new Date(usuario.banned_until) <= new Date(), `${id} ficou bloqueado: ${usuario.banned_until}`);
}

test('o último superadmin ativo não perde o papel nem é desativado (RP101), sem mexer nas contas reais',
    { skip: !TOKEN && 'preencha SUPABASE_ACCESS_TOKEN no .env.teste' },
    async () => {
        const a = await criarUsuario({ papeis: ['superadmin'] });
        const antes = await superadminsAtivos();
        assert.ok(antes.includes(a.id), JSON.stringify(antes));

        const r = await rodarSql(blocoRp101(a.id));
        assert.ok(r.status < 200 || r.status >= 300, `o bloco deveria terminar em erro: ${r.status} ${r.texto}`);
        assert.ok(r.texto.includes('OK_SENTINELA'), `${r.status} ${r.texto}`);

        // Nada do bloco ficou gravado: os mesmos superadmins continuam ativos, inclusive A.
        assert.deepStrictEqual(await superadminsAtivos(), antes);
        for (const id of antes) await confereSuperadminIntacto(id);
    });
