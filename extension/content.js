// ChatGPT Automator - Content Script v1.6.0
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
// 2. Extração Precisa de Imagens Geradas (DALL-E)
// -------------------------------------------------------------
async function convertBlobOrUrlToBase64(src) {
  try {
    const resp = await fetch(src);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    return null;
  }
}

async function extractAllGeneratedImages() {
  const imgs = Array.from(document.querySelectorAll('img'));
  const contentImages = [];

  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];

    // Ignorar avatares do ChatGPT / Usuário
    const isAvatar = (
      img.classList.contains('rounded-full') ||
      img.closest('[data-testid="user-avatar"]') ||
      img.closest('button[data-testid="profile-button"]') ||
      (img.naturalWidth > 0 && img.naturalWidth <= 50 && img.naturalHeight <= 50) ||
      (img.width <= 50 && img.height <= 50)
    );

    if (isAvatar || !img.src) continue;

    // Verificar se é uma imagem de conteúdo (tem largura razoável ou botão de editar)
    const isGenerated = (
      img.src.includes('oaiusercontent.com') ||
      img.src.startsWith('blob:') ||
      img.naturalWidth > 150 ||
      img.width > 150 ||
      img.closest('[data-testid*="image"]') ||
      img.parentElement?.querySelector('button') // botões de Editar / Download
    );

    if (!isGenerated) continue;

    // Aguardar terminar de carregar se necessário
    if (!img.complete) {
      await new Promise(res => {
        img.onload = res;
        img.onerror = res;
        setTimeout(res, 2000);
      });
    }

    let base64 = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 512;
      canvas.height = img.naturalHeight || img.height || 512;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      base64 = canvas.toDataURL('image/png').split(',')[1];
    } catch (e) {
      base64 = await convertBlobOrUrlToBase64(img.src);
    }

    const filename = `chatgpt_imagem_${Date.now()}_${i + 1}.png`;
    contentImages.push({
      name: filename,
      url: img.src,
      alt: img.getAttribute('alt') || 'Imagem gerada pelo ChatGPT',
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      base64: base64
    });
  }

  return contentImages;
}

// -------------------------------------------------------------
// 3. Extração de Mensagens
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

function getAllTurns() {
  const turns = [];
  const articles = Array.from(document.querySelectorAll('article'));
  if (articles.length > 0) {
    articles.forEach((art, idx) => {
      const isUser = !!(
        art.querySelector('[data-message-author-role="user"]') ||
        art.getAttribute('data-testid')?.includes('user') ||
        art.innerText.includes('Você disse:')
      );
      const role = isUser ? 'user' : 'assistant';
      const text = cleanElementText(art);
      turns.push({ index: idx, role, text, element: art });
    });
    return turns;
  }

  const markdowns = Array.from(document.querySelectorAll('.markdown'));
  markdowns.forEach((m, idx) => {
    const text = cleanElementText(m);
    if (text) {
      turns.push({ index: idx, role: 'assistant', text, element: m });
    }
  });

  return turns;
}

async function getLastMessage() {
  const turns = getAllTurns();
  const allImages = await extractAllGeneratedImages();

  if (turns.length === 0) {
    return { role: 'assistant', text: '', images: allImages };
  }

  const assistants = turns.filter(t => t.role === 'assistant');
  const target = assistants.length > 0 ? assistants[assistants.length - 1] : turns[turns.length - 1];

  return {
    role: target.role,
    text: target.text,
    images: allImages
  };
}

// -------------------------------------------------------------
// 4. Detecção de Término
// -------------------------------------------------------------
function waitForGenerationComplete(timeoutMs = 90000) {
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

      const lastMsg = await getLastMessage();
      const currentText = lastMsg.text || '';
      const hasImages = (lastMsg.images || []).length > 0;

      if (currentText && currentText === lastText) {
        stableTicks++;
      } else {
        stableTicks = 0;
        lastText = currentText;
      }

      const isDone = !stopBtn && !isStreaming && (hasSeenStop || stableTicks >= 2 || hasImages);
      const isTimeout = now - startTime > timeoutMs;

      if ((isDone && (currentText.length > 0 || hasImages)) || isTimeout) {
        clearInterval(interval);
        console.log('[ChatGPT Automator] Geração finalizada! Imagens encontradas:', lastMsg.images.length);
        resolve({
          success: true,
          response: currentText || 'Imagem gerada com sucesso!',
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
  if (request.action === 'get_images') {
    extractAllGeneratedImages()
      .then(images => sendResponse({ success: true, images }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'get_last_message') {
    getLastMessage()
      .then(lastMessage => sendResponse({ success: true, lastMessage }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'get_history') {
    const turns = getAllTurns();
    extractAllGeneratedImages().then(images => {
      sendResponse({
        success: true,
        history: turns.map(t => ({ ...t, images }))
      });
    });
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
