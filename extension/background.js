// Background Service Worker

// Ao clicar no ícone da extensão, abre diretamente o painel lateral (Side Panel)
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Erro ao configurar Side Panel:', error));

chrome.runtime.onInstalled.addListener(() => {
  console.log('[ChatGPT Automator] Extensão instalada com suporte a Side Panel!');
});
