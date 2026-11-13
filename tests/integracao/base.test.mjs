// tests/integracao/base.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert';
import { rest, rpc, CHAVE_ANON, criarUsuario, apagarUsuariosCriados, ultimoIdHistorico, cpfAleatorio } from './apoio.mjs';

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
    assert.deepStrictEqual(Object.keys(mapa).sort(), ['agenda', 'cadastro', 'creditos', 'estande', 'funcionamento', 'municao', 'privacidade']);
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

// Plano 2: política de privacidade e gravação do perfil com o autor no histórico.
test('a política de privacidade inicial existe e avisa que é provisória', async () => {
    const r = await rest('configuracoes?chave=eq.privacidade&select=valor');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados[0].valor.versao, 1);
    assert.match(r.dados[0].valor.texto, /advogado/);
});

function dadosDePerfil(extra = {}) {
    return {
        nome_completo: 'Perfil Teste', cpf: cpfAleatorio(), telefone: '11999999999', data_nascimento: '1990-01-01',
        cr: null, orgao_expedidor: null, politica_versao: 1, politica_aceita_em: new Date().toISOString(), ...extra,
    };
}

test('criar_perfil grava o perfil e o histórico com o próprio usuário como autor', async () => {
    const u = await criarUsuario({ perfil: false });
    const dados = dadosDePerfil();
    const r = await rpc('criar_perfil', { p_usuario: u.id, p_dados: dados });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.id, u.id);
    assert.strictEqual(r.dados.cpf, dados.cpf);
    assert.strictEqual(r.dados.politica_versao, 1);
    assert.ok(r.dados.politica_aceita_em);

    const h = await rest(`historico_alteracoes?tabela=eq.perfis&registro_id=eq.${u.id}&select=acao,feito_por`);
    assert.deepStrictEqual(h.dados, [{ acao: 'insercao', feito_por: u.id }]);
});

test('atualizar_perfil muda só os campos editáveis e registra o autor', async () => {
    const u = await criarUsuario();
    const autor = await criarUsuario({ papeis: ['atendente'] });
    const antes = await rest(`perfis?id=eq.${u.id}&select=cpf`);
    const r = await rpc('atualizar_perfil', { p_usuario: u.id, p_dados: { telefone: '1134567890', cpf: '00000000000' }, p_autor: autor.id });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.telefone, '1134567890');
    assert.strictEqual(r.dados.cpf, antes.dados[0].cpf);

    const h = await rest(`historico_alteracoes?tabela=eq.perfis&registro_id=eq.${u.id}&acao=eq.alteracao&select=feito_por,depois`);
    assert.strictEqual(h.dados.length, 1);
    assert.strictEqual(h.dados[0].feito_por, autor.id);
    assert.strictEqual(h.dados[0].depois.telefone, '1134567890');
});

test('atualizar_perfil com null apaga o CR e sem a chave mantém', async () => {
    const u = await criarUsuario();
    await rpc('atualizar_perfil', { p_usuario: u.id, p_dados: { cr: '123', orgao_expedidor: 'SSP' }, p_autor: u.id });
    const r = await rpc('atualizar_perfil', { p_usuario: u.id, p_dados: { cr: null }, p_autor: u.id });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.cr, null);
    assert.strictEqual(r.dados.orgao_expedidor, 'SSP');
});

test('criar_perfil com CPF já usado é recusado pelo banco', async () => {
    const existente = await criarUsuario();
    const cpf = (await rest(`perfis?id=eq.${existente.id}&select=cpf`)).dados[0].cpf;
    const u = await criarUsuario({ perfil: false });
    const r = await rpc('criar_perfil', { p_usuario: u.id, p_dados: dadosDePerfil({ cpf }) });
    assert.strictEqual(r.dados.code, '23505', JSON.stringify(r.dados));
});

test('anon não chama criar_perfil nem atualizar_perfil', async () => {
    const a = await rpc('criar_perfil', { p_usuario: null, p_dados: {} }, { chave: CHAVE_ANON });
    const b = await rpc('atualizar_perfil', { p_usuario: null, p_dados: {}, p_autor: null }, { chave: CHAVE_ANON });
    assert.ok([401, 403, 404].includes(a.status), `status ${a.status}`);
    assert.ok([401, 403, 404].includes(b.status), `status ${b.status}`);
});
