// Operação do estande: regras do check-in. Módulo puro: roda igual no Node (testes), no Deno
// (Edge Functions) e no navegador. Dinheiro é sempre um número inteiro de centavos.

import { dataNoFuso } from './cadastro.mjs';

export const FORMAS_PAGAMENTO = ['dinheiro', 'pix', 'cartao_debito', 'cartao_credito'];
export const ROTULO_FORMA = {
    dinheiro: 'Dinheiro',
    pix: 'Pix',
    cartao_debito: 'Cartão de débito',
    cartao_credito: 'Cartão de crédito',
};

const MOTIVO_POR_SITUACAO = {
    check_in: 'O check-in deste agendamento já foi feito.',
    concluido: 'O check-in deste agendamento já foi feito.',
    cancelado: 'Este agendamento foi cancelado.',
    nao_compareceu: 'Este agendamento foi marcado como não compareceu.',
};

// Devolve o motivo de não poder fazer o check-in agora, ou null quando pode.
export function motivoSemCheckIn({ situacao, inicio }, { hoje, fuso }) {
    if (Object.hasOwn(MOTIVO_POR_SITUACAO, situacao)) return MOTIVO_POR_SITUACAO[situacao];
    if (dataNoFuso(new Date(inicio), fuso) !== hoje) return 'O check-in só pode ser feito no dia da sessão.';
    return null;
}

const NAO_EXISTE = 'Este campo não pode ser mudado aqui.';
const MAX_DOCUMENTO = 60;
const centavosValidos = (v) => Number.isInteger(v) && v >= 0;

// Confere o pedido de check-in. Com situação `pago` não há o que informar (valores.pagamento = null).
// Com `aguardando_pagamento`, valores.pagamento traz a forma, a classe (ou null), o documento (ou null)
// e o valor: `valor_esperado_centavos` quando há preço guardado, `valor_centavos` quando não há.
export function validarCheckIn(dados, { situacao, temPreco }) {
    const enviados = typeof dados === 'object' && dados !== null && !Array.isArray(dados) ? dados : {};
    const campos = {};

    if (situacao === 'pago') {
        for (const campo of Object.keys(enviados)) campos[campo] = NAO_EXISTE;
        return Object.keys(campos).length
            ? { campos, valores: {} }
            : { campos, valores: { pagamento: null } };
    }

    const permitidos = ['forma_pagamento', 'classe_id', 'documento',
        temPreco ? 'valor_esperado_centavos' : 'valor_centavos'];
    for (const campo of Object.keys(enviados)) {
        if (!permitidos.includes(campo)) campos[campo] = NAO_EXISTE;
    }

    const forma = enviados.forma_pagamento;
    if (!FORMAS_PAGAMENTO.includes(forma)) campos.forma_pagamento = 'Escolha a forma de pagamento.';

    const classe = enviados.classe_id ?? null;
    let documento = null;
    if (classe !== null) {
        if (!temPreco) {
            campos.classe_id = 'Este agendamento não tem preço guardado: o desconto de classe não está disponível.';
        } else if (!Number.isInteger(classe) || classe <= 0) {
            campos.classe_id = 'Escolha um item da lista.';
        }
        const texto = typeof enviados.documento === 'string' ? enviados.documento.trim() : '';
        if (texto === '') campos.documento = 'Informe o número do documento conferido.';
        else if (texto.length > MAX_DOCUMENTO) campos.documento = `Use no máximo ${MAX_DOCUMENTO} caracteres.`;
        else documento = texto;
    }

    const campoValor = temPreco ? 'valor_esperado_centavos' : 'valor_centavos';
    if (!centavosValidos(enviados[campoValor])) campos[campoValor] = 'Informe o valor cobrado.';

    if (Object.keys(campos).length) return { campos, valores: {} };
    return {
        campos,
        valores: {
            pagamento: {
                forma_pagamento: forma,
                classe_id: classe,
                documento,
                [campoValor]: enviados[campoValor],
            },
        },
    };
}
