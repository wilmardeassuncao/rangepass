// tests/unidade/precos.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import {
    formatarReais, centavosDoTexto, calcularPreco,
    validarRegra, validarCampanha, validarClasse, validarPacote, conferirItensDoPacote,
} from '../../supabase/functions/_shared/precos.mjs';

const FUSO = 'America/Sao_Paulo'; // UTC-3, sem horário de verão
const HOJE = '2026-11-17';
const CTX = { hoje: HOJE, fuso: FUSO };

// 2026-11-18 é quarta; 2026-11-21 é sábado. Hora local + 3 = UTC.
const QUARTA_10H = '2026-11-18T13:00:00.000Z';
const SABADO_17H = '2026-11-21T20:00:00.000Z';
const SABADO_20H = '2026-11-21T23:00:00.000Z';

function tabelaBase(extra = {}) {
    return {
        hora_pista_centavos: 10000,
        regras: [
            { dias: [6], hora_inicio: '18:00', hora_fim: '23:00', percentual: 20, prioridade: 1 },
            { dias: [6], hora_inicio: '20:00', hora_fim: '23:00', percentual: -10, prioridade: 2 },
        ],
        modelos: { 1: 3000 },
        tipos_municao: { 5: 250 },
        campanhas: [],
        pacotes: [],
        ...extra,
    };
}

const estande = (qtd = 50) => ({ modalidade: 'estande', modelo_id: 1, tipo_municao_id: 5, municao_qtd: qtd,
    arma_propria: null, termo_versao: null });
const tudoProprio = () => ({ modalidade: 'tudo_proprio', modelo_id: null, tipo_municao_id: null, municao_qtd: null,
    arma_propria: { modelo: 'X' }, termo_versao: 'v1' });
const armaPropria = (qtd) => ({ modalidade: 'arma_propria', modelo_id: null, tipo_municao_id: 5, municao_qtd: qtd,
    arma_propria: { modelo: 'X' }, termo_versao: 'v1' });

function pedido(inicio, horas, participantes, instrutores = 1) {
    return { inicio, horas, instrutor_id: null, instrutores_necessarios: instrutores, participantes };
}

const item = (preco, descricao) => preco.itens.find((i) => i.descricao === descricao);

const INICIANTE = { id: 9, nome: 'Iniciante', inicio: '2026-11-01', fim: '2026-11-30', preco_centavos: 15000,
    horas: 1, modelo_id: 1, tipo_municao_id: 5, municao_qtd: 50 };

// --- formatarReais / centavosDoTexto ---

test('formatarReais', () => {
    assert.strictEqual(formatarReais(12000), 'R$ 120,00');
    assert.strictEqual(formatarReais(123456), 'R$ 1.234,56');
    assert.strictEqual(formatarReais(5), 'R$ 0,05');
});

test('centavosDoTexto aceita os formatos', () => {
    assert.strictEqual(centavosDoTexto('120'), 12000);
    assert.strictEqual(centavosDoTexto('120,5'), 12050);
    assert.strictEqual(centavosDoTexto('120,50'), 12050);
    assert.strictEqual(centavosDoTexto('1.234,56'), 123456);
    assert.strictEqual(centavosDoTexto('R$ 1.234,56'), 123456);
});

test('centavosDoTexto recusa', () => {
    assert.strictEqual(centavosDoTexto(''), null);
    assert.strictEqual(centavosDoTexto('   '), null);
    assert.strictEqual(centavosDoTexto('-10'), null);
    assert.strictEqual(centavosDoTexto('12a'), null);
    assert.strictEqual(centavosDoTexto('10,555'), null);
});

// --- calcularPreco ---

test('sozinho, quarta 10h–12h, estande 50 munições', () => {
    const preco = calcularPreco(pedido(QUARTA_10H, 2, [estande()]), tabelaBase(), CTX);
    assert.deepStrictEqual(preco, {
        itens: [
            { descricao: 'Pista (1 pista × 2 horas)', total_centavos: 20000 },
            { descricao: 'Aluguel de armas', total_centavos: 6000 },
            { descricao: 'Munição', total_centavos: 12500 },
        ],
        subtotal_centavos: 38500,
        desconto: null,
        total_centavos: 38500,
    });
});

test('sábado 17h–19h: 10.000 + 12.000', () => {
    const preco = calcularPreco(pedido(SABADO_17H, 2, [tudoProprio()]), tabelaBase(), CTX);
    assert.deepStrictEqual(preco.itens, [{ descricao: 'Pista (1 pista × 2 horas)', total_centavos: 22000 }]);
});

test('sábado 20h–21h: a regra de prioridade 2 vale', () => {
    const preco = calcularPreco(pedido(SABADO_20H, 1, [tudoProprio()]), tabelaBase(), CTX);
    assert.deepStrictEqual(preco.itens, [{ descricao: 'Pista (1 pista × 1 hora)', total_centavos: 9000 }]);
});

test('empate de prioridade: vale o menor percentual', () => {
    const tabela = tabelaBase({ regras: [
        { dias: [3], hora_inicio: '08:00', hora_fim: '12:00', percentual: 30, prioridade: 1 },
        { dias: [3], hora_inicio: '08:00', hora_fim: '12:00', percentual: 10, prioridade: 1 },
    ] });
    const preco = calcularPreco(pedido(QUARTA_10H, 1, [tudoProprio()]), tabela, CTX);
    assert.strictEqual(preco.total_centavos, 11000);
});

test('grupo de 6 (2 pistas), 1h quarta, 2 estande + 4 tudo_proprio', () => {
    const lista = [estande(), estande(), tudoProprio(), tudoProprio(), tudoProprio(), tudoProprio()];
    const preco = calcularPreco(pedido(QUARTA_10H, 1, lista, 2), tabelaBase(), CTX);
    assert.deepStrictEqual(preco.itens, [
        { descricao: 'Pista (2 pistas × 1 hora)', total_centavos: 20000 },
        { descricao: 'Aluguel de armas', total_centavos: 6000 },
        { descricao: 'Munição', total_centavos: 2 * 50 * 250 },
    ]);
    assert.strictEqual(preco.total_centavos, 51000);
});

test('arma própria paga só a munição', () => {
    const preco = calcularPreco(pedido(QUARTA_10H, 1, [armaPropria(40)]), tabelaBase(), CTX);
    assert.strictEqual(item(preco, 'Munição').total_centavos, 10000);
    assert.strictEqual(item(preco, 'Aluguel de armas'), undefined);
});

test('preço ausente na tabela: erro', () => {
    const tabela = tabelaBase({ modelos: {} });
    assert.throws(() => calcularPreco(pedido(QUARTA_10H, 1, [estande()]), tabela, CTX), /preço ausente/);
});

test('pacote "Iniciante" numa sessão de 2h', () => {
    const preco = calcularPreco(pedido(QUARTA_10H, 2, [estande()]), tabelaBase({ pacotes: [INICIANTE] }), CTX);
    assert.strictEqual(preco.subtotal_centavos, 38500);
    assert.deepStrictEqual(preco.desconto, { tipo: 'pacote', nome: 'Pacote Iniciante', valor_centavos: 10500 });
    assert.strictEqual(preco.total_centavos, 38500 - 10500);
});

test('pacote vencido: não aplica', () => {
    const vencido = { ...INICIANTE, fim: '2026-11-16' };
    const preco = calcularPreco(pedido(QUARTA_10H, 2, [estande()]), tabelaBase({ pacotes: [vencido] }), CTX);
    assert.strictEqual(preco.desconto, null);
});

test('pacote de modelo não usado: não aplica', () => {
    const outro = { ...INICIANTE, modelo_id: 2 };
    const preco = calcularPreco(pedido(QUARTA_10H, 2, [estande()]), tabelaBase({ pacotes: [outro] }), CTX);
    assert.strictEqual(preco.desconto, null);
});

test('pacote com mais horas que a sessão ou munição a mais: não aplica', () => {
    const longo = { ...INICIANTE, horas: 3 };
    const muitaMunicao = { ...INICIANTE, municao_qtd: 100 };
    const preco = calcularPreco(pedido(QUARTA_10H, 2, [estande()]), tabelaBase({ pacotes: [longo, muitaMunicao] }), CTX);
    assert.strictEqual(preco.desconto, null);
});

test('pacote sem economia: não aplica', () => {
    const caro = { ...INICIANTE, preco_centavos: 25500 };
    const preco = calcularPreco(pedido(QUARTA_10H, 2, [estande()]), tabelaBase({ pacotes: [caro] }), CTX);
    assert.strictEqual(preco.desconto, null);
});

test('campanha 10% e pacote: vence o pacote (economia maior)', () => {
    const campanhas = [{ id: 1, nome: 'Black Friday', percentual: 10, inicio: '2026-11-01', fim: '2026-11-30' }];
    const preco = calcularPreco(pedido(QUARTA_10H, 2, [estande()]),
        tabelaBase({ pacotes: [INICIANTE], campanhas }), CTX);
    assert.deepStrictEqual(preco.desconto, { tipo: 'pacote', nome: 'Pacote Iniciante', valor_centavos: 10500 });
});

test('campanha 10% e pacote: vence a campanha (economia maior)', () => {
    const campanhas = [{ id: 1, nome: 'Black Friday', percentual: 10, inicio: '2026-11-01', fim: '2026-11-30' }];
    const caro = { ...INICIANTE, preco_centavos: 25000 }; // economia 500
    const preco = calcularPreco(pedido(QUARTA_10H, 2, [estande()]),
        tabelaBase({ pacotes: [caro], campanhas }), CTX);
    assert.deepStrictEqual(preco.desconto, { tipo: 'campanha', nome: 'Campanha Black Friday (10%)', valor_centavos: 3850 });
    assert.strictEqual(preco.total_centavos, 38500 - 3850);
});

test('empate entre pacote e campanha: pacote', () => {
    const campanhas = [{ id: 1, nome: 'Metade', percentual: 50, inicio: '2026-11-01', fim: '2026-11-30' }];
    const pacote = { ...INICIANTE, preco_centavos: 25500 - 19250 }; // economia 19.250 = 50% de 38.500
    const preco = calcularPreco(pedido(QUARTA_10H, 2, [estande()]),
        tabelaBase({ pacotes: [pacote], campanhas }), CTX);
    assert.strictEqual(preco.desconto.tipo, 'pacote');
    assert.strictEqual(preco.desconto.valor_centavos, 19250);
});

test('fica a campanha de maior percentual; campanha fora do período não conta', () => {
    const campanhas = [
        { id: 1, nome: 'Pequena', percentual: 5, inicio: '2026-11-01', fim: '2026-11-30' },
        { id: 2, nome: 'Grande', percentual: 20, inicio: '2026-11-01', fim: '2026-11-30' },
        { id: 3, nome: 'Futura', percentual: 50, inicio: '2026-11-18', fim: '2026-11-30' },
    ];
    const preco = calcularPreco(pedido(QUARTA_10H, 2, [estande()]), tabelaBase({ campanhas }), CTX);
    assert.deepStrictEqual(preco.desconto, { tipo: 'campanha', nome: 'Campanha Grande (20%)', valor_centavos: 7700 });
});

test('nada ativo: desconto null', () => {
    const preco = calcularPreco(pedido(QUARTA_10H, 1, [estande()]), tabelaBase(), CTX);
    assert.strictEqual(preco.desconto, null);
    assert.strictEqual(preco.total_centavos, preco.subtotal_centavos);
});

// --- validadores: uma asserção por mensagem ---

const CRIAR = { criando: true };
const EDITAR = { criando: false };
const REGRA_OK = { nome: 'Noite', dias: [6], hora_inicio: '18:00', hora_fim: '23:00', percentual: 20, prioridade: 1, ativo: true };

test('validarRegra aceita uma regra completa', () => {
    assert.deepStrictEqual(validarRegra(REGRA_OK, CRIAR), { campos: {}, valores: REGRA_OK });
});
test('regra: nome vazio', () => {
    assert.strictEqual(validarRegra({ ...REGRA_OK, nome: ' ' }, CRIAR).campos.nome, 'Preencha este campo.');
});
test('regra: dias inválidos', () => {
    assert.strictEqual(validarRegra({ ...REGRA_OK, dias: [7] }, CRIAR).campos.dias, 'Escolha pelo menos um dia.');
});
test('regra: dias vazio', () => {
    assert.strictEqual(validarRegra({ ...REGRA_OK, dias: [] }, CRIAR).campos.dias, 'Escolha pelo menos um dia.');
});
test('regra: hora_inicio fora do formato', () => {
    assert.strictEqual(validarRegra({ ...REGRA_OK, hora_inicio: '8:00' }, CRIAR).campos.hora_inicio,
        'Use o formato HH:MM, por exemplo 08:00.');
});
test('regra: hora_fim fora do formato', () => {
    assert.strictEqual(validarRegra({ ...REGRA_OK, hora_fim: '25:00' }, CRIAR).campos.hora_fim,
        'Use o formato HH:MM, por exemplo 08:00.');
});
test('regra: início depois do fim', () => {
    assert.strictEqual(validarRegra({ ...REGRA_OK, hora_inicio: '23:00', hora_fim: '18:00' }, CRIAR).campos.hora_fim,
        'O fim deve ser depois do início.');
});
test('regra: percentual 0', () => {
    assert.strictEqual(validarRegra({ ...REGRA_OK, percentual: 0 }, CRIAR).campos.percentual,
        'Informe um percentual entre -90 e 200, diferente de 0.');
});
test('regra: percentual fora da faixa', () => {
    assert.strictEqual(validarRegra({ ...REGRA_OK, percentual: -91 }, CRIAR).campos.percentual,
        'Informe um percentual entre -90 e 200, diferente de 0.');
});
test('regra: prioridade negativa', () => {
    assert.strictEqual(validarRegra({ ...REGRA_OK, prioridade: -1 }, CRIAR).campos.prioridade,
        'Informe um número inteiro igual ou maior que 0.');
});
test('regra: ativo não booleano', () => {
    assert.strictEqual(validarRegra({ ativo: 'sim' }, EDITAR).campos.ativo, 'Escolha sim ou não.');
});
test('regra: edição sem campos', () => {
    assert.strictEqual(validarRegra({}, EDITAR).campos.geral, 'Nada para alterar.');
});
test('regra: edição só do que veio', () => {
    assert.deepStrictEqual(validarRegra({ percentual: -10 }, EDITAR), { campos: {}, valores: { percentual: -10 } });
});

const CAMPANHA_OK = { nome: 'Black Friday', percentual: 10, inicio: '2026-11-20', fim: '2026-11-30', ativo: true };

test('validarCampanha aceita uma campanha completa', () => {
    assert.deepStrictEqual(validarCampanha(CAMPANHA_OK, CRIAR), { campos: {}, valores: CAMPANHA_OK });
});
test('campanha: nome vazio', () => {
    assert.strictEqual(validarCampanha({ ...CAMPANHA_OK, nome: '' }, CRIAR).campos.nome, 'Preencha este campo.');
});
test('campanha: percentual fora de 1–90', () => {
    assert.strictEqual(validarCampanha({ ...CAMPANHA_OK, percentual: 91 }, CRIAR).campos.percentual,
        'Informe um percentual entre 1 e 90.');
});
test('campanha: data inválida', () => {
    assert.strictEqual(validarCampanha({ ...CAMPANHA_OK, inicio: '2026-02-30' }, CRIAR).campos.inicio, 'Use uma data válida.');
});
test('campanha: fim antes do início', () => {
    assert.strictEqual(validarCampanha({ ...CAMPANHA_OK, fim: '2026-11-19' }, CRIAR).campos.fim,
        'O fim deve ser no mesmo dia ou depois do início.');
});
test('campanha: ativo não booleano', () => {
    assert.strictEqual(validarCampanha({ ativo: 1 }, EDITAR).campos.ativo, 'Escolha sim ou não.');
});
test('campanha: edição sem campos', () => {
    assert.strictEqual(validarCampanha({}, EDITAR).campos.geral, 'Nada para alterar.');
});

test('validarClasse aceita e confere', () => {
    assert.deepStrictEqual(validarClasse({ nome: 'Sócio', percentual: 15, ativo: true }, CRIAR),
        { campos: {}, valores: { nome: 'Sócio', percentual: 15, ativo: true } });
});
test('classe: nome vazio', () => {
    assert.strictEqual(validarClasse({ percentual: 15 }, CRIAR).campos.nome, 'Preencha este campo.');
});
test('classe: percentual fora de 1–90', () => {
    assert.strictEqual(validarClasse({ nome: 'Sócio', percentual: 0 }, CRIAR).campos.percentual,
        'Informe um percentual entre 1 e 90.');
});
test('classe: ativo não booleano', () => {
    assert.strictEqual(validarClasse({ ativo: null }, EDITAR).campos.ativo, 'Escolha sim ou não.');
});
test('classe: edição sem campos', () => {
    assert.strictEqual(validarClasse({}, EDITAR).campos.geral, 'Nada para alterar.');
});

const PACOTE_OK = { nome: 'Iniciante', inicio: '2026-11-01', fim: '2026-11-30', preco_centavos: 15000, horas: 1,
    modelo_id: 1, tipo_municao_id: 5, municao_qtd: 50, ativo: true };

test('validarPacote aceita um pacote completo', () => {
    assert.deepStrictEqual(validarPacote(PACOTE_OK, CRIAR), { campos: {}, valores: PACOTE_OK });
});
test('validarPacote aceita pacote sem arma e sem munição', () => {
    const dados = { nome: 'Só pista', inicio: '2026-11-01', fim: '2026-11-30', preco_centavos: 9000, horas: 1 };
    assert.deepStrictEqual(validarPacote(dados, CRIAR).campos, {});
});
test('pacote: nome vazio', () => {
    assert.strictEqual(validarPacote({ ...PACOTE_OK, nome: '' }, CRIAR).campos.nome, 'Preencha este campo.');
});
test('pacote: data inválida', () => {
    assert.strictEqual(validarPacote({ ...PACOTE_OK, fim: 'amanhã' }, CRIAR).campos.fim, 'Use uma data válida.');
});
test('pacote: fim antes do início', () => {
    assert.strictEqual(validarPacote({ ...PACOTE_OK, fim: '2026-10-31' }, CRIAR).campos.fim,
        'O fim deve ser no mesmo dia ou depois do início.');
});
test('pacote: preço zero', () => {
    assert.strictEqual(validarPacote({ ...PACOTE_OK, preco_centavos: 0 }, CRIAR).campos.preco_centavos,
        'Informe um valor maior que zero.');
});
test('pacote: horas fora de 1–6', () => {
    assert.strictEqual(validarPacote({ ...PACOTE_OK, horas: 7 }, CRIAR).campos.horas, 'Informe de 1 a 6 horas.');
});
test('pacote: modelo_id inválido', () => {
    assert.strictEqual(validarPacote({ ...PACOTE_OK, modelo_id: 0 }, CRIAR).campos.modelo_id, 'Escolha um item da lista.');
});
test('pacote: tipo_municao_id inválido', () => {
    assert.strictEqual(validarPacote({ ...PACOTE_OK, tipo_municao_id: 'x' }, CRIAR).campos.tipo_municao_id,
        'Escolha um item da lista.');
});
test('pacote: munição sem quantidade', () => {
    assert.strictEqual(validarPacote({ ...PACOTE_OK, municao_qtd: null }, CRIAR).campos.municao_qtd,
        'Informe a quantidade de munição do pacote.');
});
test('pacote: quantidade sem munição', () => {
    assert.strictEqual(validarPacote({ ...PACOTE_OK, tipo_municao_id: null }, CRIAR).campos.tipo_municao_id,
        'Escolha um item da lista.');
});
test('pacote: ativo não booleano', () => {
    assert.strictEqual(validarPacote({ ativo: 'não' }, EDITAR).campos.ativo, 'Escolha sim ou não.');
});
test('pacote: edição sem campos', () => {
    assert.strictEqual(validarPacote({}, EDITAR).campos.geral, 'Nada para alterar.');
});

// --- Pendências da Task 6 ---

test('pacote com arma e munição só vale quando o mesmo participante tem as duas', () => {
    const tabela = tabelaBase({ pacotes: [INICIANTE], modelos: { 1: 3000, 2: 3500 }, tipos_municao: { 5: 250, 6: 300 } });
    const dividido = [
        { ...estande(50), modelo_id: 1, tipo_municao_id: 6 },
        { ...estande(50), modelo_id: 2, tipo_municao_id: 5 },
    ];
    assert.strictEqual(calcularPreco(pedido(QUARTA_10H, 2, dividido), tabela, CTX).desconto, null);
    const junto = [{ ...estande(50), modelo_id: 1, tipo_municao_id: 5 }, { ...estande(50), modelo_id: 2, tipo_municao_id: 6 }];
    assert.strictEqual(calcularPreco(pedido(QUARTA_10H, 2, junto), tabela, CTX).desconto.tipo, 'pacote');
});

test('centavosDoTexto aceita ponto como separador decimal', () => {
    assert.strictEqual(centavosDoTexto('120.50'), 12050);
    assert.strictEqual(centavosDoTexto('120.5'), 12050);
    assert.strictEqual(centavosDoTexto('1.234'), 123400);
    assert.strictEqual(centavosDoTexto('1.234,56'), 123456);
    assert.strictEqual(centavosDoTexto('1.234.56'), null);
    assert.strictEqual(centavosDoTexto('12.345.678'), 1234567800);
});

test('formatarReais com valor negativo', () => {
    assert.strictEqual(formatarReais(-150), '-R$ 1,50');
    assert.strictEqual(formatarReais(-123456), '-R$ 1.234,56');
    assert.strictEqual(formatarReais(0), 'R$ 0,00');
});

test('conferirItensDoPacote', () => {
    const SEM_MODELO = 'Este modelo está sem preço. Defina o preço na aba Preços antes de usá-lo num pacote.';
    const SEM_MUNICAO = 'Esta munição está sem preço. Defina o preço na aba Preços antes de usá-la num pacote.';
    const CALIBRE = 'Esta munição não é do calibre do modelo escolhido.';
    const m = { preco_hora_centavos: 3000, calibre_id: 1 };
    const t = { preco_unidade_centavos: 250, calibre_id: 1 };
    assert.deepStrictEqual(conferirItensDoPacote({}, { modelo: { ...m, preco_hora_centavos: null }, tipoMunicao: null }),
        { modelo_id: SEM_MODELO });
    assert.deepStrictEqual(conferirItensDoPacote({}, { modelo: null, tipoMunicao: { ...t, preco_unidade_centavos: null } }),
        { tipo_municao_id: SEM_MUNICAO });
    assert.deepStrictEqual(conferirItensDoPacote({}, { modelo: m, tipoMunicao: { ...t, calibre_id: 2 } }),
        { tipo_municao_id: CALIBRE });
    assert.deepStrictEqual(conferirItensDoPacote({}, { modelo: m, tipoMunicao: t }), {});
    assert.deepStrictEqual(conferirItensDoPacote({}, { modelo: null, tipoMunicao: null }), {});
});
