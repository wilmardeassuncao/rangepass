// tests/integracao/configuracoes.test.mjs
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import { rest, funcao, criarUsuario, apagarUsuariosCriados, ultimoIdHistorico, banirUsuario } from './apoio.mjs';

let cliente, superadmin, linhaAgendaAnterior, linhaTermoAnterior, ultimoId;

before(async () => {
    const antes = await rest('configuracoes?chave=eq.agenda&select=valor,atualizado_em,atualizado_por');
    linhaAgendaAnterior = antes.dados[0];
    const termo = await rest('configuracoes?chave=eq.termo&select=valor,atualizado_em,atualizado_por');
    linhaTermoAnterior = termo.dados[0];
    ultimoId = await ultimoIdHistorico();
    cliente = await criarUsuario({ papeis: ['cliente'] });
    superadmin = await criarUsuario({ papeis: ['superadmin'] });
});

// Os testes apagam tudo o que criam: devolvem as linhas agenda e termo exatamente como estavam (valor, data e autor),
// apagam o histórico gerado aqui e depois os usuários.
after(async () => {
    try {
        for (const [chave, linha] of [['agenda', linhaAgendaAnterior], ['termo', linhaTermoAnterior]]) {
            const volta = await rest(`configuracoes?chave=eq.${chave}`, { metodo: 'PATCH', corpo: linha });
            assert.strictEqual(volta.status, 200, JSON.stringify(volta.dados));
            const limpa = await rest(`historico_alteracoes?tabela=eq.configuracoes&registro_id=eq.${chave}&id=gt.${ultimoId}`, { metodo: 'DELETE' });
            assert.strictEqual(limpa.status, 200, JSON.stringify(limpa.dados));
        }
    } finally {
        await apagarUsuariosCriados();
    }
});

test('sem login não lê as configurações', async () => {
    const r = await funcao('configuracoes');
    assert.strictEqual(r.status, 401, JSON.stringify(r.dados));
});

test('cliente lê as configurações', async () => {
    const r = await funcao('configuracoes', { token: cliente.token });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.configuracoes.agenda.antecedencia_maxima_dias, 15);
    assert.strictEqual(r.dados.configuracoes.estande.fuso, 'America/Sao_Paulo');
});

test('cliente não altera configurações', async () => {
    const r = await funcao('configuracoes', {
        metodo: 'PUT', token: cliente.token,
        corpo: { chave: 'agenda', valor: { ...linhaAgendaAnterior.valor, antecedencia_maxima_dias: 20 } },
    });
    assert.strictEqual(r.status, 403, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { erro: 'Você não tem permissão para fazer isso.' });
});

test('superadmin altera, o valor fica salvo e o histórico guarda o autor', async () => {
    const novo = { ...linhaAgendaAnterior.valor, antecedencia_maxima_dias: 20 };
    const r = await funcao('configuracoes', { metodo: 'PUT', token: superadmin.token, corpo: { chave: 'agenda', valor: novo } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { chave: 'agenda', valor: novo });

    const lida = await funcao('configuracoes', { token: superadmin.token });
    assert.strictEqual(lida.dados.configuracoes.agenda.antecedencia_maxima_dias, 20);

    const h = await rest('historico_alteracoes?tabela=eq.configuracoes&registro_id=eq.agenda&select=feito_por,depois&order=id.desc&limit=1');
    assert.strictEqual(h.dados[0].feito_por, superadmin.id);
    assert.strictEqual(h.dados[0].depois.valor.antecedencia_maxima_dias, 20);
});

test('superadmin com valor inválido recebe 400 e os campos', async () => {
    const r = await funcao('configuracoes', {
        metodo: 'PUT', token: superadmin.token,
        corpo: { chave: 'agenda', valor: { ...linhaAgendaAnterior.valor, antecedencia_maxima_dias: 0 } },
    });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Revise os campos destacados.');
    assert.ok(r.dados.campos.antecedencia_maxima_dias);
});

test('conta bloqueada não lê as configurações', async () => {
    const u = await criarUsuario({ papeis: ['cliente'] });
    await banirUsuario(u.id);
    const r = await funcao('configuracoes', { token: u.token });
    assert.strictEqual(r.status, 403, JSON.stringify(r.dados));
});

// Plano 4: mudar o texto do termo pede uma versão maior que a atual.
test('superadmin muda o texto do termo mantendo a versão: 400 em versao e o texto continua', async () => {
    const atual = linhaTermoAnterior.valor;
    const r = await funcao('configuracoes', {
        metodo: 'PUT', token: superadmin.token,
        corpo: { chave: 'termo', valor: { versao: atual.versao, texto: `${atual.texto} (teste)` } },
    });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.versao, `Para mudar o texto, use uma versão maior que a atual (${atual.versao}).`);

    const lida = await rest('configuracoes?chave=eq.termo&select=valor');
    assert.deepStrictEqual(lida.dados[0].valor, atual);
});

test('superadmin muda o texto do termo com a versão seguinte: 200', async () => {
    const atual = linhaTermoAnterior.valor;
    const novo = { versao: atual.versao + 1, texto: `${atual.texto} (teste)` };
    const r = await funcao('configuracoes', { metodo: 'PUT', token: superadmin.token, corpo: { chave: 'termo', valor: novo } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { chave: 'termo', valor: novo });
});
