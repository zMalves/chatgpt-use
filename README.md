# ChatGPT Use - Side Panel & Assistant Bridge

Extensão para Google Chrome e Microsoft Edge (Manifest V3) que roda no **painel lateral (Side Panel)** do navegador e se conecta a uma **Bridge Local (porta 4321)**, permitindo que você ou um assistente de IA envie comandos, mensagens e arquivos diretamente para o ChatGPT autenticado.

---

## 🚀 Funcionalidades

- **Painel Lateral (Side Panel):** Abre fixado ao lado da página de navegação, sem sumir ao clicar fora.
- **Bridge Local para o Agente:** Servidor HTTP local (`http://127.0.0.1:4321`) que permite enviar comandos via terminal/código (`node ask.js "..."`) diretamente para o ChatGPT.
- **Upload Automático de Arquivos:** Suporte a PDF, imagens, texto, código e planilhas injetados nativamente no ChatGPT.
- **Leitura da Resposta:** Extrai a resposta completa da IA e devolve tanto para o painel quanto para o terminal/agente.
- **Busca de Abas Inteligente:** O painel lateral localiza a aba do ChatGPT automaticamente, mesmo se você estiver navegando em outra aba no momento.

---

## 📦 Como Recarregar a Extensão no Edge / Chrome

Como a extensão foi atualizada para **Side Panel**:

1. Acesse `edge://extensions` (ou o link direto `edge://extensions/?id=ocndemgafoaeocnkgelccliopiiggiij`).
2. Clique no ícone de **Recarregar (🔄)** no cartão da extensão.
3. Agora, ao clicar no ícone da extensão na barra de ferramentas, ela abrirá diretamente no **Painel Lateral (Side Panel)** do Edge!

---

## 🤖 Como Enviar Comandos para o ChatGPT via Terminal / Agente

Com a extensão aberta no Side Panel e o ChatGPT aberto:

```bash
# Enviar apenas uma pergunta
node ask.js "Explique o que é gravidade em 2 frases"

# Enviar com arquivos anexados
node ask.js "Resuma este documento" ./relatorio.pdf ./dados.csv
```

---

## 🛠️ Estrutura

```text
├── extension/
│   ├── manifest.json      # Manifest V3 com permissão sidePanel
│   ├── sidepanel.html     # Interface do painel lateral
│   ├── sidepanel.js       # Controle de abas, polling do bridge e uploads
│   ├── content.js         # Script injetado no ChatGPT
│   ├── background.js      # Service Worker (ativa sidePanel no clique)
│   └── icons/             # Ícones
├── bridge.js              # Servidor HTTP local (porta 4321) que conecta o Agente à Extensão
├── ask.js                 # CLI para enviar prompts e arquivos
└── README.md
```
