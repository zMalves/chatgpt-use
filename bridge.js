const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4321;
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

let taskQueue = [];
let pendingResolvers = new Map();

// Salvar imagens base64 recebidas do ChatGPT
function saveReceivedImages(images) {
  if (!images || images.length === 0) return [];
  const savedPaths = [];

  for (const img of images) {
    if (!img.base64) continue;
    try {
      const filename = img.name || `chatgpt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}.png`;
      const filePath = path.join(DOWNLOADS_DIR, filename);
      const buffer = Buffer.from(img.base64, 'base64');
      fs.writeFileSync(filePath, buffer);
      savedPaths.push(filePath);
      console.log(`[Bridge] 🖼️ Imagem salva com sucesso: ${filePath} (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.error('[Bridge] Erro ao salvar imagem:', e.message);
    }
  }

  return savedPaths;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // 1. A extensão consulta a próxima tarefa da fila sequencial
  if (url.pathname === '/tasks' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    if (taskQueue.length > 0) {
      const task = taskQueue.shift();
      res.writeHead(200);
      res.end(JSON.stringify({ task }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ task: null }));
    }
    return;
  }

  // 2. A extensão envia a resposta (texto, imagens e status) de uma tarefa concluída
  if (url.pathname === '/response' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        
        // Salvar imagens em disco se houver
        if (data.images && data.images.length > 0) {
          data.savedImagePaths = saveReceivedImages(data.images);
        }

        const resolver = pendingResolvers.get(data.taskId);
        if (resolver) {
          resolver(data);
          pendingResolvers.delete(data.taskId);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, savedImages: (data.savedImagePaths || []).length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 3. Enviar mensagem única para o ChatGPT
  if (url.pathname === '/ask' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

        const task = {
          id: taskId,
          type: 'send',
          prompt: data.prompt || '',
          files: data.files || []
        };

        const promise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingResolvers.delete(taskId);
            reject(new Error('Tempo limite esgotado aguardando resposta do ChatGPT (360s)'));
          }, 360000);

          pendingResolvers.set(taskId, (result) => {
            clearTimeout(timer);
            resolve(result);
          });
        });

        taskQueue.push(task);
        console.log(`[Bridge] Tarefa enfileirada: ${taskId} | "${(task.prompt || '').slice(0, 50)}..."`);

        promise
          .then(result => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result, null, 2));
          })
          .catch(err => {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          });

      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 4. Enviar lote de mensagens sequenciais (ex: 10 mensagens)
  if (url.pathname === '/batch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const prompts = data.prompts || [];

        if (!Array.isArray(prompts) || prompts.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Array "prompts" é obrigatório' }));
          return;
        }

        console.log(`[Bridge] 📋 Iniciando lote sequencial de ${prompts.length} mensagens...`);
        const results = [];

        for (let i = 0; i < prompts.length; i++) {
          const item = typeof prompts[i] === 'string' ? { prompt: prompts[i] } : prompts[i];
          const taskId = `batch_${Date.now()}_step_${i + 1}`;

          const task = {
            id: taskId,
            type: 'send',
            prompt: item.prompt,
            files: item.files || [],
            batchIndex: i + 1,
            batchTotal: prompts.length
          };

          const promise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pendingResolvers.delete(taskId);
              reject(new Error(`Timeout na mensagem ${i + 1}/${prompts.length} (360s)`));
            }, 360000);

            pendingResolvers.set(taskId, (res) => {
              clearTimeout(timer);
              resolve(res);
            });
          });

          taskQueue.push(task);
          console.log(`[Bridge] Enviando [${i + 1}/${prompts.length}]: "${item.prompt.slice(0, 40)}..."`);

          try {
            const stepResult = await promise;
            results.push({
              step: i + 1,
              prompt: item.prompt,
              success: stepResult.success,
              response: stepResult.response,
              savedImages: stepResult.savedImagePaths || []
            });
            console.log(`[Bridge] ✅ Mensagem ${i + 1}/${prompts.length} concluída!`);
          } catch (stepErr) {
            results.push({
              step: i + 1,
              prompt: item.prompt,
              success: false,
              error: stepErr.message
            });
            console.error(`[Bridge] ❌ Erro na mensagem ${i + 1}:`, stepErr.message);
          }

          // Pausa de 1.5s entre mensagens para estabilidade da interface
          await new Promise(r => setTimeout(r, 1500));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total: prompts.length, results }, null, 2));

      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 5. Ler histórico completo do chat
  if (url.pathname === '/history' && req.method === 'GET') {
    const taskId = 'history_' + Date.now();
    const task = { id: taskId, type: 'get_history' };

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingResolvers.delete(taskId);
        reject(new Error('Timeout ao ler histórico do chat'));
      }, 30000);

      pendingResolvers.set(taskId, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });

    taskQueue.push(task);

    promise
      .then(result => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
      })
      .catch(err => {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
    return;
  }

  // 6. Ler a última mensagem do chat
  if (url.pathname === '/last-message' && req.method === 'GET') {
    const taskId = 'lastmsg_' + Date.now();
    const task = { id: taskId, type: 'get_last_message' };

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingResolvers.delete(taskId);
        reject(new Error('Timeout ao ler última mensagem'));
      }, 30000);

      pendingResolvers.set(taskId, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });

    taskQueue.push(task);

    promise
      .then(result => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
      })
      .catch(err => {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
    return;
  }

  // Status
  if (url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      running: true,
      pendingQueue: taskQueue.length,
      waitingResponses: pendingResolvers.size,
      downloadsDirectory: DOWNLOADS_DIR
    }));
    return;
  }

  res.writeHead(404);
  res.end('Endpoint não encontrado');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Bridge] Servidor ativo em http://127.0.0.1:${PORT}`);
  console.log(`[Bridge] Imagens serão salvas em: ${DOWNLOADS_DIR}`);
});
