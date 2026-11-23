// Regras do agendamento: horários no fuso do estande, duração, grupos e modalidades.
// Módulo puro: roda igual no Node (testes), no Deno (Edge Functions) e no navegador.

import { cpfValido, somenteDigitos, idadeEm, dataNoFuso } from './cadastro.mjs';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA_MS = 3600000;
const MODALIDADES = ['estande', 'arma_propria', 'tudo_proprio'];
const TEXTOS_ARMA = ['modelo', 'calibre', 'numero_registro', 'responsavel'];

const ERROS_DE_RESERVA = {
    RP001: 'O instrutor escolhido já tem outro agendamento nesse horário. Escolha outro horário.',
    RP002: 'Não há instrutores livres nesse horário. Escolha outro horário.',
    RP003: 'Não há pistas livres nesse horário. Escolha outro horário.',
    RP004: 'Não há arma livre do modelo escolhido nesse horário. Escolha outro horário ou outro modelo.',
    RP005: 'Este agendamento não pode mais ser alterado pelo app. Fale com o estande.',
    RP006: 'Uma das pessoas deste agendamento já tem outro agendamento nesse horário. Escolha outro horário.',
    RP007: 'O instrutor escolhido não atende mais pelo app. Para mudar o horário, fale com o estande.',
    '23P01': 'Esse horário acabou de ser ocupado. Escolha outro horário.',
    P0001: 'Esse horário acabou de ser ocupado. Escolha outro horário.',
};

function dataReal(data) {
    if (typeof data !== 'string' || !DATA.test(data)) return false;
    const d = new Date(`${data}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === data;
}

export function somarDias(data, dias) {
    const d = new Date(`${data}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

function textoNormalizado(texto) {
    return typeof texto === 'string' ? texto.trim().replace(/\s+/g, ' ') : '';
}

// "22:30" vira 22,5.
function emHoras(relogio) {
    const [h, m] = relogio.split(':').map(Number);
    return h + m / 60;
}

function partesDoFuso(instante, fuso) {
    const partes = {};
    const formato = new Intl.DateTimeFormat('en-US', {
        timeZone: fuso, hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    for (const p of formato.formatToParts(instante)) partes[p.type] = Number(p.value);
    return partes;
}

// Quanto o relógio do fuso está à frente do UTC (em ms) naquele instante.
function deslocamento(ms, fuso) {
    const p = partesDoFuso(new Date(ms), fuso);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}

// O instante em que o relógio do fuso marca aquela data e hora.
export function instanteNoFuso(data, hora, fuso) {
    const [a, m, d] = data.split('-').map(Number);
    const alvo = Date.UTC(a, m - 1, d, hora);
    let palpite = alvo;
    for (let i = 0; i < 2; i++) palpite = alvo - deslocamento(palpite, fuso);
    return new Date(palpite);
}

export function partesNoFuso(instante, fuso) {
    const p = partesDoFuso(instante, fuso);
    const data = dataNoFuso(instante, fuso);
    return {
        data, hora: p.hour, minuto: p.minute,
        diaSemana: new Date(`${data}T12:00:00Z`).getUTCDay(),
    };
}

function diaDeFuncionamento(data, funcionamento) {
    if (funcionamento.datas_fechadas.includes(data)) return null;
    return funcionamento.dias[new Date(`${data}T12:00:00Z`).getUTCDay()] ?? null;
}

// Horas de início possíveis: a sessão de 1 hora inteira cabe entre a abertura e o fechamento.
export function horariosDoDia(data, funcionamento) {
    const dia = diaDeFuncionamento(data, funcionamento);
    if (!dia) return [];
    const horas = [];
    for (let h = Math.ceil(emHoras(dia.abre)); h + 1 <= emHoras(dia.fecha); h++) horas.push(h);
    return horas;
}

// Durações [1..k] que cabem até o fechamento, sem passar do máximo.
export function duracoesPossiveis(data, hora, funcionamento, maximo) {
    const dia = diaDeFuncionamento(data, funcionamento);
    if (!dia) return [];
    const duracoes = [];
    for (let k = 1; k <= maximo && hora + k <= emHoras(dia.fecha); k++) duracoes.push(k);
    return duracoes;
}

export function instrutoresNecessarios(quantidade, faixas) {
    // Acima da última faixa (grupo grande demais, já recusado antes), vale a última.
    return (faixas.find((f) => quantidade <= f.ate) ?? faixas[faixas.length - 1]).instrutores;
}

// Regras de data, hora e duração, usadas no pedido novo e na troca de horário.
function conferirHorario({ data, hora, horas }, agora, opcoes, quantidade) {
    const { agenda, funcionamento, estande } = opcoes;
    const campos = {};
    const hoje = dataNoFuso(agora, estande.fuso);
    const horarios = dataReal(data) ? horariosDoDia(data, funcionamento) : [];

    if (!dataReal(data)) campos.data = 'Escolha o dia.';
    else if (horarios.length === 0) campos.data = 'O estande não abre neste dia. Escolha outro.';
    else if (data > somarDias(hoje, agenda.antecedencia_maxima_dias)) {
        campos.data = `Agende com até ${agenda.antecedencia_maxima_dias} dias de antecedência.`;
    }

    const horaValida = horarios.includes(hora);
    let inicio = null;
    if (!horarios.length) {
        // Sem data utilizável, não há o que dizer sobre a hora.
    } else if (!horaValida) campos.hora = 'Escolha o horário de início.';
    else {
        inicio = instanteNoFuso(data, hora, estande.fuso);
        if (inicio.getTime() - agora.getTime() < agenda.antecedencia_minima_horas * HORA_MS) {
            campos.hora = `Agende com pelo menos ${agenda.antecedencia_minima_horas} horas de antecedência.`;
        }
    }

    if (!Number.isInteger(horas) || horas < 1) campos.horas = 'Escolha a duração.';
    else if (quantidade <= 1 && horas > agenda.duracao_maxima_individual) {
        campos.horas = `Quem vai sozinho pode agendar no máximo ${agenda.duracao_maxima_individual} horas.`;
    } else if (quantidade > 1 && horas > agenda.duracao_maxima_grupo) {
        campos.horas = `Grupos podem agendar no máximo ${agenda.duracao_maxima_grupo} horas.`;
    } else if (horaValida) {
        const fecha = diaDeFuncionamento(data, funcionamento).fecha;
        if (hora + horas > emHoras(fecha)) campos.horas = `A sessão precisa terminar até as ${fecha}.`;
    }

    return { campos, inicio: inicio ? inicio.toISOString() : null };
}

function armaPropriaNormalizada(arma) {
    if (!arma || typeof arma !== 'object') return null;
    const normalizada = {};
    for (const chave of TEXTOS_ARMA) {
        const texto = typeof arma[chave] === 'string' ? arma[chave].trim() : '';
        if (!texto) return null;
        normalizada[chave] = texto;
    }
    return normalizada;
}

// Confere a modalidade e o que ela exige. Devolve os campos normalizados e os erros (sem prefixo).
function conferirModalidade(p, opcoes) {
    const erros = {};
    const { catalogo, municao, termo } = opcoes;
    const saida = { modalidade: p.modalidade, termo_versao: null, modelo_id: null,
        tipo_municao_id: null, municao_qtd: null, arma_propria: null };

    if (!MODALIDADES.includes(p.modalidade)) {
        erros.modalidade = 'Escolha a modalidade.';
        saida.modalidade = null;
        return { saida, erros };
    }
    const estande = p.modalidade === 'estande';
    const usaArmaPropria = !estande;
    const usaMunicao = p.modalidade !== 'tudo_proprio';

    let modelo = null;
    if (estande) {
        modelo = catalogo.modelos.find((m) => m.id === p.modelo_id);
        if (modelo) saida.modelo_id = modelo.id;
        else erros.modelo_id = 'Escolha uma arma da lista.';
    }

    if (usaMunicao) {
        const tipo = catalogo.tipos_municao.find((t) => t.id === p.tipo_municao_id);
        if (tipo && (!modelo || tipo.calibre_id === modelo.calibre_id)) saida.tipo_municao_id = tipo.id;
        else erros.tipo_municao_id = 'Escolha a munição da lista.';
        if (Number.isInteger(p.municao_qtd) && p.municao_qtd >= municao.minima_por_participante) {
            saida.municao_qtd = p.municao_qtd;
        } else erros.municao_qtd = `A quantidade mínima de munição é ${municao.minima_por_participante}.`;
    }

    if (usaArmaPropria) {
        saida.arma_propria = armaPropriaNormalizada(p.arma_propria);
        if (!saida.arma_propria) {
            erros.arma_propria = 'Informe o modelo, o calibre, o número de registro e o responsável pela arma.';
        }
        if (p.aceite_termo_versao === termo.versao) saida.termo_versao = termo.versao;
        else erros.aceite_termo_versao = 'Para usar arma própria, aceite o termo de responsabilidade.';
    }
    return { saida, erros };
}

// Nome, CPF e nascimento de quem não é o responsável (participante 2 em diante).
function conferirConvidado(p, cpfsAnteriores, hoje, opcoes) {
    const erros = {};
    const nome = textoNormalizado(p.nome_completo);
    if (nome.split(' ').length < 2) erros.nome_completo = 'Informe o nome completo.';

    const cpf = somenteDigitos(p.cpf);
    if (!cpfValido(cpf)) erros.cpf = 'Informe um CPF válido.';
    else if (cpfsAnteriores.includes(cpf)) erros.cpf = 'Este CPF já está em outro participante.';

    const nascimento = p.data_nascimento;
    if (!dataReal(nascimento) || nascimento > hoje) {
        erros.data_nascimento = 'Informe a data de nascimento.';
    } else if (idadeEm(nascimento, hoje) < opcoes.idade_minima) {
        erros.data_nascimento = `Cada participante precisa ter pelo menos ${opcoes.idade_minima} anos.`;
    }
    return { dados: { nome_completo: nome, cpf, data_nascimento: nascimento }, erros };
}

export function validarPedido(pedido, { agora, opcoes }) {
    const p = pedido && typeof pedido === 'object' ? pedido : {};
    const lista = Array.isArray(p.participantes) ? p.participantes : null;
    const quantidade = lista ? lista.length : 1;
    const horario = conferirHorario(p, agora, opcoes, quantidade);
    const campos = horario.campos;

    const instrutorId = p.instrutor_id ?? null;
    if (instrutorId !== null && !opcoes.instrutores.some((i) => i.id === instrutorId)) {
        campos.instrutor_id = 'Escolha um instrutor da lista ou "Sem preferência".';
    }

    const participantes = [];
    if (!lista || lista.length === 0) campos.participantes = 'Informe quem vai atirar.';
    else if (lista.length > opcoes.agenda.grupo_maximo) {
        campos.participantes = `O grupo pode ter no máximo ${opcoes.agenda.grupo_maximo} pessoas.`;
    } else {
        const hoje = dataNoFuso(agora, opcoes.estande.fuso);
        const { responsavel } = opcoes;
        const cpfs = [];
        lista.forEach((item, i) => {
            const part = item && typeof item === 'object' ? item : {};
            let identificacao;
            let erros = {};
            if (i === 0) {
                identificacao = { nome_completo: responsavel.nome_completo, cpf: responsavel.cpf,
                    data_nascimento: responsavel.data_nascimento, perfil_id: responsavel.id };
            } else {
                const convidado = conferirConvidado(part, cpfs, hoje, opcoes);
                identificacao = { ...convidado.dados, perfil_id: null };
                erros = convidado.erros;
            }
            cpfs.push(identificacao.cpf);
            const modalidade = conferirModalidade(part, opcoes);
            Object.assign(erros, modalidade.erros);
            for (const [campo, mensagem] of Object.entries(erros)) campos[`participantes.${i}.${campo}`] = mensagem;
            participantes.push({ ...identificacao, ...modalidade.saida });
        });
    }

    return {
        campos,
        pedido: {
            inicio: horario.inicio,
            horas: p.horas,
            instrutor_id: instrutorId,
            instrutores_necessarios: instrutoresNecessarios(quantidade, opcoes.agenda.faixas_instrutores),
            participantes,
        },
    };
}

export function validarNovoHorario(novo, { agora, opcoes, quantidade }) {
    const n = novo && typeof novo === 'object' ? novo : {};
    const { campos, inicio } = conferirHorario(n, agora, opcoes, quantidade);
    return { campos, inicio, horas: n.horas };
}

// Só dá para mexer enquanto o agendamento está ativo e ainda falta o prazo todo.
export function podeAlterar({ inicio, situacao }, agora, prazoHoras) {
    if (situacao !== 'aguardando_pagamento' && situacao !== 'pago') return false;
    return new Date(inicio).getTime() - agora.getTime() >= prazoHoras * HORA_MS;
}

export function erroDeReserva(codigo) {
    const erro = ERROS_DE_RESERVA[codigo];
    return erro ? { status: 409, corpo: { erro } } : null;
}
