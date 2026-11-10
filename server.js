const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { spawn, exec } = require('child_process');

const crypto = require('crypto');
const drive = require('./drive');

const app = express();
const PORT = process.env.PORT || 4321;

// Carpetas de almacenamiento
const STORAGE_DIR = path.resolve(__dirname, 'Archivos_Recibidos');
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[m]));
}

function resolveSafeStoragePath(rawName) {
  const safeName = path.basename(String(rawName || '')).replace(/[\x00-\x1f]/g, '').trim();
  if (!safeName || safeName === '.' || safeName === '..') return null;
  const resolved = path.resolve(STORAGE_DIR, safeName);
  if (!resolved.startsWith(STORAGE_DIR + path.sep)) return null;
  return { safeName, filePath: resolved };
}

function isLocalRequest(req) {
  // Bloquear si viene a través de un túnel/proxy externo como Cloudflare
  if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) return false;
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function requireLocalRequest(req, res, next) {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Acción permitida solo desde la laptop local' });
  }
  next();
}

// Configuración de Multer para guardar archivos con su nombre original (sanitizado)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_DIR);
  },
  filename: (req, file, cb) => {
    // Decodificar el nombre de archivo en UTF-8 y evitar path traversal
    const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safeBase = path.basename(decoded).replace(/[\x00-\x1f]/g, '').trim() || `archivo_${Date.now()}`;
    const ext = path.extname(safeBase);
    const baseName = path.basename(safeBase, ext);

    let targetName = safeBase;
    let counter = 1;
    while (fs.existsSync(path.join(STORAGE_DIR, targetName))) {
      targetName = `${baseName} (${counter})${ext}`;
      counter++;
    }
    cb(null, targetName);
  }
});

// Aumentar límites para soportar archivos pesados (hasta 10 GB)
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/files-data', express.static(STORAGE_DIR));

// Archivo de almacenamiento de mensajes de texto y notas
const MESSAGES_FILE = path.join(__dirname, 'mensajes.json');

function getStoredMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error leyendo mensajes:', err);
  }
  return [];
}

function saveStoredMessages(messages) {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2), 'utf8');
  } catch (err) {
    console.error('Error guardando mensajes:', err);
  }
}

// Configuración de Vinculación Permanente (Estilo WhatsApp Web) y Dispositivo
const CONFIG_FILE = path.join(__dirname, 'config.json');

function getConfig() {
  let cfg = { deviceName: os.hostname() || 'Laptop' };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error leyendo config.json:', err);
  }

  // Generar un ID de vinculación persistente único si no existe
  if (!cfg.pairId) {
    cfg.pairId = 'air_' + crypto.randomBytes(12).toString('hex');
    saveConfig(cfg);
  }
  return cfg;
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('Error guardando config.json:', err);
  }
}

// Obtener IP local en la red Wi-Fi
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

let publicUrl = null;
let publicQrCode = null;
let cachedLocalIp = null;
let cachedLocalQrCode = null;

// Publicar la presencia de la laptop en el hub seguro de su pairId (permanente como WhatsApp Web)
async function publishDeviceSession() {
  const cfg = getConfig();
  const pairId = cfg.pairId;
  const currentIp = getLocalIp();
  const localUrl = `http://${currentIp}:${PORT}`;

  const payload = JSON.stringify({
    pairId,
    publicUrl,
    localUrl,
    hostname: os.hostname(),
    deviceName: cfg.deviceName || 'Laptop',
    updatedAt: Date.now()
  });

  try {
    await fetch(`https://ntfy.sh/airlink_hub_${pairId}`, {
      method: 'POST',
      headers: {
        'Title': 'AirLink Permanent Session',
        'X-Cache': 'yes'
      },
      body: payload
    });
    console.log(`🔗 Dispositivo listo para vincular/reconectar permanentemente`);
  } catch (err) {
    // Si no hay conexión a internet temporalmente, funcionará en red local
  }
}

async function getDynamicServerInfo() {
  const currentIp = getLocalIp();
  const currentLocalUrl = `http://${currentIp}:${PORT}`;
  const cfg = getConfig();
  const localPairUrl = `${currentLocalUrl}/?pair=${cfg.pairId}`;
  const publicPairUrl = publicUrl ? `${publicUrl}/?pair=${cfg.pairId}` : null;

  if (currentIp !== cachedLocalIp || !cachedLocalQrCode) {
    cachedLocalIp = currentIp;
    try {
      cachedLocalQrCode = await QRCode.toDataURL(localPairUrl, {
        width: 320,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      });
    } catch (e) {
      console.error('Error generando QR local:', e);
    }
  }

  return {
    localUrl: currentLocalUrl,
    publicUrl,
    localPairUrl,
    publicPairUrl,
    localQrCode: cachedLocalQrCode,
    publicQrCode,
    pairId: cfg.pairId,
    deviceName: cfg.deviceName || os.hostname(),
    driveConnected: drive.isAuthenticated(),
    filesCount: getStoredFiles().length,
    messagesCount: getStoredMessages().length
  };
}

// Obtener lista de archivos
function getStoredFiles() {
  try {
    const files = fs.readdirSync(STORAGE_DIR);
    return files.map(filename => {
      const filePath = path.join(STORAGE_DIR, filename);
      const stats = fs.statSync(filePath);
      return {
        id: encodeURIComponent(filename),
        name: filename,
        size: stats.size,
        formattedSize: formatBytes(stats.size),
        createdAt: stats.birthtime || stats.mtime,
        url: `/api/download/${encodeURIComponent(filename)}`,
        previewUrl: `/files-data/${encodeURIComponent(filename)}`,
        isImage: /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename),
        isVideo: /\.(mp4|webm|mov|mkv)$/i.test(filename),
        isAudio: /\.(mp3|wav|ogg|m4a)$/i.test(filename),
        isPdf: /\.pdf$/i.test(filename)
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (err) {
    console.error('Error leyendo archivos:', err);
    return [];
  }
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

let sseClients = [];

function notifyClients(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => res.write(payload));
}

// Endpoint SSE
app.get('/api/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(': connected\n\n');
  sseClients.push(res);

  const info = await getDynamicServerInfo();
  const messages = getStoredMessages();
  res.write(`event: init\ndata: ${JSON.stringify({ ...info, messages })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

setInterval(() => {
  sseClients.forEach(res => {
    try {
      res.write(': ping\n\n');
    } catch (e) {}
  });
}, 15000);

// Endpoints API
app.get('/api/info', async (req, res) => {
  const info = await getDynamicServerInfo();
  res.json(info);
});

app.get('/api/files', (req, res) => {
  res.json(getStoredFiles());
});

// Endpoints de Vinculación y Configuración
app.get('/api/pair-info', (req, res) => {
  const cfg = getConfig();
  res.json({
    pairId: cfg.pairId,
    deviceName: cfg.deviceName
  });
});

app.post('/api/reset-pair', requireLocalRequest, async (req, res) => {
  const cfg = getConfig();
  cfg.pairId = 'air_' + crypto.randomBytes(12).toString('hex');
  saveConfig(cfg);
  cachedLocalQrCode = null;
  publicQrCode = null;
  const info = await getDynamicServerInfo();
  publishDeviceSession();
  notifyClients('pair_reset', info);
  res.json({ success: true, pairId: cfg.pairId });
});

// Ruta directa para el portal de vinculación / espera
app.get('/conectar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'conectar.html'));
});

// ============================================================
// Endpoints de Google Drive (Respaldo en la Nube y Alta Velocidad)
// ============================================================
app.get('/auth/google', requireLocalRequest, (req, res) => {
  const authUrl = drive.getAuthUrl(PORT);
  if (!authUrl) {
    return res.status(500).send('credentials.json no encontrado o inválido.');
  }
  res.redirect(authUrl);
});

app.get('/auth/callback', requireLocalRequest, async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`<h2>Error al autenticar con Google: ${escapeHtml(error)}</h2>`);
  }
  if (!code) {
    return res.status(400).send('Código de autorización no recibido');
  }
  try {
    await drive.handleAuthCallback(code, PORT);
    notifyClients('drive_status_updated', { connected: true });
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Google Drive Conectado</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #090d16; color: #fff; text-align: center; padding: 60px 20px; }
          .card { max-width: 480px; margin: 0 auto; background: #121826; padding: 36px 28px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
          h1 { color: #34d399; font-size: 1.6rem; margin: 16px 0 10px; }
          p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
          .btn { display: inline-block; margin-top: 24px; padding: 14px 28px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border-radius: 12px; text-decoration: none; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="font-size: 3.5rem;">☁️</div>
          <h1>¡Google Drive Conectado con Éxito!</h1>
          <p>Tu cuenta se vinculó correctamente. A partir de ahora tus archivos se respaldarán en tu carpeta <strong>AirLink Express</strong> en Google Drive.</p>
          <a href="/" class="btn">Volver a AirLink</a>
        </div>
        <script>
          setTimeout(() => {
            if (window.opener) {
              window.opener.location.reload();
              window.close();
            } else {
              window.location.href = '/';
            }
          }, 2200);
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Error en callback de Google Drive:', err);
    res.status(500).send(`<h2>Error autorizando con Google Drive: ${escapeHtml(err.message)}</h2>`);
  }
});

app.get('/api/drive/status', (req, res) => {
  res.json({
    connected: drive.isAuthenticated()
  });
});

app.post('/api/drive/disconnect', requireLocalRequest, (req, res) => {
  const TOKENS_PATH = path.join(__dirname, 'tokens.json');
  if (fs.existsSync(TOKENS_PATH)) {
    fs.unlinkSync(TOKENS_PATH);
  }
  notifyClients('drive_status_updated', { connected: false });
  res.json({ success: true });
});

// Sincronización automática de Google Drive a la Laptop
let isSyncingDrive = false;
async function syncFromGoogleDrive() {
  if (isSyncingDrive || !drive.isAuthenticated()) return;
  isSyncingDrive = true;
  try {
    const driveFiles = await drive.listDriveFiles();
    if (!driveFiles || driveFiles.length === 0) return;

    let newFilesDownloaded = false;
    for (const df of driveFiles) {
      if (!df.name) continue;
      const safeTarget = resolveSafeStoragePath(df.name);
      if (!safeTarget) continue;
      if (!fs.existsSync(safeTarget.filePath)) {
        console.log(`⬇️ Descargando nuevo archivo de Drive a la Laptop: ${safeTarget.safeName}`);
        await drive.downloadFileFromDrive(df.id, safeTarget.filePath);
        newFilesDownloaded = true;
      }
    }

    if (newFilesDownloaded) {
      notifyClients('files_updated', {
        message: 'Nuevo archivo recibido desde Google Drive',
        totalFiles: getStoredFiles()
      });
    }
  } catch (err) {
    // Si no hay red momentáneamente no interrumpe
  } finally {
    isSyncingDrive = false;
  }
}

// Endpoint para forzar sincronización manual instantánea
app.post('/api/drive/sync', async (req, res) => {
  await syncFromGoogleDrive();
  res.json({ success: true, files: getStoredFiles() });
});

// Sincronizar periódicamente cada 10 segundos en segundo plano
setInterval(syncFromGoogleDrive, 10000);

// Endpoints de Mensajes y Notas Compartidas
app.get('/api/messages', (req, res) => {
  res.json(getStoredMessages());
});

app.post('/api/messages', (req, res) => {
  const { text, sender, device } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'El texto no puede estar vacío' });
  }

  const messages = getStoredMessages();
  const newMessage = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    text: text.trim(),
    sender: sender || 'Desconocido', // 'Laptop' o 'Celular'
    device: device || (sender === 'Celular' ? 'mobile' : 'laptop'),
    createdAt: new Date().toISOString()
  };

  messages.push(newMessage);
  // Limitar a los últimos 500 mensajes
  if (messages.length > 500) {
    messages.splice(0, messages.length - 500);
  }

  saveStoredMessages(messages);

  // Notificar a todos los clientes en tiempo real
  notifyClients('new_message', {
    message: newMessage,
    totalMessages: messages
  });

  res.json({
    success: true,
    message: newMessage
  });
});

// Eliminar mensaje individual
app.delete('/api/messages/:id', (req, res) => {
  const { id } = req.params;
  let messages = getStoredMessages();
  const initialLength = messages.length;
  messages = messages.filter(m => m.id !== id);

  if (messages.length !== initialLength) {
    saveStoredMessages(messages);
    notifyClients('messages_updated', {
      totalMessages: messages
    });
    return res.json({ success: true });
  }

  res.status(404).json({ error: 'Mensaje no encontrado' });
});

// Vaciar todos los mensajes
app.delete('/api/messages', (req, res) => {
  saveStoredMessages([]);
  notifyClients('messages_updated', {
    totalMessages: []
  });
  res.json({ success: true });
});

// Subida de archivos
app.post('/api/upload', upload.array('files'), (req, res) => {
  const uploadedFiles = req.files.map(f => {
    const originalName = Buffer.from(f.originalname, 'latin1').toString('utf8');
    return {
      name: f.filename,
      originalName,
      size: f.size,
      mimetype: f.mimetype
    };
  });

  const sender = req.query.sender || 'desconocido';

  // Subir a Google Drive en segundo plano si está conectado
  if (drive.isAuthenticated()) {
    uploadedFiles.forEach(async (f) => {
      try {
        const filePath = path.join(STORAGE_DIR, f.name);
        await drive.uploadFileToDrive({
          filePath,
          originalName: f.originalName,
          mimeType: f.mimetype
        });
        console.log(`☁️ Archivo respaldado en Google Drive: ${f.originalName}`);
      } catch (err) {
        console.error('Error subiendo a Google Drive en segundo plano:', err.message);
      }
    });
  }

  // Notificar a todos los clientes conectados
  notifyClients('files_updated', {
    message: `${uploadedFiles.length} archivo(s) transferido(s)`,
    sender,
    files: uploadedFiles,
    totalFiles: getStoredFiles()
  });

  res.json({
    success: true,
    message: 'Archivos recibidos exitosamente',
    files: uploadedFiles
  });
});

// Endpoint Web Share Target (Recibir archivos o textos compartidos desde WhatsApp u otras apps en el celular)
app.post('/share-target', upload.array('files'), (req, res) => {
  try {
    const uploadedFiles = (req.files || []).map(f => {
      const originalName = Buffer.from(f.originalname, 'latin1').toString('utf8');
      return {
        name: f.filename,
        originalName,
        size: f.size,
        mimetype: f.mimetype
      };
    });

    if (uploadedFiles.length > 0) {
      // Subir a Google Drive en segundo plano si está conectado
      if (drive.isAuthenticated()) {
        uploadedFiles.forEach(async (f) => {
          try {
            const filePath = path.join(STORAGE_DIR, f.name);
            await drive.uploadFileToDrive({
              filePath,
              originalName: f.originalName,
              mimeType: f.mimetype
            });
            console.log(`☁️ Archivo desde WhatsApp respaldado en Google Drive: ${f.originalName}`);
          } catch (err) {
            console.error('Error subiendo a Google Drive desde share-target:', err.message);
          }
        });
      }

      notifyClients('files_updated', {
        message: `${uploadedFiles.length} archivo(s) recibido(s) desde app externa`,
        sender: 'mobile',
        files: uploadedFiles,
        totalFiles: getStoredFiles()
      });
    }

    // Si también se compartió texto o un enlace (ej. desde WhatsApp o navegador)
    const sharedTitle = (req.body && req.body.title) ? req.body.title.trim() : '';
    const sharedText = (req.body && req.body.text) ? req.body.text.trim() : '';
    const sharedUrl = (req.body && req.body.url) ? req.body.url.trim() : '';
    const combinedText = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join('\n').trim();

    if (combinedText) {
      const messages = getStoredMessages();
      const newMessage = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        text: combinedText,
        sender: 'Celular',
        device: 'mobile',
        createdAt: new Date().toISOString()
      };
      messages.push(newMessage);
      if (messages.length > 500) {
        messages.splice(0, messages.length - 500);
      }
      saveStoredMessages(messages);
      notifyClients('new_message', {
        message: newMessage,
        totalMessages: messages
      });
    }

    const redirectParam = uploadedFiles.length > 0 ? 'shared=files' : (combinedText ? 'shared=text' : 'shared=1');
    res.redirect(303, `/?${redirectParam}`);
  } catch (err) {
    console.error('Error en /share-target:', err);
    res.redirect(303, '/?shared=error');
  }
});

// Descarga directa con headers apropiados (protegida contra Path Traversal)
app.get('/api/download/:filename', (req, res) => {
  const safeTarget = resolveSafeStoragePath(decodeURIComponent(req.params.filename || ''));
  if (!safeTarget) {
    return res.status(400).send('Nombre de archivo inválido');
  }

  if (!fs.existsSync(safeTarget.filePath)) {
    return res.status(404).send('Archivo no encontrado');
  }

  res.download(safeTarget.filePath, safeTarget.safeName);
});

// Eliminar archivo (protegida contra Path Traversal)
app.delete('/api/files/:filename', (req, res) => {
  const safeTarget = resolveSafeStoragePath(decodeURIComponent(req.params.filename || ''));
  if (!safeTarget) {
    return res.status(400).json({ error: 'Nombre de archivo inválido' });
  }

  if (fs.existsSync(safeTarget.filePath)) {
    try {
      fs.unlinkSync(safeTarget.filePath);
      notifyClients('files_updated', {
        message: 'Archivo eliminado',
        totalFiles: getStoredFiles()
      });
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo eliminar el archivo' });
    }
  }
  res.status(404).json({ error: 'Archivo no encontrado' });
});

// Abrir la carpeta de descargas en el explorador de Windows (solo acceso local)
app.post('/api/open-folder', requireLocalRequest, (req, res) => {
  exec(`explorer.exe "${STORAGE_DIR}"`, (err) => {
    if (err) {
      return res.status(500).json({ error: 'No se pudo abrir la carpeta' });
    }
    res.json({ success: true, path: STORAGE_DIR });
  });
});

// Iniciar Cloudflare Tunnel para acceso desde Internet
function startCloudflareTunnel(port) {
  const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
  if (!fs.existsSync(cloudflaredPath)) {
    console.log('⚠️ cloudflared.exe no encontrado. Solo estará disponible en red local.');
    return;
  }

  console.log('🚀 Iniciando túnel seguro de Cloudflare para acceso desde Internet...');
  const tunnel = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`]);

  let urlFound = false;

  const handleOutput = (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match && !urlFound) {
      urlFound = true;
      publicUrl = match[0];
      const localIp = getLocalIp();
      const localUrl = `http://${localIp}:${port}`;
      console.log(`\n======================================================`);
      console.log(`🌐 ENLACE PÚBLICO (ACCESO DESDE INTERNET): ${publicUrl}`);
      console.log(`🏠 ENLACE LOCAL (MISMO WI-FI): ${localUrl}`);
      console.log(`======================================================\n`);

      // Generar código QR para el enlace público con parámetro de vinculación permanente
      const cfg = getConfig();
      const publicPairUrl = `${publicUrl}/?pair=${cfg.pairId}`;
      QRCode.toDataURL(publicPairUrl, { width: 320, margin: 1, color: { dark: '#000000', light: '#ffffff' } }, async (err, url) => {
        if (!err) publicQrCode = url;
        const info = await getDynamicServerInfo();
        notifyClients('tunnel_ready', info);
        // Publicar de inmediato en el canal de vinculación permanente
        publishDeviceSession();
      });
    }
  };

  tunnel.stdout.on('data', handleOutput);
  tunnel.stderr.on('data', handleOutput);

  tunnel.on('close', (code) => {
    console.log(`Túnel de Cloudflare cerrado (código ${code})`);
  });

  // Cerrar túnel al salir
  process.on('SIGINT', () => {
    tunnel.kill();
    process.exit();
  });
  process.on('exit', () => {
    tunnel.kill();
  });
}

// Iniciar servidor
app.listen(PORT, async () => {
  const localIp = getLocalIp();
  const localUrl = `http://${localIp}:${PORT}`;
  console.log(`\nServidor iniciado en el puerto ${PORT}`);
  console.log(`Red local Wi-Fi: ${localUrl}`);

  // Pre-generar código QR para red local
  await getDynamicServerInfo();

  // Publicar sesión inicial vinculada
  publishDeviceSession();

  // Mantener actualizado el registro del hub periódicamente (cada 3 minutos)
  setInterval(publishDeviceSession, 3 * 60 * 1000);

  // Iniciar túnel de Cloudflare
  startCloudflareTunnel(PORT);

  // Intentar abrir el navegador en la laptop automáticamente
  const isWindows = process.platform === 'win32';
  if (isWindows && !process.env.NO_AUTO_OPEN) {
    exec(`start http://localhost:${PORT}`);
  }
});
