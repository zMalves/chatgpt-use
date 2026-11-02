// ChatGPT Automator - Content Script v1.7.0
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
// 2. Extração Precisa de Imagens
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

async function extractImagesFromContainer(container) {
  const imgs = Array.from(container.querySelectorAll('img'));
  const contentImages = [];

  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];

    // Ignorar avatares
    const isAvatar = (
      img.classList.contains('rounded-full') ||
      img.closest('[data-testid="user-avatar"]') ||
      img.closest('button[data-testid="profile-button"]') ||
      (img.naturalWidth > 0 && img.naturalWidth <= 50 && img.naturalHeight <= 50) ||
      (img.width <= 50 && img.height <= 50)
    );

    if (isAvatar || !img.src) continue;

    const isGenerated = (
      img.src.includes('oaiusercontent.com') ||
      img.src.startsWith('blob:') ||
      img.naturalWidth > 150 ||
      img.width > 150 ||
      img.closest('[data-testid*="image"]') ||
      img.parentElement?.querySelector('button')
    );

    if (!isGenerated) continue;

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

function getAllGeneratedImageElements() {
  const imgs = Array.from(document.querySelectorAll('img'));
  return imgs.filter(img => {
    const isAvatar = (
      img.classList.contains('rounded-full') ||
      img.closest('[data-testid="user-avatar"]') ||
      (img.naturalWidth > 0 && img.naturalWidth <= 50)
    );
    return !isAvatar && (
      img.src.includes('oaiusercontent.com') ||
      img.src.startsWith('blob:') ||
      img.naturalWidth > 150 ||
      img.width > 150
    );
  });
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

function getAllTurnContainers() {
  const articles = Array.from(document.querySelectorAll('article'));
  if (articles.length > 0) return articles;

  const markdowns = Array.from(document.querySelectorAll('.markdown'));
  if (markdowns.length > 0) return markdowns;

  return [];
}

async function getLastTurn() {
  const containers = getAllTurnContainers();
  if (containers.length === 0) {
    const allImgs = await extractImagesFromContainer(document.body);
    return {
      text: '',
      images: allImgs.slice(-1), // apenas a mais recente se não houver contêiner
      element: null
    };
  }

  const lastContainer = containers[containers.length - 1];
  const text = cleanElementText(lastContainer);
  const images = await extractImagesFromContainer(lastContainer);

  return {
    text,
    images,
    element: lastContainer
  };
}

// -------------------------------------------------------------
// 4. Detecção Precisa de Término (Novo Turno / Nova Imagem)
// -------------------------------------------------------------
function waitForGenerationComplete(preExistingImgUrls = new Set(), timeoutMs = 90000) {
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

      // 1. Verificar imagens no último turno
      const lastTurn = await getLastTurn();
      const currentText = lastTurn.text || '';

      // 2. Verificar se surgiu alguma NOVA imagem na página
      const allCurrentImgs = getAllGeneratedImageElements();
      const newImgs = allCurrentImgs.filter(img => !preExistingImgUrls.has(img.src));

      let newlyGeneratedImages = [];
      if (newImgs.length > 0) {
        // Encontrou nova imagem gerada nesta mensagem!
        const lastNewImg = newImgs[newImgs.length - 1];
        if (lastNewImg.complete) {
          const extracted = await extractImagesFromContainer(lastNewImg.parentElement || document.body);
          newlyGeneratedImages = extracted.filter(img => !preExistingImgUrls.has(img.url));
        }
      }

      if (currentText && currentText === lastText) {
        stableTicks++;
      } else {
        stableTicks = 0;
        lastText = currentText;
      }

      const hasNewImageReady = newlyGeneratedImages.length > 0;
      const isTextDone = !stopBtn && !isStreaming && (hasSeenStop || stableTicks >= 2);
      const isTimeout = now - startTime > timeoutMs;

      if ((hasNewImageReady && !stopBtn) || (isTextDone && currentText.length > 0) || isTimeout) {
        clearInterval(interval);
        console.log('[ChatGPT Automator] Geração finalizada! Novas imagens:', newlyGeneratedImages.length);

        resolve({
          success: true,
          response: currentText || 'Imagem gerada com sucesso!',
          images: hasNewImageReady ? newlyGeneratedImages : lastTurn.images
        });
      }
    }, 600);
  });
}

// -------------------------------------------------------------
// 5. Listener de Mensagens
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_images') {
    extractImagesFromContainer(document.body)
      .then(images => sendResponse({ success: true, images }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'get_last_message') {
    getLastTurn()
      .then(last => sendResponse({ success: true, lastMessage: { role: 'assistant', text: last.text, images: last.images } }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'get_history') {
    const containers = getAllTurnContainers();
    Promise.all(containers.map(async (c, idx) => ({
      index: idx,
      role: 'assistant',
      text: cleanElementText(c),
      images: await extractImagesFromContainer(c)
    }))).then(history => sendResponse({ success: true, history }));
    return true;
  }

  if (request.action === 'send') {
    (async () => {
      try {
        // Mapear imagens existentes ANTES de enviar o novo prompt
        const existingImgs = getAllGeneratedImageElements();
        const preExistingImgUrls = new Set(existingImgs.map(i => i.src));

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
        // Passa o conjunto de URLs anteriores para filtrar APENAS a imagem recém-gerada
        const result = await waitForGenerationComplete(preExistingImgUrls, 90000);
        sendResponse(result);

      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }
});
