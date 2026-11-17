// Preços: valor da pista por horário, aluguel, munição, pacotes e campanhas; e a conferência
// dos cadastros de preço. Módulo puro: roda igual no Node (testes), no Deno (Edge Functions) e no navegador.
// Dinheiro é sempre um número inteiro de centavos.

import { partesNoFuso } from './agendamento.mjs';

const HORA_MS = 3600000;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const RELOGIO = /^([01]\d|2[0-3]):[0-5]\d$/;
// "120", "120,5", "1.234,56", "R$ 1.234,56" (pontos só como separador de milhar).
const VALOR = /^(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

// --- Dinheiro ---

export function formatarReais(centavos) {
    const reais = Math.floor(centavos / 100);
    const resto = String(centavos % 100).padStart(2, '0');
    const milhar = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `R$ ${milhar},${resto}`;
}

export function centavosDoTexto(texto) {
    if (typeof texto !== 'string') return null;
    const m = VALOR.exec(texto.trim());
    if (!m) return null;
    const reais = Number(m[1].replace(/\./g, ''));
    const centavos = m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0'));
    return reais * 100 + centavos;
}

// --- Cálculo ---

function preco(mapa, id) {
    const valor = mapa[id];
    if (!Number.isInteger(valor)) throw new Error('preço ausente');
    return valor;
}

function relogio(hora, minuto) {
    return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}

// Regra que vale para o início daquela hora: a de maior prioridade; empate, a de menor percentual.
function regraDaHora(regras, diaSemana, hhmm) {
    let melhor = null;
    for (const r of regras) {
        if (!r.dias.includes(diaSemana) || !(r.hora_inicio <= hhmm && hhmm < r.hora_fim)) continue;
        if (!melhor || r.prioridade > melhor.prioridade
            || (r.prioridade === melhor.prioridade && r.percentual < melhor.percentual)) melhor = r;
    }
    return melhor;
}

// Valor de cada hora da sessão, para uma pista, já com o ajuste das regras.
function valoresDasHoras(pedido, tabela, fuso) {
    const inicio = new Date(pedido.inicio).getTime();
    const base = tabela.hora_pista_centavos;
    const valores = [];
    for (let h = 0; h < pedido.horas; h++) {
        const p = partesNoFuso(new Date(inicio + h * HORA_MS), fuso);
        const regra = regraDaHora(tabela.regras, p.diaSemana, relogio(p.hora, p.minuto));
        valores.push(regra ? Math.round(base * (100 + regra.percentual) / 100) : base);
    }
    return valores;
}

const soma = (lista) => lista.reduce((total, v) => total + v, 0);
const vigente = (item, hoje) => item.inicio <= hoje && hoje <= item.fim;

// Quanto o pacote economiza neste pedido (0 quando não vale).
function economiaDoPacote(pacote, pedido, tabela, valoresHoras, hoje) {
    if (!vigente(pacote, hoje) || pacote.horas > pedido.horas) return 0;
    const { participantes } = pedido;
    let coberto = soma(valoresHoras.slice(0, pacote.horas));
    if (pacote.modelo_id != null) {
        if (!participantes.some((p) => p.modalidade === 'estande' && p.modelo_id === pacote.modelo_id)) return 0;
        coberto += pacote.horas * preco(tabela.modelos, pacote.modelo_id);
    }
    if (pacote.tipo_municao_id != null) {
        const usa = participantes.some((p) => p.tipo_municao_id === pacote.tipo_municao_id
            && (p.modalidade === 'estande' || p.modalidade === 'arma_propria')
            && p.municao_qtd >= pacote.municao_qtd);
        if (!usa) return 0;
        coberto += pacote.municao_qtd * preco(tabela.tipos_municao, pacote.tipo_municao_id);
    }
    return Math.max(0, coberto - pacote.preco_centavos);
}

export function calcularPreco(pedido, tabela, { hoje, fuso }) {
    const pistas = pedido.instrutores_necessarios;
    const { horas, participantes } = pedido;
    const valoresHoras = valoresDasHoras(pedido, tabela, fuso);

    let aluguel = 0;
    let municao = 0;
    for (const p of participantes) {
        if (p.modalidade === 'estande') aluguel += preco(tabela.modelos, p.modelo_id) * horas;
        if (p.modalidade === 'estande' || p.modalidade === 'arma_propria') {
            municao += preco(tabela.tipos_municao, p.tipo_municao_id) * p.municao_qtd;
        }
    }

    const itens = [
        { descricao: `Pista (${pistas} pista${pistas > 1 ? 's' : ''} × ${horas} hora${horas > 1 ? 's' : ''})`,
            total_centavos: pistas * soma(valoresHoras) },
        { descricao: 'Aluguel de armas', total_centavos: aluguel },
        { descricao: 'Munição', total_centavos: municao },
    ].filter((i) => i.total_centavos > 0);
    const subtotal = soma(itens.map((i) => i.total_centavos));

    let pacote = null;
    for (const pc of tabela.pacotes) {
        const economia = economiaDoPacote(pc, pedido, tabela, valoresHoras, hoje);
        if (economia > 0 && (!pacote || economia > pacote.valor_centavos)) {
            pacote = { tipo: 'pacote', nome: `Pacote ${pc.nome}`, valor_centavos: economia };
        }
    }

    let campanha = null;
    for (const c of tabela.campanhas) {
        if (!vigente(c, hoje) || (campanha && c.percentual <= campanha.percentual)) continue;
        campanha = { percentual: c.percentual, desconto: { tipo: 'campanha',
            nome: `Campanha ${c.nome} (${c.percentual}%)`, valor_centavos: Math.round(subtotal * c.percentual / 100) } };
    }
    const descontoCampanha = campanha && campanha.desconto.valor_centavos > 0 ? campanha.desconto : null;

    let desconto = pacote;
    if (descontoCampanha && (!pacote || descontoCampanha.valor_centavos > pacote.valor_centavos)) {
        desconto = descontoCampanha;
    }

    return {
        itens,
        subtotal_centavos: subtotal,
        desconto,
        total_centavos: subtotal - (desconto ? desconto.valor_centavos : 0),
    };
}

// --- Conferência dos cadastros ---

function dataReal(data) {
    if (typeof data !== 'string' || !DATA.test(data)) return false;
    const d = new Date(`${data}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === data;
}

const inteiroEntre = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Cada conferência devolve a mensagem de erro, ou null quando o valor está certo.
const CONFERE = {
    texto: (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'Preencha este campo.'),
    booleano: (v) => (typeof v === 'boolean' ? null : 'Escolha sim ou não.'),
    dias: (v) => (Array.isArray(v) && v.length > 0 && v.every((d) => inteiroEntre(d, 0, 6))
        ? null : 'Escolha pelo menos um dia.'),
    relogio: (v) => (typeof v === 'string' && RELOGIO.test(v) ? null : 'Use o formato HH:MM, por exemplo 08:00.'),
    percentualRegra: (v) => (inteiroEntre(v, -90, 200) && v !== 0
        ? null : 'Informe um percentual entre -90 e 200, diferente de 0.'),
    prioridade: (v) => (Number.isInteger(v) && v >= 0 ? null : 'Informe um número inteiro igual ou maior que 0.'),
    percentualDesconto: (v) => (inteiroEntre(v, 1, 90) ? null : 'Informe um percentual entre 1 e 90.'),
    data: (v) => (dataReal(v) ? null : 'Use uma data válida.'),
    centavos: (v) => (Number.isInteger(v) && v > 0 ? null : 'Informe um valor maior que zero.'),
    horas: (v) => (inteiroEntre(v, 1, 6) ? null : 'Informe de 1 a 6 horas.'),
    idOpcional: (v) => (v === null || (Number.isInteger(v) && v > 0) ? null : 'Escolha um item da lista.'),
    qtdOpcional: (v) => (v === null || (Number.isInteger(v) && v > 0)
        ? null : 'Informe a quantidade de munição do pacote.'),
};

const NAO_EXISTE = 'Este campo não pode ser mudado aqui.';

// Regras por campo: [conferência, obrigatório ao criar, padrão ao criar].
function validar(campos, dados, criando, cruzar) {
    const enviados = typeof dados === 'object' && dados !== null && !Array.isArray(dados) ? dados : {};
    const erros = {};
    const valores = {};
    for (const campo of Object.keys(enviados)) {
        if (!Object.hasOwn(campos, campo)) erros[campo] = NAO_EXISTE;
    }
    for (const [campo, [tipo, obrigatorio, padrao]] of Object.entries(campos)) {
        if (!Object.hasOwn(enviados, campo)) {
            if (!criando) continue;
            if (obrigatorio) erros[campo] = CONFERE[tipo](undefined);
            else if (padrao !== undefined) valores[campo] = padrao;
            continue;
        }
        const valor = tipo === 'texto' && typeof enviados[campo] === 'string' ? enviados[campo].trim() : enviados[campo];
        const erro = CONFERE[tipo](valor);
        if (erro) erros[campo] = erro;
        else valores[campo] = valor;
    }
    if (cruzar) cruzar(valores, erros, enviados, criando);

    if (!criando && Object.keys(erros).length === 0 && Object.keys(valores).length === 0) {
        erros.geral = 'Nada para alterar.';
    }
    return Object.keys(erros).length ? { campos: erros, valores: {} } : { campos: erros, valores };
}

// Período de datas: o fim no mesmo dia ou depois do início (quando os dois vieram certos).
function conferirPeriodo(valores, erros) {
    if (valores.inicio && valores.fim && valores.fim < valores.inicio) {
        erros.fim = 'O fim deve ser no mesmo dia ou depois do início.';
    }
}

const CAMPOS_REGRA = {
    nome: ['texto', true],
    dias: ['dias', true],
    hora_inicio: ['relogio', true],
    hora_fim: ['relogio', true],
    percentual: ['percentualRegra', true],
    prioridade: ['prioridade', false, 0],
    ativo: ['booleano', false],
};

export function validarRegra(dados, { criando }) {
    return validar(CAMPOS_REGRA, dados, criando, (valores, erros) => {
        if (valores.hora_inicio && valores.hora_fim && valores.hora_inicio >= valores.hora_fim) {
            erros.hora_fim = 'O fim deve ser depois do início.';
        }
    });
}

const CAMPOS_CAMPANHA = {
    nome: ['texto', true],
    percentual: ['percentualDesconto', true],
    inicio: ['data', true],
    fim: ['data', true],
    ativo: ['booleano', false],
};

export function validarCampanha(dados, { criando }) {
    return validar(CAMPOS_CAMPANHA, dados, criando, conferirPeriodo);
}

const CAMPOS_CLASSE = {
    nome: ['texto', true],
    percentual: ['percentualDesconto', true],
    ativo: ['booleano', false],
};

export function validarClasse(dados, { criando }) {
    return validar(CAMPOS_CLASSE, dados, criando);
}

const CAMPOS_PACOTE = {
    nome: ['texto', true],
    inicio: ['data', true],
    fim: ['data', true],
    preco_centavos: ['centavos', true],
    horas: ['horas', true],
    modelo_id: ['idOpcional', false],
    tipo_municao_id: ['idOpcional', false],
    municao_qtd: ['qtdOpcional', false],
    ativo: ['booleano', false],
};

// Munição e quantidade andam juntas. Ao criar, confere sempre; numa edição, só quando as duas vieram.
function conferirMunicao(valores, erros, enviados, criando) {
    const vieramAsDuas = Object.hasOwn(enviados, 'tipo_municao_id') && Object.hasOwn(enviados, 'municao_qtd');
    if (!criando && !vieramAsDuas) return;
    if (erros.tipo_municao_id || erros.municao_qtd) return;
    const tipo = valores.tipo_municao_id ?? null;
    const qtd = valores.municao_qtd ?? null;
    if (tipo !== null && qtd === null) erros.municao_qtd = 'Informe a quantidade de munição do pacote.';
    if (tipo === null && qtd !== null) erros.tipo_municao_id = 'Escolha um item da lista.';
}

export function validarPacote(dados, { criando }) {
    return validar(CAMPOS_PACOTE, dados, criando, (valores, erros, enviados, cr) => {
        conferirPeriodo(valores, erros);
        conferirMunicao(valores, erros, enviados, cr);
    });
}
