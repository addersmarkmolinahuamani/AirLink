const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKENS_PATH = path.join(__dirname, 'tokens.json');
const SCOPES = [
  'https://www.googleapis.com/auth/drive'
];

let oauth2Client = null;
let airlinkFolderId = null;

function getOAuth2Client(redirectUri) {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  let content;
  try {
    content = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
  const keys = content.installed || content.web;
  if (!keys) return null;

  const rUri = redirectUri || 'http://localhost:4321/auth/callback';
  const client = new google.auth.OAuth2(keys.client_id, keys.client_secret, rUri);

  if (fs.existsSync(TOKENS_PATH)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
      client.setCredentials(tokens);
    } catch (e) {
      console.error('Error cargando tokens.json:', e);
    }
  }

  client.on('tokens', (tokens) => {
    try {
      let existing = {};
      if (fs.existsSync(TOKENS_PATH)) {
        existing = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
      }
      const updated = { ...existing, ...tokens };
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(updated, null, 2), 'utf8');
      console.log('🔄 Tokens de Google Drive actualizados automáticamente');
    } catch (e) {
      console.error('Error guardando tokens actualizados:', e);
    }
  });

  return client;
}

function isAuthenticated() {
  if (!fs.existsSync(CREDENTIALS_PATH) || !fs.existsSync(TOKENS_PATH)) return false;
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    return !!(tokens && (tokens.access_token || tokens.refresh_token));
  } catch (e) {
    return false;
  }
}

function getAuthUrl(port = 4321) {
  const client = getOAuth2Client(`http://localhost:${port}/auth/callback`);
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
}

async function handleAuthCallback(code, port = 4321) {
  const client = getOAuth2Client(`http://localhost:${port}/auth/callback`);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf8');
  oauth2Client = client;
  // Ubicar o crear la carpeta AirLink Express
  await getOrCreateAirLinkFolder();
  return tokens;
}

async function getDriveService() {
  if (!oauth2Client) {
    oauth2Client = getOAuth2Client();
  }
  if (!oauth2Client || !isAuthenticated()) return null;
  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function getOrCreateAirLinkFolder() {
  if (airlinkFolderId) return airlinkFolderId;
  const drive = await getDriveService();
  if (!drive) return null;

  try {
    const res = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.folder' and name='AirLink Express' and trashed=false",
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (res.data.files && res.data.files.length > 0) {
      airlinkFolderId = res.data.files[0].id;
      return airlinkFolderId;
    }

    // Crear la carpeta
    const fileMetadata = {
      name: 'AirLink Express',
      mimeType: 'application/vnd.google-apps.folder'
    };
    const folder = await drive.files.create({
      resource: fileMetadata,
      fields: 'id'
    });
    airlinkFolderId = folder.data.id;
    console.log('📁 Carpeta "AirLink Express" creada en Google Drive con ID:', airlinkFolderId);
    return airlinkFolderId;
  } catch (err) {
    console.error('Error obteniendo/creando carpeta en Drive:', err);
    return null;
  }
}

async function uploadFileToDrive({ filePath, originalName, mimeType }) {
  const drive = await getDriveService();
  if (!drive) throw new Error('Google Drive no autenticado');

  const folderId = await getOrCreateAirLinkFolder();
  const fileMetadata = {
    name: originalName,
    parents: folderId ? [folderId] : []
  };

  const media = {
    mimeType: mimeType || 'application/octet-stream',
    body: fs.createReadStream(filePath)
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, name, size, mimeType, webViewLink, webContentLink, createdTime'
  });

  return response.data;
}

async function listDriveFiles() {
  const drive = await getDriveService();
  if (!drive) return [];

  const folderId = await getOrCreateAirLinkFolder();
  if (!folderId) return [];

  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, size, mimeType, webViewLink, webContentLink, createdTime, thumbnailLink)',
      orderBy: 'createdTime desc',
      pageSize: 100
    });
    return res.data.files || [];
  } catch (e) {
    console.error('Error listando archivos de Drive:', e);
    return [];
  }
}

async function downloadFileFromDrive(fileId, destinationPath) {
  const drive = await getDriveService();
  if (!drive) throw new Error('Google Drive no autenticado');

  // Obtener metadata del archivo para saber si es un Google Doc nativo
  const meta = await drive.files.get({ fileId, fields: 'id, name, mimeType' });
  const mimeType = meta.data.mimeType || '';

  let actualPath = destinationPath;
  let res;

  if (mimeType.startsWith('application/vnd.google-apps.document')) {
    if (!actualPath.endsWith('.docx')) actualPath += '.docx';
    res = await drive.files.export(
      { fileId: fileId, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { responseType: 'stream' }
    );
  } else if (mimeType.startsWith('application/vnd.google-apps.spreadsheet')) {
    if (!actualPath.endsWith('.xlsx')) actualPath += '.xlsx';
    res = await drive.files.export(
      { fileId: fileId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { responseType: 'stream' }
    );
  } else if (mimeType.startsWith('application/vnd.google-apps.presentation')) {
    if (!actualPath.endsWith('.pptx')) actualPath += '.pptx';
    res = await drive.files.export(
      { fileId: fileId, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
      { responseType: 'stream' }
    );
  } else {
    res = await drive.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'stream' }
    );
  }

  const dest = fs.createWriteStream(actualPath);
  return new Promise((resolve, reject) => {
    res.data
      .pipe(dest)
      .on('finish', () => resolve(actualPath))
      .on('error', reject);
  });
}

async function deleteDriveFile(fileId) {
  const drive = await getDriveService();
  if (!drive) throw new Error('Google Drive no autenticado');
  await drive.files.delete({ fileId });
  return true;
}

module.exports = {
  isAuthenticated,
  getAuthUrl,
  handleAuthCallback,
  uploadFileToDrive,
  listDriveFiles,
  downloadFileFromDrive,
  deleteDriveFile,
  getOrCreateAirLinkFolder
};

