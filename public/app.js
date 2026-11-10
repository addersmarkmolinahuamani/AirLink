// AirLink Express - Nube Directa en Google Drive (Serverless)
// Compatible con GitHub Pages, Celular y Laptop sin consumir recursos locales

const CLIENT_ID = '53478639551-2ndvvqghcmmnld49m3jktf8j2ji1m1pg.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive';
const SAFE_DRIVE_ID_RE = /^[a-zA-Z0-9_-]{10,128}$/;

function isValidDriveId(id) {
  return typeof id === 'string' && SAFE_DRIVE_ID_RE.test(id);
}

function isSafeHttpUrl(rawUrl, httpsOnly = false) {
  try {
    const parsed = new URL(rawUrl);
    if (httpsOnly) return parsed.protocol === 'https:';
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (e) {
    return false;
  }
}

function createSvgIcon(width, height, markupNodes) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');

  markupNodes.forEach(([tag, attrs]) => {
    const el = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    svg.appendChild(el);
  });
  return svg;
}

function clearStoredSession(clearFolder = false) {
  accessToken = null;
  tokenExpiry = 0;
  localStorage.removeItem('airlink_drive_token');
  localStorage.removeItem('airlink_token_expiry');
  localStorage.removeItem('airlink_client_id');
  if (clearFolder) {
    airlinkFolderId = null;
    messagesFileId = null;
    localStorage.removeItem('airlink_folder_id');
    localStorage.removeItem('airlink_messages_file_id');
  }
}

let tokenClient = null;
let accessToken = localStorage.getItem('airlink_drive_token') || null;
let tokenExpiry = parseInt(localStorage.getItem('airlink_token_expiry') || '0', 10);
const storedFolderId = localStorage.getItem('airlink_folder_id');
let airlinkFolderId = isValidDriveId(storedFolderId) ? storedFolderId : null;
let activeMainTab = 'files';

let filesData = [];
let messagesData = [];
const storedMessagesFileId = localStorage.getItem('airlink_messages_file_id');
let messagesFileId = isValidDriveId(storedMessagesFileId) ? storedMessagesFileId : null;

// Detección de dispositivo (Móvil vs Laptop)
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 860;

// Elementos DOM
const deviceBadge = document.getElementById('deviceBadge');
const deviceText = document.getElementById('deviceText');
const btnDriveAuth = document.getElementById('btnDriveAuth');
const driveAuthText = document.getElementById('driveAuthText');
const driveBanner = document.getElementById('driveBanner');
const driveBannerTitle = document.getElementById('driveBannerTitle');
const driveBannerDesc = document.getElementById('driveBannerDesc');
const btnDriveAction = document.getElementById('btnDriveAction');

const tabNavFiles = document.getElementById('tabNavFiles');
const tabNavChat = document.getElementById('tabNavChat');
const tabFilesBadge = document.getElementById('tabFilesBadge');
const tabChatBadge = document.getElementById('tabChatBadge');
const chatUnreadDot = document.getElementById('chatUnreadDot');

const filesTabSection = document.getElementById('filesTabSection');
const chatTabSection = document.getElementById('chatTabSection');

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const cameraInput = document.getElementById('cameraInput');
const btnSelectFiles = document.getElementById('btnSelectFiles');
const btnPasteCapture = document.getElementById('btnPasteCapture');
const btnCamera = document.getElementById('btnCamera');
const btnOpenDriveFolder = document.getElementById('btnOpenDriveFolder');
const btnRefresh = document.getElementById('btnRefresh');

const progressContainer = document.getElementById('progressContainer');
const progressTitle = document.getElementById('progressTitle');
const progressBarFill = document.getElementById('progressBarFill');
const progressPercent = document.getElementById('progressPercent');
const progressInfo = document.getElementById('progressInfo');

const filesList = document.getElementById('filesList');
const filesCount = document.getElementById('filesCount');
const emptyState = document.getElementById('emptyState');

const chatInput = document.getElementById('chatInput');
const btnSendText = document.getElementById('btnSendText');
const btnPasteText = document.getElementById('btnPasteText');
const btnClearChat = document.getElementById('btnClearChat');
const chatCharCounter = document.getElementById('chatCharCounter');
const chatMessagesList = document.getElementById('chatMessagesList');
const emptyChatState = document.getElementById('emptyChatState');
const messagesCount = document.getElementById('messagesCount');

const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Configuración inicial de dispositivo
if (isMobile) {
  document.body.classList.add('is-mobile-device');
  if (deviceBadge) {
    deviceBadge.querySelector('.device-icon').textContent = '📱';
    if (deviceText) deviceText.textContent = 'Celular';
  }
} else {
  if (deviceBadge) {
    deviceBadge.querySelector('.device-icon').textContent = '💻';
    if (deviceText) deviceText.textContent = 'Laptop';
  }
}

// -------------------------------------------------------------
// Notificaciones Toast y Sonido
// -------------------------------------------------------------
function showToast(msg) {
  if (!toast || !toastMessage) return;
  toastMessage.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// -------------------------------------------------------------
// Google Identity Services (GIS) & Autenticación
// -------------------------------------------------------------
function initGoogleAuth() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    setTimeout(initGoogleAuth, 300);
    return;
  }

  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: async (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          accessToken = tokenResponse.access_token;
          const expiresIn = parseInt(tokenResponse.expires_in || '3599', 10);
          tokenExpiry = Date.now() + expiresIn * 1000;
          localStorage.setItem('airlink_drive_token', accessToken);
          localStorage.setItem('airlink_token_expiry', String(tokenExpiry));

          updateAuthUI(true);
          showToast('☁️ Conectado con éxito a Google Drive');
          playChime();

          await initializeDriveFolder();
          loadAllData();
        }
      }
    });

    if (isTokenValid()) {
      updateAuthUI(true);
      initializeDriveFolder().then(() => {
        loadAllData();
      });
    } else {
      clearStoredSession(false);
      updateAuthUI(false);
    }
  } catch (err) {
    console.error('Error inicializando Google Auth:', err);
    updateAuthUI(false);
  }
}

function isTokenValid() {
  return Boolean(accessToken && tokenExpiry > Date.now() + 60000);
}

function requestDriveAccess() {
  if (!tokenClient) {
    initGoogleAuth();
  }
  if (tokenClient) {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    showToast('Cargando servicio de Google... intenta en unos segundos');
  }
}

function disconnectDrive() {
  const tokenToRevoke = accessToken;
  clearStoredSession(true);
  filesData = [];
  messagesData = [];
  renderFiles([]);
  renderMessages([]);
  updateAuthUI(false);

  if (btnOpenDriveFolder) {
    btnOpenDriveFolder.href = 'https://drive.google.com';
  }

  if (tokenToRevoke && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
    try {
      google.accounts.oauth2.revoke(tokenToRevoke, () => {});
    } catch (e) {}
  }
  showToast('🔒 Sesión de Google Drive cerrada y revocada');
}

function updateAuthUI(connected) {
  if (connected) {
    if (btnDriveAuth) {
      btnDriveAuth.classList.add('connected');
      btnDriveAuth.title = 'Clic para cerrar sesión y revocar acceso en este dispositivo';
    }
    if (driveAuthText) driveAuthText.textContent = 'Drive Conectado ✓';
    if (driveBanner) driveBanner.classList.add('connected');
    if (driveBannerTitle) driveBannerTitle.textContent = '☁️ Google Drive Activo';
    if (driveBannerDesc) driveBannerDesc.textContent = 'Tus archivos se guardan directamente en tu carpeta "AirLink Express" de Google Drive.';
    if (btnDriveAction) {
      btnDriveAction.classList.add('connected');
      btnDriveAction.textContent = '✓ Conectado';
    }
  } else {
    if (btnDriveAuth) {
      btnDriveAuth.classList.remove('connected');
      btnDriveAuth.title = 'Conectar con Google Drive';
    }
    if (driveAuthText) driveAuthText.textContent = 'Conectar Drive';
    if (driveBanner) driveBanner.classList.remove('connected');
    if (driveBannerTitle) driveBannerTitle.textContent = 'Conectar con Google Drive';
    if (driveBannerDesc) driveBannerDesc.textContent = 'Inicia sesión una sola vez para sincronizar tus archivos, capturas y textos entre tu celular y tu laptop sin límites ni túneles.';
    if (btnDriveAction) {
      btnDriveAction.classList.remove('connected');
      btnDriveAction.textContent = 'Conectar con Google';
    }
  }
}

if (btnDriveAuth) {
  btnDriveAuth.addEventListener('click', () => {
    if (isTokenValid()) {
      if (confirm('¿Deseas desconectar y revocar tu sesión de Google Drive en este dispositivo?')) {
        disconnectDrive();
      }
    } else {
      requestDriveAccess();
    }
  });
}

if (btnDriveAction) {
  btnDriveAction.addEventListener('click', () => {
    if (!isTokenValid()) {
      requestDriveAccess();
    }
  });
}

// -------------------------------------------------------------
// Operaciones con Google Drive API v3
// -------------------------------------------------------------
async function fetchWithAuth(url, options = {}) {
  if (!isTokenValid()) {
    clearStoredSession(false);
    showToast('Sesión de Google Drive expirada. Vuelve a conectar.');
    updateAuthUI(false);
    throw new Error('Token expirado');
  }
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${accessToken}`
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearStoredSession(false);
    updateAuthUI(false);
    showToast('Sesión expirada. Toca "Conectar Drive" para renovar.');
    throw new Error('401 Unauthorized');
  }
  return res;
}

function updateDriveFolderLink() {
  if (btnOpenDriveFolder && isValidDriveId(airlinkFolderId)) {
    btnOpenDriveFolder.href = `https://drive.google.com/drive/folders/${encodeURIComponent(airlinkFolderId)}`;
  }
}

// Localizar o crear la carpeta "AirLink Express"
async function initializeDriveFolder() {
  if (isValidDriveId(airlinkFolderId)) {
    try {
      const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(airlinkFolderId)}?fields=id,name,trashed`);
      if (res.ok) {
        const d = await res.json();
        if (d && isValidDriveId(d.id) && !d.trashed) {
          updateDriveFolderLink();
          return airlinkFolderId;
        }
      }
    } catch (e) {}
    airlinkFolderId = null;
    localStorage.removeItem('airlink_folder_id');
  }

  try {
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='AirLink Express' and trashed=false");
    const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`);
    const data = await res.json();

    if (data.files && data.files.length > 0 && isValidDriveId(data.files[0].id)) {
      airlinkFolderId = data.files[0].id;
      localStorage.setItem('airlink_folder_id', airlinkFolderId);
      updateDriveFolderLink();
      return airlinkFolderId;
    }

    // Crear carpeta
    const createRes = await fetchWithAuth('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'AirLink Express',
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    const folder = await createRes.json();
    if (folder && isValidDriveId(folder.id)) {
      airlinkFolderId = folder.id;
      localStorage.setItem('airlink_folder_id', airlinkFolderId);
      updateDriveFolderLink();
      return airlinkFolderId;
    }
    return null;
  } catch (err) {
    console.error('Error buscando/creando carpeta AirLink Express:', err);
    return null;
  }
}

// Cargar lista de archivos de Google Drive
async function loadDriveFiles() {
  if (!isValidDriveId(airlinkFolderId)) await initializeDriveFolder();
  if (!isValidDriveId(airlinkFolderId)) return;

  try {
    const q = encodeURIComponent(`'${airlinkFolderId}' in parents and trashed=false and name != 'mensajes.json'`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,mimeType,createdTime,webViewLink,webContentLink,thumbnailLink)&orderBy=createdTime desc&pageSize=100`;

    const res = await fetchWithAuth(url);
    if (!res.ok) return;
    const data = await res.json();
    const newFiles = (data.files || [])
      .filter(f => f && isValidDriveId(f.id) && typeof f.name === 'string')
      .map(f => {
        const mime = typeof f.mimeType === 'string' ? f.mimeType : '';
        const isImg = mime.startsWith('image/');
        const isVid = mime.startsWith('video/');
        const isAud = mime.startsWith('audio/');
        const isDoc = mime.includes('word') || mime.includes('document');
        const isPdf = mime.includes('pdf');
        const parsedSize = parseInt(f.size || '0', 10);

        return {
          id: f.id,
          name: f.name,
          size: Number.isFinite(parsedSize) ? parsedSize : 0,
          formattedSize: formatBytes(Number.isFinite(parsedSize) ? parsedSize : 0),
          createdAt: f.createdTime,
          mimeType: mime,
          webViewLink: isSafeHttpUrl(f.webViewLink, true) ? f.webViewLink : null,
          thumbnailLink: isSafeHttpUrl(f.thumbnailLink, true) ? f.thumbnailLink : null,
          isImage: isImg,
          isVideo: isVid,
          isAudio: isAud,
          isPdf: isPdf,
          isDoc: isDoc
        };
      });

    // Solo actualizar la vista si los archivos realmente cambiaron
    const currentIds = filesData.map(f => f.id).join(',');
    const newIds = newFiles.map(f => f.id).join(',');
    if (currentIds !== newIds || filesData.length === 0) {
      if (filesData.length > 0 && newFiles.length > filesData.length) {
        playChime();
        showToast('☁️ ¡Nuevo archivo disponible en AirLink Express!');
      }
      filesData = newFiles;
      renderFiles(filesData);
    }
  } catch (e) {
    console.error('Error cargando archivos de Drive:', e);
  }
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return 'Archivo';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function createShareButtonContent() {
  const frag = document.createDocumentFragment();
  frag.appendChild(createSvgIcon(17, 17, [
    ['circle', { cx: 18, cy: 5, r: 3 }],
    ['circle', { cx: 6, cy: 12, r: 3 }],
    ['circle', { cx: 18, cy: 19, r: 3 }],
    ['line', { x1: 8.59, y1: 13.51, x2: 15.42, y2: 17.49 }],
    ['line', { x1: 15.41, y1: 6.51, x2: 8.59, y2: 10.49 }]
  ]));
  const label = document.createElement('span');
  label.className = 'share-btn-label';
  label.textContent = 'Compartir';
  frag.appendChild(label);
  return frag;
}

// Renderizar la lista de archivos de forma segura (sin innerHTML dinámico)
function renderFiles(files) {
  if (filesCount) filesCount.textContent = files.length;
  if (tabFilesBadge) tabFilesBadge.textContent = files.length;

  if (!files || files.length === 0) {
    filesList.replaceChildren(emptyState);
    return;
  }

  const frag = document.createDocumentFragment();

  files.forEach(file => {
    const card = document.createElement('div');
    card.className = 'file-card';

    const fileLeft = document.createElement('div');
    fileLeft.className = 'file-left';

    const thumb = document.createElement('div');
    thumb.className = 'file-thumb';
    if (file.thumbnailLink) {
      const img = document.createElement('img');
      img.src = file.thumbnailLink;
      img.alt = file.name;
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      thumb.appendChild(img);
    } else if (file.isImage) {
      thumb.textContent = '🖼️';
    } else if (file.isVideo) {
      thumb.textContent = '🎥';
    } else if (file.isAudio) {
      thumb.textContent = '🎵';
    } else if (file.isPdf) {
      thumb.textContent = '📕';
    } else if (file.isDoc) {
      thumb.textContent = '📝';
    } else {
      thumb.textContent = '📄';
    }

    const meta = document.createElement('div');
    meta.className = 'file-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';
    nameEl.title = file.name;
    nameEl.textContent = file.name;

    const dateObj = new Date(file.createdAt);
    const dateFormatted = isNaN(dateObj.getTime()) ? '' : dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const subEl = document.createElement('div');
    subEl.className = 'file-sub';
    subEl.textContent = dateFormatted ? `${file.formattedSize} • ${dateFormatted}` : file.formattedSize;

    meta.append(nameEl, subEl);
    fileLeft.append(thumb, meta);

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    const shareBtn = document.createElement('button');
    shareBtn.className = 'btn-file-action share';
    shareBtn.type = 'button';
    shareBtn.title = 'Compartir directo a WhatsApp u otra app';
    shareBtn.appendChild(createShareButtonContent());
    shareBtn.addEventListener('click', () => shareDriveFile(file.id, shareBtn));

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn-file-action';
    downloadBtn.type = 'button';
    downloadBtn.title = 'Descargar';
    downloadBtn.appendChild(createSvgIcon(18, 18, [
      ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
      ['polyline', { points: '7 10 12 15 17 10' }],
      ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }]
    ]));
    downloadBtn.addEventListener('click', () => downloadDriveFile(file.id, file.name, file.mimeType));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-file-action delete';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Eliminar de Drive';
    deleteBtn.appendChild(createSvgIcon(16, 16, [
      ['polyline', { points: '3 6 5 6 21 6' }],
      ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]
    ]));
    deleteBtn.addEventListener('click', () => deleteDriveFile(file.id));

    actions.append(shareBtn, downloadBtn, deleteBtn);
    card.append(fileLeft, actions);
    frag.appendChild(card);
  });

  filesList.replaceChildren(frag);
}

// Descargar archivo desde Google Drive
async function downloadDriveFile(fileId, fileName, mimeType) {
  if (!isValidDriveId(fileId)) return;
  try {
    showToast(`Descargando ${fileName}...`);
    const safeId = encodeURIComponent(fileId);
    let downloadUrl = `https://www.googleapis.com/drive/v3/files/${safeId}?alt=media`;

    if (mimeType && mimeType.startsWith('application/vnd.google-apps.document')) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${safeId}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
      if (!fileName.endsWith('.docx')) fileName += '.docx';
    } else if (mimeType && mimeType.startsWith('application/vnd.google-apps.spreadsheet')) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${safeId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
      if (!fileName.endsWith('.xlsx')) fileName += '.xlsx';
    }

    const res = await fetchWithAuth(downloadUrl);
    if (!res.ok) throw new Error('No se pudo descargar el archivo');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    showToast(`✓ Descarga de ${fileName} lista`);
  } catch (err) {
    showToast('Error al descargar el archivo de Drive');
  }
}

// Compartir directamente a WhatsApp u otras apps móviles (Web Share API)
async function shareDriveFile(fileId, btnEl) {
  if (!isValidDriveId(fileId)) return;
  const file = filesData.find(f => f.id === fileId);
  if (!file) return;

  if (btnEl) {
    btnEl.classList.add('loading');
    const waitSpan = document.createElement('span');
    waitSpan.textContent = '⏳...';
    btnEl.replaceChildren(waitSpan);
  }

  try {
    const safeId = encodeURIComponent(fileId);
    let downloadUrl = `https://www.googleapis.com/drive/v3/files/${safeId}?alt=media`;
    let fileName = file.name;
    let mimeType = file.mimeType || 'application/octet-stream';

    if (mimeType.startsWith('application/vnd.google-apps.document')) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${safeId}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (!fileName.endsWith('.docx')) fileName += '.docx';
    }

    const res = await fetchWithAuth(downloadUrl);
    const blob = await res.blob();
    const fileObj = new File([blob], fileName, { type: mimeType });

    if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
      await navigator.share({
        files: [fileObj],
        title: fileName
      });
    } else if (file.webViewLink && isSafeHttpUrl(file.webViewLink, true)) {
      if (navigator.share) {
        await navigator.share({
          title: fileName,
          url: file.webViewLink
        });
      } else {
        window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      showToast('No se pudo abrir el menú de compartir');
    }
  } finally {
    if (btnEl) {
      btnEl.classList.remove('loading');
      btnEl.replaceChildren(createShareButtonContent());
    }
  }
}

// Eliminar archivo de Drive
async function deleteDriveFile(fileId) {
  if (!isValidDriveId(fileId)) return;
  if (!confirm('¿Deseas eliminar este archivo de Google Drive?')) return;
  try {
    const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showToast('Archivo eliminado de Google Drive');
      filesData = filesData.filter(f => f.id !== fileId);
      renderFiles(filesData);
    }
  } catch (err) {
    showToast('Error al eliminar archivo');
  }
}

// -------------------------------------------------------------
// Subida de Archivos a Google Drive
// -------------------------------------------------------------
async function uploadFiles(files) {
  if (!isTokenValid()) {
    showToast('Inicia sesión en Google Drive primero');
    requestDriveAccess();
    return;
  }
  if (!isValidDriveId(airlinkFolderId)) await initializeDriveFolder();
  if (!isValidDriveId(airlinkFolderId)) {
    showToast('No se pudo localizar la carpeta AirLink Express en Drive');
    return;
  }

  progressContainer.style.display = 'flex';
  const total = files.length;
  let completed = 0;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    progressTitle.textContent = `Subiendo ${file.name}... (${i + 1}/${total})`;
    progressPercent.textContent = `${Math.round(((i) / total) * 100)}%`;
    progressBarFill.style.width = `${Math.round(((i) / total) * 100)}%`;
    progressInfo.textContent = `${formatBytes(file.size)}`;

    try {
      const metadata = {
        name: file.name,
        parents: [airlinkFolderId]
      };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', file);

      await fetchWithAuth('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        body: form
      });
      completed++;
    } catch (e) {
      console.error('Error subiendo archivo:', file.name, e);
    }
  }

  progressBarFill.style.width = '100%';
  progressPercent.textContent = '100%';
  progressTitle.textContent = '¡Archivos subidos a Google Drive!';
  playChime();
  showToast(`¡${completed} archivo(s) guardado(s) en tu Drive!`);

  setTimeout(() => {
    progressContainer.style.display = 'none';
    progressBarFill.style.width = '0%';
    fileInput.value = '';
    cameraInput.value = '';
    loadDriveFiles();
  }, 1200);
}

// -------------------------------------------------------------
// Pegar Captura de Pantalla con Ctrl+V (Directo a Drive)
// -------------------------------------------------------------
window.addEventListener('paste', async (e) => {
  if (activeMainTab === 'chat' && document.activeElement === chatInput) {
    return; // Si está escribiendo texto, dejar pegar texto normalmente
  }

  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  let imageFound = false;

  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      imageFound = true;
      const blob = item.getAsFile();
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const captureFile = new File([blob], `Captura_${timestamp}.png`, { type: 'image/png' });

      showToast('📋 Captura detectada en portapapeles. Subiendo a Drive...');
      await uploadFiles([captureFile]);
      break;
    }
  }

  if (!imageFound && btnPasteCapture && e.target === btnPasteCapture) {
    showToast('No se encontró ninguna imagen en el portapapeles');
  }
});

if (btnPasteCapture) {
  btnPasteCapture.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find(type => type.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
            const file = new File([blob], `Captura_${timestamp}.png`, { type: imageType });
            showToast('📋 Subiendo captura del portapapeles...');
            await uploadFiles([file]);
            return;
          }
        }
      }
      showToast('Copia una captura con Win+Shift+S y presiona Ctrl+V');
    } catch (err) {
      showToast('Presiona Ctrl+V directamente para pegar la captura');
    }
  });
}

// -------------------------------------------------------------
// Drag & Drop y Selección
// -------------------------------------------------------------
if (btnSelectFiles) btnSelectFiles.addEventListener('click', () => fileInput.click());
if (btnCamera) btnCamera.addEventListener('click', () => cameraInput.click());

if (fileInput) {
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) uploadFiles(fileInput.files);
  });
}

if (cameraInput) {
  cameraInput.addEventListener('change', () => {
    if (cameraInput.files.length > 0) uploadFiles(cameraInput.files);
  });
}

if (dropZone) {
  dropZone.addEventListener('click', (e) => {
    if (e.target.closest('.btn')) return;
    fileInput.click();
  });

  ['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      uploadFiles(dt.files);
    }
  });
}

if (btnRefresh) {
  btnRefresh.addEventListener('click', () => {
    btnRefresh.style.transform = 'rotate(180deg)';
    setTimeout(() => { btnRefresh.style.transform = ''; }, 400);
    loadAllData();
    showToast('Actualizando archivos...');
  });
}

// -------------------------------------------------------------
// Texto y Portapapeles Sincronizado en Drive (mensajes.json)
// -------------------------------------------------------------
function sanitizeMessagesArray(rawMsgs) {
  if (!Array.isArray(rawMsgs)) return [];
  return rawMsgs
    .filter(m => m && typeof m === 'object' && typeof m.text === 'string' && typeof m.id === 'string')
    .slice(0, 500)
    .map(m => ({
      id: m.id,
      text: m.text,
      sender: typeof m.sender === 'string' ? m.sender.slice(0, 40) : 'Dispositivo',
      device: m.device === 'mobile' ? 'mobile' : 'laptop',
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString()
    }));
}

async function loadDriveMessages() {
  if (!isValidDriveId(airlinkFolderId)) await initializeDriveFolder();
  if (!isValidDriveId(airlinkFolderId)) return;

  try {
    if (!isValidDriveId(messagesFileId)) {
      const q = encodeURIComponent(`'${airlinkFolderId}' in parents and trashed=false and name = 'mensajes.json'`);
      const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const data = await res.json();
      if (data.files && data.files.length > 0 && isValidDriveId(data.files[0].id)) {
        messagesFileId = data.files[0].id;
        localStorage.setItem('airlink_messages_file_id', messagesFileId);
      }
    }

    if (isValidDriveId(messagesFileId)) {
      const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(messagesFileId)}?alt=media`);
      if (res.status === 404) {
        messagesFileId = null;
        localStorage.removeItem('airlink_messages_file_id');
        return;
      }
      if (res.ok) {
        const raw = await res.json();
        if (Array.isArray(raw)) {
          const msgs = sanitizeMessagesArray(raw);
          const currentMsgIds = messagesData.map(m => m.id).join(',');
          const newMsgIds = msgs.map(m => m.id).join(',');
          if (currentMsgIds !== newMsgIds || messagesData.length === 0) {
            if (messagesData.length > 0 && msgs.length > messagesData.length) {
              playChime();
              showToast('💬 Nuevo texto recibido');
              if (activeMainTab !== 'chat' && chatUnreadDot) chatUnreadDot.style.display = 'block';
            }
            messagesData = msgs;
            renderMessages(messagesData);
          }
        }
      }
    }
  } catch (e) {
    console.error('Error cargando mensajes de Drive:', e);
  }
}

async function saveDriveMessages(msgs) {
  if (!isValidDriveId(airlinkFolderId)) await initializeDriveFolder();
  if (!isValidDriveId(airlinkFolderId)) return;

  const content = JSON.stringify(msgs, null, 2);

  try {
    if (isValidDriveId(messagesFileId)) {
      await fetchWithAuth(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(messagesFileId)}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: content
      });
    } else {
      const metadata = {
        name: 'mensajes.json',
        parents: [airlinkFolderId],
        mimeType: 'application/json'
      };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', new Blob([content], { type: 'application/json' }));

      const res = await fetchWithAuth('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        body: form
      });
      const data = await res.json();
      if (data && isValidDriveId(data.id)) {
        messagesFileId = data.id;
        localStorage.setItem('airlink_messages_file_id', messagesFileId);
      }
    }
  } catch (e) {
    console.error('Error guardando mensajes en Drive:', e);
  }
}

function linkifyToFragment(text) {
  const frag = document.createDocumentFragment();
  const str = typeof text === 'string' ? text : '';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      frag.appendChild(document.createTextNode(str.slice(lastIndex, match.index)));
    }
    const candidate = match[0];
    if (isSafeHttpUrl(candidate, false)) {
      const a = document.createElement('a');
      a.href = candidate;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'msg-url-link';
      a.textContent = candidate;
      frag.appendChild(a);
    } else {
      frag.appendChild(document.createTextNode(candidate));
    }
    lastIndex = urlRegex.lastIndex;
  }

  if (lastIndex < str.length) {
    frag.appendChild(document.createTextNode(str.slice(lastIndex)));
  }
  return frag;
}

function renderMessages(messages) {
  messagesData = messages || [];
  const count = messagesData.length;
  if (messagesCount) messagesCount.textContent = count;
  if (tabChatBadge) tabChatBadge.textContent = count;

  if (!chatMessagesList) return;

  if (messagesData.length === 0) {
    if (emptyChatState) chatMessagesList.replaceChildren(emptyChatState);
    else chatMessagesList.replaceChildren();
    return;
  }

  const frag = document.createDocumentFragment();
  const sortedMessages = [...messagesData].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  sortedMessages.forEach(msg => {
    const card = document.createElement('div');
    const myDevice = isMobile ? 'mobile' : 'laptop';
    const isMe = msg.device === myDevice;
    const deviceClass = msg.device === 'mobile' ? 'sender-mobile' : 'sender-laptop';
    card.className = `message-card ${deviceClass}`;

    const date = new Date(msg.createdAt);
    const timeFormatted = isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const senderIcon = msg.device === 'mobile' ? '📱' : '💻';

    const metaRow = document.createElement('div');
    metaRow.className = 'message-meta-row';

    const senderEl = document.createElement('span');
    senderEl.className = 'message-sender';
    senderEl.textContent = `${senderIcon} ${msg.sender}${isMe ? ' (Tú)' : ''}`;

    const timeEl = document.createElement('span');
    timeEl.className = 'message-time';
    timeEl.textContent = timeFormatted;

    metaRow.append(senderEl, timeEl);

    const contentEl = document.createElement('div');
    contentEl.className = 'message-text-content';
    contentEl.appendChild(linkifyToFragment(msg.text));

    const actionsRow = document.createElement('div');
    actionsRow.className = 'message-actions-row';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-msg-action btn-copy-msg';
    copyBtn.type = 'button';
    copyBtn.title = 'Copiar texto al portapapeles';
    copyBtn.appendChild(createSvgIcon(14, 14, [
      ['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }],
      ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]
    ]));
    const copyLabel = document.createElement('span');
    copyLabel.className = 'btn-copy-label';
    copyLabel.textContent = 'Copiar';
    copyBtn.appendChild(copyLabel);
    copyBtn.addEventListener('click', () => copyMessageText(msg.id, copyBtn));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-msg-action delete';
    deleteBtn.type = 'button';
    deleteBtn.title = 'Eliminar mensaje';
    deleteBtn.appendChild(createSvgIcon(13, 13, [
      ['polyline', { points: '3 6 5 6 21 6' }],
      ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }]
    ]));
    deleteBtn.addEventListener('click', () => deleteMessage(msg.id));

    actionsRow.append(copyBtn, deleteBtn);
    card.append(metaRow, contentEl, actionsRow);
    frag.appendChild(card);
  });

  chatMessagesList.replaceChildren(frag);

  if (activeMainTab === 'chat') {
    chatMessagesList.scrollTop = 0;
  }
}

async function copyMessageText(id, btnEl) {
  const msg = messagesData.find(m => m.id === id);
  if (!msg) return;
  try {
    await navigator.clipboard.writeText(msg.text);
    if (btnEl) {
      const label = btnEl.querySelector('.btn-copy-label');
      if (label) label.textContent = '¡Copiado!';
      btnEl.classList.add('copied');
      setTimeout(() => {
        if (label) label.textContent = 'Copiar';
        btnEl.classList.remove('copied');
      }, 2000);
    }
    showToast('¡Texto copiado al portapapeles!');
  } catch (e) {
    showToast('No se pudo copiar automáticamente');
  }
}

async function deleteMessage(id) {
  messagesData = messagesData.filter(m => m.id !== id);
  renderMessages(messagesData);
  await saveDriveMessages(messagesData);
  showToast('Mensaje eliminado');
}

async function sendMessage() {
  if (!isTokenValid()) {
    showToast('Inicia sesión en Google Drive primero');
    requestDriveAccess();
    return;
  }
  const text = (chatInput.value || '').trim();
  if (!text) return;

  const myDevice = isMobile ? 'mobile' : 'laptop';
  const mySender = isMobile ? 'Celular' : 'Laptop';

  const newMsg = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    text,
    sender: mySender,
    device: myDevice,
    createdAt: new Date().toISOString()
  };

  messagesData.unshift(newMsg);
  if (messagesData.length > 300) messagesData.pop();

  chatInput.value = '';
  if (chatCharCounter) chatCharCounter.textContent = '0 caracteres';
  renderMessages(messagesData);

  playChime();
  showToast('Texto enviado');

  await saveDriveMessages(messagesData);
}

if (btnSendText) btnSendText.addEventListener('click', sendMessage);

if (chatInput) {
  chatInput.addEventListener('input', () => {
    if (chatCharCounter) chatCharCounter.textContent = `${chatInput.value.length} caracteres`;
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault();
      sendMessage();
    }
  });
}

if (btnPasteText) {
  btnPasteText.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipText = await navigator.clipboard.readText();
        if (clipText) {
          const current = chatInput.value;
          chatInput.value = current ? current + (current.endsWith('\n') ? '' : '\n') + clipText : clipText;
          if (chatCharCounter) chatCharCounter.textContent = `${chatInput.value.length} caracteres`;
          chatInput.focus();
          showToast('Texto pegado del portapapeles');
        } else {
          showToast('Portapapeles vacío');
        }
      }
    } catch (e) {
      chatInput.focus();
      showToast('Presiona Ctrl+V para pegar');
    }
  });
}

if (btnClearChat) {
  btnClearChat.addEventListener('click', async () => {
    if (!confirm('¿Deseas vaciar todo el historial de textos?')) return;
    messagesData = [];
    renderMessages([]);
    await saveDriveMessages([]);
    showToast('Historial vaciado');
  });
}

// -------------------------------------------------------------
// Control de Pestañas
// -------------------------------------------------------------
function switchMainTab(tab) {
  activeMainTab = tab;
  if (tab === 'files') {
    if (tabNavFiles) {
      tabNavFiles.classList.add('active');
      tabNavFiles.setAttribute('aria-selected', 'true');
    }
    if (tabNavChat) {
      tabNavChat.classList.remove('active');
      tabNavChat.setAttribute('aria-selected', 'false');
    }
    if (filesTabSection) filesTabSection.style.display = 'flex';
    if (chatTabSection) chatTabSection.style.display = 'none';
  } else {
    if (tabNavChat) {
      tabNavChat.classList.add('active');
      tabNavChat.setAttribute('aria-selected', 'true');
    }
    if (tabNavFiles) {
      tabNavFiles.classList.remove('active');
      tabNavFiles.setAttribute('aria-selected', 'false');
    }
    if (filesTabSection) filesTabSection.style.display = 'none';
    if (chatTabSection) chatTabSection.style.display = 'flex';
    if (chatUnreadDot) chatUnreadDot.style.display = 'none';
    if (chatMessagesList) chatMessagesList.scrollTop = 0;
  }
}

if (tabNavFiles) tabNavFiles.addEventListener('click', () => switchMainTab('files'));
if (tabNavChat) tabNavChat.addEventListener('click', () => switchMainTab('chat'));

// Cargar datos a demanda (al iniciar sesión, al refrescar, o tras enviar/recibir)
function loadAllData() {
  if (isTokenValid()) {
    loadDriveFiles();
    loadDriveMessages();
  }
}

// Iniciar aplicación
window.addEventListener('DOMContentLoaded', () => {
  initGoogleAuth();
});

// PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
