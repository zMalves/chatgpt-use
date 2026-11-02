# 🤖 ChatGPT Use - Automator, Side Panel & Agent Bridge

Extensão profissional para **Microsoft Edge** e **Google Chrome** (Manifest V3) que roda no **Painel Lateral (Side Panel)** do navegador e se integra a um servidor local (**Bridge HTTP na porta 4321**).

Ela permite que você (ou um assistente/agente de IA) controle o ChatGPT autenticado, enviando mensagens, anexando arquivos, processando filas sequenciais de tarefas, lendo históricos e baixando imagens geradas pelo DALL-E em alta resolução.

---

## ✨ Funcionalidades Principais

| Recurso | Descrição |
| :--- | :--- |
| **Painel Lateral (Side Panel)** | Fixado diretamente na barra lateral do Edge/Chrome sem fechar ao alternar de janela. |
| **Automação via Terminal & Agente** | CLI simples (`node ask.js`) para enviar comandos e receber respostas pelo terminal. |
| **Detecção Inteligente de Término** | Monitora streaming, botões de parada e estabilidade de texto para saber exatamente quando a IA terminou. |
| **Fila Sequencial (Batch de Mensagens)** | Envia 10 ou mais mensagens em sequência: aguarda a resposta da 1ª antes de disparar a 2ª automaticamente. |
| **Download Automático de Imagens** | Captura imagens geradas pelo DALL-E em resolução nativa (PNG) e salva diretamente na pasta `downloads/`. |
| **Upload de Arquivos & Mídia** | Anexa PDFs, imagens, códigos, planilhas e documentos diretamente no chat. |
| **Leitura Completa do Chat** | Extrai histórico de mensagens (usuário e assistente) e respostas anteriores. |

---

## 📁 Estrutura do Projeto

```text
chatgpt-use/
├── extension/                 # Código da Extensão (Manifest V3)
│   ├── manifest.json          # Configuração de permissões e Side Panel
│   ├── sidepanel.html         # Interface com 3 abas (Chat, Fila, Histórico)
│   ├── sidepanel.js           # Lógica do painel, polling do bridge e downloads
│   ├── content.js             # Injetado no ChatGPT (DOM, typing, captura de DALL-E)
│   ├── background.js          # Service Worker que abre o Side Panel
│   └── icons/                 # Ícones da extensão
├── bridge.js                  # Servidor HTTP local (Porta 4321) que conecta o Agente à Extensão
├── ask.js                     # CLI para terminal (envio único, lote, histórico)
├── downloads/                 # Pasta onde as imagens geradas pelo DALL-E são salvas
├── iniciar.bat                # Atalho rápido para iniciar o Bridge Server
└── README.md                  # Documentação completa
```

---

## 🚀 Guia de Instalação Rápida (Passo a Passo)

### 1. Iniciar o Servidor Bridge
O servidor Bridge é quem recebe os comandos do terminal e repassa para a extensão:
- Dê dois cliques em **`iniciar.bat`**  
*(ou execute no terminal: `node bridge.js`)*.

Ele ficará ativo em `http://127.0.0.1:4321`.

---

### 2. Carregar a Extensão no Microsoft Edge (ou Chrome)

1. No Edge, acesse:
   ```text
   edge://extensions
   ```
   *(No Chrome: `chrome://extensions`)*
2. Ative a chave **"Modo de desenvolvedor"** (canto inferior esquerdo ou superior direito).
3. Clique em **"Carregar sem pacote"** (*Load unpacked*).
4. Selecione a pasta:
   ```text
   C:\Users\Maychel\OneDrive - Seconds\Documentos\Sistemas\chatgpt-use\extension
   ```
5. Pronto! A extensão estará ativa.

---

### 3. Abrir o ChatGPT e o Painel Lateral

1. Abra o [ChatGPT](https://chatgpt.com) no navegador com a sua conta normal.
2. Clique no ícone da extensão na barra de ferramentas do navegador (ícone de quebra-cabeça 🧩).
3. O **Side Panel** abrirá à direita exibindo:
   * `🟢 ChatGPT Conectado`
   * `🟢 Bridge: Conectado (4321)`

---

## 💻 Como Usar

### Modo 1: Usando pelo Terminal / Scripts (CLI)

#### 💬 Enviar uma pergunta única
```bash
node ask.js "Explique computação quântica em 2 frases."
```

#### 📎 Enviar com arquivos em anexo
```bash
node ask.js "Analise estes arquivos e resuma os pontos principais:" ./relatorio.pdf ./dados.csv
```

#### 📋 Enviar Fila Sequencial (Ex: 10 mensagens)
O robô enviará a primeira, aguardará o ChatGPT responder 100%, e só então enviará a próxima:
```bash
node ask.js --batch "Qual a capital do Brasil?" "Qual a capital da França?" "Qual a capital do Japão?"
```
*Ou a partir de um arquivo `.txt` contendo uma mensagem por linha:*
```bash
node ask.js --batch lista_de_perguntas.txt
```

#### 🎨 Gerar e Baixar Imagens (DALL-E)
```bash
node ask.js "Gere uma imagem de um carro futurista no deserto."
```
*A imagem será baixada automaticamente em alta resolução para a pasta `downloads/`.*

#### 🔄 Abrir um Novo Chat (Resetar Conversa)
Inicia uma nova conversa em branco instantaneamente:
```bash
node ask.js --new
```

#### 📖 Ler o Histórico Completo do Chat
```bash
node ask.js --history
```

#### 🔍 Ler apenas a Última Resposta
```bash
node ask.js --last
```

---

### Modo 2: Usando Diretamente pelo Painel Lateral (Side Panel)

O painel possui 3 abas intuitivas:

1. **Aba "Chat & Envio":**
   * Digite qualquer texto ou clique no clipe para anexar arquivos do seu computador.
   * Botão de **Enviar**, **Novo Chat** e **Parar Geração**.
   * Veja a resposta em tempo real com botão de copiar com 1 clique.
2. **Aba "Fila Sequencial (Lote)":**
   * Cole uma lista de prompts (um por linha).
   * Clique em **"▶ Executar Fila Sequencial"**.
   * Acompanhe a barra de progresso visual enquanto cada mensagem é enviada e aguardada.
3. **Aba "Histórico & Imagens":**
   * Botão **"📖 Ler Chat Completo"** para carregar todas as mensagens da conversa.
   * Botão **"🖼️ Baixar Imagens"** para baixar todas as ilustrações e fotos geradas na conversa.

---

## 🛠️ Tecnologias Utilizadas

- **Manifest V3:** Padrão oficial mais recente e seguro de extensões para Chromium.
- **Chrome Side Panel API:** Integração nativa na lateral da janela do navegador.
- **DOM Mutation & Canvas Streaming:** Captura dinâmica de elementos reativos do React.
- **Node.js HTTP Bridge:** Ponte local sem dependências externas pesadas.

---

## 📄 Licença

MIT
