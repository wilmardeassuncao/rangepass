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
let modelo, municao, calibre;

before(async () => {
    superadmin = await criarUsuario({ papeis: ['superadmin'] });
    administrativo = await criarUsuario({ papeis: ['administrativo'] });
    cliente = await criarUsuario({ papeis: ['cliente'] });
    instrutor = await criarUsuario({ papeis: ['instrutor'] });
    atendente = await criarUsuario({ papeis: ['atendente'] });
    const m = marcador();
    const categoria = await criar('categorias', { nome: `Categoria ${m}` });
    calibre = await criar('calibres', { nome: `Calibre ${m}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${m}`, nome: 'Modelo Teste', preco_hora_centavos: 3000 });
    municao = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Munição ${m}`, preco_unidade_centavos: 200 });
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

test('classe com o nome de uma classe desativada dá 409 sugerindo reativar', async () => {
    const d = exemplos();
    const r1 = await cadastrar('classe', d.classe);
    assert.strictEqual(r1.status, 201, JSON.stringify(r1.dados));
    const off = await editar('classe', r1.dados.item.id, { ativo: false });
    assert.strictEqual(off.status, 200, JSON.stringify(off.dados));
    const r2 = await cadastrar('classe', { nome: d.classe.nome, percentual: 30 });
    assert.strictEqual(r2.status, 409, JSON.stringify(r2.dados));
    assert.deepStrictEqual(r2.dados.campos, {
        nome: 'Já existe uma classe desativada com este nome. Reative-a na lista em vez de criar outra.',
    });
});

test('pacote recusa modelo sem preço e munição sem preço ou de outro calibre', async () => {
    const m = marcador();
    const semPreco = await criar('modelos', { categoria_id: modelo.categoria_id, calibre_id: calibre.id, marca: `Marca ${m}`, nome: 'Sem preço' });
    const outroCalibre = await criar('calibres', { nome: `Outro ${m}` });
    const municaoOutra = await criar('tipos_municao', { calibre_id: outroCalibre.id, nome: `Outra ${m}`, preco_unidade_centavos: 200 });
    const municaoSemPreco = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Sem preço ${m}` });
    const d = exemplos().pacote;

    const a = await cadastrar('pacote', { ...d, modelo_id: semPreco.id });
    assert.strictEqual(a.status, 400, JSON.stringify(a.dados));
    assert.strictEqual(a.dados.campos.modelo_id, 'Este modelo está sem preço. Defina o preço na aba Preços antes de usá-lo num pacote.');

    const b = await cadastrar('pacote', { ...d, tipo_municao_id: municaoOutra.id });
    assert.strictEqual(b.status, 400, JSON.stringify(b.dados));
    assert.strictEqual(b.dados.campos.tipo_municao_id, 'Esta munição não é do calibre do modelo escolhido.');

    const c = await cadastrar('pacote', { ...d, tipo_municao_id: municaoSemPreco.id });
    assert.strictEqual(c.status, 400, JSON.stringify(c.dados));
    assert.strictEqual(c.dados.campos.tipo_municao_id, 'Esta munição está sem preço. Defina o preço na aba Preços antes de usá-la num pacote.');

    // Ao editar um pacote existente, vale a linha final (o guardado + o que veio).
    const ok = (await cadastrar('pacote', d)).dados.item;
    const e1 = await editar('pacote', ok.id, { modelo_id: semPreco.id });
    assert.strictEqual(e1.status, 400, JSON.stringify(e1.dados));
    assert.strictEqual(e1.dados.campos.modelo_id, 'Este modelo está sem preço. Defina o preço na aba Preços antes de usá-lo num pacote.');
    const e2 = await editar('pacote', ok.id, { tipo_municao_id: municaoOutra.id });
    assert.strictEqual(e2.status, 400, JSON.stringify(e2.dados));
    assert.strictEqual(e2.dados.campos.tipo_municao_id, 'Esta munição não é do calibre do modelo escolhido.');
    const h = await rest(`historico_alteracoes?tabela=eq.pacotes&registro_id=eq.${ok.id}&select=acao`);
    assert.deepStrictEqual(h.dados, [{ acao: 'insercao' }]);
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

test('renomear classe para o nome de uma desativada sugere reativar ou escolher outro nome', async () => {
    const d = exemplos();
    const desativada = await cadastrar('classe', d.classe);
    assert.strictEqual(desativada.status, 201, JSON.stringify(desativada.dados));
    const off = await editar('classe', desativada.dados.item.id, { ativo: false });
    assert.strictEqual(off.status, 200, JSON.stringify(off.dados));
    const outra = await cadastrar('classe', { nome: `Outra ${marcador()}`, percentual: 30 });
    assert.strictEqual(outra.status, 201, JSON.stringify(outra.dados));

    const r = await editar('classe', outra.dados.item.id, { nome: d.classe.nome });
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados.campos, {
        nome: 'Já existe uma classe desativada com este nome. Reative-a na lista ou escolha outro nome.',
    });
});

test('salvar pacote cujo modelo e munição perderam o preço, mudando só o nome ou o ativo, dá certo', async () => {
    const m = marcador();
    const modeloDoPacote = await criar('modelos', { categoria_id: modelo.categoria_id, calibre_id: calibre.id, marca: `Marca ${m}`, nome: 'Perde o preço', preco_hora_centavos: 3000 });
    const municaoDoPacote = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Perde o preço ${m}`, preco_unidade_centavos: 200 });
    const pacote = (await cadastrar('pacote', { ...exemplos().pacote, modelo_id: modeloDoPacote.id, tipo_municao_id: municaoDoPacote.id })).dados.item;
    assert.ok(pacote?.id, 'o pacote foi criado');

    // Tira o preço do modelo e da munição e devolve os dois no fim, mesmo se o teste falhar no meio.
    try {
        const modeloSemPreco = await rest(`modelos?id=eq.${modeloDoPacote.id}`, { metodo: 'PATCH', corpo: { preco_hora_centavos: null } });
        assert.strictEqual(modeloSemPreco.status, 200, JSON.stringify(modeloSemPreco.dados));
        const municaoSemPreco = await rest(`tipos_municao?id=eq.${municaoDoPacote.id}`, { metodo: 'PATCH', corpo: { preco_unidade_centavos: null } });
        assert.strictEqual(municaoSemPreco.status, 200, JSON.stringify(municaoSemPreco.dados));

        const nome = await editar('pacote', pacote.id, { nome: `Renomeado ${m}` });
        assert.strictEqual(nome.status, 200, JSON.stringify(nome.dados));
        assert.strictEqual(nome.dados.item.nome, `Renomeado ${m}`);

        const ativo = await editar('pacote', pacote.id, { ativo: false });
        assert.strictEqual(ativo.status, 200, JSON.stringify(ativo.dados));
        assert.strictEqual(ativo.dados.item.ativo, false);
    } finally {
        const voltaModelo = await rest(`modelos?id=eq.${modeloDoPacote.id}`, { metodo: 'PATCH', corpo: { preco_hora_centavos: 3000 } });
        const voltaMunicao = await rest(`tipos_municao?id=eq.${municaoDoPacote.id}`, { metodo: 'PATCH', corpo: { preco_unidade_centavos: 200 } });
        assert.strictEqual(voltaModelo.status, 200, `falha ao devolver o preço do modelo: ${JSON.stringify(voltaModelo.dados)}`);
        assert.strictEqual(voltaMunicao.status, 200, `falha ao devolver o preço da munição: ${JSON.stringify(voltaMunicao.dados)}`);
    }
});
