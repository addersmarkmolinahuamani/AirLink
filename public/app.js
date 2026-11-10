// AirLink Express - Nube Directa en Google Drive (Serverless)
// Compatible con GitHub Pages, Celular y Laptop sin consumir recursos locales

const DEFAULT_CLIENT_ID = '53478639551-2ndvvqghcmmnld49m3jktf8j2ji1m1pg.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive';

let tokenClient = null;
let accessToken = localStorage.getItem('airlink_drive_token') || null;
let tokenExpiry = parseInt(localStorage.getItem('airlink_token_expiry') || '0', 10);
let airlinkFolderId = localStorage.getItem('airlink_folder_id') || null;
let activeMainTab = 'files';

let filesData = [];
let messagesData = [];
let messagesFileId = localStorage.getItem('airlink_messages_file_id') || null;
let pollTimer = null;

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
function getClientId() {
  return localStorage.getItem('airlink_client_id') || DEFAULT_CLIENT_ID;
}

function initGoogleAuth() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    setTimeout(initGoogleAuth, 300);
    return;
  }

  try {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: getClientId(),
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
      updateAuthUI(false);
    }
  } catch (err) {
    console.error('Error inicializando Google Auth:', err);
    updateAuthUI(false);
  }
}

function isTokenValid() {
  return accessToken && tokenExpiry > Date.now() + 60000;
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

function updateAuthUI(connected) {
  if (connected) {
    if (btnDriveAuth) {
      btnDriveAuth.classList.add('connected');
      btnDriveAuth.title = 'Google Drive Conectado';
    }
    if (driveAuthText) driveAuthText.textContent = 'Drive Conectado ✓';
    if (driveBanner) driveBanner.classList.add('connected');
    if (driveBannerTitle) driveBannerTitle.textContent = '☁️ Google Drive Activo';
    if (driveBannerDesc) driveBannerDesc.textContent = 'Tus archivos se guardan directamente en tu carpeta "AirLink Express" de Google Drive.';
    if (btnDriveAction) {
      btnDriveAction.classList.add('connected');
      btnDriveAction.textContent = '✓ Conectado';
      btnDriveAction.onclick = null;
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
      btnDriveAction.onclick = requestDriveAccess;
    }
  }
}

if (btnDriveAuth) btnDriveAuth.addEventListener('click', requestDriveAccess);
if (btnDriveAction) btnDriveAction.addEventListener('click', requestDriveAccess);

// -------------------------------------------------------------
// Operaciones con Google Drive API v3
// -------------------------------------------------------------
async function fetchWithAuth(url, options = {}) {
  if (!isTokenValid()) {
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
    updateAuthUI(false);
    showToast('Sesión expirada. Toca "Conectar Drive" para renovar.');
    throw new Error('401 Unauthorized');
  }
  return res;
}

// Localizar o crear la carpeta "AirLink Express"
async function initializeDriveFolder() {
  if (airlinkFolderId) {
    // Verificar si aún existe
    try {
      const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${airlinkFolderId}?fields=id,name,trashed`);
      if (res.ok) {
        const d = await res.json();
        if (d && !d.trashed) return airlinkFolderId;
      }
    } catch (e) {}
  }

  try {
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='AirLink Express' and trashed=false");
    const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`);
    const data = await res.json();

    if (data.files && data.files.length > 0) {
      airlinkFolderId = data.files[0].id;
      localStorage.setItem('airlink_folder_id', airlinkFolderId);
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
    airlinkFolderId = folder.id;
    localStorage.setItem('airlink_folder_id', airlinkFolderId);
    return airlinkFolderId;
  } catch (err) {
    console.error('Error buscando/creando carpeta AirLink Express:', err);
    return null;
  }
}

// Cargar lista de archivos de Google Drive
async function loadDriveFiles() {
  if (!airlinkFolderId) await initializeDriveFolder();
  if (!airlinkFolderId) return;

  try {
    const q = encodeURIComponent(`'${airlinkFolderId}' in parents and trashed=false and name != 'mensajes.json'`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,mimeType,createdTime,webViewLink,webContentLink,thumbnailLink)&orderBy=createdTime desc&pageSize=100`;
    
    const res = await fetchWithAuth(url);
    if (!res.ok) return;
    const data = await res.json();
    const newFiles = (data.files || []).map(f => {
      const isImg = f.mimeType && f.mimeType.startsWith('image/');
      const isVid = f.mimeType && f.mimeType.startsWith('video/');
      const isAud = f.mimeType && f.mimeType.startsWith('audio/');
      const isDoc = f.mimeType && (f.mimeType.includes('word') || f.mimeType.includes('document'));
      const isPdf = f.mimeType && f.mimeType.includes('pdf');

      return {
        id: f.id,
        name: f.name,
        size: parseInt(f.size || '0', 10),
        formattedSize: formatBytes(parseInt(f.size || '0', 10)),
        createdAt: f.createdTime,
        mimeType: f.mimeType,
        webViewLink: f.webViewLink,
        webContentLink: f.webContentLink,
        thumbnailLink: f.thumbnailLink,
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

// Renderizar la lista de archivos
function renderFiles(files) {
  if (filesCount) filesCount.textContent = files.length;
  if (tabFilesBadge) tabFilesBadge.textContent = files.length;

  if (!files || files.length === 0) {
    filesList.innerHTML = '';
    filesList.appendChild(emptyState);
    return;
  }

  filesList.innerHTML = '';

  files.forEach(file => {
    const card = document.createElement('div');
    card.className = 'file-card';

    let thumbHtml = '📄';
    if (file.thumbnailLink) {
      thumbHtml = `<img src="${file.thumbnailLink}" alt="${file.name}" loading="lazy">`;
    } else if (file.isImage) {
      thumbHtml = '🖼️';
    } else if (file.isVideo) {
      thumbHtml = '🎥';
    } else if (file.isAudio) {
      thumbHtml = '🎵';
    } else if (file.isPdf) {
      thumbHtml = '📕';
    } else if (file.isDoc) {
      thumbHtml = '📝';
    }

    const dateFormatted = new Date(file.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="file-left">
        <div class="file-thumb">${thumbHtml}</div>
        <div class="file-meta">
          <div class="file-name" title="${file.name}">${file.name}</div>
          <div class="file-sub">${file.formattedSize} • ${dateFormatted}</div>
        </div>
      </div>
      <div class="file-actions">
        <button class="btn-file-action share" onclick="shareDriveFile('${file.id}', this)" title="Compartir directo a WhatsApp u otra app">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
          <span class="share-btn-label">Compartir</span>
        </button>
        <button class="btn-file-action" onclick="downloadDriveFile('${file.id}', '${file.name}', '${file.mimeType}')" title="Descargar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
        <button class="btn-file-action delete" onclick="deleteDriveFile('${file.id}')" title="Eliminar de Drive">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    filesList.appendChild(card);
  });
}

// Descargar archivo desde Google Drive
window.downloadDriveFile = async function(fileId, fileName, mimeType) {
  try {
    showToast(`Descargando ${fileName}...`);
    let downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    let isExport = false;

    if (mimeType && mimeType.startsWith('application/vnd.google-apps.document')) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
      if (!fileName.endsWith('.docx')) fileName += '.docx';
      isExport = true;
    } else if (mimeType && mimeType.startsWith('application/vnd.google-apps.spreadsheet')) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
      if (!fileName.endsWith('.xlsx')) fileName += '.xlsx';
      isExport = true;
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
};

// Compartir directamente a WhatsApp u otras apps móviles (Web Share API)
window.shareDriveFile = async function(fileId, btnEl) {
  const file = filesData.find(f => f.id === fileId);
  if (!file) return;

  if (btnEl) {
    btnEl.classList.add('loading');
    btnEl.innerHTML = `<span>⏳...</span>`;
  }

  try {
    let downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    let fileName = file.name;
    let mimeType = file.mimeType || 'application/octet-stream';

    if (mimeType.startsWith('application/vnd.google-apps.document')) {
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
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
    } else if (file.webViewLink) {
      if (navigator.share) {
        await navigator.share({
          title: fileName,
          url: file.webViewLink
        });
      } else {
        window.open(file.webViewLink, '_blank');
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      showToast('No se pudo abrir el menú de compartir');
    }
  } finally {
    if (btnEl) {
      btnEl.classList.remove('loading');
      btnEl.innerHTML = `
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
        <span class="share-btn-label">Compartir</span>
      `;
    }
  }
};

// Eliminar archivo de Drive
window.deleteDriveFile = async function(fileId) {
  if (!confirm('¿Deseas eliminar este archivo de Google Drive?')) return;
  try {
    const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
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
};

// -------------------------------------------------------------
// Subida de Archivos a Google Drive
// -------------------------------------------------------------
async function uploadFiles(files) {
  if (!isTokenValid()) {
    showToast('Inicia sesión en Google Drive primero');
    requestDriveAccess();
    return;
  }
  if (!airlinkFolderId) await initializeDriveFolder();

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
async function loadDriveMessages() {
  if (!airlinkFolderId) await initializeDriveFolder();
  if (!airlinkFolderId) return;

  try {
    if (!messagesFileId) {
      const q = encodeURIComponent(`'${airlinkFolderId}' in parents and trashed=false and name = 'mensajes.json'`);
      const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const data = await res.json();
      if (data.files && data.files.length > 0) {
        messagesFileId = data.files[0].id;
        localStorage.setItem('airlink_messages_file_id', messagesFileId);
      }
    }

    if (messagesFileId) {
      const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${messagesFileId}?alt=media`);
      if (res.ok) {
        const msgs = await res.json();
        if (Array.isArray(msgs)) {
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
  if (!airlinkFolderId) await initializeDriveFolder();
  if (!airlinkFolderId) return;

  const content = JSON.stringify(msgs, null, 2);

  try {
    if (messagesFileId) {
      // Actualizar archivo existente
      await fetchWithAuth(`https://www.googleapis.com/upload/drive/v3/files/${messagesFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: content
      });
    } else {
      // Crear archivo inicial
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
      if (data && data.id) {
        messagesFileId = data.id;
        localStorage.setItem('airlink_messages_file_id', messagesFileId);
      }
    }
  } catch (e) {
    console.error('Error guardando mensajes en Drive:', e);
  }
}

function renderMessages(messages) {
  messagesData = messages || [];
  const count = messagesData.length;
  if (messagesCount) messagesCount.textContent = count;
  if (tabChatBadge) tabChatBadge.textContent = count;

  if (!chatMessagesList) return;

  if (messagesData.length === 0) {
    chatMessagesList.innerHTML = '';
    if (emptyChatState) chatMessagesList.appendChild(emptyChatState);
    return;
  }

  chatMessagesList.innerHTML = '';

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

    card.innerHTML = `
      <div class="message-meta-row">
        <span class="message-sender">${senderIcon} ${msg.sender} ${isMe ? '(Tú)' : ''}</span>
        <span class="message-time">${timeFormatted}</span>
      </div>
      <div class="message-text-content">${linkify(msg.text)}</div>
      <div class="message-actions-row">
        <button class="btn-msg-action btn-copy-msg" onclick="copyMessageText('${msg.id}', this)" title="Copiar texto al portapapeles">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <span class="btn-copy-label">Copiar</span>
        </button>
        <button class="btn-msg-action delete" onclick="deleteMessage('${msg.id}')" title="Eliminar mensaje">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path></svg>
        </button>
      </div>
    `;

    chatMessagesList.appendChild(card);
  });

  if (activeMainTab === 'chat') {
    chatMessagesList.scrollTop = 0;
  }
}

function linkify(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  const safe = (text || '').replace(/[&<>"']/g, m => map[m]);
  return safe.replace(/(https?:\/\/[^\s]+)/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="msg-url-link">${url}</a>`);
}

window.copyMessageText = async function(id, btnEl) {
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
};

window.deleteMessage = async function(id) {
  messagesData = messagesData.filter(m => m.id !== id);
  renderMessages(messagesData);
  await saveDriveMessages(messagesData);
  showToast('Mensaje eliminado');
};

async function sendMessage() {
  const text = (chatInput.value || '').trim();
  if (!text) return;

  const myDevice = isMobile ? 'mobile' : 'laptop';
  const mySender = isMobile ? 'Celular' : 'Laptop';

  const newMsg = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
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
    if (tabNavFiles) tabNavFiles.classList.add('active');
    if (tabNavChat) tabNavChat.classList.remove('active');
    if (filesTabSection) filesTabSection.style.display = 'flex';
    if (chatTabSection) chatTabSection.style.display = 'none';
  } else {
    if (tabNavChat) tabNavChat.classList.add('active');
    if (tabNavFiles) tabNavFiles.classList.remove('active');
    if (filesTabSection) filesTabSection.style.display = 'none';
    if (chatTabSection) chatTabSection.style.display = 'flex';
    if (chatUnreadDot) chatUnreadDot.style.display = 'none';
    if (chatMessagesList) chatMessagesList.scrollTop = 0;
  }
}
window.switchMainTab = switchMainTab;

// Cargar datos a demanda (al iniciar sesión, al refrescar, o tras enviar/recibir)
function loadAllData() {
  if (isTokenValid()) {
    loadDriveFiles();
    loadDriveMessages();
  }
}

// Modal de configuración de Client ID
const clientIdModal = document.getElementById('clientIdModal');
const btnCloseClientIdModal = document.getElementById('btnCloseClientIdModal');
const customClientIdInput = document.getElementById('customClientIdInput');
const btnSaveClientId = document.getElementById('btnSaveClientId');

if (btnCloseClientIdModal) {
  btnCloseClientIdModal.addEventListener('click', () => {
    if (clientIdModal) clientIdModal.style.display = 'none';
  });
}

if (btnSaveClientId && customClientIdInput) {
  btnSaveClientId.addEventListener('click', () => {
    const val = (customClientIdInput.value || '').trim();
    if (val) {
      localStorage.setItem('airlink_client_id', val);
      if (clientIdModal) clientIdModal.style.display = 'none';
      initGoogleAuth();
      requestDriveAccess();
      showToast('Client ID guardado');
    }
  });
}

// Iniciar aplicación
window.addEventListener('DOMContentLoaded', () => {
  initGoogleAuth();
});

// PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
