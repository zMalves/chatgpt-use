const http = require('http');
const fs = require('fs');
const path = require('path');

const prompt = process.argv[2];
const filePaths = process.argv.slice(3);

if (!prompt && filePaths.length === 0) {
  console.log('Uso: node ask.js "Sua pergunta para o ChatGPT" [caminho/do/arquivo1 ...]');
  process.exit(1);
}

// Ler arquivos e converter para base64
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
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.py': 'text/x-python'
  };

  return {
    name: path.basename(fullPath),
    type: mimeMap[ext] || 'application/octet-stream',
    size: buffer.length,
    base64: buffer.toString('base64')
  };
});

console.log(`Enviando para o ChatGPT via Side Panel...`);
if (prompt) console.log(`Prompt: "${prompt}"`);
if (filesData.length > 0) console.log(`Arquivos: ${filesData.map(f => f.name).join(', ')}`);

const postData = JSON.stringify({
  prompt: prompt || '',
  files: filesData
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 4321,
  path: '/ask',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (data.success) {
        console.log('\n================ RESPOSTA DO CHATGPT ================');
        console.log(data.response);
        console.log('======================================================\n');
      } else {
        console.error('Erro retornado:', data.error);
      }
    } catch (e) {
      console.log('Resposta bruta:', body);
    }
  });
});

req.on('error', (err) => {
  console.error('Erro de conexão com o Bridge (porta 4321):', err.message);
  console.error('Certifique-se de que o servidor bridge está rodando (node bridge.js).');
});

req.write(postData);
req.end();
