const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
Uso do ChatGPT Assistant CLI:
  
  1. Pergunta única:
     node ask.js "Sua pergunta para o ChatGPT" [arquivo1.pdf ...]
  
  2. Lote sequencial (ex: 10 mensagens):
     node ask.js --batch "Pergunta 1" "Pergunta 2" "Pergunta 3" ...
     node ask.js --batch arquivo_com_perguntas.txt
  
  3. Ler histórico completo do chat atual:
     node ask.js --history
  
  4. Ler a última resposta do chat:
     node ask.js --last
`);
  process.exit(0);
}

function makeRequest(pathName, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4321,
      path: pathName,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Erro de conexão com o Bridge (porta 4321): ${err.message}`));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  try {
    // Comando: Ler histórico
    if (args[0] === '--history') {
      console.log('Lendo histórico da conversa no ChatGPT...');
      const res = await makeRequest('/history', 'GET');
      if (res.success) {
        console.log(`\n=== Histórico (${res.history.length} turnos) ===`);
        res.history.forEach(turn => {
          console.log(`\n[${turn.role.toUpperCase()} - Turno #${turn.index + 1}]:`);
          console.log(turn.text);
          if (turn.images && turn.images.length > 0) {
            console.log(`🖼️ Imagens: ${turn.images.length}`);
          }
        });
      } else {
        console.error('Erro:', res.error);
      }
      return;
    }

    // Comando: Abrir novo chat
    if (args[0] === '--new' || args[0] === '--reset') {
      console.log('Solicitando abertura de novo chat no ChatGPT...');
      const res = await makeRequest('/new-chat', 'POST', {});
      console.log(res.message || 'Novo chat iniciado.');
      return;
    }

    // Comando: Ler última mensagem
    if (args[0] === '--last') {
      console.log('Lendo última mensagem do ChatGPT...');
      const res = await makeRequest('/last-message', 'GET');
      if (res.success && res.lastMessage) {
        console.log(`\n=== Última Mensagem (${res.lastMessage.role}) ===`);
        console.log(res.lastMessage.text);
      } else {
        console.error('Erro:', res.error);
      }
      return;
    }

    // Comando: Lote sequencial (--batch)
    if (args[0] === '--batch') {
      let prompts = [];
      const batchArgs = args.slice(1);

      if (batchArgs.length === 1 && fs.existsSync(batchArgs[0])) {
        // Ler do arquivo de texto
        const content = fs.readFileSync(batchArgs[0], 'utf-8');
        prompts = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      } else {
        prompts = batchArgs;
      }

      if (prompts.length === 0) {
        console.error('Nenhum prompt fornecido para o lote.');
        return;
      }

      console.log(`🚀 Iniciando lote sequencial de ${prompts.length} mensagens no ChatGPT...`);
      console.log(`Cada mensagem será aguardada até ser 100% concluída antes da próxima.\n`);

      const res = await makeRequest('/batch', 'POST', { prompts });
      if (res.results) {
        console.log(`\n🎉 Lote de ${res.total} mensagens finalizado!`);
        res.results.forEach(r => {
          console.log(`\n--------------------------------------------------`);
          console.log(`Etapa ${r.step}: "${r.prompt}"`);
          if (r.success) {
            console.log(`Status: Concluído com sucesso`);
            console.log(`Resposta:\n${r.response.slice(0, 200)}...`);
            if (r.savedImages && r.savedImages.length > 0) {
              console.log(`🖼️ Imagens salvas em: ${r.savedImages.join(', ')}`);
            }
          } else {
            console.log(`Status: Falha - ${r.error}`);
          }
        });
      }
      return;
    }

    // Comando padrão: Pergunta única (com suporte a arquivos)
    const prompt = args[0];
    const filePaths = args.slice(1);

    const filesData = filePaths.map(filePath => {
      const fullPath = path.resolve(filePath);
      if (!fs.existsSync(fullPath)) {
        console.error(`Arquivo não encontrado: ${fullPath}`);
        process.exit(1);
      }
      const buffer = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const mimeMap = {
        '.txt': 'text/plain',
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.csv': 'text/csv',
        '.json': 'application/json'
      };

      return {
        name: path.basename(fullPath),
        type: mimeMap[ext] || 'application/octet-stream',
        size: buffer.length,
        base64: buffer.toString('base64')
      };
    });

    console.log(`Enviando para o ChatGPT...`);
    console.log(`Prompt: "${prompt}"`);
    if (filesData.length > 0) console.log(`Arquivos: ${filesData.map(f => f.name).join(', ')}`);

    const res = await makeRequest('/ask', 'POST', {
      prompt,
      files: filesData
    });

    if (res.success) {
      console.log('\n================ RESPOSTA DO CHATGPT ================');
      console.log(res.response);
      console.log('======================================================\n');
      if (res.savedImagePaths && res.savedImagePaths.length > 0) {
        console.log(`🖼️ Imagens salvas automaticamente:`);
        res.savedImagePaths.forEach(p => console.log(`  - ${p}`));
      }
    } else {
      console.error('Erro retornado:', res.error);
    }

  } catch (err) {
    console.error('Erro na execução:', err.message);
  }
}

main();
