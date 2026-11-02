let selectedFiles = [];
let targetTabId = null;

const chatgptStatus = document.getElementById('chatgptStatus');
const chatgptStatusText = document.getElementById('chatgptStatusText');
const bridgeStatus = document.getElementById('bridgeStatus');
const bridgeStatusText = document.getElementById('bridgeStatusText');
const agentLog = document.getElementById('agentLog');

const promptInput = document.getElementById('promptInput');
const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');
const responseContent = document.getElementById('responseContent');
const copyBtn = document.getElementById('copyBtn');

function logAgent(msg) {
  const time = new Date().toLocaleTimeString();
  agentLog.textContent = `[${time}] ${msg}\n` + agentLog.textContent.slice(0, 300);
}

// 1. Localizar aba do ChatGPT (na aba ativa ou em qualquer aba aberta)
async function findChatGPTTab() {
  try {
    // Primeiro tentar a aba ativa
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && activeTab.url.includes('chatgpt.com')) {
      targetTabId = activeTab.id;
      setChatGPTStatus(true, 'ChatGPT Conectado');
      return targetTabId;
    }

    // Se a aba ativa não for o ChatGPT, buscar em todas as abas
    const tabs = await chrome.tabs.query({ url: '*://chatgpt.com/*' });
    if (tabs.length > 0) {
      targetTabId = tabs[0].id;
      setChatGPTStatus(true, `Conectado à aba #${targetTabId}`);
      return targetTabId;
    }

    targetTabId = null;
    setChatGPTStatus(false, 'Abra o chatgpt.com');
    return null;
  } catch (e) {
    targetTabId = null;
    setChatGPTStatus(false, 'Erro ao buscar aba');
    return null;
  }
}

function setChatGPTStatus(online, text) {
  chatgptStatus.className = `status-badge ${online ? 'status-online' : 'status-offline'}`;
  chatgptStatusText.textContent = text;
  sendBtn.disabled = !online;
}

function setBridgeStatus(online, text) {
  bridgeStatus.className = `status-badge ${online ? 'status-online' : 'status-offline'}`;
  bridgeStatusText.textContent = text;
}

// 2. Loop de conexão com o Bridge Local (Porta 4321)
let isProcessingTask = false;

async function pollBridge() {
  try {
    const res = await fetch('http://127.0.0.1:4321/tasks', { method: 'GET' });
    if (res.ok) {
      setBridgeStatus(true, 'Bridge: Conectado (4321)');
      const data = await res.json();
      
      if (data && data.task && !isProcessingTask) {
        isProcessingTask = true;
        await executeTask(data.task);
        isProcessingTask = false;
      }
    } else {
      setBridgeStatus(false, 'Bridge: Desconectado');
    }
  } catch (err) {
    setBridgeStatus(false, 'Bridge: Aguardando');
  }

  // Polling a cada 1.2 segundos
  setTimeout(pollBridge, 1200);
}

// Executar tarefa enviada pelo Agente
async function executeTask(task) {
  logAgent(`Executando tarefa #${task.id}: "${task.prompt.slice(0, 40)}..."`);
  
  const tabId = await findChatGPTTab();
  if (!tabId) {
    logAgent(`Erro: Aba do ChatGPT não encontrada.`);
    await sendTaskResponse(task.id, { success: false, error: 'Aba do ChatGPT não encontrada.' });
    return;
  }

  try {
    chrome.tabs.sendMessage(tabId, {
      action: 'send',
      text: task.prompt,
      files: task.files || []
    }, async (response) => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message;
        logAgent(`Erro ao comunicar com a página: ${err}`);
        await sendTaskResponse(task.id, { success: false, error: err });
        return;
      }

      if (response && response.success) {
        logAgent(`Resposta recebida da IA! Retornando ao Agente.`);
        responseContent.textContent = response.response;
        await sendTaskResponse(task.id, { success: true, response: response.response });
      } else {
        const err = (response && response.error) || 'Falha ao processar no ChatGPT.';
        logAgent(`Erro no ChatGPT: ${err}`);
        await sendTaskResponse(task.id, { success: false, error: err });
      }
    });
  } catch (err) {
    logAgent(`Exceção: ${err.message}`);
    await sendTaskResponse(task.id, { success: false, error: err.message });
  }
}

async function sendTaskResponse(taskId, payload) {
  try {
    await fetch('http://127.0.0.1:4321/response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, ...payload })
    });
  } catch (e) {
    console.error('Falha ao enviar resposta para o bridge:', e);
  }
}

// 3. Gerenciamento de arquivos e envio manual
dropArea.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    if (!selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
      selectedFiles.push(file);
    }
  });
  renderFileList();
  fileInput.value = '';
});

function renderFileList() {
  fileList.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    const sizeKB = (file.size / 1024).toFixed(1);
    item.innerHTML = `
      <span>📄 ${file.name} (${sizeKB} KB)</span>
      <span class="file-remove" data-index="${index}">&times;</span>
    `;
    fileList.appendChild(item);
  });

  document.querySelectorAll('.file-remove').forEach(el => {
    el.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'), 10);
      selectedFiles.splice(idx, 1);
      renderFileList();
    });
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        base64: base64
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

sendBtn.addEventListener('click', async () => {
  const text = promptInput.value.trim();
  if (!text && selectedFiles.length === 0) {
    alert('Digite uma mensagem ou selecione um arquivo.');
    return;
  }

  const tabId = await findChatGPTTab();
  if (!tabId) {
    alert('Aba do ChatGPT não encontrada. Abra o chatgpt.com.');
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Enviando...';
  responseContent.textContent = 'Aguardando processamento e resposta do ChatGPT...';

  try {
    const filesData = await Promise.all(selectedFiles.map(fileToBase64));

    chrome.tabs.sendMessage(tabId, {
      action: 'send',
      text: text,
      files: filesData
    }, (response) => {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Enviar Mensagem';

      if (chrome.runtime.lastError) {
        responseContent.textContent = 'Erro ao se comunicar: ' + chrome.runtime.lastError.message;
        return;
      }

      if (response && response.success) {
        responseContent.textContent = response.response;
        promptInput.value = '';
        selectedFiles = [];
        renderFileList();
      } else {
        responseContent.textContent = 'Erro: ' + ((response && response.error) || 'Falha ao processar.');
      }
    });

  } catch (err) {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Enviar Mensagem';
    responseContent.textContent = 'Erro interno: ' + err.message;
  }
});

newChatBtn.addEventListener('click', async () => {
  const tabId = await findChatGPTTab();
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'new_chat' });
  }
});

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(responseContent.textContent).then(() => {
    const orig = copyBtn.textContent;
    copyBtn.textContent = 'Copiado!';
    setTimeout(() => copyBtn.textContent = orig, 2000);
  });
});

// Inicialização periódica para verificar status das abas
setInterval(findChatGPTTab, 3000);
findChatGPTTab();
pollBridge();
