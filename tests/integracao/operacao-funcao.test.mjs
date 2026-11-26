// tests/integracao/operacao-funcao.test.mjs
// A Edge Function operacao, área Recepção: a lista do dia, a ficha de check-in e o próprio check-in.
// O banco de desenvolvimento tem dados de exemplo; os testes não supõem que só existem os criados aqui
// e não mudam nada deles. Tudo o que é criado aqui é apagado no fim, inclusive os acessos registrados.
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import { dataNoFuso } from '../../supabase/functions/_shared/cadastro.mjs';
import { instanteNoFuso, somarDias } from '../../supabase/functions/_shared/agendamento.mjs';
import { descontoDeClasse } from '../../supabase/functions/_shared/precos.mjs';
import {
    rest, rpc, funcao, marcador,
    criarUsuario, criar, apagarTudoCriado, anotarAgendamento, apagarAcessosDe,
} from './apoio.mjs';

let fuso, hoje, cliente, instrutor, atendente, superadmin, modelo, tipoMunicao, classe, classeDesativada, nomeDoCliente;

after(async () => {
    const passos = [];
    for (const pessoa of [atendente, superadmin]) if (pessoa) passos.push(() => apagarAcessosDe(pessoa.id));
    passos.push(apagarTudoCriado);
    const falhas = [];
    for (const passo of passos) {
        try { await passo(); } catch (erro) { falhas.push(erro.message); }
    }
    if (falhas.length) throw new Error(falhas.join('\n'));
});

const CUSTO_UNIDADE = 220;
const MUNICAO_QTD = 50;

// O preço congelado dos agendamentos de teste (um objeto Preco de _shared/precos.mjs).
const PRECO = {
    itens: [
        { descricao: 'Pista (1 pista × 1 hora)', total_centavos: 10000 },
        { descricao: 'Aluguel de armas', total_centavos: 3000 },
        { descricao: 'Munição (50 unidades)', total_centavos: 12500 },
    ],
    subtotal_centavos: 25500,
    desconto: null,
    total_centavos: 25500,
};

before(async () => {
    const config = await rest('configuracoes?chave=eq.estande&select=valor');
    fuso = config.dados[0].valor.fuso;
    hoje = dataNoFuso(new Date(), fuso);

    cliente = await criarUsuario({ papeis: ['cliente'] });
    instrutor = await criarUsuario({ papeis: ['instrutor'] });
    atendente = await criarUsuario({ papeis: ['atendente'] });
    superadmin = await criarUsuario({ papeis: ['superadmin'] });
    nomeDoCliente = (await rest(`perfis?id=eq.${cliente.id}&select=nome_completo`)).dados[0].nome_completo;

    // Uma pista a mais para os agendamentos de teste não dependerem das pistas livres do banco.
    await criar('pistas', { numero: 100000000 + Math.floor(Math.random() * 1000000000) });
    const categoria = await criar('categorias', { nome: `Categoria ${marcador()}` });
    const calibre = await criar('calibres', { nome: `Calibre ${marcador()}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Teste' });
    tipoMunicao = await criar('tipos_municao', {
        calibre_id: calibre.id, nome: `Munição ${marcador()}`, custo_compra_centavos: CUSTO_UNIDADE,
    });
    // Uma unidade só; os agendamentos ficam em horas diferentes.
    await criar('unidades_arma', { modelo_id: modelo.id, numero_registro: `REG-${marcador()}` });
    classe = await criar('classes_desconto', {
        nome: `Classe ${marcador()}`, percentual_pista: 20, percentual_aluguel: 10, percentual_municao: 15,
    });
    classeDesativada = await criar('classes_desconto', {
        nome: `Classe ${marcador()}`, percentual_pista: 30, percentual_aluguel: 30, percentual_municao: 30, ativo: false,
    });
});

let proximaHora = 1;

// Cria um agendamento com o instrutor de teste, cada um numa hora diferente (o instrutor e a arma não
// podem estar em dois agendamentos ao mesmo tempo). criar_agendamento não confere antecedência.
async function agendamento({ dias = 0, preco = PRECO } = {}) {
    const hora = proximaHora;
    proximaHora += 1;
    const r = await rpc('criar_agendamento', {
        p_responsavel: cliente.id,
        p_pedido: {
            preco,
            inicio: instanteNoFuso(somarDias(hoje, dias), hora, fuso).toISOString(), horas: 1,
            instrutor_id: instrutor.id, instrutores_necessarios: 1,
            participantes: [{
                nome_completo: 'Cliente Teste', cpf: cliente.cpf, data_nascimento: '1990-01-01', perfil_id: cliente.id,
                modalidade: 'estande', termo_versao: null, modelo_id: modelo.id,
                tipo_municao_id: tipoMunicao.id, municao_qtd: MUNICAO_QTD, arma_propria: null,
            }],
        },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    anotarAgendamento(r.dados);
    return r.dados;
}

async function mudar(id, corpo) {
    const r = await rest(`agendamentos?id=eq.${id}`, { metodo: 'PATCH', corpo });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
}

function operacao(token, { consulta = '', metodo = 'GET', corpo } = {}) {
    return funcao(`operacao${consulta ? `?${consulta}` : ''}`, { token, metodo, corpo });
}

function checkIn(token, corpo) {
    return operacao(token, { metodo: 'POST', corpo: { acao: 'check_in', ...corpo } });
}

async function situacao(id) {
    const r = await rest(`agendamentos?id=eq.${id}&select=situacao`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    return r.dados[0].situacao;
}

async function pagamentos(id) {
    const r = await rest(`pagamentos?agendamento_id=eq.${id}`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    return r.dados;
}

async function nadaGravado(id, situacaoEsperada = 'aguardando_pagamento') {
    assert.strictEqual(await situacao(id), situacaoEsperada);
    assert.strictEqual((await pagamentos(id)).length, 0);
}

test('sem login 401', async () => {
    assert.strictEqual((await operacao(null, { consulta: 'area=recepcao' })).status, 401);
    assert.strictEqual((await checkIn(null, { id: '00000000-0000-0000-0000-000000000000' })).status, 401);
});

test('instrutor e cliente recebem 403', async () => {
    for (const pessoa of [instrutor, cliente]) {
        const lista = await operacao(pessoa.token, { consulta: 'area=recepcao' });
        assert.strictEqual(lista.status, 403, JSON.stringify(lista.dados));
        const post = await checkIn(pessoa.token, { id: '00000000-0000-0000-0000-000000000000' });
        assert.strictEqual(post.status, 403, JSON.stringify(post.dados));
    }
});

test('a ficha exige atendente: instrutor e cliente recebem 403, sem registrar acesso', async () => {
    const id = await agendamento();
    for (const pessoa of [instrutor, cliente]) {
        const r = await operacao(pessoa.token, { consulta: `id=${id}` });
        assert.strictEqual(r.status, 403, JSON.stringify(r.dados));
        assert.ok(!JSON.stringify(r.dados).includes(cliente.cpf), 'o 403 não deveria conter CPF');
        const acessos = await rest(`acessos_dados?usuario_id=eq.${pessoa.id}&recurso=eq.operacao.ficha`);
        assert.strictEqual(acessos.dados.length, 0);
    }
});

test('superadmin passa', async () => {
    const r = await operacao(superadmin.token, { consulta: 'area=recepcao' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.ok(Array.isArray(r.dados.agendamentos));
});

test('outros métodos dão 405 e área desconhecida dá 400', async () => {
    const r = await operacao(atendente.token, { metodo: 'PUT', corpo: {} });
    assert.strictEqual(r.status, 405, JSON.stringify(r.dados));
    const area = await operacao(atendente.token, { consulta: 'area=cozinha' });
    assert.strictEqual(area.status, 400, JSON.stringify(area.dados));
    assert.strictEqual(area.dados.erro, 'Esta área da operação não existe.');
    const semArea = await operacao(atendente.token);
    assert.strictEqual(semArea.status, 400, JSON.stringify(semArea.dados));
    assert.strictEqual(semArea.dados.erro, 'Escolha uma área da operação.');
    const acao = await operacao(atendente.token, { metodo: 'POST', corpo: { acao: 'cozinhar' } });
    assert.strictEqual(acao.status, 400, JSON.stringify(acao.dados));
    assert.strictEqual(acao.dados.erro, 'Esta ação não existe.');
});

test('a lista da recepção traz só as sessões de hoje, sem canceladas, em ordem', async () => {
    const deHoje = await agendamento();
    const deAmanha = await agendamento({ dias: 1 });
    const cancelada = await agendamento();
    await mudar(cancelada, { situacao: 'cancelado' });

    const r = await operacao(atendente.token, { consulta: 'area=recepcao' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.hoje, hoje);
    assert.strictEqual(r.dados.fuso, fuso);
    const lista = r.dados.agendamentos;
    const ids = lista.map(a => a.id);
    assert.ok(ids.includes(deHoje), 'a sessão de hoje deveria aparecer');
    assert.ok(!ids.includes(deAmanha), 'a sessão de amanhã não deveria aparecer');
    assert.ok(!ids.includes(cancelada), 'a sessão cancelada não deveria aparecer');
    for (const a of lista) {
        assert.strictEqual(dataNoFuso(new Date(a.inicio), fuso), hoje);
        assert.notStrictEqual(a.situacao, 'cancelado');
    }
    const inicios = lista.map(a => new Date(a.inicio).getTime());
    assert.deepStrictEqual(inicios, [...inicios].sort((a, b) => a - b));

    const linha = lista.find(a => a.id === deHoje);
    assert.strictEqual(linha.horas, 1);
    assert.strictEqual(linha.situacao, 'aguardando_pagamento');
    assert.deepStrictEqual(linha.responsavel, { nome: nomeDoCliente, telefone: '11999999999' });
    assert.strictEqual(linha.pessoas, 1);
    assert.strictEqual(linha.pistas.length, 1);
    assert.strictEqual(linha.instrutores.length, 1);
    assert.strictEqual(linha.valor_centavos, 25500);
    assert.strictEqual(linha.pago_no_balcao_centavos, null);
    assert.ok(!JSON.stringify(linha).includes(cliente.cpf), 'a lista não deveria conter CPF');

    // Um id vazio conta como ausente: devolve a lista.
    const vazio = await operacao(atendente.token, { consulta: 'id=&area=recepcao' });
    assert.strictEqual(vazio.status, 200, JSON.stringify(vazio.dados));
    assert.ok(vazio.dados.agendamentos.some(a => a.id === deHoje));
});

test('a ficha traz CPFs, classes ativas e registra o acesso', async () => {
    const id = await agendamento();
    const r = await operacao(atendente.token, { consulta: `id=${id}` });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const { agendamento: ficha, classes } = r.dados;
    assert.strictEqual(ficha.id, id);
    assert.deepStrictEqual(ficha.responsavel, { nome: nomeDoCliente });
    assert.strictEqual(ficha.situacao, 'aguardando_pagamento');
    assert.strictEqual(ficha.preco_total_centavos, 25500);
    assert.deepStrictEqual(ficha.preco_detalhe, PRECO);
    assert.strictEqual(ficha.pagamento, null);
    assert.strictEqual(ficha.participantes.length, 1);
    assert.deepStrictEqual(ficha.participantes[0], {
        nome_completo: 'Cliente Teste', cpf: cliente.cpf, data_nascimento: '1990-01-01', modalidade: 'estande',
        modelo: `${modelo.marca} Modelo Teste`, tipo_municao: tipoMunicao.nome, municao_qtd: MUNICAO_QTD,
    });

    const minha = classes.find(c => c.id === classe.id);
    assert.deepStrictEqual(minha, {
        id: classe.id, nome: classe.nome, percentual_pista: 20, percentual_aluguel: 10, percentual_municao: 15,
    });
    assert.ok(!classes.some(c => c.id === classeDesativada.id), 'classe desativada não deveria aparecer');
    assert.strictEqual(r.dados.custo_municao_centavos, MUNICAO_QTD * CUSTO_UNIDADE);
    assert.strictEqual(r.dados.pode_fazer_check_in, true);
    assert.strictEqual(r.dados.motivo, null);
    assert.strictEqual(r.dados.fuso, fuso);

    const acessos = await rest(`acessos_dados?usuario_id=eq.${atendente.id}&recurso=eq.operacao.ficha&registro=eq.${id}`);
    assert.strictEqual(acessos.status, 200, JSON.stringify(acessos.dados));
    assert.strictEqual(acessos.dados.length, 1);

    const nao = await operacao(atendente.token, { consulta: 'id=00000000-0000-0000-0000-000000000000' });
    assert.strictEqual(nao.status, 404, JSON.stringify(nao.dados));
    assert.strictEqual(nao.dados.erro, 'Não encontramos este agendamento.');
});

// A ficha mostra CPFs: só abre para as sessões de hoje que não foram canceladas (spec 3).
async function fichaNaoAbre(id) {
    const r = await operacao(atendente.token, { consulta: `id=${id}` });
    assert.strictEqual(r.status, 404, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Não encontramos este agendamento.');
    assert.ok(!JSON.stringify(r.dados).includes(cliente.cpf), 'o 404 não deveria conter CPF');
    const acessos = await rest(`acessos_dados?usuario_id=eq.${atendente.id}&recurso=eq.operacao.ficha&registro=eq.${id}`);
    assert.strictEqual(acessos.dados.length, 0, 'a ficha recusada não deveria registrar acesso');
}

test('a ficha de uma sessão de amanhã responde 404', async () => {
    await fichaNaoAbre(await agendamento({ dias: 1 }));
});

test('a ficha de um agendamento cancelado de hoje responde 404', async () => {
    const id = await agendamento();
    await mudar(id, { situacao: 'cancelado' });
    await fichaNaoAbre(id);
});

test('check-in sem classe', async () => {
    const id = await agendamento();
    const r = await checkIn(atendente.token, {
        id, forma_pagamento: 'pix', classe_id: null, documento: null, valor_esperado_centavos: 25500,
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { agendamento: { id, situacao: 'check_in' } });
    assert.strictEqual(await situacao(id), 'check_in');

    const [linha, ...resto] = await pagamentos(id);
    assert.strictEqual(resto.length, 0);
    assert.strictEqual(linha.valor_centavos, 25500);
    assert.strictEqual(linha.desconto_centavos, 0);
    assert.strictEqual(linha.forma, 'pix');
    assert.strictEqual(linha.classe_id, null);
    assert.strictEqual(linha.documento, null);
    assert.strictEqual(linha.conta, null);
    assert.strictEqual(linha.registrado_por, atendente.id);

    // A lista mostra o valor pago no balcão; um segundo check-in é recusado.
    const lista = await operacao(atendente.token, { consulta: 'area=recepcao' });
    assert.strictEqual(lista.dados.agendamentos.find(a => a.id === id).pago_no_balcao_centavos, 25500);
    const ficha = await operacao(atendente.token, { consulta: `id=${id}` });
    assert.strictEqual(ficha.dados.agendamento.pagamento.valor_centavos, 25500);
    assert.strictEqual(ficha.dados.pode_fazer_check_in, false);
    const segundo = await checkIn(atendente.token, {
        id, forma_pagamento: 'pix', classe_id: null, documento: null, valor_esperado_centavos: 25500,
    });
    assert.strictEqual(segundo.status, 409, JSON.stringify(segundo.dados));
    assert.strictEqual(segundo.dados.erro, 'O check-in deste agendamento já foi feito.');
    assert.strictEqual((await pagamentos(id)).length, 1);
});

test('check-in com classe aplica a conta por parte', async () => {
    const id = await agendamento();
    const conta = descontoDeClasse(PRECO, classe, MUNICAO_QTD * CUSTO_UNIDADE);
    assert.strictEqual(conta.limitado_ao_custo, true, 'o teste deveria exercitar o limite do custo');
    const r = await checkIn(atendente.token, {
        id, forma_pagamento: 'cartao_credito', classe_id: classe.id, documento: '  CR-12345  ',
        valor_esperado_centavos: conta.valor_cobrado_centavos,
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));

    const [linha] = await pagamentos(id);
    assert.strictEqual(linha.valor_centavos, conta.valor_cobrado_centavos);
    assert.strictEqual(linha.desconto_centavos, conta.desconto_centavos);
    assert.strictEqual(linha.classe_id, classe.id);
    assert.strictEqual(linha.documento, 'CR-12345');
    assert.strictEqual(linha.forma, 'cartao_credito');
    assert.deepStrictEqual(linha.conta, conta);
});

test('valor esperado diferente é recusado com 409', async () => {
    const id = await agendamento();
    const r = await checkIn(atendente.token, {
        id, forma_pagamento: 'dinheiro', classe_id: classe.id, documento: 'CR-1', valor_esperado_centavos: 25500,
    });
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'O valor mudou. Confira a ficha de novo.');
    await nadaGravado(id);
});

test('classe desativada é recusada com 409', async () => {
    const id = await agendamento();
    for (const classeId of [classeDesativada.id, 2000000000]) {
        const r = await checkIn(atendente.token, {
            id, forma_pagamento: 'dinheiro', classe_id: classeId, documento: 'CR-1', valor_esperado_centavos: 25500,
        });
        assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
        assert.strictEqual(r.dados.erro, 'Esta classe de desconto não está mais disponível. Escolha outra.');
    }
    await nadaGravado(id);
});

test('sessão de amanhã é recusada com 409', async () => {
    const id = await agendamento({ dias: 1 });
    const r = await checkIn(atendente.token, {
        id, forma_pagamento: 'pix', classe_id: null, documento: null, valor_esperado_centavos: 25500,
    });
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'O check-in só pode ser feito no dia da sessão.');
    await nadaGravado(id);
});

test('campos errados dão 400 com os campos destacados', async () => {
    const id = await agendamento();
    const r = await checkIn(atendente.token, { id, forma_pagamento: 'cheque', classe_id: null, documento: null });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Revise os campos destacados.');
    assert.ok(r.dados.campos.forma_pagamento);
    assert.ok(r.dados.campos.valor_esperado_centavos);
    await nadaGravado(id);

    const nao = await checkIn(atendente.token, {
        id: '00000000-0000-0000-0000-000000000000', forma_pagamento: 'pix', valor_esperado_centavos: 1,
    });
    assert.strictEqual(nao.status, 404, JSON.stringify(nao.dados));
});

test('pago pelo app faz o check-in sem pagamento', async () => {
    const id = await agendamento();
    await mudar(id, { situacao: 'pago' });
    const comPagamento = await checkIn(atendente.token, { id, forma_pagamento: 'pix', valor_esperado_centavos: 25500 });
    assert.strictEqual(comPagamento.status, 400, JSON.stringify(comPagamento.dados));
    const r = await checkIn(atendente.token, { id });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(await situacao(id), 'check_in');
    assert.strictEqual((await pagamentos(id)).length, 0);
});

test('agendamento sem preço guardado aceita valor digitado e recusa classe', async () => {
    const id = await agendamento();
    await mudar(id, { preco_total_centavos: null, preco_detalhe: null });

    const ficha = await operacao(atendente.token, { consulta: `id=${id}` });
    assert.strictEqual(ficha.status, 200, JSON.stringify(ficha.dados));
    assert.strictEqual(ficha.dados.agendamento.preco_total_centavos, null);
    assert.strictEqual(ficha.dados.agendamento.preco_detalhe, null);

    const comClasse = await checkIn(atendente.token, {
        id, forma_pagamento: 'pix', classe_id: classe.id, documento: 'CR-1', valor_centavos: 15000,
    });
    assert.strictEqual(comClasse.status, 400, JSON.stringify(comClasse.dados));
    assert.ok(comClasse.dados.campos.classe_id);
    await nadaGravado(id);

    const r = await checkIn(atendente.token, {
        id, forma_pagamento: 'dinheiro', classe_id: null, documento: null, valor_centavos: 15000,
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const [linha] = await pagamentos(id);
    assert.strictEqual(linha.valor_centavos, 15000);
    assert.strictEqual(linha.desconto_centavos, 0);
    assert.strictEqual(linha.conta, null);
});
