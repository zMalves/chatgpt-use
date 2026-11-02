// ChatGPT Automator - Content Script v1.2.0
console.log('[ChatGPT Automator] Content script carregado no ChatGPT.');

// -------------------------------------------------------------
// 1. Localizadores de Elementos do DOM do ChatGPT
// -------------------------------------------------------------
function getPromptElement() {
  return (
    document.querySelector('#prompt-textarea') ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('textarea')
  );
}

function getSendButton() {
  return (
    document.querySelector('button[data-testid="send-button"]') ||
    document.querySelector('button[aria-label*="Enviar"]') ||
    document.querySelector('button[aria-label*="Send"]')
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
  if (!el) throw new Error('Campo de prompt não encontrado.');

  el.focus();
  if (el.tagName.toLowerCase() === 'textarea') {
    el.value = text;
  } else {
    el.innerText = text;
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

  // Aguardar 1.5s para o ChatGPT renderizar os anexos
  await new Promise(r => setTimeout(r, 1500));
}

// -------------------------------------------------------------
// 2. Extração de Imagens e Conversão para Base64
// -------------------------------------------------------------
async function imageToBase64(imgElement) {
  try {
    // 1. Tentar via Canvas direto
    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth || imgElement.width || 512;
    canvas.height = imgElement.naturalHeight || imgElement.height || 512;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.split(',')[1];
  } catch (canvasErr) {
    // 2. Fallback via fetch da URL da imagem
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
      console.warn('Não foi possível converter imagem para base64:', fetchErr);
      return null;
    }
  }
}

// Extrair imagens geradas (DALL-E ou geradas pela IA) ignorando avatares
async function extractImagesFromElement(rootElement) {
  const imgs = Array.from(rootElement.querySelectorAll('img'));
  const contentImages = [];

  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    // Ignorar avatares pequenos de usuário
    const isAvatar = (
      img.classList.contains('rounded-full') ||
      img.closest('[data-testid="user-avatar"]') ||
      (img.naturalWidth > 0 && img.naturalWidth <= 48 && img.naturalHeight <= 48) ||
      (img.width <= 48 && img.height <= 48)
    );

    if (isAvatar || !img.src) continue;

    // Aguardar imagem carregar caso ainda esteja carregando
    if (!img.complete) {
      await new Promise(res => {
        img.onload = res;
        img.onerror = res;
        setTimeout(res, 3000);
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
// 3. Leitura Completa do Chat & Histórico
// -------------------------------------------------------------
async function parseTurn(turnElement, index) {
  const isUser = !!(
    turnElement.querySelector('[data-message-author-role="user"]') ||
    turnElement.getAttribute('data-testid')?.includes('user') ||
    turnElement.innerText.includes('Você disse:')
  );
  const role = isUser ? 'user' : 'assistant';

  // Conteúdo textual
  const markdownEl = turnElement.querySelector('.markdown') || turnElement;
  const text = markdownEl.innerText.trim();

  // Blocos de código separados
  const codeBlocks = Array.from(turnElement.querySelectorAll('pre code')).map(code => ({
    code: code.innerText,
    language: (code.className.match(/language-(\w+)/) || [])[1] || 'text'
  }));

  // Imagens do turno
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
  const turns = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn"]'));
  const history = [];

  for (let i = 0; i < turns.length; i++) {
    const parsed = await parseTurn(turns[i], i);
    history.push(parsed);
  }

  return history;
}

async function getLastMessage() {
  const turns = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn"]'));
  if (turns.length === 0) {
    // Fallback por seletores alternativos
    const messages = Array.from(document.querySelectorAll('div[data-message-author-role="assistant"]'));
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      const images = await extractImagesFromElement(last);
      return {
        role: 'assistant',
        text: last.innerText.trim(),
        images
      };
    }
    return { role: 'assistant', text: '', images: [] };
  }

  const lastTurn = turns[turns.length - 1];
  return await parseTurn(lastTurn, turns.length - 1);
}

// -------------------------------------------------------------
// 4. Detecção Ultra-Precisa de Conclusão da Mensagem
// -------------------------------------------------------------
function waitForGenerationComplete(timeoutMs = 180000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let hasStarted = false;
    let initialTurnCount = document.querySelectorAll('article[data-testid^="conversation-turn"]').length;
    let lastSeenText = '';
    let stableCount = 0;

    const interval = setInterval(async () => {
      const now = Date.now();
      const stopBtn = getStopButton();
      const sendBtn = getSendButton();
      const isStreaming = !!document.querySelector('.result-streaming');

      // 1. Detectar se a geração começou
      if (!hasStarted) {
        const currentTurnCount = document.querySelectorAll('article[data-testid^="conversation-turn"]').length;
        if (stopBtn || isStreaming || currentTurnCount > initialTurnCount) {
          hasStarted = true;
          console.log('[ChatGPT Automator] Geração iniciada detectada.');
        } else if (now - startTime > 10000) {
          // Se após 10s ainda não viu o stop-button, pode ter sido resposta muito curta
          hasStarted = true;
        }
      }

      // 2. Se a geração já começou, verificar quando termina
      if (hasStarted) {
        // Obter texto atual do último turno
        const turns = document.querySelectorAll('article[data-testid^="conversation-turn"]');
        const currentText = turns.length > 0 ? turns[turns.length - 1].innerText : '';

        // Se stop-button sumiu e não tem streaming
        const isStopGone = !stopBtn && !isStreaming;

        if (currentText === lastSeenText && currentText.length > 0) {
          stableCount++;
        } else {
          stableCount = 0;
          lastSeenText = currentText;
        }

        // Condições para considerar 100% finalizado:
        // A) Botão de parada não existe mais
        // B) O texto estabilizou (não mudou nos últimos 2 ciclos = 1.4s)
        // C) Botão de envio voltou a ficar pronto OU não há bloqueios ativos
        const isStable = stableCount >= 2;
        const isTimeout = now - startTime > timeoutMs;

        if ((isStopGone && isStable) || isTimeout) {
          clearInterval(interval);
          console.log('[ChatGPT Automator] Geração concluída com sucesso!');
          
          // Aguardar 500ms adicionais para qualquer imagem terminar a renderização final
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
  // Ação: Verificar status
  if (request.action === 'check_status') {
    const prompt = getPromptElement();
    const isGenerating = !!getStopButton();
    sendResponse({
      ready: !!prompt,
      isGenerating,
      url: window.location.href,
      title: document.title
    });
    return true;
  }

  // Ação: Ler todo o histórico do chat
  if (request.action === 'get_history') {
    getChatHistory()
      .then(history => sendResponse({ success: true, history }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Ação: Ler a última mensagem do chat
  if (request.action === 'get_last_message') {
    getLastMessage()
      .then(lastMessage => sendResponse({ success: true, lastMessage }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Ação: Extrair todas as imagens da conversa
  if (request.action === 'get_images') {
    extractImagesFromElement(document.body)
      .then(images => sendResponse({ success: true, images }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Ação: Parar geração atual
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

  // Ação: Nova conversa
  if (request.action === 'new_chat') {
    window.location.href = 'https://chatgpt.com/';
    sendResponse({ success: true });
    return true;
  }

  // Ação: Enviar mensagem e aguardar conclusão
  if (request.action === 'send') {
    (async () => {
      try {
        // Se ainda estiver gerando uma mensagem anterior, aguardar ela terminar primeiro
        if (getStopButton()) {
          console.log('[ChatGPT Automator] Uma geração já está em andamento. Aguardando...');
          await waitForGenerationComplete(60000);
          await new Promise(r => setTimeout(r, 1000));
        }

        // 1. Upload de arquivos se houver
        if (request.files && request.files.length > 0) {
          await attachFiles(request.files);
        }

        // 2. Preencher prompt
        if (request.text) {
          setPromptText(request.text);
        }

        await new Promise(r => setTimeout(r, 600));

        // 3. Clicar em enviar
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
            throw new Error('Botão de envio desabilitado e campo inacessível.');
          }
        } else {
          sendBtn.click();
        }

        // 4. Aguardar com alta precisão o término da resposta
        const result = await waitForGenerationComplete(180000);
        sendResponse(result);

      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }
});
