// tests/integracao/base.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert';
import { rest, rpc, CHAVE_ANON, criarUsuario, apagarUsuariosCriados, ultimoIdHistorico } from './apoio.mjs';

// Os testes apagam tudo o que criam: usuários, perfis, papéis e linhas de histórico.
after(apagarUsuariosCriados);

test('anon não lê configuracoes', async () => {
    const r = await rest('configuracoes?select=chave', { chave: CHAVE_ANON });
    assert.ok([401, 403].includes(r.status), `status ${r.status}`);
});

test('anon não chama salvar_configuracao', async () => {
    const r = await rpc('salvar_configuracao', { p_chave: 'agenda', p_valor: {}, p_usuario: null }, { chave: CHAVE_ANON });
    assert.ok([401, 403, 404].includes(r.status), `status ${r.status}`);
});

test('chave de serviço lê as configurações iniciais', async () => {
    const r = await rest('configuracoes?select=chave,valor');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const mapa = Object.fromEntries(r.dados.map(l => [l.chave, l.valor]));
    assert.deepStrictEqual(Object.keys(mapa).sort(), ['agenda', 'cadastro', 'creditos', 'estande', 'funcionamento', 'municao']);
    assert.strictEqual(mapa.agenda.antecedencia_maxima_dias, 15);
    assert.strictEqual(mapa.agenda.duracao_maxima_grupo, 6);
    assert.strictEqual(mapa.municao.minima_por_participante, 50);
    assert.strictEqual(mapa.creditos.validade_dias, 365);
    assert.strictEqual(mapa.estande.fuso, 'America/Sao_Paulo');
});

test('salvar_configuracao grava histórico com o autor', async () => {
    const usuario = await criarUsuario({ papeis: ['superadmin'] });
    const antes = await rest('configuracoes?chave=eq.cadastro&select=valor,atualizado_em,atualizado_por');
    const linhaAnterior = antes.dados[0];
    const ultimoId = await ultimoIdHistorico();

    try {
        const novo = { ...linhaAnterior.valor, idade_minima: 21 };
        const r = await rpc('salvar_configuracao', { p_chave: 'cadastro', p_valor: novo, p_usuario: usuario.id });
        assert.strictEqual(r.status, 200, JSON.stringify(r.dados));

        const h = await rest(`historico_alteracoes?tabela=eq.configuracoes&registro_id=eq.cadastro&feito_por=eq.${usuario.id}&select=acao,depois`);
        assert.strictEqual(h.status, 200);
        assert.strictEqual(h.dados.length, 1);
        assert.strictEqual(h.dados[0].acao, 'alteracao');
        assert.strictEqual(h.dados[0].depois.valor.idade_minima, 21);
    } finally {
        // Devolve a linha exatamente como estava (valor, data e autor) e apaga o histórico gerado aqui.
        const volta = await rest('configuracoes?chave=eq.cadastro', { metodo: 'PATCH', corpo: linhaAnterior });
        assert.strictEqual(volta.status, 200, JSON.stringify(volta.dados));
        const limpa = await rest(`historico_alteracoes?tabela=eq.configuracoes&registro_id=eq.cadastro&id=gt.${ultimoId}`, { metodo: 'DELETE' });
        assert.strictEqual(limpa.status, 200, JSON.stringify(limpa.dados));
    }
});

test('cpf com formato inválido é recusado', async () => {
    const usuario = await criarUsuario({ perfil: false });
    const r = await rest('perfis', {
        metodo: 'POST',
        corpo: { id: usuario.id, nome_completo: 'CPF Errado', cpf: '123', telefone: '11999999999', data_nascimento: '1990-01-01' },
    });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.code, '23514');
});
