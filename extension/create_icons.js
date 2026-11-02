const fs = require('fs');
const path = require('path');

// Um PNG 1x1 transparente ou gerador de ícone básico
// Criando ícones simples válidos em PNG (32x32 verde ChatGPT)
const iconDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconDir)) {
  fs.mkdirSync(iconDir, { recursive: true });
}

// 1x1 green pixel base64 expandido como PNG válido para placeholder
const greenPixelBase64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PMQEAAAgEID/517GE52EBSyB1qu+lAwAAAAAAAAAAAAAAAADAfgH41lMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgbYlMAAV1W26EAAAAASUVORK5CYII=";
const buffer = Buffer.from(greenPixelBase64, 'base64');

fs.writeFileSync(path.join(iconDir, 'icon16.png'), buffer);
fs.writeFileSync(path.join(iconDir, 'icon48.png'), buffer);
fs.writeFileSync(path.join(iconDir, 'icon128.png'), buffer);

console.log('Ícones criados em:', iconDir);

