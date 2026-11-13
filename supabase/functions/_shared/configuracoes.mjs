// Conferência dos valores das Configurações antes de gravar.
// Módulo puro: roda igual no Node (testes) e no Deno (Edge Functions).

export const CHAVES_CONFIGURACAO = ['estande', 'funcionamento', 'agenda', 'municao', 'cadastro', 'creditos'];

// Campos numéricos obrigatórios de cada chave. Todos são inteiros maiores que 0, salvo os de ACEITAM_ZERO.
const CAMPOS_NUMERICOS = {
    agenda: [
        'antecedencia_minima_horas', 'antecedencia_maxima_dias', 'prazo_alteracao_horas',
        'duracao_maxima_individual', 'duracao_maxima_grupo', 'grupo_maximo',
        'poucas_vagas', 'tolerancia_nao_comparecimento_min',
    ],
    municao: ['minima_por_participante'],
    cadastro: ['idade_minima'],
    creditos: ['validade_dias', 'arrependimento_dias'],
};
const ACEITAM_ZERO = ['antecedencia_minima_horas', 'tolerancia_nao_comparecimento_min'];

// Teto do banco: agendamentos.horas tem "check (horas between 1 and 6)".
const DURACAO_MAXIMA_BANCO = 6;
// CDC art. 49: o direito de arrependimento é de no mínimo 7 dias.
const ARREPENDIMENTO_MINIMO_DIAS = 7;

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function ehObjeto(valor) {
    return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function dataValida(texto) {
    if (typeof texto !== 'string' || !DATA.test(texto)) return false;
    const data = new Date(`${texto}T00:00:00Z`);
    return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === texto;
}

function validarNumeros(chave, valor, erros) {
    for (const campo of CAMPOS_NUMERICOS[chave]) {
        const numero = valor[campo];
        const minimo = ACEITAM_ZERO.includes(campo) ? 0 : 1;
        if (!Number.isInteger(numero) || numero < minimo) {
            erros[campo] = minimo === 0
                ? 'Informe um número inteiro igual ou maior que 0.'
                : 'Informe um número inteiro maior que 0.';
        }
    }
}

function validarAgenda(valor, erros) {
    validarNumeros('agenda', valor, erros);

    if (!erros.duracao_maxima_individual && !erros.duracao_maxima_grupo
        && valor.duracao_maxima_individual > valor.duracao_maxima_grupo) {
        erros.duracao_maxima_individual = 'A duração máxima de quem vai sozinho não pode passar a duração máxima de grupo.';
    }
    if (!erros.duracao_maxima_grupo && valor.duracao_maxima_grupo > DURACAO_MAXIMA_BANCO) {
        erros.duracao_maxima_grupo = `A sessão pode ter no máximo ${DURACAO_MAXIMA_BANCO} horas.`;
    }

    const faixas = valor.faixas_instrutores;
    if (!Array.isArray(faixas) || faixas.length === 0) {
        erros.faixas_instrutores = 'Informe pelo menos uma faixa de instrutores.';
        return;
    }
    let anterior = 0;
    for (const faixa of faixas) {
        if (!ehObjeto(faixa) || !Number.isInteger(faixa.ate) || faixa.ate <= anterior) {
            erros.faixas_instrutores = 'O tamanho de grupo de cada faixa deve ser um número inteiro maior que o da faixa anterior.';
            return;
        }
        if (!Number.isInteger(faixa.instrutores) || faixa.instrutores < 1) {
            erros.faixas_instrutores = 'Cada faixa precisa de pelo menos 1 instrutor.';
            return;
        }
        anterior = faixa.ate;
    }
    if (!erros.grupo_maximo && anterior !== valor.grupo_maximo) {
        erros.faixas_instrutores = 'A última faixa deve terminar no tamanho máximo de grupo.';
    }
}

function validarFuncionamento(valor, erros) {
    if (!ehObjeto(valor.dias)) {
        erros.dias = 'Informe o horário de cada dia da semana.';
    } else {
        for (let dia = 0; dia <= 6; dia++) {
            const campo = `dias.${dia}`;
            const horario = valor.dias[dia];
            if (horario === null) continue;
            if (horario === undefined) {
                erros[campo] = 'Informe o horário deste dia ou marque como fechado.';
            } else if (!ehObjeto(horario) || !HORA.test(horario.abre) || !HORA.test(horario.fecha)) {
                erros[campo] = 'Use o formato HH:MM, por exemplo 08:00.';
            } else if (horario.abre >= horario.fecha) {
                erros[campo] = 'O horário de abertura deve ser antes do de fechamento.';
            }
        }
    }
    if (!Array.isArray(valor.datas_fechadas) || !valor.datas_fechadas.every(dataValida)) {
        erros.datas_fechadas = 'Use datas válidas no formato AAAA-MM-DD, por exemplo 2026-12-25.';
    }
}

function fusoValido(fuso) {
    if (typeof fuso !== 'string' || fuso.trim() === '') return false;
    try {
        new Intl.DateTimeFormat('en', { timeZone: fuso });
        return true;
    } catch {
        return false;
    }
}

function validarEstande(valor, erros) {
    if (typeof valor.nome !== 'string' || valor.nome.trim() === '') {
        erros.nome = 'Informe o nome do estande.';
    }
    if (!fusoValido(valor.fuso)) {
        erros.fuso = 'Escolha um fuso horário válido, por exemplo America/Sao_Paulo.';
    }
    for (const campo of ['endereco', 'contato']) {
        if (typeof valor[campo] !== 'string') erros[campo] = 'Informe um texto (pode ficar em branco).';
    }
    if (valor.logo_url !== null && typeof valor.logo_url !== 'string') {
        erros.logo_url = 'Informe o endereço da imagem do logo ou deixe sem logo.';
    }
}

function validarCreditos(valor, erros) {
    validarNumeros('creditos', valor, erros);
    if (!erros.arrependimento_dias && valor.arrependimento_dias < ARREPENDIMENTO_MINIMO_DIAS) {
        erros.arrependimento_dias = `Pela lei (CDC, art. 49), o prazo de arrependimento é de no mínimo ${ARREPENDIMENTO_MINIMO_DIAS} dias.`;
    }
}

// Devolve {} quando está tudo certo; senão, um mapa campo → mensagem.
export function validarConfiguracao(chave, valor) {
    if (!CHAVES_CONFIGURACAO.includes(chave)) return { chave: 'Esta configuração não existe.' };
    if (!ehObjeto(valor)) return { valor: 'Envie os dados da configuração.' };

    const erros = {};
    if (chave === 'agenda') validarAgenda(valor, erros);
    else if (chave === 'funcionamento') validarFuncionamento(valor, erros);
    else if (chave === 'estande') validarEstande(valor, erros);
    else if (chave === 'creditos') validarCreditos(valor, erros);
    else validarNumeros(chave, valor, erros);
    return erros;
}
