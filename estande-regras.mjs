// Regras da página do estande (estande.html) que não mexem na tela: dá para testar no Node.
// A conta do desconto de classe é feita aqui só para MOSTRAR; quem decide o valor é o servidor.
import { partesNoFuso } from './supabase/functions/_shared/agendamento.mjs';
import { descontoDeClasse, formatarReais, centavosDoTexto } from './supabase/functions/_shared/precos.mjs';
import { FORMAS_PAGAMENTO } from './supabase/functions/_shared/operacao.mjs';

const SEM_VALOR = '—';
const HORA_MS = 3600000;

// As áreas e quem vê cada uma ficam em estande-areas.mjs (leve, para o menu); daqui só se reexporta.
export { AREAS_ESTANDE, areasVisiveis } from './estande-areas.mjs';

export const ROTULO_SITUACAO = {
    aguardando_pagamento: 'Aguardando check-in',
    pago: 'Pago pelo app',
    check_in: 'Check-in feito',
    concluido: 'Concluído',
    nao_compareceu: 'Não compareceu',
};

// "Fazer check-in" só aparece para quem ainda não fez.
export function podeAbrirFicha(situacao) {
    return situacao === 'aguardando_pagamento' || situacao === 'pago';
}

const doisDigitos = (n) => String(n).padStart(2, '0');

// '08:00 às 10:00', no relógio do fuso do estande.
export function textoDoHorario(inicio, horas, fuso) {
    const comeco = new Date(inicio);
    const p = partesNoFuso(comeco, fuso);
    const f = partesNoFuso(new Date(comeco.getTime() + horas * HORA_MS), fuso);
    return `${doisDigitos(p.hora)}:${doisDigitos(p.minuto)} às ${doisDigitos(f.hora)}:${doisDigitos(f.minuto)}`;
}

// [1, 2, 4] → 'Pistas 1, 2 e 4'.
export function textoDasPistas(numeros) {
    if (!numeros?.length) return SEM_VALOR;
    if (numeros.length === 1) return `Pista ${numeros[0]}`;
    return `Pistas ${numeros.slice(0, -1).join(', ')} e ${numeros[numeros.length - 1]}`;
}

export function textoDaLista(nomes) {
    return nomes?.length ? nomes.join(', ') : SEM_VALOR;
}

// O valor da lista do dia: o pago no balcão (com a nota), se já houve check-in com pagamento; senão, o do agendamento.
export function textoDoValor({ valor_centavos, pago_no_balcao_centavos }) {
    if (pago_no_balcao_centavos != null) return { valor: formatarReais(pago_no_balcao_centavos), nota: 'pago no balcão' };
    return { valor: valor_centavos == null ? SEM_VALOR : formatarReais(valor_centavos), nota: null };
}

// 'AAAA-MM-DD' → 'DD/MM/AAAA'.
export function dataBrasileira(data) {
    const [ano, mes, dia] = String(data ?? '').split('-');
    return dia ? `${dia}/${mes}/${ano}` : SEM_VALOR;
}

// O que um participante da ficha usa (o servidor manda o modelo e a munição já como texto).
export function usoDoParticipante(p) {
    const arma = p.modalidade === 'estande' ? `${p.modelo ?? 'Arma'}, do estande` : 'Arma própria';
    const municao = p.modalidade === 'tudo_proprio' || !p.tipo_municao ? 'Própria' : `${p.municao_qtd ?? 0} × ${p.tipo_municao}`;
    return { arma, municao };
}

// A conta do desconto de classe para a classe escolhida (o valor da lista, em texto), ou null quando
// não há classe, não há preço guardado ou a classe não está na ficha.
export function contaDaFicha(ficha, classeId) {
    const preco = ficha.agendamento.preco_detalhe;
    if (!preco || !classeId) return null;
    const classe = ficha.classes.find((c) => String(c.id) === String(classeId));
    if (!classe) return null;
    return descontoDeClasse(preco, classe, ficha.custo_municao_centavos);
}

// O valor a cobrar que a tela mostra (e manda como esperado): o da conta ou o congelado; null sem preço.
export function valorACobrarCentavos(ficha, conta) {
    if (conta) return conta.valor_cobrado_centavos;
    return ficha.agendamento.preco_detalhe ? ficha.agendamento.preco_total_centavos : null;
}

const ROTULO_PARTE = { pista: 'Pista', aluguel: 'Aluguel de armas', municao: 'Munição' };

// As linhas da tabela da conta (spec 6.1): cada parte, o total, o valor congelado (se houver pacote ou
// campanha) e o valor a cobrar.
export function linhasDaConta(conta, preco) {
    const linha = (rotulo, antes, desconto, depois, tipo) => ({ rotulo, antes, desconto, depois, tipo });
    const linhas = conta.partes.map((p) => linha(ROTULO_PARTE[p.parte], formatarReais(p.antes_centavos),
        `${p.percentual}%`, formatarReais(p.depois_centavos), 'parte'));
    linhas.push(linha('Total', formatarReais(conta.total_antes_centavos), '', formatarReais(conta.total_com_classe_centavos), 'total'));
    if (conta.total_congelado_centavos !== conta.total_antes_centavos) {
        const nome = preco?.desconto?.nome;
        linhas.push(linha(nome ? `Valor do agendamento (${nome})` : 'Valor do agendamento', '', '',
            formatarReais(conta.total_congelado_centavos), 'congelado'));
    }
    linhas.push(linha('Valor a cobrar', '', '', formatarReais(conta.valor_cobrado_centavos), 'cobrar'));
    return linhas;
}

export function avisosDaConta(conta) {
    if (!conta) return [];
    const avisos = [];
    if (conta.limitado_ao_custo) avisos.push('Desconto da munição limitado ao custo de compra.');
    if (!conta.melhorou) avisos.push('O preço do agendamento já é menor que com este desconto.');
    return avisos;
}

// O corpo do POST operacao (check-in) a partir da ficha e do que foi escolhido na tela.
// escolhas: { forma_pagamento, classe_id (texto da lista; '' = sem desconto), documento, valor_texto }.
// campos: só os erros que a tela consegue ver sozinha (o valor digitado); o resto o servidor confere.
export function corpoDoCheckIn(ficha, escolhas) {
    const { agendamento } = ficha;
    if (agendamento.situacao === 'pago') return { corpo: { acao: 'check_in', id: agendamento.id }, campos: {} };

    const temPreco = agendamento.preco_detalhe != null;
    const classeId = temPreco && escolhas.classe_id ? Number(escolhas.classe_id) : null;
    const corpo = {
        acao: 'check_in',
        id: agendamento.id,
        forma_pagamento: escolhas.forma_pagamento ?? '',
        classe_id: classeId,
        documento: classeId === null ? null : String(escolhas.documento ?? '').trim(),
    };
    const campos = {};
    if (temPreco) {
        corpo.valor_esperado_centavos = valorACobrarCentavos(ficha, contaDaFicha(ficha, classeId));
    } else {
        const texto = String(escolhas.valor_texto ?? '').trim();
        const valor = centavosDoTexto(texto);
        if (texto === '') campos.valor_centavos = 'Informe o valor cobrado.';
        else if (valor === null) campos.valor_centavos = 'Use um valor em reais, por exemplo 120,00.';
        corpo.valor_centavos = valor;
    }
    return { corpo, campos };
}

// O que a atendente tinha escolhido na ficha, para reaplicar quando a ficha é recarregada (depois de um
// 409): a forma de pagamento, a classe (só se ainda estiver entre as ativas) e o documento.
export function escolhasMantidas(escolhas, classes) {
    const forma = FORMAS_PAGAMENTO.includes(escolhas.forma_pagamento) ? escolhas.forma_pagamento : '';
    const classe = String(escolhas.classe_id ?? '');
    const ativa = classe !== '' && classes.some((c) => String(c.id) === classe);
    return { forma_pagamento: forma, classe_id: ativa ? classe : '', documento: String(escolhas.documento ?? '') };
}
