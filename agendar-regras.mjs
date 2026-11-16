// Regras puras da tela de agendamento: textos para mostrar e filtros do catálogo que veio do servidor.
// Roda igual no navegador e no Node (testes).
import { partesNoFuso } from './supabase/functions/_shared/agendamento.mjs';

const HORA_MS = 3600000;
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ENCERRADAS = ['cancelado', 'nao_compareceu'];

export const TEXTO_SITUACAO = {
    aguardando_pagamento: 'Aguardando pagamento',
    pago: 'Pago',
    check_in: 'Check-in feito',
    concluido: 'Concluído',
    cancelado: 'Cancelado',
    nao_compareceu: 'Não compareceu',
};

const doisDigitos = (n) => String(n).padStart(2, '0');

// 'Quarta, 18/11 · das 10:00 às 12:00', no relógio do fuso do estande.
export function descreverSessao(inicio, horas, fuso) {
    const comeco = new Date(inicio);
    const p = partesNoFuso(comeco, fuso);
    const f = partesNoFuso(new Date(comeco.getTime() + horas * HORA_MS), fuso);
    const [, mes, dia] = p.data.split('-');
    return `${DIAS[p.diaSemana]}, ${dia}/${mes} · das ${doisDigitos(p.hora)}:${doisDigitos(p.minuto)}`
        + ` às ${doisDigitos(f.hora)}:${doisDigitos(f.minuto)}`;
}

export function modelosDaCategoria(catalogo, categoriaId) {
    return catalogo.modelos
        .filter((m) => m.categoria_id === categoriaId)
        .sort((a, b) => a.marca.localeCompare(b.marca) || a.nome.localeCompare(b.nome));
}

export function municoesDoModelo(catalogo, modeloId) {
    const modelo = catalogo.modelos.find((m) => m.id === modeloId);
    if (!modelo) return [];
    return catalogo.tipos_municao.filter((t) => t.calibre_id === modelo.calibre_id);
}

export function nomeDoCalibre(catalogo, modeloId) {
    const modelo = catalogo.modelos.find((m) => m.id === modeloId);
    return catalogo.calibres.find((c) => c.id === modelo?.calibre_id)?.nome ?? '';
}

// Próximos: ainda não terminaram e não foram cancelados nem marcados como falta (o mais cedo primeiro).
// Anteriores: todo o resto (o mais recente primeiro).
export function separarAgendamentos(lista, agora) {
    const inicio = (a) => new Date(a.inicio).getTime();
    const proximos = [];
    const anteriores = [];
    for (const a of lista) {
        const termina = inicio(a) + a.horas * HORA_MS;
        if (termina > agora.getTime() && !ENCERRADAS.includes(a.situacao)) proximos.push(a);
        else anteriores.push(a);
    }
    proximos.sort((a, b) => inicio(a) - inicio(b));
    anteriores.sort((a, b) => inicio(b) - inicio(a));
    return { proximos, anteriores };
}
