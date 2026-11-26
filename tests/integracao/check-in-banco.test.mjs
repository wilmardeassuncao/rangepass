// tests/integracao/check-in-banco.test.mjs
// A RPC fazer_check_in: grava o pagamento do balcão e muda a situação para check_in numa transação só.
// Também confere as regras novas do banco: classes de desconto com um percentual por parte do preço.
// O banco de desenvolvimento pode ter outros dados, então os testes não supõem que só existe o que criam aqui.
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import {
    rest, rpc, marcador,
    criarUsuario, criar, tentarCriar, anotarRegistro, apagarTudoCriado, anotarAgendamento,
} from './apoio.mjs';

// Os testes apagam tudo o que criam: pagamentos e agendamentos (com reservas e histórico), catálogo,
// classes de desconto e usuários (inclusive o instrutor de teste).
after(apagarTudoCriado);

let cliente, instrutor, atendente, modelo, tipoMunicao, classe;

before(async () => {
    cliente = await criarUsuario({ papeis: ['cliente'] });
    instrutor = await criarUsuario({ papeis: ['instrutor'] });
    atendente = await criarUsuario({ papeis: ['atendente'] });
    const categoria = await criar('categorias', { nome: `Categoria ${marcador()}` });
    const calibre = await criar('calibres', { nome: `Calibre ${marcador()}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Teste' });
    tipoMunicao = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Munição ${marcador()}` });
    // Uma unidade para cada agendamento de teste (todos são de hoje, mas em horas diferentes).
    await criar('unidades_arma', { modelo_id: modelo.id, numero_registro: `REG-${marcador()}` });
    classe = await criar('classes_desconto', {
        nome: `Classe ${marcador()}`, percentual_pista: 20, percentual_aluguel: 10, percentual_municao: 15,
    });
});

let proximaHora = 0;

// Cria um agendamento de hoje com o instrutor de teste, cada um numa hora diferente (o instrutor e a
// arma não podem estar em dois agendamentos ao mesmo tempo). criar_agendamento não confere antecedência.
async function agendamentoDeHoje() {
    const inicio = new Date();
    inicio.setUTCMinutes(0, 0, 0);
    inicio.setUTCHours(inicio.getUTCHours() - 6 + proximaHora);
    proximaHora += 1;
    const r = await rpc('criar_agendamento', {
        p_responsavel: cliente.id,
        p_pedido: {
            inicio: inicio.toISOString(), horas: 1, instrutor_id: instrutor.id, instrutores_necessarios: 1,
            participantes: [{
                nome_completo: 'Cliente Teste', cpf: cliente.cpf, data_nascimento: '1990-01-01', perfil_id: cliente.id,
                modalidade: 'estande', termo_versao: null, modelo_id: modelo.id,
                tipo_municao_id: tipoMunicao.id, municao_qtd: 50, arma_propria: null,
            }],
        },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    anotarAgendamento(r.dados);
    return r.dados;
}

function checkIn(agendamento, pagamento, autor = atendente.id) {
    return rpc('fazer_check_in', { p_agendamento: agendamento, p_pagamento: pagamento, p_autor: autor });
}

const PAGAMENTO = { valor_centavos: 25500, forma: 'pix' };

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

function assertErro(r, codigo, mensagem) {
    assert.strictEqual(r.dados?.code, codigo, `${r.status} ${JSON.stringify(r.dados)}`);
    if (mensagem) assert.strictEqual(r.dados.message, mensagem);
}

test('check-in com pagamento grava o pagamento e muda a situação', async () => {
    const id = await agendamentoDeHoje();
    const r = await checkIn(id, PAGAMENTO);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.id, id);
    assert.strictEqual(r.dados.situacao, 'check_in');
    assert.strictEqual(await situacao(id), 'check_in');

    const linhas = await pagamentos(id);
    assert.strictEqual(linhas.length, 1);
    assert.strictEqual(linhas[0].valor_centavos, 25500);
    assert.strictEqual(linhas[0].forma, 'pix');
    assert.strictEqual(linhas[0].registrado_por, atendente.id);
    assert.strictEqual(linhas[0].classe_id, null);
    assert.strictEqual(linhas[0].documento, null);
    assert.strictEqual(linhas[0].desconto_centavos, 0);
});

test('check-in com classe grava a classe, o documento, a conta e o desconto', async () => {
    const id = await agendamentoDeHoje();
    const conta = { valor_cobrado_centavos: 21325, limitado_pelo_custo: false };
    const r = await checkIn(id, {
        valor_centavos: 21325, forma: 'cartao_credito', classe_id: classe.id, documento: 'CR-12345',
        conta, desconto_centavos: 4175,
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));

    const [linha] = await pagamentos(id);
    assert.strictEqual(linha.classe_id, classe.id);
    assert.strictEqual(linha.documento, 'CR-12345');
    assert.deepStrictEqual(linha.conta, conta);
    assert.strictEqual(linha.desconto_centavos, 4175);
    assert.strictEqual(linha.forma, 'cartao_credito');
});

test('check-in duas vezes: a segunda é recusada e nada é gravado em dobro', async () => {
    const id = await agendamentoDeHoje();
    assert.strictEqual((await checkIn(id, PAGAMENTO)).status, 200);
    const r = await checkIn(id, PAGAMENTO);
    assertErro(r, 'P0001', 'O check-in deste agendamento já foi feito.');
    assert.strictEqual((await pagamentos(id)).length, 1);
    assert.strictEqual(await situacao(id), 'check_in');
});

test('aguardando pagamento sem pagamento é recusado', async () => {
    const id = await agendamentoDeHoje();
    assertErro(await checkIn(id, null), 'P0001', 'Registre o pagamento para fazer o check-in.');
    assert.strictEqual(await situacao(id), 'aguardando_pagamento');
    assert.strictEqual((await pagamentos(id)).length, 0);
});

test('cancelado é recusado', async () => {
    const id = await agendamentoDeHoje();
    const c = await rest(`agendamentos?id=eq.${id}`, { metodo: 'PATCH', corpo: { situacao: 'cancelado' } });
    assert.strictEqual(c.status, 200, JSON.stringify(c.dados));
    assertErro(await checkIn(id, PAGAMENTO), 'P0001', 'Este agendamento foi cancelado.');
    assert.strictEqual(await situacao(id), 'cancelado');
    assert.strictEqual((await pagamentos(id)).length, 0);
});

test('não compareceu e concluído são recusados', async () => {
    const id = await agendamentoDeHoje();
    let c = await rest(`agendamentos?id=eq.${id}`, { metodo: 'PATCH', corpo: { situacao: 'nao_compareceu' } });
    assert.strictEqual(c.status, 200, JSON.stringify(c.dados));
    assertErro(await checkIn(id, PAGAMENTO), 'P0001', 'Este agendamento foi marcado como não compareceu.');

    c = await rest(`agendamentos?id=eq.${id}`, { metodo: 'PATCH', corpo: { situacao: 'concluido' } });
    assert.strictEqual(c.status, 200, JSON.stringify(c.dados));
    assertErro(await checkIn(id, PAGAMENTO), 'P0001', 'O check-in deste agendamento já foi feito.');
    assert.strictEqual((await pagamentos(id)).length, 0);
});

test('pago pelo app: check-in sem pagamento passa; com pagamento é recusado', async () => {
    const id = await agendamentoDeHoje();
    const c = await rest(`agendamentos?id=eq.${id}`, { metodo: 'PATCH', corpo: { situacao: 'pago' } });
    assert.strictEqual(c.status, 200, JSON.stringify(c.dados));
    assertErro(await checkIn(id, PAGAMENTO), 'P0001', 'Este agendamento já foi pago pelo app.');
    assert.strictEqual(await situacao(id), 'pago');

    const r = await checkIn(id, null);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.situacao, 'check_in');
    assert.strictEqual((await pagamentos(id)).length, 0);
});

test('agendamento inexistente dá P0002', async () => {
    assertErro(await checkIn('00000000-0000-0000-0000-000000000000', PAGAMENTO), 'P0002', 'Não encontramos este agendamento.');
});

test('classe sem documento é recusada pelo banco', async () => {
    const id = await agendamentoDeHoje();
    const r = await checkIn(id, { ...PAGAMENTO, classe_id: classe.id });
    assertErro(r, '23514');
    const vazio = await checkIn(id, { ...PAGAMENTO, classe_id: classe.id, documento: '   ' });
    assertErro(vazio, '23514');
    const longo = await checkIn(id, { ...PAGAMENTO, classe_id: classe.id, documento: 'x'.repeat(61) });
    assertErro(longo, '23514');
    const semClasse = await checkIn(id, { ...PAGAMENTO, documento: 'CR-1' });
    assertErro(semClasse, '23514');
    assert.strictEqual(await situacao(id), 'aguardando_pagamento');
    assert.strictEqual((await pagamentos(id)).length, 0);
});

test('classe com os três percentuais em 0 é recusada', async () => {
    const r = await tentarCriar('classes_desconto', {
        nome: `Classe ${marcador()}`, percentual_pista: 0, percentual_aluguel: 0, percentual_municao: 0,
    });
    assertErro(r, '23514');
    const acima = await tentarCriar('classes_desconto', {
        nome: `Classe ${marcador()}`, percentual_pista: 91, percentual_aluguel: 0, percentual_municao: 0,
    });
    assertErro(acima, '23514');
    const umSo = await tentarCriar('classes_desconto', {
        nome: `Classe ${marcador()}`, percentual_pista: 0, percentual_aluguel: 0, percentual_municao: 5,
    });
    assert.strictEqual(umSo.status, 201, JSON.stringify(umSo.dados));
});

test('a coluna percentual antiga saiu e o custo de compra existe', async () => {
    const r = await rest(`classes_desconto?id=eq.${classe.id}&select=percentual`);
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    const custo = await rest(`tipos_municao?id=eq.${tipoMunicao.id}`, { metodo: 'PATCH', corpo: { custo_compra_centavos: 0 } });
    assertErro(custo, '23514');
    const ok = await rest(`tipos_municao?id=eq.${tipoMunicao.id}`, { metodo: 'PATCH', corpo: { custo_compra_centavos: 120 } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.dados));
    assert.strictEqual(ok.dados[0].custo_compra_centavos, 120);
});

test('salvar_promocao e salvar_cadastro aceitam os campos novos', async () => {
    const p = await rpc('salvar_promocao', {
        p_tipo: 'classe', p_id: null, p_autor: atendente.id,
        p_dados: { nome: `Classe ${marcador()}`, percentual_pista: 30, percentual_aluguel: 0, percentual_municao: 5 },
    });
    assert.strictEqual(p.status, 200, JSON.stringify(p.dados));
    anotarRegistro('classes_desconto', p.dados.id);
    const criada = await rest(`classes_desconto?id=eq.${p.dados.id}`);
    assert.deepStrictEqual(
        [criada.dados[0].percentual_pista, criada.dados[0].percentual_aluguel, criada.dados[0].percentual_municao], [30, 0, 5]);

    const e = await rpc('salvar_promocao', { p_tipo: 'classe', p_id: p.dados.id, p_autor: atendente.id, p_dados: { percentual_aluguel: 12 } });
    assert.strictEqual(e.status, 200, JSON.stringify(e.dados));
    assert.strictEqual(e.dados.percentual_aluguel, 12);
    assert.strictEqual(e.dados.percentual_pista, 30);

    const antigo = await rpc('salvar_promocao', { p_tipo: 'classe', p_id: p.dados.id, p_autor: atendente.id, p_dados: { percentual: 10 } });
    assertErro(antigo, '22023');

    const c = await rpc('salvar_cadastro', {
        p_tipo: 'tipo_municao', p_id: tipoMunicao.id, p_autor: atendente.id, p_dados: { custo_compra_centavos: 95 },
    });
    assert.strictEqual(c.status, 200, JSON.stringify(c.dados));
    assert.strictEqual(c.dados.custo_compra_centavos, 95);
});

test('o histórico registra o pagamento com o autor', async () => {
    const id = await agendamentoDeHoje();
    assert.strictEqual((await checkIn(id, PAGAMENTO)).status, 200);
    const [linha] = await pagamentos(id);
    const h = await rest(`historico_alteracoes?tabela=eq.pagamentos&registro_id=eq.${linha.id}`);
    assert.strictEqual(h.status, 200, JSON.stringify(h.dados));
    assert.strictEqual(h.dados.length, 1);
    assert.strictEqual(h.dados[0].feito_por, atendente.id);
    assert.strictEqual(h.dados[0].acao, 'insercao');
});
