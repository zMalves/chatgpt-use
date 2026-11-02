// ChatGPT Automator - Content Script v1.8.0
console.log('[ChatGPT Automator] Content script v1.8.0 carregado no ChatGPT.');

// -------------------------------------------------------------
// 1. Localizadores de Elementos do ChatGPT
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
    throw new Error('Campo de upload de arquivo não encontrado.');
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
// 2. Extração Específica de Imagens do ASSISTENTE (DALL-E)
// -------------------------------------------------------------
async function convertImgToBase64(imgElement) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth || imgElement.width || 1024;
    canvas.height = imgElement.naturalHeight || imgElement.height || 1024;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
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

// Retorna apenas os turnos que pertencem ao ChatGPT (Assistente)
function getAssistantTurnElements() {
  const articles = Array.from(document.querySelectorAll('article'));
  if (articles.length > 0) {
    return articles.filter(art => {
      // É mensagem do usuário? Se sim, descarta!
      const isUser = (
        art.getAttribute('data-message-author-role') === 'user' ||
        art.querySelector('[data-message-author-role="user"]') ||
        art.getAttribute('data-testid')?.includes('user') ||
        art.innerText.startsWith('Você disse:')
      );
      return !isUser;
    });
  }

  // Fallback: elementos com autor assistant
  return Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
}

// Retorna todas as imagens que foram geradas nas respostas do Assistente
function getAllAssistantImages() {
  const assistantTurns = getAssistantTurnElements();
  const imgs = [];

  assistantTurns.forEach(turn => {
    const turnImgs = Array.from(turn.querySelectorAll('img'));
    turnImgs.forEach(img => {
      // Ignora avatares
      const isAvatar = (
        img.classList.contains('rounded-full') ||
        img.closest('[data-testid="user-avatar"]') ||
        (img.naturalWidth > 0 && img.naturalWidth <= 50)
      );

      // Imagem gerada no chat: tem tamanho visual de imagem ou está no container do DALL-E
      const isContentImage = !isAvatar && (
        img.src.includes('oaiusercontent.com') ||
        img.src.startsWith('blob:') ||
        img.naturalWidth > 100 ||
        img.width > 100
      );

      if (isContentImage && !imgs.some(existing => existing.src === img.src)) {
        imgs.push(img);
      }
    });
  });

  return imgs;
}

// Processa uma lista de tags <img> para objetos com base64
async function processImageElements(imgElements) {
  const results = [];
  for (let i = 0; i < imgElements.length; i++) {
    const img = imgElements[i];

    if (!img.complete) {
      await new Promise(res => {
        img.onload = res;
        img.onerror = res;
        setTimeout(res, 2500);
      });
    }

    const base64 = await convertImgToBase64(img);
    results.push({
      name: `chatgpt_gerada_${Date.now()}_${i + 1}.png`,
      url: img.src,
      alt: img.getAttribute('alt') || 'Imagem gerada pelo ChatGPT',
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      base64: base64
    });
  }
  return results;
}

// -------------------------------------------------------------
// 3. Leitura de Mensagens
// -------------------------------------------------------------
function cleanElementText(element) {
  if (!element) return '';
  const textContainer = (
    element.querySelector('.markdown') ||
    element.querySelector('[data-message-author-role]') ||
    element.querySelector('.whitespace-pre-wrap') ||
    element
  );

  let text = textContainer.innerText || textContainer.textContent || '';
  text = text.replace(/^(Você disse|ChatGPT disse|ChatGPT):\s*/i, '');
  return text.trim();
}

async function getLastAssistantTurn() {
  const assistantTurns = getAssistantTurnElements();
  if (assistantTurns.length === 0) {
    return { text: '', images: [] };
  }

  const lastTurn = assistantTurns[assistantTurns.length - 1];
  const text = cleanElementText(lastTurn);

  // Busca imagens EXCLUSIVAMENTE deste último turno
  const turnImgs = Array.from(lastTurn.querySelectorAll('img')).filter(img => {
    const isAvatar = img.classList.contains('rounded-full') || (img.naturalWidth > 0 && img.naturalWidth <= 50);
    return !isAvatar && (img.src.includes('oaiusercontent.com') || img.src.startsWith('blob:') || img.naturalWidth > 100);
  });

  const images = await processImageElements(turnImgs);
  return { text, images };
}

// -------------------------------------------------------------
// 4. Detecção Ultra-Precisa de Conclusão da Imagem Atual
// -------------------------------------------------------------
function waitForGenerationComplete(preExistingImgUrls = new Set(), timeoutMs = 300000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let hasSeenStop = false;
    let lastText = '';
    let stableTicks = 0;

    const interval = setInterval(async () => {
      const now = Date.now();
      const stopBtn = getStopButton();
      const isStreaming = !!document.querySelector('.result-streaming');

      if (stopBtn || isStreaming) {
        hasSeenStop = true;
      }

      // 1. Procurar por NOVA imagem gerada nesta resposta do assistente
      const currentAssistantImgs = getAllAssistantImages();
      const newImgs = currentAssistantImgs.filter(img => !preExistingImgUrls.has(img.src));

      let readyNewImages = [];
      if (newImgs.length > 0) {
        const lastNew = newImgs[newImgs.length - 1];
        // Aguarda a imagem estar totalmente carregada
        if (lastNew.complete && (lastNew.naturalWidth > 0 || lastNew.width > 0)) {
          readyNewImages = await processImageElements([lastNew]);
        }
      }

      // 2. Verificar texto da resposta
      const lastTurn = await getLastAssistantTurn();
      const currentText = lastTurn.text || '';

      if (currentText && currentText === lastText) {
        stableTicks++;
      } else {
        stableTicks = 0;
        lastText = currentText;
      }

      const hasNewImage = readyNewImages.length > 0;
      const isTextDone = !stopBtn && !isStreaming && (hasSeenStop || stableTicks >= 2);
      const isTimeout = now - startTime > timeoutMs;

      // Se a nova imagem do assistente terminou de renderizar e o stop sumiu: SUCESSO!
      if ((hasNewImage && !stopBtn) || (isTextDone && currentText.length > 0) || isTimeout) {
        clearInterval(interval);
        console.log('[ChatGPT Automator] Concluído! Novas imagens geradas:', readyNewImages.length);

        resolve({
          success: true,
          response: currentText || (hasNewImage ? 'Imagem gerada com sucesso!' : ''),
          // SE gerou imagem nova nesta pergunta, retorna APENAS ela!
          images: hasNewImage ? readyNewImages : lastTurn.images
        });
      }
    }, 600);
  });
}

// -------------------------------------------------------------
// 5. Listener de Mensagens da Extensão
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Novo chat
  if (request.action === 'new_chat') {
    // 1. Tentar clicar no botão nativo "Novo chat" ou barra lateral
    const newChatBtn = (
      document.querySelector('a[href="/"]') ||
      document.querySelector('button[aria-label*="Novo chat"]') ||
      document.querySelector('button[aria-label*="New chat"]') ||
      document.querySelector('nav a[href="/"]') ||
      document.querySelector('[data-testid="new-chat-button"]')
    );

    if (newChatBtn) {
      newChatBtn.click();
    }
    
    // Forçar navegação para a raiz se a URL ainda estiver em um chat específico
    if (window.location.pathname !== '/' && !window.location.pathname.endsWith('/')) {
      window.location.href = 'https://chatgpt.com/';
    }

    sendResponse({ success: true, message: 'Novo chat aberto com sucesso' });
    return true;
  }
  // Novo chat
  if (request.action === 'new_chat') {
    const newChatBtn = (
      document.querySelector('[data-testid="create-new-chat-button"]') ||
      document.querySelector('a[href="/"]') ||
      document.querySelector('a[aria-label*="Novo"]') ||
      document.querySelector('a[aria-label*="New"]') ||
      document.querySelector('button[aria-label*="Novo"]') ||
      document.querySelector('button[aria-label*="New"]')
    );
    if (newChatBtn) {
      newChatBtn.click();
    } else {
      window.location.href = 'https://chatgpt.com/';
    }
    sendResponse({ success: true });
    return true;
  }

  // Baixar a ÚLTIMA imagem gerada na conversa
  if (request.action === 'get_images') {
    const assistantImgs = getAllAssistantImages();
    if (assistantImgs.length === 0) {
      sendResponse({ success: true, images: [] });
      return true;
    }
    // Retorna a mais recente gerada pelo assistente
    processImageElements([assistantImgs[assistantImgs.length - 1]])
      .then(images => sendResponse({ success: true, images }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Ler a última mensagem do assistente
  if (request.action === 'get_last_message') {
    getLastAssistantTurn()
      .then(last => sendResponse({ success: true, lastMessage: { role: 'assistant', text: last.text, images: last.images } }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Enviar mensagem e aguardar
  if (request.action === 'send') {
    (async () => {
      try {
        // Registra as imagens do assistente que já existiam ANTES de disparar este envio
        const beforeAssistantImgs = getAllAssistantImages();
        const preExistingImgUrls = new Set(beforeAssistantImgs.map(i => i.src));

        // Registra as URLs dos arquivos anexados pelo usuário para NUNCA confundi-los com respostas da IA
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
            throw new Error('Botão de envio indisponível.');
          }
        } else {
          sendBtn.click();
        }

        await new Promise(r => setTimeout(r, 1500));
        const result = await waitForGenerationComplete(preExistingImgUrls, 300000);
        sendResponse(result);

      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }
});
