// tests/integracao/equipe.test.mjs
// A Edge Function equipe: o superadmin procura pessoas, troca os papéis delas e desativa ou
// reativa contas. Os testes usam só usuários de teste e apagam tudo o que criam (inclusive o
// histórico de papeis_usuario e perfis deles e os registros de acesso).
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import {
    rest, rpc, funcao, entrar, criarUsuario, apagarTudoCriado, apagarAcessosDe, banirUsuario, usuarioDoAuth,
} from './apoio.mjs';

let superA, superB, administrativo, cliente;

before(async () => {
    superA = await criarUsuario({ papeis: ['superadmin'] });
    superB = await criarUsuario({ papeis: ['superadmin'] });
    administrativo = await criarUsuario({ papeis: ['administrativo'] });
    cliente = await criarUsuario({ papeis: ['cliente'] });
});

after(async () => {
    try {
        for (const pessoa of [superA, superB, administrativo, cliente]) {
            if (pessoa) await apagarAcessosDe(pessoa.id);
        }
    } finally {
        await apagarTudoCriado();
    }
});

function buscar(busca, token = superA.token) {
    const consulta = busca === undefined ? '' : `?busca=${encodeURIComponent(busca)}`;
    return funcao(`equipe${consulta}`, { token });
}

function mudar(corpo, token = superA.token) {
    return funcao('equipe', { metodo: 'PUT', token, corpo });
}

async function papeisNoBanco(id) {
    const r = await rest(`papeis_usuario?usuario_id=eq.${id}&select=papel`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    return r.dados.map(l => l.papel).sort();
}

test('sem login dá 401', async () => {
    const r = await funcao('equipe');
    assert.strictEqual(r.status, 401, JSON.stringify(r.dados));
});

test('cliente e administrativo recebem 403 em GET e PUT', async () => {
    for (const pessoa of [cliente, administrativo]) {
        const g = await buscar(cliente.email, pessoa.token);
        const p = await mudar({ usuario_id: cliente.id, papeis: ['cliente'] }, pessoa.token);
        for (const r of [g, p]) {
            assert.strictEqual(r.status, 403, JSON.stringify(r.dados));
            assert.strictEqual(r.dados.erro, 'Você não tem permissão para fazer isso.');
        }
    }
});

test('a busca pelo e-mail acha o cliente e registra o acesso', async () => {
    const r = await buscar(cliente.email);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const achada = r.dados.pessoas.find(p => p.id === cliente.id);
    assert.ok(achada, JSON.stringify(r.dados));
    assert.strictEqual(achada.email, cliente.email);
    assert.strictEqual(achada.cpf, cliente.cpf);
    assert.deepStrictEqual(achada.papeis, ['cliente']);
    assert.strictEqual(achada.ativo, true);

    const acessos = await rest(`acessos_dados?usuario_id=eq.${superA.id}&recurso=eq.equipe.busca&select=registro`);
    assert.strictEqual(acessos.status, 200, JSON.stringify(acessos.dados));
    assert.deepStrictEqual(acessos.dados.map(a => a.registro), [cliente.email]);
});

test('a busca pelo começo do CPF acha o cliente', async () => {
    const r = await buscar(cliente.cpf.slice(0, 9));
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.ok(r.dados.pessoas.some(p => p.id === cliente.id), JSON.stringify(r.dados));
});

test('sem busca, lista a equipe (sem clientes) e não registra acesso', async () => {
    const antes = await rest(`acessos_dados?usuario_id=eq.${superB.id}&select=id`);
    const r = await buscar(undefined, superB.token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const ids = r.dados.pessoas.map(p => p.id);
    assert.ok(ids.includes(administrativo.id), 'o administrativo de teste deveria aparecer');
    assert.ok(!ids.includes(cliente.id), 'o cliente não deveria aparecer sem busca');
    assert.ok(r.dados.pessoas.length <= 50);
    const depois = await rest(`acessos_dados?usuario_id=eq.${superB.id}&select=id`);
    assert.strictEqual(depois.dados.length, antes.dados.length);
});

test('a busca trata % e _ como letras comuns', async () => {
    const r = await buscar('%%');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.ok(!r.dados.pessoas.some(p => p.id === cliente.id), JSON.stringify(r.dados));
});

test('pessoa que não existe dá 404', async () => {
    for (const usuario_id of ['00000000-0000-4000-8000-000000000000', 'nao-e-uuid', undefined]) {
        const r = await mudar({ usuario_id, papeis: ['cliente'] });
        assert.strictEqual(r.status, 404, JSON.stringify(r.dados));
        assert.strictEqual(r.dados.erro, 'Não encontramos esta pessoa.');
    }
});

test('papel fora da lista dá 400', async () => {
    const r = await mudar({ usuario_id: cliente.id, papeis: ['dono'] });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.papeis, 'Escolha papéis da lista.');
    assert.deepStrictEqual(await papeisNoBanco(cliente.id), ['cliente']);
});

test('ação desconhecida dá 400', async () => {
    const r = await mudar({ usuario_id: cliente.id, acao: 'apagar' });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Esta ação não existe.');
});

test('dar instrutor ao cliente: o GET mostra e o histórico guarda o autor', async () => {
    const r = await mudar({ usuario_id: cliente.id, papeis: ['instrutor'] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados.pessoa.papeis, ['instrutor']);
    assert.strictEqual(r.dados.pessoa.id, cliente.id);

    const g = await buscar(cliente.email);
    assert.deepStrictEqual(g.dados.pessoas.find(p => p.id === cliente.id).papeis, ['instrutor']);

    const h = await rest(`historico_alteracoes?tabela=eq.papeis_usuario&registro_id=eq.${cliente.id}&select=acao,antes,depois,feito_por`);
    assert.strictEqual(h.status, 200, JSON.stringify(h.dados));
    assert.deepStrictEqual(h.dados, [{ acao: 'alteracao', antes: ['cliente'], depois: ['instrutor'], feito_por: superA.id }]);

    const volta = await mudar({ usuario_id: cliente.id, papeis: ['cliente'] });
    assert.strictEqual(volta.status, 200, JSON.stringify(volta.dados));
});

test('superadmin tirando o próprio superadmin dá 409 e nada muda', async () => {
    const r = await mudar({ usuario_id: superA.id, papeis: ['instrutor'] });
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Você não pode tirar o seu próprio papel de superadmin.');
    assert.deepStrictEqual(await papeisNoBanco(superA.id), ['superadmin']);
});

test('superadmin A tira o superadmin de B (sobra A)', async () => {
    const r = await mudar({ usuario_id: superB.id, papeis: ['administrativo'] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.deepStrictEqual(await papeisNoBanco(superB.id), ['administrativo']);
});

test('desativar o cliente bloqueia o login; reativar devolve o acesso', async () => {
    const d = await mudar({ usuario_id: cliente.id, acao: 'desativar' });
    assert.strictEqual(d.status, 200, JSON.stringify(d.dados));
    assert.strictEqual(d.dados.pessoa.ativo, false);

    const perfil = await rest(`perfis?id=eq.${cliente.id}&select=ativo`);
    assert.strictEqual(perfil.dados[0].ativo, false);

    const login = await entrar(cliente.email, cliente.senha);
    assert.notStrictEqual(login.status, 200, JSON.stringify(login.dados));

    const conta = await funcao('minha-conta', { token: cliente.token });
    assert.strictEqual(conta.status, 403, JSON.stringify(conta.dados));

    const g = await buscar(cliente.email);
    assert.strictEqual(g.dados.pessoas.find(p => p.id === cliente.id).ativo, false);

    const h = await rest(`historico_alteracoes?tabela=eq.perfis&registro_id=eq.${cliente.id}&acao=eq.alteracao&select=feito_por,depois`);
    assert.ok(h.dados.some(l => l.feito_por === superA.id && l.depois.ativo === false), JSON.stringify(h.dados));

    const re = await mudar({ usuario_id: cliente.id, acao: 'reativar' });
    assert.strictEqual(re.status, 200, JSON.stringify(re.dados));
    assert.strictEqual(re.dados.pessoa.ativo, true);

    const novo = await entrar(cliente.email, cliente.senha);
    assert.strictEqual(novo.status, 200, JSON.stringify(novo.dados));
    const conta2 = await funcao('minha-conta', { token: novo.dados.access_token });
    assert.strictEqual(conta2.status, 200, JSON.stringify(conta2.dados));
});

test('desativar a própria conta dá 409', async () => {
    const r = await mudar({ usuario_id: superA.id, acao: 'desativar' });
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Você não pode desativar a sua própria conta.');
    const conta = await funcao('minha-conta', { token: superA.token });
    assert.strictEqual(conta.status, 200, JSON.stringify(conta.dados));
});

// Daqui em diante, superA é o único superadmin de teste que consegue entrar (superB já perdeu o papel).
// Se o banco tiver outro superadmin ativo (uma conta real), estes testes são pulados: não mexemos nela.
async function soSuperAAtivo(t) {
    const r = await rpc('superadmins_ativos');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const ids = r.dados.map(l => l.usuario_id);
    assert.ok(ids.includes(superA.id), JSON.stringify(ids));
    if (ids.length > 1) {
        t.skip('Há outro superadmin ativo no banco; o teste do último superadmin não se aplica.');
        return false;
    }
    return true;
}

test('definir_papeis recusa (RP101) tirar o último superadmin ativo, mesmo com outro superadmin desativado', async (t) => {
    const desativado = await criarUsuario({ papeis: ['superadmin'] });
    await banirUsuario(desativado.id);
    if (!await soSuperAAtivo(t)) return;

    const r = await rpc('definir_papeis', { p_usuario: superA.id, p_papeis: ['instrutor'], p_autor: superA.id });
    assert.strictEqual(r.dados?.code, 'RP101', `${r.status} ${JSON.stringify(r.dados)}`);
    assert.deepStrictEqual(await papeisNoBanco(superA.id), ['superadmin']);
});

test('marcar_conta recusa (RP101) desativar o último superadmin ativo e nada é bloqueado', async (t) => {
    if (!await soSuperAAtivo(t)) return;

    const r = await rpc('marcar_conta', { p_usuario: superA.id, p_ativa: false, p_autor: superB.id });
    assert.strictEqual(r.dados?.code, 'RP101', `${r.status} ${JSON.stringify(r.dados)}`);

    const perfil = await rest(`perfis?id=eq.${superA.id}&select=ativo`);
    assert.strictEqual(perfil.dados[0].ativo, true);
    const usuario = await usuarioDoAuth(superA.id);
    assert.ok(!usuario.banned_until || new Date(usuario.banned_until) <= new Date(), JSON.stringify(usuario.banned_until));
    const conta = await funcao('minha-conta', { token: superA.token });
    assert.strictEqual(conta.status, 200, JSON.stringify(conta.dados));
});

test('desativar e reativar quem não tem perfil deixa histórico de contas com o autor', async () => {
    const semPerfil = await criarUsuario({ perfil: false, papeis: ['cliente'] });

    const d = await mudar({ usuario_id: semPerfil.id, acao: 'desativar' });
    assert.strictEqual(d.status, 200, JSON.stringify(d.dados));
    assert.strictEqual(d.dados.pessoa.ativo, false);
    assert.strictEqual(d.dados.pessoa.nome_completo, null);

    const re = await mudar({ usuario_id: semPerfil.id, acao: 'reativar' });
    assert.strictEqual(re.status, 200, JSON.stringify(re.dados));
    assert.strictEqual(re.dados.pessoa.ativo, true);

    const h = await rest(`historico_alteracoes?tabela=eq.contas&registro_id=eq.${semPerfil.id}&select=acao,antes,depois,feito_por&order=id`);
    assert.strictEqual(h.status, 200, JSON.stringify(h.dados));
    assert.deepStrictEqual(h.dados, [
        { acao: 'alteracao', antes: { ativo: true }, depois: { ativo: false }, feito_por: superA.id },
        { acao: 'alteracao', antes: { ativo: false }, depois: { ativo: true }, feito_por: superA.id },
    ]);
});
