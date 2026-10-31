const test = require('node:test');
const assert = require('node:assert');
const {
    interpretarResposta,
    duracoesPermitidas,
    validarAgendamento,
    dataMinima,
    formatarData,
    montarEnvio,
    INSTRUTORES,
    ARMAMENTOS,
    HORAS_INICIO
} = require('../regras.js');

const agora = new Date(2026, 10, 1, 10, 0);
const base = {
    usuario: 'Carlos Lima',
    armamento: 'Pistola 9mm',
    municao_qtd: '50',
    instrutor: 'MARLON',
    data: '2026-11-14',
    hora_inicio: '14',
    duracao_horas: '2'
};
const validar = alteracoes => validarAgendamento({ ...base, ...alteracoes }, agora);

test('listas do estande', () => {
    assert.deepEqual(INSTRUTORES, ['J.CARLOS', 'MARLON', 'JP.BROTAS', 'MATOS', 'W.ASSUNCAO', 'PEDRO', 'NAPOLEAO', 'MAURICIO']);
    assert.deepEqual(ARMAMENTOS, ['Pistola .380', 'Pistola 9mm', 'Revólver .38', 'Carabina .22', 'Espingarda calibre 12']);
    assert.equal(HORAS_INICIO.length, 15);
    assert.equal(HORAS_INICIO[0], 8);
    assert.equal(HORAS_INICIO[14], 22);
});

test('durações permitidas terminam até as 23h', () => {
    assert.deepEqual(duracoesPermitidas(22), [1]);
    assert.deepEqual(duracoesPermitidas(21), [1, 2]);
    assert.equal(duracoesPermitidas(8).length, 15);
});

test('agendamento válido não tem erros', () => assert.deepEqual(validar({}), {}));

test('data mínima é o dia seguinte, mesmo na virada do mês', () => {
    assert.equal(dataMinima(new Date(2026, 10, 30, 10, 0)), '2026-12-01');
});

test('data mínima preenche mês e dia com dois dígitos', () => {
    assert.equal(dataMinima(new Date(2026, 0, 1, 10, 0)), '2026-01-02');
});

test('formata data para o padrão brasileiro', () => {
    assert.equal(formatarData('2026-11-14'), '14/11/2026');
});

test('monta o corpo do envio com números e fim calculado', () => {
    assert.deepEqual(montarEnvio({ ...base, usuario: '  Carlos Lima ' }), {
        usuario: 'Carlos Lima',
        armamento: 'Pistola 9mm',
        municao_qtd: 50,
        instrutor: 'MARLON',
        data: '2026-11-14',
        hora_inicio: 14,
        duracao_horas: 2,
        hora_fim: 16
    });
});

const invalidos = [
    ['usuário vazio', { usuario: '   ' }, 'usuario'],
    ['instrutor fora da lista', { instrutor: 'João' }, 'instrutor'],
    ['instrutor vazio', { instrutor: '' }, 'instrutor'],
    ['armamento fora da lista', { armamento: 'Bazuca' }, 'armamento'],
    ['munição 49', { municao_qtd: '49' }, 'municao_qtd'],
    ['munição negativa', { municao_qtd: '-50' }, 'municao_qtd'],
    ['munição decimal', { municao_qtd: '50.5' }, 'municao_qtd'],
    ['munição em notação científica', { municao_qtd: '1e3' }, 'municao_qtd'],
    ['munição vazia', { municao_qtd: '' }, 'municao_qtd'],
    ['data vazia', { data: '' }, 'data'],
    ['data inexistente', { data: '2026-02-31' }, 'data'],
    ['23h de antecedência', { data: '2026-11-02', hora_inicio: '9' }, 'data'],
    ['data no passado', { data: '2026-10-01' }, 'data'],
    ['início vazio', { hora_inicio: '' }, 'hora_inicio'],
    ['início 7', { hora_inicio: '7' }, 'hora_inicio'],
    ['início 23', { hora_inicio: '23', duracao_horas: '1' }, 'hora_inicio'],
    ['início 22 com 2h', { hora_inicio: '22', duracao_horas: '2' }, 'duracao_horas'],
    ['duração vazia', { duracao_horas: '' }, 'duracao_horas'],
    ['duração 0', { duracao_horas: '0' }, 'duracao_horas'],
    ['duração decimal', { duracao_horas: '1.5' }, 'duracao_horas']
];

for (const [nome, alteracoes, campo] of invalidos) {
    test(`recusa ${nome}`, () => {
        assert.ok(validar(alteracoes)[campo], `esperava erro em ${campo}`);
    });
}

const validos = [
    ['munição 50', { municao_qtd: '50' }],
    ['munição alta', { municao_qtd: '100000' }],
    ['exatamente 24h', { data: '2026-11-02', hora_inicio: '10', duracao_horas: '1' }],
    ['início 22 com 1h', { hora_inicio: '22', duracao_horas: '1' }],
    ['início 21 com 2h', { hora_inicio: '21', duracao_horas: '2' }]
];

for (const [nome, alteracoes] of validos) {
    test(`aceita ${nome}`, () => assert.deepEqual(validar(alteracoes), {}));
}

test('ok com status ok é sucesso', () => {
    assert.equal(interpretarResposta(true, '{"status":"ok"}'), 'sucesso');
});

test('ok com status conflito é conflito', () => {
    assert.equal(interpretarResposta(true, '{"status":"conflito"}'), 'conflito');
});

test('Accepted padrão do Make é falha', () => {
    assert.equal(interpretarResposta(true, 'Accepted'), 'falha');
});

test('corpo vazio é falha', () => {
    assert.equal(interpretarResposta(true, ''), 'falha');
});

test('JSON com status desconhecido é falha', () => {
    assert.equal(interpretarResposta(true, '{"status":"x"}'), 'falha');
});

test('JSON null é falha', () => {
    assert.equal(interpretarResposta(true, 'null'), 'falha');
});

test('HTTP com erro é falha mesmo com corpo ok', () => {
    assert.equal(interpretarResposta(false, '{"status":"ok"}'), 'falha');
});
