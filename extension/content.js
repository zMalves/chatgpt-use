// ChatGPT Automator - Content Script
console.log('[ChatGPT Automator] Content script carregado na página do ChatGPT.');

// Função auxiliar para aguardar elementos
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

// Obter campo de prompt
function getPromptElement() {
  return (
    document.querySelector('#prompt-textarea') ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('textarea')
  );
}

// Obter o botão de envio
function getSendButton() {
  return (
    document.querySelector('button[data-testid="send-button"]') ||
    document.querySelector('button[aria-label*="Enviar"]') ||
    document.querySelector('button[aria-label*="Send"]')
  );
}

// Inserir texto no campo do ChatGPT simulando digitação real
function setPromptText(text) {
  const el = getPromptElement();
  if (!el) throw new Error('Campo de prompt não encontrado.');

  el.focus();

  if (el.tagName.toLowerCase() === 'textarea') {
    el.value = text;
  } else {
    // Para contenteditable / div rica
    el.innerText = text;
  }

  // Disparar eventos para o React reconhecer o texto
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Anexar arquivos diretamente no ChatGPT
async function attachFiles(filesData) {
  if (!filesData || filesData.length === 0) return;

  const fileInput = document.querySelector('input[type="file"]');
  if (!fileInput) {
    throw new Error('Campo de upload de arquivo (input[type="file"]) não encontrado.');
  }

  const dt = new DataTransfer();

  for (const fileItem of filesData) {
    // Converter base64 de volta para Blob / File
    const byteCharacters = atob(fileItem.base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: fileItem.type || 'application/octet-stream' });
    const file = new File([blob], fileItem.name, { type: fileItem.type });
    dt.items.add(file);
  }

  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));

  // Aguardar um momento para o ChatGPT processar os arquivos na barra de mensagens
  await new Promise(r => setTimeout(r, 1500));
}

// Obter a última resposta gerada pelo assistente
function getLastAssistantResponse() {
  // Tentar encontrar pelos artigos de conversa
  const articles = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn"]'));
  if (articles.length > 0) {
    const lastArticle = articles[articles.length - 1];
    // Pegar o conteúdo markdown dentro do artigo
    const markdown = lastArticle.querySelector('.markdown') || lastArticle;
    return markdown.innerText.trim();
  }

  // Fallback por atributo de papel
  const messages = Array.from(document.querySelectorAll('div[data-message-author-role="assistant"]'));
  if (messages.length > 0) {
    return messages[messages.length - 1].innerText.trim();
  }

  return 'Resposta concluída, mas o texto não pôde ser extraído automaticamente.';
}

// Ouvir mensagens enviadas pelo popup da extensão
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'check_status') {
    const prompt = getPromptElement();
    sendResponse({
      ready: !!prompt,
      url: window.location.href,
      title: document.title
    });
    return true;
  }

  if (request.action === 'stop_generating') {
    const stopBtn = document.querySelector('button[data-testid="stop-button"]');
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
        // 1. Anexar arquivos se houver
        if (request.files && request.files.length > 0) {
          await attachFiles(request.files);
        }

        // 2. Preencher texto
        if (request.text) {
          setPromptText(request.text);
        }

        await new Promise(r => setTimeout(r, 600));

        // 3. Clicar em enviar
        const sendBtn = getSendButton();
        if (!sendBtn || sendBtn.disabled) {
          // Tentar enviar via evento de tecla Enter se o botão não estiver ativo
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

        // 4. Aguardar o término da resposta
        // Primeiro espera aparecer o stop button ou espera 2 segundos
        await new Promise(r => setTimeout(r, 1500));

        const maxWaitTime = 180000; // 3 minutos máximo
        const startTime = Date.now();

        const checkCompletion = setInterval(() => {
          const stopBtn = document.querySelector('button[data-testid="stop-button"]');
          const isDone = !stopBtn || (Date.now() - startTime > maxWaitTime);

          if (isDone) {
            clearInterval(checkCompletion);
            const responseText = getLastAssistantResponse();
            sendResponse({ success: true, response: responseText });
          }
        }, 1000);

      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true; // Mantém a conexão aberta para resposta assíncrona
  }
});

