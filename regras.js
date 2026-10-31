const INSTRUTORES = ['J.CARLOS', 'MARLON', 'JP.BROTAS', 'MATOS', 'W.ASSUNCAO', 'PEDRO', 'NAPOLEAO', 'MAURICIO'];
const ARMAMENTOS = ['Pistola .380', 'Pistola 9mm', 'Revólver .38', 'Carabina .22', 'Espingarda calibre 12'];
const HORA_ABERTURA = 8;
const HORA_ULTIMO_INICIO = 22;
const HORA_FECHAMENTO = 23;
const MUNICAO_MINIMA = 50;
const ANTECEDENCIA_HORAS = 24;
const HORAS_INICIO = Array.from(
    { length: HORA_ULTIMO_INICIO - HORA_ABERTURA + 1 },
    (_, indice) => HORA_ABERTURA + indice
);

function interpretarResposta(ok, corpo) {
    if (!ok) return 'falha';

    let dados;
    try {
        dados = JSON.parse(corpo);
    } catch (erro) {
        return 'falha';
    }

    if (dados?.status === 'ok') return 'sucesso';
    if (dados?.status === 'conflito') return 'conflito';
    return 'falha';
}

function duracoesPermitidas(horaInicio) {
    return Array.from({ length: HORA_FECHAMENTO - horaInicio }, (_, indice) => indice + 1);
}

function lerInteiro(texto) {
    const limpo = String(texto).trim();
    return /^\d+$/.test(limpo) ? Number(limpo) : NaN;
}

function lerData(texto) {
    const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
    if (!partes) return null;

    const [ano, mes, dia] = partes.slice(1).map(Number);
    const data = new Date(ano, mes - 1, dia);
    const existe = data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia;
    return existe ? data : null;
}

function validarAgendamento(dados, agora) {
    const erros = {};

    if (!dados.usuario.trim()) erros.usuario = 'Informe o nome do atirador.';
    if (!INSTRUTORES.includes(dados.instrutor)) erros.instrutor = 'Selecione um instrutor.';
    if (!ARMAMENTOS.includes(dados.armamento)) erros.armamento = 'Selecione um armamento.';

    const municao = lerInteiro(dados.municao_qtd);
    if (!(municao >= MUNICAO_MINIMA)) {
        erros.municao_qtd = `Informe um número inteiro a partir de ${MUNICAO_MINIMA}.`;
    }

    const horaInicio = lerInteiro(dados.hora_inicio);
    const horaValida = HORAS_INICIO.includes(horaInicio);
    if (!horaValida) erros.hora_inicio = 'Selecione o horário de início.';

    const dia = lerData(dados.data);
    if (!dia) {
        erros.data = 'Selecione uma data válida.';
    } else {
        const inicio = new Date(dia);
        inicio.setHours(horaValida ? horaInicio : HORA_ULTIMO_INICIO);
        if (inicio - agora < ANTECEDENCIA_HORAS * 60 * 60 * 1000) {
            erros.data = `Agende com pelo menos ${ANTECEDENCIA_HORAS} horas de antecedência.`;
        }
    }

    const duracao = lerInteiro(dados.duracao_horas);
    if (!(duracao >= 1)) {
        erros.duracao_horas = 'Selecione a duração.';
    } else if (horaValida && !duracoesPermitidas(horaInicio).includes(duracao)) {
        erros.duracao_horas = `A sessão deve terminar até as ${HORA_FECHAMENTO}h.`;
    }

    return erros;
}

function dataMinima(agora) {
    const limite = new Date(agora.getTime() + ANTECEDENCIA_HORAS * 60 * 60 * 1000);
    const mes = String(limite.getMonth() + 1).padStart(2, '0');
    const dia = String(limite.getDate()).padStart(2, '0');
    return `${limite.getFullYear()}-${mes}-${dia}`;
}

function formatarData(data) {
    const [ano, mes, dia] = data.split('-');
    return `${dia}/${mes}/${ano}`;
}

function montarEnvio(dados) {
    const horaInicio = Number(dados.hora_inicio);
    const duracao = Number(dados.duracao_horas);

    return {
        usuario: dados.usuario.trim(),
        armamento: dados.armamento,
        municao_qtd: Number(dados.municao_qtd),
        instrutor: dados.instrutor,
        data: dados.data,
        hora_inicio: horaInicio,
        duracao_horas: duracao,
        hora_fim: horaInicio + duracao
    };
}

if (typeof module !== 'undefined') {
    module.exports = {
        dataMinima,
        formatarData,
        montarEnvio,
        INSTRUTORES,
        ARMAMENTOS,
        HORAS_INICIO,
        HORA_FECHAMENTO,
        MUNICAO_MINIMA,
        ANTECEDENCIA_HORAS,
        interpretarResposta,
        duracoesPermitidas,
        validarAgendamento
    };
}
