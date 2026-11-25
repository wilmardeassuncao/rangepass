// Desenho da agenda visual (faixa de dias, botões de hora e de duração) dentro de uma `raiz`.
// Quem decide o que aparece e de que cor é o montarAgenda (agenda-regras.mjs); aqui só se desenha
// e se lê o que a pessoa marcou. Serve a qualquer formulário: os rádios se chamam data, hora e horas
// e ficam dentro da raiz, sem ids, então duas agendas (em formulários diferentes) não se misturam.

const TEXTO_COR = { livre: 'livre', poucas: 'poucas vagas', lotado: 'lotado' };

// Um botão de escolha: um <label> com o rádio escondido e o texto visível ao lado.
function botaoDeEscolha(nome, valor, { partes, rotuloAcessivel, marcado, desabilitado, cor }) {
    const label = document.createElement('label');
    label.className = 'opcao-agenda';
    if (cor) label.dataset.cor = cor;
    const entrada = document.createElement('input');
    entrada.type = 'radio';
    entrada.name = nome;
    entrada.value = String(valor);
    entrada.checked = marcado;
    entrada.disabled = desabilitado;
    entrada.setAttribute('aria-label', rotuloAcessivel);
    const face = document.createElement('span');
    face.className = 'opcao-face';
    face.setAttribute('aria-hidden', 'true');
    for (const [classe, texto] of partes) {
        const pedaco = document.createElement('span');
        if (classe) pedaco.className = classe;
        pedaco.textContent = texto;
        face.append(pedaco);
    }
    label.append(entrada, face);
    return label;
}

function dica(texto) {
    const p = document.createElement('p');
    p.className = 'agenda-dica';
    p.textContent = texto;
    return p;
}

export function criarAgenda(raiz, { aoMudar }) {
    const lugarDias = raiz.querySelector('[data-dias]');
    const lugarHoras = raiz.querySelector('[data-horas]');
    const lugarDuracoes = raiz.querySelector('[data-duracoes]');
    const resumo = raiz.querySelector('[data-resumo]');
    const aviso = raiz.querySelector('[data-aviso-agenda]');
    const falha = raiz.querySelector('[data-falha-agenda]');
    const falhaTexto = falha.querySelector('[data-falha-texto]');
    const botaoTentar = falha.querySelector('[data-tentar-agenda]');
    let tentar = null;

    const marcado = (nome) => raiz.querySelector(`input[name="${nome}"]:checked`);
    const numero = (entrada) => (entrada ? Number(entrada.value) : null);

    raiz.addEventListener('change', (evento) => {
        const nome = evento.target.name;
        if (!['data', 'hora', 'horas'].includes(nome)) return;
        // Trocar de dia recomeça a hora e a duração; trocar de hora mantém a duração, se ainda couber.
        if (nome === 'data') {
            for (const r of raiz.querySelectorAll('input[name="hora"], input[name="horas"]')) r.checked = false;
        }
        aoMudar();
    });

    botaoTentar.addEventListener('click', async () => {
        if (!tentar) return;
        botaoTentar.disabled = true;
        try {
            await tentar();
        } finally {
            botaoTentar.disabled = false;
        }
    });

    function desenhar(agenda) {
        const { escolha } = agenda;
        // Redesenhar troca os botões: guarda a rolagem da faixa de dias e o botão com o foco.
        const rolagem = lugarDias.scrollLeft;
        const ativo = document.activeElement;
        const foco = raiz.contains(ativo) && ativo.matches('input[type="radio"]')
            ? { nome: ativo.name, valor: ativo.value }
            : null;

        lugarDias.replaceChildren(...agenda.dias.map((d) => {
            const [semana, ...resto] = d.rotulo.split(' ');
            return botaoDeEscolha('data', d.data, {
                partes: [['opcao-semana', semana], [null, resto.join(' ')]],
                rotuloAcessivel: d.habilitado ? d.rotulo : `${d.rotulo}, sem horário livre`,
                marcado: d.data === escolha.data,
                desabilitado: !d.habilitado,
            });
        }));
        if (agenda.dias.length === 0) lugarDias.append(dica('Nenhum dia para mostrar agora.'));

        lugarHoras.replaceChildren(...agenda.horas.map((h) => botaoDeEscolha('hora', h.hora, {
            partes: [[null, h.rotulo]],
            rotuloAcessivel: `${h.rotulo}, ${TEXTO_COR[h.cor]}`,
            marcado: h.hora === escolha.hora,
            desabilitado: h.cor === 'lotado',
            cor: h.cor,
        })));
        if (agenda.horas.length === 0) {
            lugarHoras.append(dica(escolha.data === null ? 'Escolha um dia para ver os horários.' : 'Este dia não tem horários.'));
        }

        lugarDuracoes.replaceChildren(...agenda.duracoes.map((d) => botaoDeEscolha('horas', d.horas, {
            partes: [[null, d.rotulo], ['opcao-ate', `até ${d.ate}`]],
            rotuloAcessivel: d.habilitada ? `${d.rotulo}, até ${d.ate}` : `${d.rotulo}, até ${d.ate}, não cabe`,
            marcado: d.horas === escolha.horas,
            desabilitado: !d.habilitada,
        })));
        if (agenda.duracoes.length === 0) lugarDuracoes.append(dica('Escolha um horário para ver as durações.'));

        resumo.textContent = agenda.resumo ?? '';
        resumo.hidden = !agenda.resumo;
        // O aviso nunca fica `hidden`: vazio, o CSS o tira da vista, e o leitor de tela anuncia a primeira mudança.
        aviso.textContent = agenda.aviso ?? '';

        lugarDias.scrollLeft = rolagem;
        if (foco) {
            const volta = raiz.querySelector(`input[name="${foco.nome}"][value="${foco.valor}"]`);
            if (volta && !volta.disabled) volta.focus({ preventScroll: true });
        }
    }

    function escolha() {
        return {
            data: marcado('data')?.value ?? null,
            hora: numero(marcado('hora')),
            horas: numero(marcado('horas')),
        };
    }

    // Falha ao buscar os horários: a mensagem com "Tentar de novo". `null` esconde.
    function mostrarErro(texto, aoTentar) {
        tentar = aoTentar ?? null;
        falhaTexto.textContent = texto ?? '';
        falha.hidden = !texto;
    }

    return { desenhar, escolha, mostrarErro };
}
