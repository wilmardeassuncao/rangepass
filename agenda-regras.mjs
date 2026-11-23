// Regras puras da agenda visual: quais dias, horas e durações aparecem e de que cor.
// Roda igual no navegador e no Node (testes). Não desenha nada, só decide.
import {
    instanteNoFuso, duracoesPossiveis, instrutoresNecessarios,
} from './supabase/functions/_shared/agendamento.mjs';
import { descreverSessao, doisDigitos } from './agendar-regras.mjs';

const HORA_MS = 3600000;
const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const AVISO_DIA = 'O dia escolhido não tem mais horário livre para este grupo. Escolha outro dia.';
export const AVISO_HORA = 'O horário escolhido não está mais livre para este grupo. Escolha outro.';
export const AVISO_DURACAO = 'A duração escolhida não cabe mais neste horário. Escolha outra.';

const relogio = (hora) => `${doisDigitos(hora)}:00`;

// Horas (números) que o dia tem na disponibilidade, em ordem.
const horasDoDia = (dia) => Object.keys(dia ?? {}).map(Number).sort((a, b) => a - b);

// Quantas pistas/instrutores livres há em todas as horas hora..hora+k-1 (ou null se alguma hora não existe
// ou se o instrutor escolhido não está livre em todas). O cruzamento é o que sobra em comum.
function vagasDaSessao(dia, hora, k, instrutorId) {
    let pistas = null;
    let instrutores = null;
    for (let h = hora; h < hora + k; h++) {
        const livre = dia?.[h];
        if (!livre) return null;
        pistas = pistas ? pistas.filter((p) => livre.pistas.includes(p)) : [...livre.pistas];
        instrutores = instrutores ? instrutores.filter((i) => livre.instrutores.includes(i)) : [...livre.instrutores];
    }
    if (instrutorId && !instrutores.includes(instrutorId)) return null;
    return { pistas: pistas.length, instrutores: instrutores.length };
}

// Quantas vagas (grupos como este) a sessão tem; 0 quando não cabe.
function vagas(dia, hora, k, instrutorId, necessarios) {
    const v = vagasDaSessao(dia, hora, k, instrutorId);
    if (!v) return 0;
    return Math.min(Math.floor(v.pistas / necessarios), Math.floor(v.instrutores / necessarios));
}

export function montarAgenda(contexto, escolha) {
    const { disponibilidade, opcoes, agora, quantidade, instrutorId } = contexto;
    const { agenda, funcionamento, estande } = opcoes;
    const fuso = estande.fuso;
    const necessarios = instrutoresNecessarios(quantidade, agenda.faixas_instrutores);
    const maximo = quantidade > 1 ? agenda.duracao_maxima_grupo : agenda.duracao_maxima_individual;
    const antecedenciaMs = agenda.antecedencia_minima_horas * HORA_MS;

    const corDaHora = (data, hora) => {
        if (instanteNoFuso(data, hora, fuso).getTime() - agora.getTime() < antecedenciaMs) return 'lotado';
        const v = vagas(disponibilidade.dias[data], hora, 1, instrutorId, necessarios);
        if (v === 0) return 'lotado';
        return v <= agenda.poucas_vagas ? 'poucas' : 'livre';
    };

    const dias = Object.keys(disponibilidade.dias).sort().map((data) => {
        const [, mes, dia] = data.split('-');
        const diaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
        return {
            data,
            rotulo: `${DIAS_CURTOS[diaSemana]} ${dia}/${mes}`,
            habilitado: horasDoDia(disponibilidade.dias[data]).some((h) => corDaHora(data, h) !== 'lotado'),
        };
    });

    let { data, hora, horas } = escolha;
    let aviso = null;
    const diaEscolhido = dias.find((d) => d.data === data);
    if (data !== null && !diaEscolhido?.habilitado) {
        data = hora = horas = null;
        aviso = AVISO_DIA;
    }
    if (data !== null && hora !== null) {
        const existe = horasDoDia(disponibilidade.dias[data]).includes(hora);
        if (!existe || corDaHora(data, hora) === 'lotado') {
            hora = horas = null;
            aviso = AVISO_HORA;
        }
    }

    const listaHoras = data === null ? [] : horasDoDia(disponibilidade.dias[data]).map((h) => ({
        hora: h, rotulo: relogio(h), cor: corDaHora(data, h),
    }));

    const duracoes = hora === null ? [] : duracoesPossiveis(data, hora, funcionamento, maximo).map((k) => ({
        horas: k,
        rotulo: k === 1 ? '1 hora' : `${k} horas`,
        ate: relogio(hora + k),
        habilitada: vagas(disponibilidade.dias[data], hora, k, instrutorId, necessarios) > 0,
    }));

    if (horas !== null && !duracoes.find((d) => d.horas === horas)?.habilitada) {
        horas = null;
        aviso = AVISO_DURACAO;
    }

    const resumo = data !== null && hora !== null && horas !== null
        ? descreverSessao(instanteNoFuso(data, hora, fuso), horas, fuso)
        : null;

    return { dias, horas: listaHoras, duracoes, escolha: { data, hora, horas }, aviso, resumo };
}
