let selectedFiles = [];
let activeTabId = null;

const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const promptInput = document.getElementById('promptInput');
const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');
const responseCard = document.getElementById('responseCard');
const responseContent = document.getElementById('responseContent');
const copyBtn = document.getElementById('copyBtn');

// Inicialização: checar a aba atual
async function checkActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      setOffline('Nenhuma aba detectada');
      return;
    }

    activeTabId = tab.id;

    if (!tab.url || (!tab.url.includes('chatgpt.com') && !tab.url.includes('openai.com'))) {
      setOffline('Abra o chatgpt.com');
      return;
    }

    // Enviar ping para o content script
    chrome.tabs.sendMessage(activeTabId, { action: 'check_status' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ready) {
        setOnline('Aguardando ChatGPT');
        sendBtn.disabled = false;
      } else {
        setOnline('ChatGPT Conectado');
        sendBtn.disabled = false;
      }
    });

  } catch (err) {
    setOffline('Erro de conexão');
  }
}

function setOnline(text) {
  statusBadge.className = 'status-badge status-online';
  statusText.textContent = text;
}

function setOffline(text) {
  statusBadge.className = 'status-badge status-offline';
  statusText.textContent = text;
  sendBtn.disabled = true;
}

// Gerenciamento de arquivos
dropArea.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    // Evitar duplicados
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

// Converter arquivo para base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // O resultado vem como "data:...;base64,AAAA..."
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

// Enviar mensagem e arquivos
sendBtn.addEventListener('click', async () => {
  const text = promptInput.value.trim();
  if (!text && selectedFiles.length === 0) {
    alert('Digite uma mensagem ou selecione ao menos um arquivo.');
    return;
  }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Enviando...';
  responseCard.style.display = 'block';
  responseContent.textContent = 'Aguardando processamento e resposta do ChatGPT...';

  try {
    // Converter arquivos para base64
    const filesData = await Promise.all(selectedFiles.map(fileToBase64));

    chrome.tabs.sendMessage(activeTabId, {
      action: 'send',
      text: text,
      files: filesData
    }, (response) => {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Enviar Mensagem';

      if (chrome.runtime.lastError) {
        responseContent.textContent = 'Erro ao se comunicar com a aba: ' + chrome.runtime.lastError.message;
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

// Novo chat
newChatBtn.addEventListener('click', () => {
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { action: 'new_chat' });
  }
});

// Copiar resposta
copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(responseContent.textContent).then(() => {
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copiado!';
    setTimeout(() => copyBtn.textContent = originalText, 2000);
  });
});

// Iniciar verificação
checkActiveTab();

