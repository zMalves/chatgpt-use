// ChatGPT Automator - Content Script v1.4.0
console.log('[ChatGPT Automator] Content script carregado no ChatGPT.');

// -------------------------------------------------------------
// 1. Localizadores Universais
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

function setPromptText(text) {
  const el = getPromptElement();
  if (!el) throw new Error('Campo de mensagem do ChatGPT não encontrado.');

  el.focus();
  if (el.tagName.toLowerCase() === 'textarea') {
    el.value = text;
  } else {
    el.innerText = text;
    if (!el.innerText || el.innerText.trim() === '') {
      el.innerHTML = `<p>${text}</p>`;
    }
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

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
// 2. Extração de Imagens
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
// 3. Leitura Robusta e Flexível do Chat
// -------------------------------------------------------------
function extractAllMessagesFromDOM() {
  const results = [];

  // 1. Procurar por artigos
  const articles = Array.from(document.querySelectorAll('article'));
  if (articles.length > 0) {
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      const text = art.innerText.trim();
      if (!text) continue;

      const isUser = !!(
        art.querySelector('[data-message-author-role="user"]') ||
        art.getAttribute('data-testid')?.includes('user') ||
        text.startsWith('Você disse:')
      );

      results.push({
        index: i,
        role: isUser ? 'user' : 'assistant',
        text: text.replace(/^Você disse:\s*/i, '').replace(/^ChatGPT disse:\s*/i, '').trim(),
        element: art
      });
    }
    if (results.length > 0) return results;
  }

  // 2. Fallback: procurar por elementos com markdown
  const markdowns = Array.from(document.querySelectorAll('.markdown'));
  if (markdowns.length > 0) {
    for (let i = 0; i < markdowns.length; i++) {
      results.push({
        index: i,
        role: 'assistant',
        text: markdowns[i].innerText.trim(),
        element: markdowns[i]
      });
    }
    return results;
  }

  // 3. Fallback extremo: pegar o container principal de conversa
  const main = document.querySelector('main');
  if (main) {
    const pTags = Array.from(main.querySelectorAll('p'));
    if (pTags.length > 0) {
      const lastP = pTags[pTags.length - 1];
      results.push({
        index: 0,
        role: 'assistant',
        text: lastP.innerText.trim(),
        element: lastP
      });
    }
  }

  return results;
}

async function getLastMessage() {
  const msgs = extractAllMessagesFromDOM();
  if (msgs.length === 0) {
    return { role: 'assistant', text: '', images: [] };
  }

  // Encontrar a última mensagem do assistente
  const assistantMsgs = msgs.filter(m => m.role === 'assistant');
  const target = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1] : msgs[msgs.length - 1];
  
  const images = target.element ? await extractImagesFromElement(target.element) : [];
  return {
    role: target.role,
    text: target.text,
    images
  };
}

async function getChatHistory() {
  const msgs = extractAllMessagesFromDOM();
  const history = [];

  for (const m of msgs) {
    const images = m.element ? await extractImagesFromElement(m.element) : [];
    history.push({
      index: m.index,
      role: m.role,
      text: m.text,
      images
    });
  }

  return history;
}

// -------------------------------------------------------------
// 4. Detecção Rápida e Confiável de Fim de Geração
// -------------------------------------------------------------
function waitForGenerationComplete(timeoutMs = 120000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let hasSeenStopButton = false;
    let lastText = '';
    let stableChecks = 0;

    const interval = setInterval(async () => {
      const now = Date.now();
      const stopBtn = getStopButton();
      const isStreaming = !!document.querySelector('.result-streaming');

      if (stopBtn || isStreaming) {
        hasSeenStopButton = true;
      }

      const lastMsg = await getLastMessage();
      const currentText = lastMsg.text || '';

      if (currentText && currentText === lastText) {
        stableChecks++;
      } else {
        stableChecks = 0;
        lastText = currentText;
      }

      // Concluído se:
      // - O stop-button não existe E o texto estabilizou por 1 segundo (2 verificações de 500ms)
      // - OU atingiu timeout
      const isFinished = !stopBtn && !isStreaming && (hasSeenStopButton || stableChecks >= 2);
      const isTimeout = now - startTime > timeoutMs;

      if ((isFinished && currentText.length > 0) || isTimeout) {
        clearInterval(interval);
        console.log('[ChatGPT Automator] Resposta capturada:', currentText);
        resolve({
          success: true,
          response: currentText,
          images: lastMsg.images || []
        });
      }
    }, 500);
  });
}

// -------------------------------------------------------------
// 5. Listener de Mensagens
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'check_status') {
    const prompt = getPromptElement();
    const isGenerating = !!getStopButton();
    const turnsCount = extractAllMessagesFromDOM().length;
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

  if (request.action === 'send') {
    (async () => {
      try {
        if (request.files && request.files.length > 0) {
          await attachFiles(request.files);
        }

        if (request.text) {
          setPromptText(request.text);
        }

        await new Promise(r => setTimeout(r, 500));

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
            throw new Error('Botão de envio indisponível.');
          }
        } else {
          sendBtn.click();
        }

        // Aguarda 1.5s antes de começar a checar o fim
        await new Promise(r => setTimeout(r, 1500));
        const result = await waitForGenerationComplete(90000);
        sendResponse(result);

      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }
});
