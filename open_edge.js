const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const userDataDir = path.join(__dirname, 'browser_data');
  console.log('Iniciando o Microsoft Edge com perfil persistente em:', userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: false,
    viewport: null, // usa tamanho natural da janela
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled' // reduz detecção de bot
    ]
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  
  console.log('Navegando para o ChatGPT...');
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded' });
  console.log('Página carregada! Aguardando o login do usuário...');

  // Manter o navegador ativo para interação
  // Podemos escutar requisições ou aguardar o usuário logar
  setInterval(async () => {
    try {
      const url = page.url();
      const title = await page.title();
      // heartbeat simples
    } catch (e) {
      // janela fechada
      process.exit(0);
    }
  }, 5000);
}

main().catch(console.error);

