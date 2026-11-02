// ChatGPT Automator - Content Script v1.5.0
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
// 3. Extração Precisa de Texto das Mensagens
// -------------------------------------------------------------
function cleanElementText(element) {
  if (!element) return '';

  // 1. Tentar elementos específicos de markdown / texto
  const textContainer = (
    element.querySelector('.markdown') ||
    element.querySelector('[data-message-author-role]') ||
    element.querySelector('.whitespace-pre-wrap') ||
    element
  );

  let text = textContainer.innerText || textContainer.textContent || '';
  
  // Limpar botões de rodapé comuns (Copiar, Regenerar, etc.)
  text = text.replace(/^(Você disse|ChatGPT disse|ChatGPT):\s*/i, '');
  return text.trim();
}

function getAllTurns() {
  const turns = [];

  // 1. Abordagem principal: data-message-author-role
  const roleElements = Array.from(document.querySelectorAll('[data-message-author-role]'));
  if (roleElements.length > 0) {
    roleElements.forEach((el, idx) => {
      const role = el.getAttribute('data-message-author-role') || 'assistant';
      const text = cleanElementText(el);
      if (text) {
        turns.push({ index: idx, role, text, element: el });
      }
    });
    if (turns.length > 0) return turns;
  }

  // 2. Abordagem por artigos de conversa
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
      if (text) {
        turns.push({ index: idx, role, text, element: art });
      }
    });
    if (turns.length > 0) return turns;
  }

  // 3. Abordagem por blocos de markdown
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
  if (turns.length === 0) {
    // Última tentativa: buscar todo texto dentro de main ignorando cabeçalhos e prompt
    const main = document.querySelector('main');
    if (main) {
      const paragraphs = Array.from(main.querySelectorAll('p, li, pre'));
      const validText = paragraphs.map(p => p.innerText.trim()).filter(t => t.length > 0).join('\n');
      if (validText) {
        return { role: 'assistant', text: validText, images: [] };
      }
    }
    return { role: 'assistant', text: '', images: [] };
  }

  const assistants = turns.filter(t => t.role === 'assistant');
  const target = assistants.length > 0 ? assistants[assistants.length - 1] : turns[turns.length - 1];

  const images = target.element ? await extractImagesFromElement(target.element) : [];
  return {
    role: target.role,
    text: target.text,
    images
  };
}

async function getChatHistory() {
  const turns = getAllTurns();
  const history = [];

  for (const t of turns) {
    const images = t.element ? await extractImagesFromElement(t.element) : [];
    history.push({
      index: t.index,
      role: t.role,
      text: t.text,
      images
    });
  }

  return history;
}

// -------------------------------------------------------------
// 4. Detecção Rápida de Conclusão da Mensagem
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

      if (currentText && currentText === lastText) {
        stableTicks++;
      } else {
        stableTicks = 0;
        lastText = currentText;
      }

      // Finalizado quando o stop sumir e o texto estiver estável
      const isDone = !stopBtn && !isStreaming && (hasSeenStop || stableTicks >= 2);
      const isTimeout = now - startTime > timeoutMs;

      if ((isDone && currentText.length > 0) || isTimeout) {
        clearInterval(interval);
        console.log('[ChatGPT Automator] Resposta final capturada:', currentText);
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
    const turns = getAllTurns();
    sendResponse({
      ready: !!prompt,
      isGenerating,
      turnsCount: turns.length,
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
