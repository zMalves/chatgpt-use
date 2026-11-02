const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 3333;
const userDataDir = path.join(__dirname, 'browser_data');

let browserContext = null;
let activePage = null;

async function initBrowser() {
  console.log('Iniciando o Microsoft Edge...');
  browserContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: false,
    viewport: null,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const pages = browserContext.pages();
  activePage = pages.length > 0 ? pages[0] : await browserContext.newPage();

  console.log('Navegando para o ChatGPT...');
  await activePage.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
  console.log('Edge pronto! Acesse http://127.0.0.1:' + PORT + ' para controlar.');
}

// Helpers para interagir com o ChatGPT
async function checkStatus() {
  if (!activePage) return { error: 'Navegador não inicializado' };
  const url = activePage.url();
  const title = await activePage.title();

  const isLoginPage = await activePage.evaluate(() => {
    const text = document.body ? document.body.innerText : '';
    const hasLoginButton = !!document.querySelector('button[data-testid="login-button"], a[href*="login"]');
    return hasLoginButton || text.includes('Log in') || text.includes('Entrar');
  });

  const hasPromptTextarea = await activePage.evaluate(() => {
    return !!(
      document.querySelector('#prompt-textarea') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea')
    );
  });

  return {
    url,
    title,
    isLoggedIn: hasPromptTextarea,
    isLoginPage: !hasPromptTextarea && isLoginPage,
    readyForInput: hasPromptTextarea
  };
}

async function listActions() {
  if (!activePage) return { error: 'Navegador não inicializado' };

  return await activePage.evaluate(() => {
    const actions = [];

    // 1. Procurar campo de prompt
    const textarea = document.querySelector('#prompt-textarea, div[contenteditable="true"]');
    if (textarea) {
      actions.push({
        type: 'input',
        name: 'Campo de Mensagem (Prompt)',
        selector: textarea.id ? `#${textarea.id}` : 'div[contenteditable="true"]',
        tag: textarea.tagName,
        placeholder: textarea.getAttribute('placeholder') || textarea.getAttribute('data-placeholder') || ''
      });
    }

    // 2. Procurar inputs de arquivo
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    fileInputs.forEach((input, i) => {
      actions.push({
        type: 'file_upload',
        name: `Upload de Arquivo (${input.getAttribute('accept') || 'todos'})`,
        selector: `input[type="file"]:nth-of-type(${i + 1})`,
        accept: input.getAttribute('accept') || '*/*'
      });
    });

    // 3. Procurar botões relevantes com data-testid ou aria-label
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    buttons.forEach(btn => {
      const testId = btn.getAttribute('data-testid');
      const ariaLabel = btn.getAttribute('aria-label');
      const text = btn.innerText ? btn.innerText.trim().replace(/\s+/g, ' ') : '';

      if (testId || ariaLabel || (text && text.length < 30)) {
        actions.push({
          type: 'button',
          testId: testId || null,
          ariaLabel: ariaLabel || null,
          text: text || null,
          disabled: btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true'
        });
      }
    });

    return {
      totalFound: actions.length,
      actions
    };
  });
}

async function sendMessage(message, files = []) {
  if (!activePage) return { error: 'Navegador não inicializado' };

  // 1. Upload de arquivos se fornecidos
  if (files && files.length > 0) {
    const fileInput = await activePage.$('input[type="file"]');
    if (fileInput) {
      await fileInput.setInputFiles(files);
      // Aguardar upload inicial
      await activePage.waitForTimeout(2000);
    } else {
      console.warn('Campo de upload de arquivo não encontrado.');
    }
  }

  // 2. Localizar campo de prompt
  const promptLocator = activePage.locator('#prompt-textarea, div[contenteditable="true"]').first();
  await promptLocator.waitFor({ state: 'visible', timeout: 10000 });
  await promptLocator.click();

  // Digitar mensagem
  await promptLocator.fill('');
  await activePage.evaluate((text) => {
    const el = document.querySelector('#prompt-textarea, div[contenteditable="true"]');
    if (el) {
      if (el.tagName.toLowerCase() === 'textarea') {
        el.value = text;
      } else {
        el.innerText = text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, message);

  await activePage.waitForTimeout(500);

  // 3. Clicar no botão de envio
  const sendButton = activePage.locator('button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="Enviar"]').first();
  await sendButton.click();

  // 4. Aguardar o término da geração (aparece stop-button e depois desaparece)
  try {
    const stopButton = activePage.locator('button[data-testid="stop-button"]');
    await stopButton.waitFor({ state: 'visible', timeout: 5000 });
    // Aguarda o stop button sumir (resposta completa)
    await stopButton.waitFor({ state: 'detached', timeout: 120000 });
  } catch (e) {
    // Caso a resposta tenha sido instantânea ou o seletor mude
    await activePage.waitForTimeout(3000);
  }

  // 5. Obter a última mensagem do assistente
  const lastResponse = await activePage.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn"]'));
    if (articles.length > 0) {
      const lastArticle = articles[articles.length - 1];
      return lastArticle.innerText;
    }
    const messages = Array.from(document.querySelectorAll('div[data-message-author-role="assistant"]'));
    if (messages.length > 0) {
      return messages[messages.length - 1].innerText;
    }
    return 'Resposta gerada, verifique a janela do navegador.';
  });

  return { success: true, response: lastResponse };
}

// Servidor HTTP Local para controle
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (url.pathname === '/status') {
      const status = await checkStatus();
      res.writeHead(200);
      res.end(JSON.stringify(status, null, 2));
    } else if (url.pathname === '/actions') {
      const actions = await listActions();
      res.writeHead(200);
      res.end(JSON.stringify(actions, null, 2));
    } else if (url.pathname === '/send' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const data = JSON.parse(body || '{}');
        const result = await sendMessage(data.message, data.files);
        res.writeHead(200);
        res.end(JSON.stringify(result, null, 2));
      });
    } else if (url.pathname === '/eval' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const data = JSON.parse(body || '{}');
        const result = await activePage.evaluate(data.script);
        res.writeHead(200);
        res.end(JSON.stringify({ result }, null, 2));
      });
    } else if (url.pathname === '/screenshot') {
      const screenshotPath = path.join(__dirname, 'screenshot.png');
      await activePage.screenshot({ path: screenshotPath });
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, path: screenshotPath }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Endpoint não encontrado' }));
    }
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, async () => {
  console.log(`Servidor de automação ativo na porta ${PORT}`);
  try {
    await initBrowser();
  } catch (e) {
    console.error('Erro ao iniciar o Edge:', e);
  }
});

