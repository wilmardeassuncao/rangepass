// tests/integracao/agendamentos.test.mjs
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import {
    rest, CHAVE_ANON, marcador, cpfAleatorio,
    criarUsuario, apagarUsuariosCriados, criar, tentarCriar, apagarCriados,
} from './apoio.mjs';

// Os testes apagam tudo o que criam: primeiro agendamentos e catálogo, depois os usuários.
after(async () => {
    await apagarCriados();
    await apagarUsuariosCriados();
});

let cliente, instrutorA, instrutorB, modelo;

before(async () => {
    cliente = await criarUsuario({ papeis: ['cliente'] });
    instrutorA = await criarUsuario({ papeis: ['instrutor'] });
    instrutorB = await criarUsuario({ papeis: ['instrutor'] });
    const categoria = await criar('categorias', { nome: `Categoria ${marcador()}` });
    const calibre = await criar('calibres', { nome: `Calibre ${marcador()}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Teste' });
});

function novaPista() {
    return criar('pistas', { numero: 900000 + Math.floor(Math.random() * 99999) });
}

function novaUnidade(situacao = 'disponivel') {
    return criar('unidades_arma', { modelo_id: modelo.id, numero_registro: `REG-${marcador()}`, situacao });
}

function novoParticipante(agendamentoId, extra = {}) {
    return tentarCriar('participantes', {
        agendamento_id: agendamentoId, nome_completo: 'Participante Teste', cpf: cpfAleatorio(),
        data_nascimento: '1990-01-01', modalidade: 'estande', ...extra,
    });
}

// Cria um agendamento e as reservas pedidas. Devolve o id e a resposta de cada reserva.
async function novoAgendamento({ inicio, horas, pista, instrutor, unidade }) {
    const agendamento = await criar('agendamentos', { responsavel_id: cliente.id, inicio, horas, forma_pagamento: 'balcao' });
    const resultado = { id: agendamento.id };
    if (pista) {
        const r = await tentarCriar('agendamento_pistas', { agendamento_id: agendamento.id, pista_id: pista.id });
        resultado.statusPista = r.status;
        resultado.respostaPista = r.dados;
    }
    if (instrutor) {
        const r = await tentarCriar('agendamento_instrutores', { agendamento_id: agendamento.id, instrutor_id: instrutor.id, principal: true });
        resultado.statusInstrutor = r.status;
        resultado.respostaInstrutor = r.dados;
    }
    if (unidade) {
        const p = await novoParticipante(agendamento.id);
        assert.strictEqual(p.status, 201, JSON.stringify(p.dados));
        const r = await tentarCriar('agendamento_unidades', { agendamento_id: agendamento.id, unidade_id: unidade.id, participante_id: p.dados[0].id });
        resultado.statusUnidade = r.status;
        resultado.respostaUnidade = r.dados;
    }
    return resultado;
}

// O PostgREST devolve o conflito de horário (código 23P01 do Postgres) como status 400.
function assertConflito(status, dados) {
    assert.strictEqual(status, 400, JSON.stringify(dados));
    assert.strictEqual(dados.code, '23P01', JSON.stringify(dados));
}

test('mesmo instrutor em horários sobrepostos é recusado', async () => {
    const a = await novoAgendamento({ inicio: '2030-07-01T10:00:00-03:00', horas: 2, instrutor: instrutorA });
    assert.strictEqual(a.statusInstrutor, 201);
    const b = await novoAgendamento({ inicio: '2030-07-01T11:00:00-03:00', horas: 1, instrutor: instrutorA });
    assertConflito(b.statusInstrutor, b.respostaInstrutor);
});

test('mesma pista em horários sobrepostos é recusada', async () => {
    const pista = await novaPista();
    const a = await novoAgendamento({ inicio: '2030-07-09T10:00:00-03:00', horas: 2, pista });
    assert.strictEqual(a.statusPista, 201, JSON.stringify(a.respostaPista));
    const b = await novoAgendamento({ inicio: '2030-07-09T11:00:00-03:00', horas: 2, pista });
    assertConflito(b.statusPista, b.respostaPista);
});

test('sessões encostadas não conflitam (10h–12h e 12h–13h)', async () => {
    const pista = await novaPista();
    const a = await novoAgendamento({ inicio: '2030-07-02T10:00:00-03:00', horas: 2, pista, instrutor: instrutorB });
    const b = await novoAgendamento({ inicio: '2030-07-02T12:00:00-03:00', horas: 1, pista, instrutor: instrutorB });
    assert.deepStrictEqual([a.statusPista, a.statusInstrutor, b.statusPista, b.statusInstrutor], [201, 201, 201, 201]);
});

test('mesma unidade de arma sobreposta é recusada', async () => {
    const unidade = await novaUnidade();
    const a = await novoAgendamento({ inicio: '2030-07-03T10:00:00-03:00', horas: 2, unidade });
    assert.strictEqual(a.statusUnidade, 201, JSON.stringify(a.respostaUnidade));
    const b = await novoAgendamento({ inicio: '2030-07-03T11:00:00-03:00', horas: 2, unidade });
    assertConflito(b.statusUnidade, b.respostaUnidade);
});

test('cancelar libera a pista e reativar volta a conflitar', async () => {
    const pista = await novaPista();
    const a = await novoAgendamento({ inicio: '2030-07-04T10:00:00-03:00', horas: 2, pista });
    assert.strictEqual(a.statusPista, 201);

    const cancela = await rest(`agendamentos?id=eq.${a.id}`, { metodo: 'PATCH', corpo: { situacao: 'cancelado' } });
    assert.strictEqual(cancela.status, 200, JSON.stringify(cancela.dados));

    const b = await novoAgendamento({ inicio: '2030-07-04T10:00:00-03:00', horas: 1, pista });
    assert.strictEqual(b.statusPista, 201);

    const reativa = await rest(`agendamentos?id=eq.${a.id}`, { metodo: 'PATCH', corpo: { situacao: 'pago' } });
    assertConflito(reativa.status, reativa.dados);
    const confere = await rest(`agendamentos?id=eq.${a.id}&select=situacao`);
    assert.strictEqual(confere.dados[0].situacao, 'cancelado');
});

test('alterar o horário para cima de outro é recusado inteiro', async () => {
    const a = await novoAgendamento({ inicio: '2030-07-05T10:00:00-03:00', horas: 1, instrutor: instrutorA });
    const b = await novoAgendamento({ inicio: '2030-07-05T14:00:00-03:00', horas: 1, instrutor: instrutorA });
    assert.deepStrictEqual([a.statusInstrutor, b.statusInstrutor], [201, 201]);

    const muda = await rest(`agendamentos?id=eq.${b.id}`, { metodo: 'PATCH', corpo: { inicio: '2030-07-05T10:00:00-03:00' } });
    assertConflito(muda.status, muda.dados);
    const confere = await rest(`agendamentos?id=eq.${b.id}&select=inicio`);
    assert.strictEqual(new Date(confere.dados[0].inicio).toISOString(), new Date('2030-07-05T14:00:00-03:00').toISOString());
});

test('pista interditada não recebe agendamento', async () => {
    const pista = await novaPista();
    await criar('interdicoes', { pista_id: pista.id, periodo: '[2030-07-06 10:00-03,2030-07-06 12:00-03)', motivo: 'manutenção do alvo' });
    const a = await novoAgendamento({ inicio: '2030-07-06T11:00:00-03:00', horas: 1, pista });
    assert.strictEqual(a.statusPista, 400, JSON.stringify(a.respostaPista));
    assert.match(a.respostaPista.message, /interditada/);
});

test('unidade em manutenção não é alocada', async () => {
    const unidade = await novaUnidade('manutencao');
    const a = await novoAgendamento({ inicio: '2030-07-07T10:00:00-03:00', horas: 1, unidade });
    assert.strictEqual(a.statusUnidade, 400, JSON.stringify(a.respostaUnidade));
    assert.match(a.respostaUnidade.message, /não está disponível/);
});

test('arma própria sem aceite do termo é recusada', async () => {
    const agendamento = await criar('agendamentos', { responsavel_id: cliente.id, inicio: '2030-07-08T10:00:00-03:00', horas: 1, forma_pagamento: 'balcao' });
    const r = await novoParticipante(agendamento.id, { modalidade: 'arma_propria' });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
});

test('anon não lê agendamentos', async () => {
    const r = await rest('agendamentos?select=id', { chave: CHAVE_ANON });
    assert.ok([401, 403].includes(r.status), `status ${r.status}`);
});
