const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const qrcode = require('qrcode-terminal');

const PORT = 8000;
let globalTunnelUrl = '';

// Mime types helper for static server
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf'
};

// Create a simple static server
const server = http.createServer((req, res) => {
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(req.url);
  } catch (e) {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  if (req.url.startsWith('/api/cuepoints')) {
    const searchParams = new URL(req.url, 'http://localhost').searchParams;
    const video = searchParams.get('video') || 'default';
    const safeVideoName = encodeURIComponent(path.basename(video));
    const cpFile = path.join(__dirname, 'cuepoints_' + safeVideoName + '.json');

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        fs.writeFile(cpFile, body, err => {
          res.writeHead(err ? 500 : 200);
          res.end(err ? 'Error' : 'OK');
        });
      });
    } else {
      fs.readFile(cpFile, (err, content) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(err ? '[]' : content);
      });
    }
    return;
  }

  if (decodedUrl === '/tunnel.txt') {
    res.statusCode = 200;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(globalTunnelUrl || '');
    return;
  }

  let filePath = path.join(__dirname, decodedUrl === '/' ? 'index.html' : decodedUrl);

  if (!filePath.startsWith(__dirname)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.statusCode = 404;
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Fichier non trouvé');
      } else {
        res.statusCode = 500;
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Erreur interne du serveur');
      }
    } else {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

let sshTunnelProcess = null;

// Start the server
server.listen(PORT, () => {
  console.clear();
  console.log('====================================================');
  console.log('  Serveur Local & Tunnel HTTPS démarré avec succès');
  console.log('====================================================\n');
  console.log(`💻 Local URL : http://localhost:${PORT}`);
  console.log('🔄 Connexion au tunnel sécurisé (pinggy.io)...');

  // Spawn SSH reverse tunnel to pinggy.io
  sshTunnelProcess = spawn('ssh', [
    '-p', '443',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-R', `0:localhost:${PORT}`,
    'a.pinggy.io'
  ]);

  let qrGenerated = false;

  sshTunnelProcess.stdout.on('data', (data) => {
    const output = data.toString();
    
    // Look for the HTTPS URL in the pinggy.io output
    const match = output.match(/https:\/\/[a-zA-Z0-9-.]+\.pinggy-free\.link/);
    if (match && !qrGenerated) {
      qrGenerated = true;
      const url = match[0];
      globalTunnelUrl = url;

      console.log(`\n🔑 Secure Tunnel URL (HTTPS) : ${url}`);
      console.log('\n📲 Scannez le QR Code ci-dessous avec votre Pixel 4 :');
      
      // Print QR code in terminal
      qrcode.generate(url, { small: true });

      console.log('\n💡 Le gyroscope nécessite une connexion HTTPS.');
      console.log('Appuyez sur Ctrl+C pour arrêter le serveur et fermer le tunnel.\n');
    }
  });

  sshTunnelProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    // Log connection issues if any
    if (msg.includes('Permission denied') || msg.includes('port forwarding failed')) {
      console.error('\n❌ Erreur SSH Tunnel :', msg.trim());
    }
  });

  sshTunnelProcess.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`\n⚠️ Le tunnel s'est arrêté avec le code ${code}.`);
    }
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nArrêt du serveur et du tunnel...');
  if (sshTunnelProcess) {
    sshTunnelProcess.kill('SIGINT');
  }
  server.close(() => {
    console.log('Serveur arrêté.');
    process.exit(0);
  });
});
