// tests/integracao/precos-funcao.test.mjs
// A Edge Function precos: o superadmin cria e edita as regras por horário, campanhas, classes de
// desconto e pacotes. Nada é apagado por ela; os testes apagam tudo o que criam (com o histórico).
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import { rest, funcao, marcador, criarUsuario, criar, anotarRegistro, apagarTudoCriado } from './apoio.mjs';

after(apagarTudoCriado);

const TABELAS = { regra: 'regras_preco', campanha: 'campanhas', classe: 'classes_desconto', pacote: 'pacotes' };
const LISTAS = { regra: 'regras', campanha: 'campanhas', classe: 'classes', pacote: 'pacotes' };

let superadmin, administrativo, cliente, instrutor, atendente;
let modelo, municao;

before(async () => {
    superadmin = await criarUsuario({ papeis: ['superadmin'] });
    administrativo = await criarUsuario({ papeis: ['administrativo'] });
    cliente = await criarUsuario({ papeis: ['cliente'] });
    instrutor = await criarUsuario({ papeis: ['instrutor'] });
    atendente = await criarUsuario({ papeis: ['atendente'] });
    const m = marcador();
    const categoria = await criar('categorias', { nome: `Categoria ${m}` });
    const calibre = await criar('calibres', { nome: `Calibre ${m}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${m}`, nome: 'Modelo Teste' });
    municao = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Munição ${m}` });
});

// Cria pela função; se der certo, anota a linha para apagar no fim (com o histórico).
async function cadastrar(tipo, dados, token = superadmin.token) {
    const r = await funcao('precos', { metodo: 'POST', token, corpo: { tipo, dados } });
    if (r.status === 201 && r.dados?.item?.id) anotarRegistro(TABELAS[tipo], r.dados.item.id);
    return r;
}

function editar(tipo, id, dados, token = superadmin.token) {
    return funcao('precos', { metodo: 'PUT', token, corpo: { tipo, id, dados } });
}

function exemplos() {
    const m = marcador();
    return {
        regra: { nome: ` Sábado à noite ${m} `, dias: [6], hora_inicio: '18:00', hora_fim: '23:00', percentual: 20 },
        campanha: { nome: `Black Friday ${m}`, percentual: 10, inicio: '2030-11-20', fim: '2030-11-30' },
        classe: { nome: `Policiais ${m}`, percentual: 15 },
        pacote: {
            nome: `Iniciante ${m}`, inicio: '2030-01-01', fim: '2030-12-31', preco_centavos: 25000, horas: 1,
            modelo_id: modelo.id, tipo_municao_id: municao.id, municao_qtd: 50,
        },
    };
}

test('sem login dá 401', async () => {
    const r = await funcao('precos');
    assert.strictEqual(r.status, 401, JSON.stringify(r.dados));
});

test('cliente, administrativo, instrutor e atendente recebem 403 em GET, POST e PUT', async () => {
    for (const pessoa of [cliente, administrativo, instrutor, atendente]) {
        const g = await funcao('precos', { token: pessoa.token });
        const p = await cadastrar('classe', { nome: `Classe ${marcador()}`, percentual: 10 }, pessoa.token);
        const u = await editar('classe', 1, { ativo: true }, pessoa.token);
        for (const r of [g, p, u]) {
            assert.strictEqual(r.status, 403, JSON.stringify(r.dados));
            assert.strictEqual(r.dados.erro, 'Você não tem permissão para fazer isso.');
        }
    }
});

test('outros métodos dão 405', async () => {
    const r = await funcao('precos', { metodo: 'DELETE', token: superadmin.token });
    assert.strictEqual(r.status, 405, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Esta ação não é permitida aqui.');
});

test('superadmin cria e edita cada tipo; o GET traz tudo; o histórico tem o autor', async () => {
    const dados = exemplos();
    const edicoes = {
        regra: { percentual: -10, dias: [0, 6], hora_inicio: '19:00' },
        campanha: { fim: '2030-12-01', ativo: false },
        classe: { percentual: 20, ativo: false },
        pacote: { tipo_municao_id: null, municao_qtd: null, horas: 2 },
    };
    const criados = {};
    for (const tipo of Object.keys(TABELAS)) {
        const r = await cadastrar(tipo, dados[tipo]);
        assert.strictEqual(r.status, 201, `${tipo}: ${JSON.stringify(r.dados)}`);
        const esperado = { ativo: true, ...(tipo === 'regra' ? { prioridade: 0 } : {}), ...dados[tipo], nome: dados[tipo].nome.trim() };
        assert.deepStrictEqual({ ...r.dados.item, id: undefined }, { ...esperado, id: undefined }, tipo);

        const e = await editar(tipo, r.dados.item.id, edicoes[tipo]);
        assert.strictEqual(e.status, 200, `${tipo}: ${JSON.stringify(e.dados)}`);
        assert.deepStrictEqual(e.dados, { item: { ...r.dados.item, ...edicoes[tipo] } }, `${tipo} (edição)`);
        criados[tipo] = e.dados.item;

        const h = await rest(`historico_alteracoes?tabela=eq.${TABELAS[tipo]}&registro_id=eq.${r.dados.item.id}&select=acao,feito_por&order=id`);
        assert.deepStrictEqual(h.dados, [
            { acao: 'insercao', feito_por: superadmin.id },
            { acao: 'alteracao', feito_por: superadmin.id },
        ], tipo);
    }
    assert.strictEqual(criados.regra.hora_inicio, '19:00', 'horário em HH:MM');
    assert.strictEqual(criados.regra.hora_fim, '23:00', 'horário em HH:MM');

    const g = await funcao('precos', { token: superadmin.token });
    assert.strictEqual(g.status, 200, JSON.stringify(g.dados));
    assert.deepStrictEqual(Object.keys(g.dados).sort(), ['campanhas', 'classes', 'hora_pista_centavos', 'pacotes', 'regras']);
    const config = await rest('configuracoes?chave=eq.precos&select=valor');
    assert.strictEqual(g.dados.hora_pista_centavos, config.dados[0].valor.hora_pista_centavos ?? null);
    for (const [tipo, item] of Object.entries(criados)) {
        const achado = g.dados[LISTAS[tipo]].find(i => i.id === item.id);
        assert.deepStrictEqual(achado, item, `${tipo} no GET (inclusive inativos)`);
    }
});

test('campos inválidos ou faltando ao criar dão 400 com campos', async () => {
    const semPercentual = await cadastrar('classe', { nome: `Classe ${marcador()}` });
    assert.strictEqual(semPercentual.status, 400, JSON.stringify(semPercentual.dados));
    assert.strictEqual(semPercentual.dados.erro, 'Revise os campos destacados.');
    assert.strictEqual(semPercentual.dados.campos.percentual, 'Informe um percentual entre 1 e 90.');

    const regra = await cadastrar('regra', { ...exemplos().regra, percentual: 0, hora_fim: '17:00' });
    assert.strictEqual(regra.status, 400, JSON.stringify(regra.dados));
    assert.strictEqual(regra.dados.campos.percentual, 'Informe um percentual entre -90 e 200, diferente de 0.');
    assert.strictEqual(regra.dados.campos.hora_fim, 'O fim deve ser depois do início.');

    const pacote = await cadastrar('pacote', { ...exemplos().pacote, municao_qtd: undefined });
    assert.strictEqual(pacote.status, 400, JSON.stringify(pacote.dados));
    assert.strictEqual(pacote.dados.campos.municao_qtd, 'Informe a quantidade de munição do pacote.');

    const tipo = await cadastrar('cupom', { nome: 'X' });
    assert.strictEqual(tipo.status, 400, JSON.stringify(tipo.dados));
    assert.strictEqual(tipo.dados.campos.tipo, 'Este tipo de promoção não existe.');
});

test('PUT confere a linha como ficará (o guardado + o que veio)', async () => {
    const d = exemplos();
    const regra = (await cadastrar('regra', d.regra)).dados.item;
    const campanha = (await cadastrar('campanha', d.campanha)).dados.item;
    const pacote = (await cadastrar('pacote', d.pacote)).dados.item;

    const r = await editar('regra', regra.id, { hora_fim: '17:00' });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.hora_fim, 'O fim deve ser depois do início.');

    const c = await editar('campanha', campanha.id, { fim: '2030-11-01' });
    assert.strictEqual(c.status, 400, JSON.stringify(c.dados));
    assert.strictEqual(c.dados.campos.fim, 'O fim deve ser no mesmo dia ou depois do início.');

    const p = await editar('pacote', pacote.id, { municao_qtd: null });
    assert.strictEqual(p.status, 400, JSON.stringify(p.dados));
    assert.strictEqual(p.dados.campos.municao_qtd, 'Informe a quantidade de munição do pacote.');

    const nada = await editar('classe', 1, {});
    assert.strictEqual(nada.status, 400, JSON.stringify(nada.dados));
    assert.strictEqual(nada.dados.campos.geral, 'Nada para alterar.');

    // Nada mudou no banco: só a criação está no histórico.
    for (const [tipo, item] of [['regra', regra], ['campanha', campanha], ['pacote', pacote]]) {
        const h = await rest(`historico_alteracoes?tabela=eq.${TABELAS[tipo]}&registro_id=eq.${item.id}&select=acao`);
        assert.deepStrictEqual(h.dados, [{ acao: 'insercao' }], tipo);
    }
});

test('nome de classe repetido dá 409', async () => {
    const d = exemplos();
    const r1 = await cadastrar('classe', d.classe);
    assert.strictEqual(r1.status, 201, JSON.stringify(r1.dados));
    const r2 = await cadastrar('classe', { nome: d.classe.nome, percentual: 30 });
    assert.strictEqual(r2.status, 409, JSON.stringify(r2.dados));
    assert.deepStrictEqual(r2.dados.campos, { nome: 'Já existe uma classe com este nome.' });
});

test('item escolhido que não existe dá 400', async () => {
    const r = await cadastrar('pacote', { ...exemplos().pacote, modelo_id: 2000000000 });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Um dos itens escolhidos não existe mais. Recarregue a página.');
});

test('PUT com id inexistente dá 404', async () => {
    for (const tipo of Object.keys(TABELAS)) {
        const r = await editar(tipo, 2000000000, { ativo: false });
        assert.strictEqual(r.status, 404, `${tipo}: ${JSON.stringify(r.dados)}`);
        assert.strictEqual(r.dados.erro, 'Não encontramos este cadastro.');
    }
    const semId = await editar('classe', undefined, { ativo: false });
    assert.strictEqual(semId.status, 404, JSON.stringify(semId.dados));
});
