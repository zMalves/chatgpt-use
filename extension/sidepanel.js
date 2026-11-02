let selectedFiles = [];
let targetTabId = null;
let isProcessingTask = false;
let cancelBatchFlag = false;

// Elementos de Status e Log
const chatgptStatus = document.getElementById('chatgptStatus');
const chatgptStatusText = document.getElementById('chatgptStatusText');
const bridgeStatus = document.getElementById('bridgeStatus');
const bridgeStatusText = document.getElementById('bridgeStatusText');
const agentLog = document.getElementById('agentLog');

// Tab 1: Chat
const promptInput = document.getElementById('promptInput');
const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');
const stopBtn = document.getElementById('stopBtn');
const responseContent = document.getElementById('responseContent');
const copyBtn = document.getElementById('copyBtn');

// Tab 2: Batch Queue
const batchInput = document.getElementById('batchInput');
const batchProgress = document.getElementById('batchProgress');
const batchProgressFill = document.getElementById('batchProgressFill');
const batchStatusText = document.getElementById('batchStatusText');
const startBatchBtn = document.getElementById('startBatchBtn');
const cancelBatchBtn = document.getElementById('cancelBatchBtn');
const batchLog = document.getElementById('batchLog');

// Tab 3: Histórico & Imagens
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const downloadImagesBtn = document.getElementById('downloadImagesBtn');
const historyStats = document.getElementById('historyStats');
const historyList = document.getElementById('historyList');

// -------------------------------------------------------------
// Navegação por Abas
// -------------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById(tabId).classList.add('active');
  });
});

function logAgent(msg) {
  const time = new Date().toLocaleTimeString();
  agentLog.textContent = `[${time}] ${msg}\n` + agentLog.textContent.slice(0, 300);
}

// -------------------------------------------------------------
// 1. Conexão com a aba do ChatGPT
// -------------------------------------------------------------
async function findChatGPTTab() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && activeTab.url.includes('chatgpt.com')) {
      targetTabId = activeTab.id;
      setChatGPTStatus(true, 'ChatGPT Conectado');
      return targetTabId;
    }

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

// -------------------------------------------------------------
// 2. Loop de Tarefas da Bridge (Porta 4321)
// -------------------------------------------------------------
async function pollBridge() {
  try {
    const res = await fetch('http://127.0.0.1:4321/tasks', { method: 'GET' });
    if (res.ok) {
      setBridgeStatus(true, 'Bridge: Conectado (4321)');
      const data = await res.json();
      
      if (data && data.task && !isProcessingTask) {
        isProcessingTask = true;
        await handleBridgeTask(data.task);
        isProcessingTask = false;
      }
    } else {
      setBridgeStatus(false, 'Bridge: Desconectado');
    }
  } catch (err) {
    setBridgeStatus(false, 'Bridge: Aguardando');
  }

  setTimeout(pollBridge, 1000);
}

async function handleBridgeTask(task) {
  const tabId = await findChatGPTTab();
  if (!tabId) {
    logAgent(`Erro: Aba do ChatGPT não encontrada.`);
    await sendBridgeResponse(task.id, { success: false, error: 'Aba do ChatGPT não encontrada.' });
    return;
  }

  // Tipo: Novo chat
  if (task.type === 'new_chat') {
    logAgent(`Solicitação de abertura de novo chat.`);
    chrome.tabs.sendMessage(tabId, { action: 'new_chat' }, async (resp) => {
      await sendBridgeResponse(task.id, resp || { success: true });
    });
    return;
  }

  // Tipo: Ler histórico
  if (task.type === 'get_history') {
    logAgent(`Solicitação de leitura do histórico do chat.`);
    chrome.tabs.sendMessage(tabId, { action: 'get_history' }, async (resp) => {
      await sendBridgeResponse(task.id, resp || { success: false, error: 'Sem resposta' });
    });
    return;
  }

  // Tipo: Ler última mensagem
  if (task.type === 'get_last_message') {
    logAgent(`Solicitação de leitura da última mensagem.`);
    chrome.tabs.sendMessage(tabId, { action: 'get_last_message' }, async (resp) => {
      await sendBridgeResponse(task.id, resp || { success: false, error: 'Sem resposta' });
    });
    return;
  }

  // Tipo: Enviar mensagem (individual ou de lote)
  const promptPreview = (task.prompt || '').slice(0, 35);
  const stepInfo = task.batchIndex ? `[${task.batchIndex}/${task.batchTotal}] ` : '';
  logAgent(`${stepInfo}Enviando: "${promptPreview}..."`);

  try {
    chrome.tabs.sendMessage(tabId, {
      action: 'send',
      text: task.prompt,
      files: task.files || []
    }, async (response) => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message;
        logAgent(`Erro: ${err}`);
        await sendBridgeResponse(task.id, { success: false, error: err });
        return;
      }

      if (response && response.success) {
        const imgCount = (response.images || []).length;
        logAgent(`${stepInfo}Concluído! ${imgCount > 0 ? `(${imgCount} imagens baixadas)` : ''}`);
        responseContent.textContent = response.response;

        // Se houver imagens geradas, salvar via chrome.downloads também
        if (response.images && response.images.length > 0) {
          downloadImagesLocally(response.images);
        }

        await sendBridgeResponse(task.id, {
          success: true,
          response: response.response,
          codeBlocks: response.codeBlocks || [],
          images: response.images || []
        });
      } else {
        const err = (response && response.error) || 'Erro no processamento.';
        logAgent(`Falha: ${err}`);
        await sendBridgeResponse(task.id, { success: false, error: err });
      }
    });
  } catch (err) {
    logAgent(`Exceção: ${err.message}`);
    await sendBridgeResponse(task.id, { success: false, error: err.message });
  }
}

async function sendBridgeResponse(taskId, payload) {
  try {
    await fetch('http://127.0.0.1:4321/response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, ...payload })
    });
  } catch (e) {
    console.error('Erro ao responder bridge:', e);
  }
}

// -------------------------------------------------------------
// 3. Fila Sequencial em Lote (ex: 10 Mensagens)
// -------------------------------------------------------------
startBatchBtn.addEventListener('click', async () => {
  const lines = batchInput.value
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    alert('Digite ao menos uma mensagem por linha para iniciar a fila.');
    return;
  }

  const tabId = await findChatGPTTab();
  if (!tabId) {
    alert('Abra o chatgpt.com antes de iniciar a fila.');
    return;
  }

  cancelBatchFlag = false;
  startBatchBtn.disabled = true;
  cancelBatchBtn.disabled = false;
  batchProgress.style.display = 'block';
  batchLog.textContent = `Iniciando fila com ${lines.length} mensagens sequenciais...\n`;

  for (let i = 0; i < lines.length; i++) {
    if (cancelBatchFlag) {
      batchLog.textContent += `\n❌ Fila cancelada pelo usuário na mensagem ${i + 1}.`;
      break;
    }

    const pct = Math.round(((i) / lines.length) * 100);
    batchProgressFill.style.width = `${pct}%`;
    batchStatusText.textContent = `Executando [${i + 1}/${lines.length}]: "${lines[i].slice(0, 30)}..."`;
    batchLog.textContent += `\n[${i + 1}/${lines.length}] Enviando: "${lines[i]}"...`;

    // Aguardar o envio e a geração completa da mensagem atual
    const stepResult = await executeSingleBatchPrompt(tabId, lines[i]);

    if (stepResult.success) {
      batchLog.textContent += `\n[${i + 1}/${lines.length}] ✅ Concluída! Resposta recebida.`;
      if (stepResult.images && stepResult.images.length > 0) {
        batchLog.textContent += ` (${stepResult.images.length} imagem(ns) detectada(s))`;
        downloadImagesLocally(stepResult.images);
      }
    } else {
      batchLog.textContent += `\n[${i + 1}/${lines.length}] ❌ Erro: ${stepResult.error || 'Falha ao gerar.'}`;
    }

    // Intervalo de segurança de 1.5s entre mensagens
    await new Promise(r => setTimeout(r, 1500));
  }

  batchProgressFill.style.width = '100%';
  batchStatusText.textContent = cancelBatchFlag ? 'Fila cancelada.' : '🎉 Todas as mensagens foram concluídas!';
  startBatchBtn.disabled = false;
  cancelBatchBtn.disabled = true;
});

cancelBatchBtn.addEventListener('click', () => {
  cancelBatchFlag = true;
  cancelBatchBtn.disabled = true;
  batchStatusText.textContent = 'Cancelando fila após a mensagem atual...';
});

function executeSingleBatchPrompt(tabId, text) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'send',
      text: text,
      files: []
    }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp || { success: false, error: 'Sem resposta' });
      }
    });
  });
}

// -------------------------------------------------------------
// 4. Histórico Completo e Download de Imagens
// -------------------------------------------------------------
refreshHistoryBtn.addEventListener('click', async () => {
  const tabId = await findChatGPTTab();
  if (!tabId) {
    alert('Abra o chatgpt.com');
    return;
  }

  refreshHistoryBtn.disabled = true;
  refreshHistoryBtn.textContent = 'Lendo mensagens...';
  historyList.innerHTML = '<p style="color: var(--text-muted); font-size: 11px;">Carregando...</p>';

  chrome.tabs.sendMessage(tabId, { action: 'get_history' }, (resp) => {
    refreshHistoryBtn.disabled = false;
    refreshHistoryBtn.textContent = '📖 Ler Chat Completo';

    if (chrome.runtime.lastError || !resp || !resp.success) {
      historyList.innerHTML = `<p style="color: var(--danger); font-size: 11px;">Erro: ${(resp && resp.error) || chrome.runtime.lastError?.message}</p>`;
      return;
    }

    const history = resp.history || [];
    historyStats.textContent = `Total de turnos encontrados: ${history.length}`;
    historyList.innerHTML = '';

    history.forEach(item => {
      const div = document.createElement('div');
      div.className = `history-item ${item.role}`;
      div.innerHTML = `
        <div class="history-role">${item.role === 'user' ? '👤 Usuário' : '🤖 ChatGPT'} (Turno #${item.index + 1})</div>
        <div class="history-body">${escapeHtml(item.text || '(Sem texto)')}</div>
        ${item.images && item.images.length > 0 ? `<div style="font-size: 10px; color: #34d399; margin-top: 4px;">🖼️ ${item.images.length} imagem(ns)</div>` : ''}
      `;
      historyList.appendChild(div);
    });
  });
});

downloadImagesBtn.addEventListener('click', async () => {
  const tabId = await findChatGPTTab();
  if (!tabId) {
    alert('Abra o chatgpt.com');
    return;
  }

  downloadImagesBtn.disabled = true;
  downloadImagesBtn.textContent = 'Buscando imagens...';

  chrome.tabs.sendMessage(tabId, { action: 'get_images' }, (resp) => {
    downloadImagesBtn.disabled = false;
    downloadImagesBtn.textContent = '🖼️ Baixar Imagens';

    if (chrome.runtime.lastError || !resp || !resp.success) {
      alert('Erro ao buscar imagens: ' + ((resp && resp.error) || chrome.runtime.lastError?.message));
      return;
    }

    const images = resp.images || [];
    if (images.length === 0) {
      alert('Nenhuma imagem encontrada na conversa atual.');
      return;
    }

    downloadImagesLocally(images);
    alert(`Iniciando download de ${images.length} imagem(ns)!`);
  });
});

function downloadImagesLocally(images) {
  images.forEach((img, idx) => {
    if (img.base64) {
      const link = document.createElement('a');
      link.href = `data:image/png;base64,${img.base64}`;
      link.download = img.name || `chatgpt_imagem_${Date.now()}_${idx + 1}.png`;
      link.click();
    } else if (img.url) {
      chrome.downloads?.download({
        url: img.url,
        filename: img.name || `chatgpt_imagem_${Date.now()}_${idx + 1}.png`
      });
    }
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// -------------------------------------------------------------
// 5. Envio Individual e Parar Geração
// -------------------------------------------------------------
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
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        base64: reader.result.split(',')[1]
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
    alert('Aba do ChatGPT não encontrada.');
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Enviando...';
  responseContent.textContent = 'Aguardando início e conclusão da geração...';

  try {
    const filesData = await Promise.all(selectedFiles.map(fileToBase64));

    chrome.tabs.sendMessage(tabId, {
      action: 'send',
      text: text,
      files: filesData
    }, (response) => {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Enviar';

      if (chrome.runtime.lastError) {
        responseContent.textContent = 'Erro: ' + chrome.runtime.lastError.message;
        return;
      }

      if (response && response.success) {
        responseContent.textContent = response.response;
        promptInput.value = '';
        selectedFiles = [];
        renderFileList();
        if (response.images && response.images.length > 0) {
          downloadImagesLocally(response.images);
        }
      } else {
        responseContent.textContent = 'Erro: ' + ((response && response.error) || 'Falha ao processar.');
      }
    });

  } catch (err) {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Enviar';
    responseContent.textContent = 'Erro interno: ' + err.message;
  }
});

stopBtn.addEventListener('click', async () => {
  const tabId = await findChatGPTTab();
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'stop_generating' });
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

// Inicialização
setInterval(findChatGPTTab, 3000);
findChatGPTTab();
pollBridge();
