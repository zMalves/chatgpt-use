// ChatGPT Automator - Content Script v1.3.0
console.log('[ChatGPT Automator] Content script carregado no ChatGPT.');

// -------------------------------------------------------------
// 1. Localizadores Universais de Elementos (Suporta Layout Novo e Antigo)
// -------------------------------------------------------------
function getPromptElement() {
  return (
    document.querySelector('#prompt-textarea') ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('div[role="textbox"]') ||
    document.querySelector('textarea')
  );
}

function getSendButton() {
  return (
    document.querySelector('button[data-testid="send-button"]') ||
    document.querySelector('button[aria-label*="Enviar"]') ||
    document.querySelector('button[aria-label*="Send"]') ||
    document.querySelector('button[data-testid="composer-speech-button"] ~ button')
  );
}

function getStopButton() {
  return (
    document.querySelector('button[data-testid="stop-button"]') ||
    document.querySelector('button[aria-label*="Parar"]') ||
    document.querySelector('button[aria-label*="Stop"]')
  );
}

// Inserir texto no prompt simulando digitação humana
function setPromptText(text) {
  const el = getPromptElement();
  if (!el) throw new Error('Campo de mensagem do ChatGPT não encontrado.');

  el.focus();

  if (el.tagName.toLowerCase() === 'textarea') {
    el.value = text;
  } else {
    // Para contenteditable / div rica
    el.innerText = text;
    // Em alguns builds do ChatGPT, parágrafos internos são necessários
    if (!el.innerText || el.innerText.trim() === '') {
      el.innerHTML = `<p>${text}</p>`;
    }
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Anexar arquivos via input oculto do ChatGPT
async function attachFiles(filesData) {
  if (!filesData || filesData.length === 0) return;

  const fileInput = document.querySelector('input[type="file"]');
  if (!fileInput) {
    throw new Error('Campo de upload de arquivo (input[type="file"]) não encontrado.');
  }

  const dt = new DataTransfer();
  for (const item of filesData) {
    const byteCharacters = atob(item.base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: item.type || 'application/octet-stream' });
    const file = new File([blob], item.name, { type: item.type });
    dt.items.add(file);
  }

  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1500));
}

// -------------------------------------------------------------
// 2. Extração de Imagens e Conversão
// -------------------------------------------------------------
async function imageToBase64(imgElement) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth || imgElement.width || 512;
    canvas.height = imgElement.naturalHeight || imgElement.height || 512;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.split(',')[1];
  } catch (canvasErr) {
    try {
      const resp = await fetch(imgElement.src);
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (fetchErr) {
      return null;
    }
  }
}

async function extractImagesFromElement(rootElement) {
  const imgs = Array.from(rootElement.querySelectorAll('img'));
  const contentImages = [];

  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    const isAvatar = (
      img.classList.contains('rounded-full') ||
      img.closest('[data-testid="user-avatar"]') ||
      (img.naturalWidth > 0 && img.naturalWidth <= 48 && img.naturalHeight <= 48) ||
      (img.width <= 48 && img.height <= 48)
    );

    if (isAvatar || !img.src) continue;

    if (!img.complete) {
      await new Promise(res => {
        img.onload = res;
        img.onerror = res;
        setTimeout(res, 2000);
      });
    }

    const base64 = await imageToBase64(img);
    const alt = img.getAttribute('alt') || 'Imagem gerada pelo ChatGPT';
    const filename = `chatgpt_image_${Date.now()}_${i + 1}.png`;

    contentImages.push({
      name: filename,
      url: img.src,
      alt: alt,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      base64: base64
    });
  }

  return contentImages;
}

// -------------------------------------------------------------
// 3. Leitura Completa de Mensagens com Seletores Amplos
// -------------------------------------------------------------
function getAllTurnElements() {
  // 1. Tentar artigos com conversation-turn
  let turns = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn"]'));
  if (turns.length > 0) return turns;

  // 2. Tentar qualquer article na página
  turns = Array.from(document.querySelectorAll('article'));
  if (turns.length > 0) return turns;

  // 3. Tentar contêineres com atributos de autor
  turns = Array.from(document.querySelectorAll('[data-message-author-role]'));
  if (turns.length > 0) return turns;

  // 4. Tentar blocos de markdown de resposta
  turns = Array.from(document.querySelectorAll('.markdown'));
  if (turns.length > 0) return turns;

  return [];
}

async function parseTurn(turnElement, index) {
  const authorAttr = turnElement.getAttribute('data-message-author-role');
  const hasUserAuthor = authorAttr === 'user' || turnElement.querySelector('[data-message-author-role="user"]');
  const hasUserTestId = turnElement.getAttribute('data-testid')?.includes('user');
  const hasUserText = turnElement.innerText.includes('Você disse:');

  const isUser = !!(hasUserAuthor || hasUserTestId || hasUserText);
  const role = isUser ? 'user' : 'assistant';

  const markdownEl = turnElement.querySelector('.markdown') || turnElement;
  const text = markdownEl.innerText.trim();

  const codeBlocks = Array.from(turnElement.querySelectorAll('pre code')).map(code => ({
    code: code.innerText,
    language: (code.className.match(/language-(\w+)/) || [])[1] || 'text'
  }));

  const images = await extractImagesFromElement(turnElement);

  return {
    index,
    role,
    text,
    codeBlocks,
    images
  };
}

async function getChatHistory() {
  const turns = getAllTurnElements();
  const history = [];

  for (let i = 0; i < turns.length; i++) {
    const parsed = await parseTurn(turns[i], i);
    if (parsed.text || parsed.images.length > 0) {
      history.push(parsed);
    }
  }

  return history;
}

async function getLastMessage() {
  const turns = getAllTurnElements();
  if (turns.length === 0) {
    return { role: 'assistant', text: '', images: [] };
  }

  const lastTurn = turns[turns.length - 1];
  return await parseTurn(lastTurn, turns.length - 1);
}

// -------------------------------------------------------------
// 4. Detecção Precisa de Conclusão da Mensagem
// -------------------------------------------------------------
function waitForGenerationComplete(timeoutMs = 180000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let hasStarted = false;
    let initialTurns = getAllTurnElements().length;
    let lastSeenText = '';
    let stableCount = 0;

    const interval = setInterval(async () => {
      const now = Date.now();
      const stopBtn = getStopButton();
      const isStreaming = !!document.querySelector('.result-streaming');
      const currentTurns = getAllTurnElements().length;

      // 1. Detectar início
      if (!hasStarted) {
        if (stopBtn || isStreaming || currentTurns > initialTurns) {
          hasStarted = true;
          console.log('[ChatGPT Automator] Geração iniciada detectada.');
        } else if (now - startTime > 8000) {
          hasStarted = true;
        }
      }

      // 2. Aguardar conclusão
      if (hasStarted) {
        const turns = getAllTurnElements();
        const currentText = turns.length > 0 ? turns[turns.length - 1].innerText : '';
        const isStopGone = !stopBtn && !isStreaming;

        if (currentText === lastSeenText && currentText.length > 0) {
          stableCount++;
        } else {
          stableCount = 0;
          lastSeenText = currentText;
        }

        const isStable = stableCount >= 2;
        const isTimeout = now - startTime > timeoutMs;

        if ((isStopGone && isStable) || isTimeout) {
          clearInterval(interval);
          console.log('[ChatGPT Automator] Geração finalizada!');
          await new Promise(r => setTimeout(r, 600));

          const lastMsg = await getLastMessage();
          resolve({
            success: true,
            response: lastMsg.text,
            codeBlocks: lastMsg.codeBlocks || [],
            images: lastMsg.images || []
          });
        }
      }
    }, 700);
  });
}

// -------------------------------------------------------------
// 5. Listener de Mensagens da Extensão
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'check_status') {
    const prompt = getPromptElement();
    const isGenerating = !!getStopButton();
    const turnsCount = getAllTurnElements().length;
    sendResponse({
      ready: !!prompt,
      isGenerating,
      turnsCount,
      url: window.location.href,
      title: document.title
    });
    return true;
  }

  if (request.action === 'get_history') {
    getChatHistory()
      .then(history => sendResponse({ success: true, history }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'get_last_message') {
    getLastMessage()
      .then(lastMessage => sendResponse({ success: true, lastMessage }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'get_images') {
    extractImagesFromElement(document.body)
      .then(images => sendResponse({ success: true, images }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'stop_generating') {
    const stopBtn = getStopButton();
    if (stopBtn) {
      stopBtn.click();
      sendResponse({ success: true, message: 'Geração interrompida' });
    } else {
      sendResponse({ success: false, message: 'Nenhuma geração em andamento' });
    }
    return true;
  }

  if (request.action === 'new_chat') {
    window.location.href = 'https://chatgpt.com/';
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'send') {
    (async () => {
      try {
        if (getStopButton()) {
          console.log('[ChatGPT Automator] Aguardando término da geração anterior...');
          await waitForGenerationComplete(60000);
          await new Promise(r => setTimeout(r, 1000));
        }

        if (request.files && request.files.length > 0) {
          await attachFiles(request.files);
        }

        if (request.text) {
          setPromptText(request.text);
        }

        await new Promise(r => setTimeout(r, 600));

        const sendBtn = getSendButton();
        if (!sendBtn || sendBtn.disabled) {
          const promptEl = getPromptElement();
          if (promptEl) {
            promptEl.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true
            }));
          } else {
            throw new Error('Botão de envio desabilitado.');
          }
        } else {
          sendBtn.click();
        }

        const result = await waitForGenerationComplete(180000);
        sendResponse(result);

      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }
});
