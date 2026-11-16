// tests/integracao/agendar-banco.test.mjs
// A RPC criar_agendamento: escolhe instrutores, pistas e armas livres dentro de uma transação.
// O banco de desenvolvimento pode ter outros dados (pistas, instrutores...), então os testes não supõem
// que só existem os recursos criados aqui.
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import {
    rest, rpc, marcador, cpfAleatorio,
    criarUsuario, criar, tentarCriar, apagarTudoCriado, anotarAgendamento,
    banirUsuario, desbanirUsuario,
} from './apoio.mjs';

// Os testes apagam tudo o que criam: agendamentos (com reservas e histórico), catálogo, interdições e usuários.
after(apagarTudoCriado);

let cliente, instrutorA, instrutorB, pistas, modelo, tipoMunicao, unidadesLivres, unidadeManutencao;

before(async () => {
    cliente = await criarUsuario({ papeis: ['cliente'] });
    instrutorA = await criarUsuario({ papeis: ['instrutor'] });
    instrutorB = await criarUsuario({ papeis: ['instrutor'] });
    pistas = [await novaPista(), await novaPista()];
    const categoria = await criar('categorias', { nome: `Categoria ${marcador()}` });
    const calibre = await criar('calibres', { nome: `Calibre ${marcador()}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Teste' });
    tipoMunicao = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Munição ${marcador()}` });
    unidadesLivres = [await novaUnidade(), await novaUnidade()];
    unidadeManutencao = await novaUnidade('manutencao');
});

function novaPista() {
    return criar('pistas', { numero: 100000000 + Math.floor(Math.random() * 1000000000) });
}

function novaUnidade(situacao = 'disponivel') {
    return criar('unidades_arma', { modelo_id: modelo.id, numero_registro: `REG-${marcador()}`, situacao });
}

function participanteEstande(extra = {}) {
    return {
        nome_completo: 'Participante Teste', cpf: cpfAleatorio(), data_nascimento: '1990-01-01', perfil_id: null,
        modalidade: 'estande', termo_versao: null, modelo_id: modelo.id,
        tipo_municao_id: tipoMunicao.id, municao_qtd: 50, arma_propria: null, ...extra,
    };
}

const ARMA = { modelo: 'Glock G17', calibre: '9mm', numero_registro: 'ABC123', responsavel: 'Participante Teste' };

// PedidoNormalizado (Task 1) de 1 participante "estande": o próprio cliente, com o instrutor A.
function pedido(extra = {}) {
    return {
        inicio: '2030-08-01T10:00:00-03:00', horas: 1, instrutor_id: instrutorA.id, instrutores_necessarios: 1,
        participantes: [participanteEstande({ nome_completo: 'Cliente Teste', cpf: cliente.cpf, perfil_id: cliente.id })],
        ...extra,
    };
}

// Chama a RPC; se ela criar o agendamento, anota o id para apagar no fim.
async function agendar(p) {
    const r = await rpc('criar_agendamento', { p_responsavel: cliente.id, p_pedido: p });
    if (r.status === 200 && typeof r.dados === 'string') anotarAgendamento(r.dados);
    return r;
}

function assertErro(r, codigo) {
    assert.strictEqual(r.dados?.code, codigo, `${r.status} ${JSON.stringify(r.dados)}`);
}

// Agendamento feito direto nas tabelas (sem a RPC), para ocupar recursos num período.
function agendamentoDireto(inicio, horas = 1) {
    return criar('agendamentos', { responsavel_id: cliente.id, inicio, horas, forma_pagamento: 'balcao' });
}

// Ocupa cada instrutor no período. Quem já está ocupado (23P01) ou não tem perfil (23503) já não está livre.
async function ocuparInstrutores(ids, inicio, horas = 1) {
    const ag = await agendamentoDireto(inicio, horas);
    for (const id of ids) {
        const r = await tentarCriar('agendamento_instrutores', { agendamento_id: ag.id, instrutor_id: id });
        assert.ok(r.status === 201 || ['23P01', '23503'].includes(r.dados?.code), `${r.status} ${JSON.stringify(r.dados)}`);
    }
}

async function todosInstrutores() {
    const r = await rest('papeis_usuario?papel=eq.instrutor&select=usuario_id');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    return r.dados.map(l => l.usuario_id);
}

async function linhas(tabela, agendamentoId, select = '*') {
    const r = await rest(`${tabela}?agendamento_id=eq.${agendamentoId}&select=${select}`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    return r.dados;
}

test('configuracoes tem o termo', async () => {
    const r = await rest('configuracoes?chave=eq.termo&select=valor');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados[0].valor.versao, 1);
    assert.match(r.dados[0].valor.texto, /advogado/);
});

test('cria com o instrutor escolhido', async () => {
    const r = await agendar(pedido());
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const id = r.dados;

    const instrutores = await linhas('agendamento_instrutores', id);
    assert.strictEqual(instrutores.length, 1);
    assert.strictEqual(instrutores[0].principal, true);
    assert.strictEqual(instrutores[0].instrutor_id, instrutorA.id);
    assert.strictEqual((await linhas('agendamento_pistas', id)).length, 1);
    const unidades = await linhas('agendamento_unidades', id);
    assert.strictEqual(unidades.length, 1);
    assert.ok(unidadesLivres.some(u => u.id === unidades[0].unidade_id), JSON.stringify(unidades));
    assert.notStrictEqual(unidades[0].unidade_id, unidadeManutencao.id);

    const ag = await rest(`agendamentos?id=eq.${id}&select=forma_pagamento,instrutor_escolhido_id`);
    assert.strictEqual(ag.dados[0].forma_pagamento, 'balcao');
    assert.strictEqual(ag.dados[0].instrutor_escolhido_id, instrutorA.id);

    const h = await rest(`historico_alteracoes?tabela=eq.agendamentos&registro_id=eq.${id}&select=feito_por`);
    assert.strictEqual(h.dados.length, 1);
    assert.strictEqual(h.dados[0].feito_por, cliente.id);
});

test('instrutor escolhido ocupado dá RP001', async () => {
    const inicio = '2030-08-02T10:00:00-03:00';
    await ocuparInstrutores([instrutorA.id], inicio);
    const contar = async () => (await rest(`agendamentos?responsavel_id=eq.${cliente.id}&select=id`)).dados.length;
    const antes = await contar();

    const r = await agendar(pedido({ inicio }));
    assertErro(r, 'RP001');
    assert.strictEqual(await contar(), antes, 'a transação deveria ter sido desfeita');
});

test('sem preferência escolhe o instrutor com menos reservas', async () => {
    const inicio = '2030-08-03T10:00:00-03:00';
    const outros = (await todosInstrutores()).filter(id => id !== instrutorA.id && id !== instrutorB.id);
    await ocuparInstrutores(outros, inicio);
    await ocuparInstrutores([instrutorA.id], '2030-08-03T15:00:00-03:00');

    const r = await agendar(pedido({ inicio, instrutor_id: null }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const instrutores = await linhas('agendamento_instrutores', r.dados);
    assert.strictEqual(instrutores.length, 1);
    assert.strictEqual(instrutores[0].instrutor_id, instrutorB.id);
    assert.strictEqual(instrutores[0].principal, true);
});

test('sem instrutores livres dá RP002', async () => {
    const inicio = '2030-08-04T10:00:00-03:00';
    await ocuparInstrutores(await todosInstrutores(), inicio);
    const r = await agendar(pedido({ inicio, instrutor_id: null }));
    assertErro(r, 'RP002');
});

test('sem pistas livres dá RP003', async () => {
    const r0 = await rest('pistas?ativa=eq.true&select=id');
    assert.strictEqual(r0.status, 200, JSON.stringify(r0.dados));
    for (const { id } of r0.dados) {
        await criar('interdicoes', { pista_id: id, periodo: '[2030-08-05 09:00-03,2030-08-05 12:00-03)', motivo: `teste ${marcador()}` });
    }
    const r = await agendar(pedido({ inicio: '2030-08-05T10:00:00-03:00' }));
    assertErro(r, 'RP003');
});

test('sem unidade livre do modelo dá RP004', async () => {
    const inicio = '2030-08-06T10:00:00-03:00';
    const ag = await agendamentoDireto(inicio);
    for (const unidade of unidadesLivres) {
        const p = await criar('participantes', {
            agendamento_id: ag.id, nome_completo: 'Ocupante Teste', cpf: cpfAleatorio(), data_nascimento: '1990-01-01', modalidade: 'estande',
        });
        await criar('agendamento_unidades', { agendamento_id: ag.id, unidade_id: unidade.id, participante_id: p.id });
    }
    const r = await agendar(pedido({ inicio }));
    assertErro(r, 'RP004');
});

test('grupo de 6 ocupa 2 instrutores e 2 pistas', async () => {
    const proprio = { termo_versao: 1, modelo_id: null, arma_propria: ARMA };
    const participantes = [
        participanteEstande({ nome_completo: 'Cliente Teste', cpf: cliente.cpf, perfil_id: cliente.id }),
        participanteEstande({ ...proprio, modalidade: 'arma_propria' }),
        ...Array.from({ length: 4 }, () => participanteEstande({ ...proprio, modalidade: 'tudo_proprio', tipo_municao_id: null, municao_qtd: null })),
    ];
    const r = await agendar(pedido({ inicio: '2030-08-07T10:00:00-03:00', horas: 2, instrutores_necessarios: 2, participantes }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const id = r.dados;

    const instrutores = await linhas('agendamento_instrutores', id);
    assert.strictEqual(instrutores.length, 2);
    assert.strictEqual(instrutores.filter(i => i.principal).length, 1);
    assert.strictEqual(instrutores.find(i => i.principal).instrutor_id, instrutorA.id);
    assert.strictEqual((await linhas('agendamento_pistas', id)).length, 2);
    assert.strictEqual((await linhas('agendamento_unidades', id)).length, 1);

    const parts = await linhas('participantes', id, 'id,modalidade,termo_versao,aceite_termo_em');
    assert.strictEqual(parts.length, 6);
    for (const p of parts) {
        if (p.modalidade === 'estande') {
            assert.strictEqual(p.termo_versao, null);
            assert.strictEqual(p.aceite_termo_em, null);
        } else {
            assert.strictEqual(p.termo_versao, 1);
            assert.ok(p.aceite_termo_em, JSON.stringify(p));
        }
    }
    const itens = await rest(`itens_participante?participante_id=in.(${parts.map(p => p.id).join(',')})&select=arma_propria`);
    assert.strictEqual(itens.dados.length, 6);
    assert.strictEqual(itens.dados.filter(i => i.arma_propria).length, 5);
});

test('grupo com 2 participantes estande do mesmo modelo recebe 2 unidades diferentes', async () => {
    const participantes = [
        participanteEstande({ nome_completo: 'Cliente Teste', cpf: cliente.cpf, perfil_id: cliente.id }),
        participanteEstande(),
    ];
    const r = await agendar(pedido({ inicio: '2030-08-08T10:00:00-03:00', participantes }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const unidades = await linhas('agendamento_unidades', r.dados);
    assert.strictEqual(unidades.length, 2);
    assert.notStrictEqual(unidades[0].unidade_id, unidades[1].unidade_id);
    for (const u of unidades) assert.ok(unidadesLivres.some(l => l.id === u.unidade_id), JSON.stringify(unidades));
});

// --- Alterar o horário e cancelar ---
// Cada teste usa um dia próprio, então as 2 unidades do modelo de teste estão livres em todos.

function alterar(id, inicio, horas = 1, autor = cliente.id) {
    return rpc('alterar_horario_agendamento', { p_agendamento: id, p_inicio: inicio, p_horas: horas, p_autor: autor });
}

// Cria pela RPC e devolve o id (falha o teste se não conseguir).
async function agendarOk(p) {
    const r = await agendar(p);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    return r.dados;
}

// A reserva de instrutor, de pista e de unidade do agendamento (uma de cada, nestes testes).
async function recursos(id) {
    const instrutores = await linhas('agendamento_instrutores', id);
    const pistasAg = await linhas('agendamento_pistas', id);
    const unidades = await linhas('agendamento_unidades', id);
    assert.strictEqual(instrutores.length, 1, JSON.stringify(instrutores));
    assert.strictEqual(pistasAg.length, 1, JSON.stringify(pistasAg));
    assert.strictEqual(unidades.length, 1, JSON.stringify(unidades));
    return { instrutor: instrutores[0], pista: pistasAg[0], unidade: unidades[0] };
}

async function lerAgendamento(id) {
    const r = await rest(`agendamentos?id=eq.${id}&select=periodo,inicio,horas,situacao`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    return r.dados[0];
}

test('alterar mantém os recursos livres', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-10T10:00:00-03:00' }));
    const antes = await recursos(id);

    const r = await alterar(id, '2030-08-10T15:00:00-03:00');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.id, id);
    assert.strictEqual(Date.parse(r.dados.inicio), Date.parse('2030-08-10T15:00:00-03:00'));

    const depois = await recursos(id);
    assert.strictEqual(depois.instrutor.instrutor_id, antes.instrutor.instrutor_id);
    assert.strictEqual(depois.pista.pista_id, antes.pista.pista_id);
    assert.strictEqual(depois.unidade.unidade_id, antes.unidade.unidade_id);
    const { periodo } = await lerAgendamento(id);
    assert.notStrictEqual(periodo, antes.pista.periodo);
    for (const reserva of Object.values(depois)) {
        assert.strictEqual(reserva.periodo, periodo);
        assert.strictEqual(reserva.ativo, true);
    }
});

test('alterar troca só a pista interditada', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-11T10:00:00-03:00' }));
    const antes = await recursos(id);
    await criar('interdicoes', { pista_id: antes.pista.pista_id, periodo: '[2030-08-11 15:00-03,2030-08-11 16:00-03)', motivo: `teste ${marcador()}` });

    const r = await alterar(id, '2030-08-11T15:00:00-03:00');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const depois = await recursos(id);
    assert.notStrictEqual(depois.pista.pista_id, antes.pista.pista_id);
    assert.strictEqual(depois.instrutor.instrutor_id, antes.instrutor.instrutor_id);
    assert.strictEqual(depois.unidade.unidade_id, antes.unidade.unidade_id);
    assert.strictEqual(depois.pista.periodo, (await lerAgendamento(id)).periodo);
});

test('alterar troca a unidade em manutenção', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-12T10:00:00-03:00' }));
    const antes = await recursos(id);
    const unidadeId = antes.unidade.unidade_id;
    const outra = unidadesLivres.find(u => u.id !== unidadeId);
    assert.ok(outra, JSON.stringify(antes.unidade));

    const p = await rest(`unidades_arma?id=eq.${unidadeId}`, { metodo: 'PATCH', corpo: { situacao: 'manutencao' } });
    assert.strictEqual(p.status, 200, JSON.stringify(p.dados));
    try {
        const r = await alterar(id, '2030-08-12T15:00:00-03:00');
        assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
        const depois = await recursos(id);
        assert.strictEqual(depois.unidade.unidade_id, outra.id);
        assert.strictEqual(depois.instrutor.instrutor_id, antes.instrutor.instrutor_id);
        assert.strictEqual(depois.pista.pista_id, antes.pista.pista_id);
    } finally {
        // Restaura a unidade (o histórico dela é apagado no fim, junto com a unidade).
        const v = await rest(`unidades_arma?id=eq.${unidadeId}`, { metodo: 'PATCH', corpo: { situacao: 'disponivel' } });
        assert.strictEqual(v.status, 200, JSON.stringify(v.dados));
    }
});

test('alterar com o instrutor escolhido ocupado dá RP001', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-13T10:00:00-03:00' }));
    await ocuparInstrutores([instrutorA.id], '2030-08-13T15:00:00-03:00');

    const r = await alterar(id, '2030-08-13T15:00:00-03:00');
    assertErro(r, 'RP001');
    const ag = await lerAgendamento(id);
    assert.strictEqual(Date.parse(ag.inicio), Date.parse('2030-08-13T10:00:00-03:00'));
    assert.strictEqual((await recursos(id)).instrutor.periodo, ag.periodo);
});

test('alterar troca o instrutor que não foi escolhido', async () => {
    const inicio = '2030-08-14T10:00:00-03:00';
    const outros = (await todosInstrutores()).filter(i => i !== instrutorA.id);
    await ocuparInstrutores(outros, inicio);
    const id = await agendarOk(pedido({ inicio, instrutor_id: null }));
    const antes = await recursos(id);
    assert.strictEqual(antes.instrutor.instrutor_id, instrutorA.id);
    await ocuparInstrutores([instrutorA.id], '2030-08-14T15:00:00-03:00');

    const r = await alterar(id, '2030-08-14T15:00:00-03:00');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const depois = await recursos(id);
    assert.notStrictEqual(depois.instrutor.instrutor_id, instrutorA.id);
    assert.strictEqual(depois.instrutor.principal, true);
    assert.strictEqual(depois.instrutor.ativo, true);
    assert.strictEqual(depois.pista.pista_id, antes.pista.pista_id);
    assert.strictEqual(depois.unidade.unidade_id, antes.unidade.unidade_id);
});

test('alterar grava o autor no histórico', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-15T10:00:00-03:00' }));
    const r = await alterar(id, '2030-08-15T15:00:00-03:00', 2, instrutorB.id);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.horas, 2);

    const h = await rest(`historico_alteracoes?tabela=eq.agendamentos&registro_id=eq.${id}&select=feito_por,acao&order=id.desc&limit=1`);
    assert.strictEqual(h.status, 200, JSON.stringify(h.dados));
    assert.strictEqual(h.dados[0].acao, 'alteracao');
    assert.strictEqual(h.dados[0].feito_por, instrutorB.id);
});

test('cancelar desativa as reservas', async () => {
    const inicio = '2030-08-16T10:00:00-03:00';
    const id = await agendarOk(pedido({ inicio }));

    const r = await rpc('cancelar_agendamento', { p_agendamento: id, p_autor: cliente.id });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.situacao, 'cancelado');
    assert.strictEqual((await lerAgendamento(id)).situacao, 'cancelado');
    for (const reserva of Object.values(await recursos(id))) assert.strictEqual(reserva.ativo, false);

    const h = await rest(`historico_alteracoes?tabela=eq.agendamentos&registro_id=eq.${id}&select=feito_por&order=id.desc&limit=1`);
    assert.strictEqual(h.dados[0].feito_por, cliente.id);

    const outro = await agendarOk(pedido({ inicio }));
    assert.strictEqual((await recursos(outro)).instrutor.instrutor_id, instrutorA.id);
});

// Quantas linhas de histórico cada registro pedido tem (só da ação informada, se houver).
async function contarHistorico(tabela, ids, acao) {
    const filtroAcao = acao ? `&acao=eq.${acao}` : '';
    const r = await rest(`historico_alteracoes?tabela=eq.${tabela}&registro_id=in.(${ids.join(',')})${filtroAcao}&select=registro_id`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const contagem = Object.fromEntries(ids.map(id => [String(id), 0]));
    for (const l of r.dados) contagem[l.registro_id] += 1;
    return contagem;
}

// Histórico do agendamento e das 3 reservas, por tabela e por registro.
async function historicoDoAgendamento(id, acao) {
    const { instrutor, pista, unidade } = await recursos(id);
    return {
        agendamentos: await contarHistorico('agendamentos', [id], acao),
        agendamento_instrutores: await contarHistorico('agendamento_instrutores', [instrutor.id], acao),
        agendamento_pistas: await contarHistorico('agendamento_pistas', [pista.id], acao),
        agendamento_unidades: await contarHistorico('agendamento_unidades', [unidade.id], acao),
    };
}

test('cancelar um agendamento já cancelado dá RP005 e não grava histórico', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-17T10:00:00-03:00' }));
    const primeiro = await rpc('cancelar_agendamento', { p_agendamento: id, p_autor: cliente.id });
    assert.strictEqual(primeiro.status, 200, JSON.stringify(primeiro.dados));
    const antes = await historicoDoAgendamento(id);

    const r = await rpc('cancelar_agendamento', { p_agendamento: id, p_autor: cliente.id });
    assertErro(r, 'RP005');
    assert.deepStrictEqual(await historicoDoAgendamento(id), antes);
    assert.strictEqual((await lerAgendamento(id)).situacao, 'cancelado');
});

test('alterar um agendamento em check-in dá RP005 e não muda o período', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-18T10:00:00-03:00' }));
    // O agendamento é apagado no fim (com o histórico desta mudança), então a situação não precisa voltar.
    const p = await rest(`agendamentos?id=eq.${id}`, { metodo: 'PATCH', corpo: { situacao: 'check_in' } });
    assert.strictEqual(p.status, 200, JSON.stringify(p.dados));
    const antes = await lerAgendamento(id);

    const r = await alterar(id, '2030-08-18T15:00:00-03:00');
    assertErro(r, 'RP005');
    const depois = await lerAgendamento(id);
    assert.strictEqual(depois.periodo, antes.periodo);
    assert.strictEqual(depois.situacao, 'check_in');
    for (const reserva of Object.values(await recursos(id))) assert.strictEqual(reserva.periodo, antes.periodo);
});

test('alterar mantendo os recursos grava uma só alteração por reserva', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-19T10:00:00-03:00' }));
    const antes = await historicoDoAgendamento(id, 'alteracao');

    const r = await alterar(id, '2030-08-19T15:00:00-03:00');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const depois = await historicoDoAgendamento(id, 'alteracao');
    for (const tabela of ['agendamento_instrutores', 'agendamento_pistas', 'agendamento_unidades']) {
        for (const [registro, n] of Object.entries(depois[tabela])) {
            assert.strictEqual(n - antes[tabela][registro], 1, `${tabela} ${registro}: ${JSON.stringify({ antes, depois })}`);
        }
    }
});

test('alterar sem instrutores livres no horário novo dá RP002', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-20T10:00:00-03:00', instrutor_id: null }));
    const antes = await lerAgendamento(id);
    await ocuparInstrutores(await todosInstrutores(), '2030-08-20T15:00:00-03:00');

    const r = await alterar(id, '2030-08-20T15:00:00-03:00');
    assertErro(r, 'RP002');
    assert.strictEqual((await lerAgendamento(id)).periodo, antes.periodo);
});

test('alterar sem pistas livres no horário novo dá RP003', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-21T10:00:00-03:00' }));
    const antes = await lerAgendamento(id);
    const r0 = await rest('pistas?ativa=eq.true&select=id');
    assert.strictEqual(r0.status, 200, JSON.stringify(r0.dados));
    for (const { id: pistaId } of r0.dados) {
        await criar('interdicoes', { pista_id: pistaId, periodo: '[2030-08-21 15:00-03,2030-08-21 16:00-03)', motivo: `teste ${marcador()}` });
    }

    const r = await alterar(id, '2030-08-21T15:00:00-03:00');
    assertErro(r, 'RP003');
    assert.strictEqual((await lerAgendamento(id)).periodo, antes.periodo);
});

test('alterar com a unidade em manutenção e nenhuma outra livre dá RP004', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-22T10:00:00-03:00' }));
    const antes = await lerAgendamento(id);
    const unidadeId = (await recursos(id)).unidade.unidade_id;
    const outra = unidadesLivres.find(u => u.id !== unidadeId);
    assert.ok(outra, String(unidadeId));

    // A outra unidade livre do modelo fica ocupada no horário novo.
    const ocupante = await agendamentoDireto('2030-08-22T15:00:00-03:00');
    const part = await criar('participantes', {
        agendamento_id: ocupante.id, nome_completo: 'Ocupante Teste', cpf: cpfAleatorio(), data_nascimento: '1990-01-01', modalidade: 'estande',
    });
    await criar('agendamento_unidades', { agendamento_id: ocupante.id, unidade_id: outra.id, participante_id: part.id });

    const p = await rest(`unidades_arma?id=eq.${unidadeId}`, { metodo: 'PATCH', corpo: { situacao: 'manutencao' } });
    assert.strictEqual(p.status, 200, JSON.stringify(p.dados));
    try {
        const r = await alterar(id, '2030-08-22T15:00:00-03:00');
        assertErro(r, 'RP004');
        assert.strictEqual((await lerAgendamento(id)).periodo, antes.periodo);
    } finally {
        const v = await rest(`unidades_arma?id=eq.${unidadeId}`, { metodo: 'PATCH', corpo: { situacao: 'disponivel' } });
        assert.strictEqual(v.status, 200, JSON.stringify(v.dados));
    }
});

test('sem preferência nunca escolhe instrutor bloqueado ou com perfil inativo', async () => {
    const inicio = '2030-08-23T10:00:00-03:00';
    const banido = await criarUsuario({ papeis: ['instrutor'] });
    const inativo = await criarUsuario({ papeis: ['instrutor'] });
    // Todos os outros instrutores ficam ocupados: só sobram os dois, que não podem ser escolhidos.
    const outros = (await todosInstrutores()).filter(i => i !== banido.id && i !== inativo.id);
    await ocuparInstrutores(outros, inicio);

    await banirUsuario(banido.id);
    const p = await rest(`perfis?id=eq.${inativo.id}`, { metodo: 'PATCH', corpo: { ativo: false } });
    assert.strictEqual(p.status, 200, JSON.stringify(p.dados));
    try {
        const r = await agendar(pedido({ inicio, instrutor_id: null }));
        assertErro(r, 'RP002');
    } finally {
        // Os dois usuários são apagados no fim; mesmo assim, tudo volta como estava.
        await desbanirUsuario(banido.id);
        const v = await rest(`perfis?id=eq.${inativo.id}`, { metodo: 'PATCH', corpo: { ativo: true } });
        assert.strictEqual(v.status, 200, JSON.stringify(v.dados));
    }
    // De volta ao normal, um dos dois é escolhido: o RP002 veio do bloqueio, não de outra coisa.
    const ok = await agendarOk(pedido({ inicio, instrutor_id: null }));
    const escolhido = (await recursos(ok)).instrutor.instrutor_id;
    assert.ok([banido.id, inativo.id].includes(escolhido), escolhido);
});

// --- A mesma pessoa em dois horários (RP006), instrutor que não atende mais (RP007) e instrutores_ativos ---

// Chama a RPC em nome de outro responsável; se ela criar o agendamento, anota o id para apagar no fim.
async function agendarPor(responsavel, p) {
    const r = await rpc('criar_agendamento', { p_responsavel: responsavel.id, p_pedido: p });
    if (r.status === 200 && typeof r.dados === 'string') anotarAgendamento(r.dados);
    return r;
}

// Pedido de um responsável com um convidado que traz tudo próprio (não usa unidade do estande).
function pedidoComConvidado(responsavel, cpfConvidado, extra = {}) {
    return pedido({
        participantes: [
            participanteEstande({ nome_completo: 'Responsável Teste', cpf: responsavel.cpf, perfil_id: responsavel.id }),
            participanteEstande({
                nome_completo: 'Convidado Teste', cpf: cpfConvidado, modalidade: 'tudo_proprio', termo_versao: 1,
                modelo_id: null, tipo_municao_id: null, municao_qtd: null, arma_propria: ARMA,
            }),
        ],
        ...extra,
    });
}

test('mesmo CPF em horários sobrepostos dá RP006', async () => {
    const outro = await criarUsuario({ papeis: ['cliente'] });
    const convidado = cpfAleatorio();
    await agendarOk(pedidoComConvidado(cliente, convidado, { inicio: '2030-08-24T10:00:00-03:00', horas: 2 }));

    const contar = async () => (await rest(`agendamentos?responsavel_id=eq.${outro.id}&select=id`)).dados.length;
    const cruzado = await agendarPor(outro, pedidoComConvidado(outro, convidado, { inicio: '2030-08-24T11:00:00-03:00', instrutor_id: instrutorB.id }));
    assertErro(cruzado, 'RP006');
    assert.strictEqual(await contar(), 0, 'a transação deveria ter sido desfeita');

    // Encostados (10–12 e 12–13) não se cruzam.
    const encostado = await agendarPor(outro, pedidoComConvidado(outro, convidado, { inicio: '2030-08-24T12:00:00-03:00', instrutor_id: instrutorB.id }));
    assert.strictEqual(encostado.status, 200, JSON.stringify(encostado.dados));
});

test('cancelado não conta para o RP006', async () => {
    const outro = await criarUsuario({ papeis: ['cliente'] });
    const convidado = cpfAleatorio();
    const inicio = '2030-08-25T10:00:00-03:00';
    const primeiro = await agendarOk(pedidoComConvidado(cliente, convidado, { inicio }));
    const c = await rpc('cancelar_agendamento', { p_agendamento: primeiro, p_autor: cliente.id });
    assert.strictEqual(c.status, 200, JSON.stringify(c.dados));

    const r = await agendarPor(outro, pedidoComConvidado(outro, convidado, { inicio, instrutor_id: instrutorB.id }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
});

test('alterar para cima de outro agendamento da mesma pessoa dá RP006', async () => {
    const id = await agendarOk(pedido({ inicio: '2030-08-26T10:00:00-03:00' }));
    await agendarOk(pedido({ inicio: '2030-08-26T15:00:00-03:00', instrutor_id: instrutorB.id }));
    const antes = await lerAgendamento(id);

    const r = await alterar(id, '2030-08-26T15:00:00-03:00');
    assertErro(r, 'RP006');
    assert.strictEqual((await lerAgendamento(id)).periodo, antes.periodo);

    // O próprio agendamento não conta: aumentar a duração no mesmo lugar passa.
    const maior = await alterar(id, '2030-08-26T10:00:00-03:00', 2);
    assert.strictEqual(maior.status, 200, JSON.stringify(maior.dados));
});

test('alterar com o instrutor escolhido bloqueado dá RP007 e ocupado continua RP001', async () => {
    const escolhido = await criarUsuario({ papeis: ['instrutor'] });
    const id = await agendarOk(pedido({ inicio: '2030-08-27T10:00:00-03:00', instrutor_id: escolhido.id }));
    const antes = await lerAgendamento(id);

    await banirUsuario(escolhido.id);
    try {
        const r = await alterar(id, '2030-08-27T15:00:00-03:00');
        assertErro(r, 'RP007');
        assert.strictEqual((await lerAgendamento(id)).periodo, antes.periodo);
    } finally {
        await desbanirUsuario(escolhido.id);
    }

    await ocuparInstrutores([escolhido.id], '2030-08-27T15:00:00-03:00');
    const r = await alterar(id, '2030-08-27T15:00:00-03:00');
    assertErro(r, 'RP001');
});

test('instrutores_ativos não traz bloqueado nem perfil inativo', async () => {
    const banido = await criarUsuario({ papeis: ['instrutor'] });
    const inativo = await criarUsuario({ papeis: ['instrutor'] });
    const ativos = async () => {
        const r = await rpc('instrutores_ativos');
        assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
        for (const i of r.dados) assert.deepStrictEqual(Object.keys(i).sort(), ['id', 'nome']);
        return r.dados.map(i => i.id);
    };
    const todos = await ativos();
    for (const u of [banido, inativo, instrutorA]) assert.ok(todos.includes(u.id), JSON.stringify(todos));
    assert.ok(!todos.includes(cliente.id), 'cliente não é instrutor');

    await banirUsuario(banido.id);
    const p = await rest(`perfis?id=eq.${inativo.id}`, { metodo: 'PATCH', corpo: { ativo: false } });
    assert.strictEqual(p.status, 200, JSON.stringify(p.dados));
    try {
        const depois = await ativos();
        assert.ok(!depois.includes(banido.id), 'bloqueado não pode aparecer');
        assert.ok(!depois.includes(inativo.id), 'perfil inativo não pode aparecer');
        assert.ok(depois.includes(instrutorA.id), JSON.stringify(depois));
    } finally {
        await desbanirUsuario(banido.id);
        const v = await rest(`perfis?id=eq.${inativo.id}`, { metodo: 'PATCH', corpo: { ativo: true } });
        assert.strictEqual(v.status, 200, JSON.stringify(v.dados));
    }
});
