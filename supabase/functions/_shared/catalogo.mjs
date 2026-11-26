// Conferência dos cadastros do superadmin: catálogo (categorias, calibres, modelos, munições),
// armas do estande e pistas. Módulo puro: roda igual no Node (testes) e no Deno (Edge Functions).

export const TIPOS_CADASTRO = ['categoria', 'calibre', 'modelo', 'tipo_municao', 'unidade', 'pista'];

export const SITUACOES_UNIDADE = ['disponivel', 'manutencao', 'desativada'];

// Campos de cada tipo. tipo: como conferir; obrigatorio: precisa vir ao criar; editavel: pode mudar depois.
// Exportado (só leitura) para a página da equipe tirar daqui o que pode mudar depois de criado.
const CAMPOS = {
    categoria: {
        nome: { tipo: 'texto', obrigatorio: true, editavel: true },
        ativo: { tipo: 'booleano', editavel: true },
    },
    calibre: {
        nome: { tipo: 'texto', obrigatorio: true, editavel: true },
        ativo: { tipo: 'booleano', editavel: true },
    },
    modelo: {
        categoria_id: { tipo: 'id', obrigatorio: true, editavel: true },
        calibre_id: { tipo: 'id', obrigatorio: true, editavel: false },
        marca: { tipo: 'texto', obrigatorio: true, editavel: true },
        nome: { tipo: 'texto', obrigatorio: true, editavel: true },
        ativo: { tipo: 'booleano', editavel: true },
        preco_hora_centavos: { tipo: 'centavos', editavel: true },
    },
    tipo_municao: {
        calibre_id: { tipo: 'id', obrigatorio: true, editavel: false },
        nome: { tipo: 'texto', obrigatorio: true, editavel: true },
        ativo: { tipo: 'booleano', editavel: true },
        preco_unidade_centavos: { tipo: 'centavos', editavel: true },
        // Custo de compra por unidade (opcional): o desconto de classe na munição não desce abaixo dele.
        custo_compra_centavos: { tipo: 'centavos', editavel: true },
    },
    unidade: {
        modelo_id: { tipo: 'id', obrigatorio: true, editavel: false },
        numero_registro: { tipo: 'texto', obrigatorio: true, editavel: true },
        situacao: { tipo: 'situacao', editavel: true, padrao: 'disponivel' },
    },
    pista: {
        numero: { tipo: 'numero', obrigatorio: true, editavel: false },
        ativa: { tipo: 'booleano', editavel: true },
    },
};

// Congela tudo (o mapa, cada tipo e cada regra): quem importa só pode ler.
for (const regras of Object.values(CAMPOS)) {
    for (const regra of Object.values(regras)) Object.freeze(regra);
    Object.freeze(regras);
}
export const CAMPOS_CADASTRO = Object.freeze(CAMPOS);

// Mensagem do nome repetido (erro 23505 do banco), por tipo: { campo: mensagem }.
export const MENSAGENS_DUPLICADO = {
    categoria: { nome: 'Já existe um cadastro com este nome.' },
    calibre: { nome: 'Já existe um cadastro com este nome.' },
    modelo: { nome: 'Já existe um modelo com esta marca e nome.' },
    tipo_municao: { nome: 'Já existe uma munição com este nome neste calibre.' },
    unidade: { numero_registro: 'Já existe uma arma com este número de registro.' },
    pista: { numero: 'Já existe uma pista com este número.' },
};

const NAO_MUDA = 'Este campo não pode ser mudado aqui.';

function ehObjeto(valor) {
    return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

// Confere um valor; devolve { valor } quando está certo ou { erro } quando não está.
function conferir(regra, valor) {
    switch (regra.tipo) {
        case 'texto':
            if (typeof valor !== 'string' || valor.trim() === '') return { erro: 'Preencha este campo.' };
            return { valor: valor.trim() };
        case 'id':
            if (!Number.isInteger(valor) || valor < 1) return { erro: 'Escolha um item da lista.' };
            return { valor };
        case 'booleano':
            if (typeof valor !== 'boolean') return { erro: 'Escolha sim ou não.' };
            return { valor };
        case 'situacao':
            if (!SITUACOES_UNIDADE.includes(valor)) return { erro: 'Escolha a situação da arma.' };
            return { valor };
        case 'numero':
            if (!Number.isInteger(valor) || valor < 1) return { erro: 'Informe um número inteiro maior que 0.' };
            return { valor };
        case 'centavos':
            // Preço em centavos; null quer dizer "sem preço" (o item não aparece para o cliente).
            if (valor !== null && (!Number.isInteger(valor) || valor < 1)) return { erro: 'Informe um valor maior que zero.' };
            return { valor };
        default:
            throw new Error(`Regra desconhecida: ${regra.tipo}`);
    }
}

// Devolve { campos, valores }: campos é o mapa campo → mensagem (vazio quando está tudo certo);
// valores traz só os campos aceitos, já limpos (vazio quando há erro).
// Ao criar, os campos opcionais com padrão recebem o padrão; ao editar, só vai o que foi enviado.
export function validarCadastroCatalogo(tipo, dados, { criando }) {
    const regras = Object.hasOwn(CAMPOS, tipo) ? CAMPOS[tipo] : null;
    if (!regras) return { campos: { tipo: 'Este tipo de cadastro não existe.' }, valores: {} };
    const enviados = ehObjeto(dados) ? dados : {};

    const campos = {};
    const valores = {};
    for (const campo of Object.keys(enviados)) {
        const regra = Object.hasOwn(regras, campo) ? regras[campo] : null;
        if (!regra || (!criando && !regra.editavel)) campos[campo] = NAO_MUDA;
    }
    for (const [campo, regra] of Object.entries(regras)) {
        if (campos[campo]) continue;
        if (!Object.hasOwn(enviados, campo)) {
            if (!criando) continue;
            if (regra.obrigatorio) {
                campos[campo] = conferir(regra, undefined).erro;
            } else if (regra.padrao !== undefined) {
                valores[campo] = regra.padrao;
            }
            continue;
        }
        const r = conferir(regra, enviados[campo]);
        if (r.erro) campos[campo] = r.erro;
        else valores[campo] = r.valor;
    }

    if (!criando && Object.keys(campos).length === 0 && Object.keys(valores).length === 0) {
        campos.geral = 'Nada para alterar.';
    }
    return Object.keys(campos).length ? { campos, valores: {} } : { campos, valores };
}

// A edição tira o recurso de uso? (arma fora de "disponivel" ou pista desativada.)
// Só então vale contar as reservas futuras que ficaram presas a ele.
export function desativa(tipo, valores) {
    if (tipo === 'unidade') return valores.situacao !== undefined && valores.situacao !== 'disponivel';
    if (tipo === 'pista') return valores.ativa === false;
    return false;
}
