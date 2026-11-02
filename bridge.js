const http = require('http');

const PORT = 4321;
let taskQueue = [];
let pendingResolvers = new Map();

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

  // 1. A extensão consulta tarefas pendentes
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

  // 2. A extensão envia a resposta recebida do ChatGPT
  if (url.pathname === '/response' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const resolver = pendingResolvers.get(data.taskId);
        if (resolver) {
          resolver(data);
          pendingResolvers.delete(data.taskId);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 3. O Agente (ou script CLI) envia um prompt para o ChatGPT
  if (url.pathname === '/ask' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

        const task = {
          id: taskId,
          prompt: data.prompt || '',
          files: data.files || []
        };

        // Criar promessa com timeout de 3 minutos
        const promise = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingResolvers.delete(taskId);
            reject(new Error('Tempo esgotado aguardando resposta do ChatGPT (180s)'));
          }, 180000);

          pendingResolvers.set(taskId, (result) => {
            clearTimeout(timer);
            resolve(result);
          });
        });

        // Adicionar na fila para a extensão pegar
        taskQueue.push(task);
        console.log(`[Bridge] Nova tarefa enfileirada: ${taskId} - "${task.prompt.slice(0, 50)}..."`);

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

  // Status
  if (url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      running: true,
      pendingQueue: taskQueue.length,
      waitingResponses: pendingResolvers.size
    }));
    return;
  }

  res.writeHead(404);
  res.end('Endpoint não encontrado');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Bridge] Servidor ativo em http://127.0.0.1:${PORT}`);
  console.log(`[Bridge] Aguardando conexão do Side Panel do ChatGPT...`);
});
