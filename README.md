# ChatGPT Use - Browser Extension & Automator

Extensão para Google Chrome e Microsoft Edge (Manifest V3) que permite controlar o ChatGPT, enviar mensagens, anexar arquivos automaticamente e capturar respostas diretamente pelo navegador.

---

## 🚀 Funcionalidades

- **Detecção Automática:** Identifica quando você está com o ChatGPT aberto (`chatgpt.com`).
- **Envio de Arquivos & Mídia:** Permite anexar múltiplos arquivos (PDFs, imagens, documentos, código, planilhas) e injeta diretamente no input do ChatGPT.
- **Digitação e Envio Automatizado:** Preenche o prompt simulando digitação humana e dispara o envio.
- **Captura da Resposta:** Monitora o término da geração da IA e exibe o texto final com botão de cópia com 1 clique.
- **Ações Rápidas:** Botão para iniciar novo chat (`New Chat`) e atalhos de controle.

---

## 📦 Como Instalar a Extensão

### No Google Chrome:
1. Abra o Chrome e acesse `chrome://extensions/`.
2. Ative a opção **"Modo do desenvolvedor"** no canto superior direito.
3. Clique em **"Carregar sem compactação"** (*Load unpacked*).
4. Selecione a pasta `extension/` deste repositório.

### No Microsoft Edge:
1. Abra o Edge e acesse `edge://extensions/`.
2. Ative a opção **"Modo de desenvolvedor"** na coluna lateral ou topo.
3. Clique em **"Carregar sem pacote"** (*Load unpacked*).
4. Selecione a pasta `extension/` deste repositório.

---

## 🛠️ Estrutura do Projeto

```text
├── extension/
│   ├── manifest.json      # Configurações do Manifest V3
│   ├── popup.html         # Interface visual do popup
│   ├── popup.js           # Lógica do popup e envio de arquivos
│   ├── content.js         # Script injetado na página do ChatGPT (DOM, upload, envio)
│   ├── background.js      # Service Worker de segundo plano
│   └── icons/             # Ícones da extensão
├── server.js              # Servidor opcional de automação via Playwright
└── README.md
```

---

## 📄 Licença

MIT
