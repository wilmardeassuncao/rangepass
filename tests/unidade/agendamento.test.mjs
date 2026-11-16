import test from 'node:test';
import assert from 'node:assert/strict';
import {
    instanteNoFuso, partesNoFuso, horariosDoDia, duracoesPossiveis, instrutoresNecessarios,
    validarPedido, validarNovoHorario, podeAlterar, erroDeReserva,
} from '../../supabase/functions/_shared/agendamento.mjs';

const OPCOES = {
    estande: { nome: 'RangePass', fuso: 'America/Sao_Paulo' },
    agenda: { antecedencia_minima_horas: 24, antecedencia_maxima_dias: 15, prazo_alteracao_horas: 24,
        duracao_maxima_individual: 3, duracao_maxima_grupo: 6, grupo_maximo: 15,
        faixas_instrutores: [{ ate: 5, instrutores: 1 }, { ate: 10, instrutores: 2 }, { ate: 15, instrutores: 3 }] },
    funcionamento: { dias: { 0: null, 1: { abre: '08:00', fecha: '23:00' }, 2: { abre: '08:00', fecha: '23:00' },
        3: { abre: '08:00', fecha: '23:00' }, 4: { abre: '08:00', fecha: '23:00' }, 5: { abre: '08:00', fecha: '23:00' },
        6: { abre: '08:30', fecha: '22:30' } }, datas_fechadas: ['2026-11-20'] },
    municao: { minima_por_participante: 50 }, idade_minima: 18, termo: { versao: 1, texto: 'x' },
    catalogo: { modelos: [{ id: 1, calibre_id: 10 }], tipos_municao: [{ id: 5, calibre_id: 10 }, { id: 6, calibre_id: 11 }] },
    instrutores: [{ id: 'i-1', nome: 'Ana Instrutora' }],
    responsavel: { id: 'r-1', nome_completo: 'Rui Responsável', cpf: '52998224725', data_nascimento: '1990-01-01' },
};
const AGORA = new Date('2026-11-16T12:00:00Z'); // 09:00 em São Paulo, segunda
const ESTANDE = { modalidade: 'estande', modelo_id: 1, tipo_municao_id: 5, municao_qtd: 50 };
const PEDIDO = { data: '2026-11-18', hora: 10, horas: 2, instrutor_id: null, participantes: [ESTANDE] };
const OUTRO = { ...ESTANDE, nome_completo: 'Maria Souza', cpf: '11144477735', data_nascimento: '1995-05-05' };
const PROPRIA = { arma_propria: { modelo: ' Taurus TH9 ', calibre: '9mm', numero_registro: 'X1', responsavel: 'Rui' } };

const validar = (mudancas) => validarPedido({ ...PEDIDO, ...mudancas }, { agora: AGORA, opcoes: OPCOES });
const campos = (mudancas) => validar(mudancas).campos;
const comParticipante2 = (extra) => ({ participantes: [ESTANDE, { ...OUTRO, ...extra }] });

test('instanteNoFuso: São Paulo e horário de verão de Nova York', () => {
    assert.equal(instanteNoFuso('2026-11-18', 10, 'America/Sao_Paulo').toISOString(), '2026-11-18T13:00:00.000Z');
    assert.equal(instanteNoFuso('2026-07-01', 10, 'America/New_York').toISOString(), '2026-07-01T14:00:00.000Z');
    assert.equal(instanteNoFuso('2026-12-01', 10, 'America/New_York').toISOString(), '2026-12-01T15:00:00.000Z');
});

test('partesNoFuso', () => {
    assert.deepEqual(partesNoFuso(new Date('2026-11-18T13:00:00Z'), 'America/Sao_Paulo'),
        { data: '2026-11-18', hora: 10, minuto: 0, diaSemana: 3 });
});

test('horariosDoDia', () => {
    const f = OPCOES.funcionamento;
    assert.deepEqual(horariosDoDia('2026-11-18', f), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    assert.deepEqual(horariosDoDia('2026-11-21', f), [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    assert.deepEqual(horariosDoDia('2026-11-22', f), []);
    assert.deepEqual(horariosDoDia('2026-11-20', f), []);
});

test('duracoesPossiveis', () => {
    const f = OPCOES.funcionamento;
    assert.deepEqual(duracoesPossiveis('2026-11-18', 21, f, 3), [1, 2]);
    assert.deepEqual(duracoesPossiveis('2026-11-18', 10, f, 3), [1, 2, 3]);
});

test('instrutoresNecessarios', () => {
    const faixas = OPCOES.agenda.faixas_instrutores;
    const esperado = { 1: 1, 5: 1, 6: 2, 10: 2, 11: 3, 15: 3 };
    for (const [q, n] of Object.entries(esperado)) assert.equal(instrutoresNecessarios(Number(q), faixas), n);
});

test('validarPedido: pedido válido', () => {
    const { campos: c, pedido } = validar({});
    assert.deepEqual(c, {});
    assert.equal(pedido.inicio, '2026-11-18T13:00:00.000Z');
    assert.equal(pedido.instrutores_necessarios, 1);
    assert.deepEqual(pedido.participantes[0], {
        nome_completo: 'Rui Responsável', cpf: '52998224725', data_nascimento: '1990-01-01', perfil_id: 'r-1',
        modalidade: 'estande', termo_versao: null, modelo_id: 1, tipo_municao_id: 5, municao_qtd: 50, arma_propria: null,
    });
});

test('validarPedido: mensagens de data', () => {
    assert.equal(campos({ data: '2026-02-30' }).data, 'Escolha o dia.');
    assert.equal(campos({ data: '2026-11-22' }).data, 'O estande não abre neste dia. Escolha outro.');
    assert.equal(campos({ data: '2026-12-02' }).data, 'Agende com até 15 dias de antecedência.');
});

test('validarPedido: mensagens de hora', () => {
    assert.equal(campos({ hora: 7 }).hora, 'Escolha o horário de início.');
    assert.equal(campos({ data: '2026-11-17', hora: 8 }).hora, 'Agende com pelo menos 24 horas de antecedência.');
});

test('validarPedido: mensagens de duração', () => {
    assert.equal(campos({ horas: 0 }).horas, 'Escolha a duração.');
    assert.equal(campos({ horas: 4 }).horas, 'Quem vai sozinho pode agendar no máximo 3 horas.');
    assert.equal(campos({ horas: 7, ...comParticipante2({}) }).horas, 'Grupos podem agendar no máximo 6 horas.');
    assert.equal(campos({ hora: 21, horas: 3 }).horas, 'A sessão precisa terminar até as 23:00.');
});

test('validarPedido: instrutor e lista de participantes', () => {
    assert.equal(campos({ instrutor_id: 'outro' }).instrutor_id, 'Escolha um instrutor da lista ou "Sem preferência".');
    assert.deepEqual(campos({ instrutor_id: 'i-1' }), {});
    assert.equal(campos({ participantes: [] }).participantes, 'Informe quem vai atirar.');
    assert.equal(campos({ participantes: 'x' }).participantes, 'Informe quem vai atirar.');
    const dezesseis = [ESTANDE, ...Array.from({ length: 15 }, () => OUTRO)];
    assert.equal(campos({ participantes: dezesseis }).participantes, 'O grupo pode ter no máximo 15 pessoas.');
});

test('validarPedido: dados dos demais participantes', () => {
    const c = (extra) => campos(comParticipante2(extra));
    assert.equal(c({ nome_completo: 'Ana' })['participantes.1.nome_completo'], 'Informe o nome completo.');
    assert.equal(c({ cpf: '123' })['participantes.1.cpf'], 'Informe um CPF válido.');
    assert.equal(c({ cpf: '529.982.247-25' })['participantes.1.cpf'], 'Este CPF já está em outro participante.');
    assert.equal(c({ data_nascimento: '2030-01-01' })['participantes.1.data_nascimento'], 'Informe a data de nascimento.');
    assert.equal(c({ data_nascimento: '2008-11-17' })['participantes.1.data_nascimento'],
        'Cada participante precisa ter pelo menos 18 anos.');
    assert.deepEqual(c({}), {});
});

test('validarPedido: CPF repetido entre convidados', () => {
    const r = campos({ participantes: [ESTANDE, OUTRO, { ...OUTRO, nome_completo: 'Pedro Alves' }] });
    assert.equal(r['participantes.2.cpf'], 'Este CPF já está em outro participante.');
});

test('validarPedido: modalidade, arma e munição', () => {
    const c = (extra) => campos({ participantes: [{ ...ESTANDE, ...extra }] });
    assert.equal(c({ modalidade: 'x' })['participantes.0.modalidade'], 'Escolha a modalidade.');
    assert.equal(c({ modelo_id: 99 })['participantes.0.modelo_id'], 'Escolha uma arma da lista.');
    assert.equal(c({ tipo_municao_id: 6 })['participantes.0.tipo_municao_id'], 'Escolha a munição da lista.');
    assert.equal(c({ tipo_municao_id: 99 })['participantes.0.tipo_municao_id'], 'Escolha a munição da lista.');
    assert.equal(c({ municao_qtd: 49 })['participantes.0.municao_qtd'], 'A quantidade mínima de munição é 50.');
});

test('validarPedido: arma própria e termo', () => {
    const c = (extra) => campos({ participantes: [{ modalidade: 'arma_propria', tipo_municao_id: 6, municao_qtd: 50,
        aceite_termo_versao: 1, ...PROPRIA, ...extra }] });
    const semRegistro = { arma_propria: { ...PROPRIA.arma_propria, numero_registro: '' } };
    assert.equal(c(semRegistro)['participantes.0.arma_propria'],
        'Informe o modelo, o calibre, o número de registro e o responsável pela arma.');
    assert.equal(c({ aceite_termo_versao: undefined })['participantes.0.aceite_termo_versao'],
        'Para usar arma própria, aceite o termo de responsabilidade.');
    assert.deepEqual(c({}), {});
});

test('validarPedido: arma própria normalizada', () => {
    const { campos: c, pedido } = validar({ participantes: [{ modalidade: 'arma_propria', tipo_municao_id: 6,
        municao_qtd: 50, aceite_termo_versao: 1, ...PROPRIA }] });
    assert.deepEqual(c, {});
    const p = pedido.participantes[0];
    assert.equal(p.modelo_id, null);
    assert.equal(p.termo_versao, 1);
    assert.equal(p.arma_propria.modelo, 'Taurus TH9');
});

test('validarPedido: tudo próprio ignora munição', () => {
    const { campos: c, pedido } = validar({ participantes: [{ modalidade: 'tudo_proprio', tipo_municao_id: 5,
        municao_qtd: 80, modelo_id: 1, aceite_termo_versao: 1, ...PROPRIA }] });
    assert.deepEqual(c, {});
    const p = pedido.participantes[0];
    assert.equal(p.tipo_municao_id, null);
    assert.equal(p.municao_qtd, null);
    assert.equal(p.modelo_id, null);
});

test('validarPedido: grupo de 6', () => {
    const cpfs = ['11144477735', '39053344705', '16899535009', '71428793860', '45317828791'];
    const outros = cpfs.map((cpf, i) => ({ ...OUTRO, cpf, nome_completo: `Pessoa Numero${i}` }));
    const { campos: c, pedido } = validar({ participantes: [ESTANDE, ...outros] });
    assert.deepEqual(c, {});
    assert.equal(pedido.instrutores_necessarios, 2);
    assert.equal(pedido.participantes[1].perfil_id, null);
});

test('validarNovoHorario', () => {
    const base = { data: '2026-11-18', hora: 10, horas: 4 };
    const grupo = validarNovoHorario(base, { agora: AGORA, opcoes: OPCOES, quantidade: 2 });
    assert.deepEqual(grupo.campos, {});
    assert.equal(grupo.inicio, '2026-11-18T13:00:00.000Z');
    assert.equal(grupo.horas, 4);
    const sozinho = validarNovoHorario(base, { agora: AGORA, opcoes: OPCOES, quantidade: 1 });
    assert.equal(sozinho.campos.horas, 'Quem vai sozinho pode agendar no máximo 3 horas.');
});

test('podeAlterar', () => {
    assert.equal(podeAlterar({ inicio: '2026-11-17T12:00:00Z', situacao: 'pago' }, AGORA, 24), true);
    assert.equal(podeAlterar({ inicio: '2026-11-17T12:01:00Z', situacao: 'pago' }, AGORA, 24), true);
    assert.equal(podeAlterar({ inicio: '2026-11-17T11:59:00Z', situacao: 'pago' }, AGORA, 24), false);
    assert.equal(podeAlterar({ inicio: '2026-11-20T12:00:00Z', situacao: 'cancelado' }, AGORA, 24), false);
    assert.equal(podeAlterar({ inicio: '2026-11-20T12:00:00Z', situacao: 'check_in' }, AGORA, 24), false);
});

test('erroDeReserva', () => {
    const e = (erro) => ({ status: 409, corpo: { erro } });
    assert.deepEqual(erroDeReserva('RP001'), e('O instrutor escolhido já tem outro agendamento nesse horário. Escolha outro horário.'));
    assert.deepEqual(erroDeReserva('RP002'), e('Não há instrutores livres nesse horário. Escolha outro horário.'));
    assert.deepEqual(erroDeReserva('RP003'), e('Não há pistas livres nesse horário. Escolha outro horário.'));
    assert.deepEqual(erroDeReserva('RP004'), e('Não há arma livre do modelo escolhido nesse horário. Escolha outro horário ou outro modelo.'));
    assert.deepEqual(erroDeReserva('23P01'), e('Esse horário acabou de ser ocupado. Escolha outro horário.'));
    assert.deepEqual(erroDeReserva('P0001'), e('Esse horário acabou de ser ocupado. Escolha outro horário.'));
    assert.deepEqual(erroDeReserva('RP005'), e('Este agendamento não pode mais ser alterado pelo app. Fale com o estande.'));
    assert.equal(erroDeReserva('42501'), null);
});
