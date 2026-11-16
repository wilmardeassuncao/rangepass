// tests/integracao/agendar-banco.test.mjs
// A RPC criar_agendamento: escolhe instrutores, pistas e armas livres dentro de uma transação.
// O banco de desenvolvimento pode ter outros dados (pistas, instrutores...), então os testes não supõem
// que só existem os recursos criados aqui.
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import {
    rest, rpc, marcador, cpfAleatorio,
    criarUsuario, criar, tentarCriar, apagarTudoCriado, anotarAgendamento,
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
