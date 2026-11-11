// AirLink Express - Chat Unificado Multimedia en la Nube (Estilo WhatsApp Web)
// Compatible con GitHub Pages, Celular y Laptop sin consumir recursos locales

const CLIENT_ID = '53478639551-2ndvvqghcmmnld49m3jktf8j2ji1m1pg.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive';
const SAFE_DRIVE_ID_RE = /^[a-zA-Z0-9_-]{10,128}$/;
const SAFE_SCRIPT_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]{20,180}\/exec$/;
const clientInstanceId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

function isValidDriveId(id) {
  return typeof id === 'string' && SAFE_DRIVE_ID_RE.test(id);
}

function isValidScriptUrl(url) {
  return typeof url === 'string' && SAFE_SCRIPT_URL_RE.test(url.trim());
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

// Limpiar por única vez tokens antiguos de solo-lectura guardados antes de actualizar Code.gs
if (localStorage.getItem('airlink_token_v6') !== '1') {
  localStorage.removeItem('airlink_drive_token');
  localStorage.removeItem('airlink_token_expiry');
  localStorage.removeItem('airlink_messages_file_id');
  localStorage.setItem('airlink_token_v6', '1');
}

let tokenClient = null;
let tokenRefreshPromise = null;
let accessToken = localStorage.getItem('airlink_drive_token') || null;
let tokenExpiry = parseInt(localStorage.getItem('airlink_token_expiry') || '0', 10);
let tokenSource = localStorage.getItem('airlink_token_source') || 'script';
let scriptSupportsMessages = localStorage.getItem('airlink_script_v2') === '1';
let writePermissionMissing = false;

const storedScriptUrl = localStorage.getItem('airlink_script_url');
let instantScriptUrl = isValidScriptUrl(storedScriptUrl) ? storedScriptUrl.trim() : null;
let instantAccessKey = localStorage.getItem('airlink_access_key') || null;
const storedFolderId = localStorage.getItem('airlink_folder_id');
let airlinkFolderId = isValidDriveId(storedFolderId) ? storedFolderId : null;
let allAirlinkFolderIds = isValidDriveId(airlinkFolderId) ? [airlinkFolderId] : [];
let activeStreamFilter = 'all'; // 'all' | 'messages' | 'files'

function buildParentsQuery() {
  const ids = (allAirlinkFolderIds.length > 0 ? allAirlinkFolderIds : [airlinkFolderId]).filter(isValidDriveId);
  if (ids.length === 0) return '';
  if (ids.length === 1) return `'${ids[0]}' in parents`;
  return `(${ids.map(id => `'${id}' in parents`).join(' or ')})`;
}

function hasInstantConfig() {
  return isValidScriptUrl(instantScriptUrl) && typeof instantAccessKey === 'string' && instantAccessKey.length >= 8;
}

function clearStoredSession(clearFolder = false) {
  accessToken = null;
  tokenExpiry = 0;
  localStorage.removeItem('airlink_drive_token');
  localStorage.removeItem('airlink_token_expiry');
  localStorage.removeItem('airlink_token_source');
  localStorage.removeItem('airlink_client_id');
  if (clearFolder) {
    airlinkFolderId = null;
    allAirlinkFolderIds = [];
    messagesFileId = null;
    localStorage.removeItem('airlink_folder_id');
    localStorage.removeItem('airlink_messages_file_id');
  }
}

let filesData = [];
let messagesData = [];
let hasRenderedFilesOnce = false;
let hasRenderedMessagesOnce = false;
const storedMessagesFileId = localStorage.getItem('airlink_messages_file_id');
let messagesFileId = isValidDriveId(storedMessagesFileId) ? storedMessagesFileId : null;

// Canal en tiempo real (estilo WhatsApp Web)
let realtimeTopic = null;
let realtimeEventSource = null;
let backgroundSyncTimer = null;
let isSyncingFiles = false;
let isSyncingMessages = false;

// Detección de dispositivo (Móvil vs Laptop)
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 860;

// Elementos DOM
const deviceBadge = document.getElementById('deviceBadge');
const deviceText = document.getElementById('deviceText');
const btnDriveAuth = document.getElementById('btnDriveAuth');
const driveAuthText = document.getElementById('driveAuthText');
const driveBanner = document.getElementById('driveBanner');
const driveBannerIcon = document.getElementById('driveBannerIcon');
const driveBannerTitle = document.getElementById('driveBannerTitle');
const driveBannerDesc = document.getElementById('driveBannerDesc');
const btnDriveAction = document.getElementById('btnDriveAction');
const btnGoogleFallback = document.getElementById('btnGoogleFallback');
const btnShareDevice = document.getElementById('btnShareDevice');

const instantSetupModal = document.getElementById('instantSetupModal');
const btnCloseInstantModal = document.getElementById('btnCloseInstantModal');
const scriptUrlInput = document.getElementById('scriptUrlInput');
const accessKeyInput = document.getElementById('accessKeyInput');
const instantSetupError = document.getElementById('instantSetupError');
const btnSaveInstantSetup = document.getElementById('btnSaveInstantSetup');

const shareDeviceModal = document.getElementById('shareDeviceModal');
const btnCloseShareModal = document.getElementById('btnCloseShareModal');
const shareDeviceLinkInput = document.getElementById('shareDeviceLinkInput');
const btnCopyShareLink = document.getElementById('btnCopyShareLink');

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

const chatInput = document.getElementById('chatInput');
const btnSendText = document.getElementById('btnSendText');
const btnPasteText = document.getElementById('btnPasteText');
const btnClearChat = document.getElementById('btnClearChat');
const chatCharCounter = document.getElementById('chatCharCounter');

const filterAll = document.getElementById('filterAll');
const filterMsgs = document.getElementById('filterMsgs');
const filterFiles = document.getElementById('filterFiles');
const countAll = document.getElementById('countAll');
const countMsgs = document.getElementById('countMsgs');
const countFiles = document.getElementById('countFiles');

const unifiedStreamList = document.getElementById('unifiedStreamList');
const emptyStreamState = document.getElementById('emptyStreamState');

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
let toastTimer = null;
function showToast(msg, duration = 3800) {
  if (!toast || !toastMessage) return;
  toastMessage.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
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
// Sincronización en Tiempo Real Tipo WhatsApp Web (Push + Delta Silencioso)
// -------------------------------------------------------------
async function computeRealtimeTopic() {
  const seed = hasInstantConfig()
    ? `airlink_rt_v5_${instantScriptUrl}_${instantAccessKey}`
    : (isValidDriveId(airlinkFolderId) ? `airlink_rt_v5_folder_${airlinkFolderId}` : null);
  if (!seed) return null;

  try {
    const enc = new TextEncoder().encode(seed);
    const hashBuf = await crypto.subtle.digest('SHA-256', enc);
    const hex = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 26);
    return `airlink_ws_${hex}`;
  } catch (e) {
    return null;
  }
}

async function startRealtimeSync() {
  const topic = await computeRealtimeTopic();
  if (!topic) return;

  if (realtimeTopic !== topic || !realtimeEventSource) {
    stopRealtimeSync();
    realtimeTopic = topic;

    try {
      const es = new EventSource(`https://ntfy.sh/${encodeURIComponent(topic)}/sse`);
      es.onmessage = (evt) => {
        try {
          const wrapper = JSON.parse(evt.data);
          if (!wrapper || wrapper.event !== 'message' || !wrapper.message) return;
          const payload = JSON.parse(wrapper.message);
          if (!payload || payload.senderId === clientInstanceId) return;

          if (payload.mfId && isValidDriveId(payload.mfId)) {
            messagesFileId = payload.mfId;
            localStorage.setItem('airlink_messages_file_id', messagesFileId);
          }

          if (payload.type === 'chat') {
            loadDriveMessages({ silent: true });
            setTimeout(() => loadDriveMessages({ silent: true }), 1200);
          } else if (payload.type === 'files') {
            loadDriveFiles({ silent: true });
            setTimeout(() => loadDriveFiles({ silent: true }), 1500);
          } else {
            loadAllData({ silent: true });
          }
        } catch (e) {}
      };
      realtimeEventSource = es;
    } catch (e) {}
  }

  if (!backgroundSyncTimer) {
    backgroundSyncTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && (isTokenValid() || hasInstantConfig())) {
        loadAllData({ silent: true });
      }
    }, 6000);
  }
}

function stopRealtimeSync() {
  if (realtimeEventSource) {
    try { realtimeEventSource.close(); } catch (e) {}
    realtimeEventSource = null;
  }
  realtimeTopic = null;
  if (backgroundSyncTimer) {
    clearInterval(backgroundSyncTimer);
    backgroundSyncTimer = null;
  }
}

async function notifyPeerDevices(type = 'all', extra = {}) {
  if (!realtimeTopic) {
    realtimeTopic = await computeRealtimeTopic();
  }
  if (!realtimeTopic) return;

  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(realtimeTopic)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        senderId: clientInstanceId,
        type,
        t: Date.now(),
        ...extra
      })
    });
  } catch (e) {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (isTokenValid() || hasInstantConfig())) {
    loadAllData({ silent: true });
  }
});

window.addEventListener('focus', () => {
  if (isTokenValid() || hasInstantConfig()) {
    loadAllData({ silent: true });
  }
});

// -------------------------------------------------------------
// Modo Permanente Instantáneo (Apps Script) + GIS Respaldo
// -------------------------------------------------------------
function processHashPairing() {
  try {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#link=')) return false;

    const encoded = hash.slice(6);
    history.replaceState(null, '', window.location.pathname + window.location.search);

    const jsonStr = decodeURIComponent(escape(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))));
    const payload = JSON.parse(jsonStr);
    if (payload && isValidScriptUrl(payload.u) && typeof payload.k === 'string' && payload.k.length >= 8) {
      instantScriptUrl = payload.u.trim();
      instantAccessKey = payload.k;
      localStorage.setItem('airlink_script_url', instantScriptUrl);
      localStorage.setItem('airlink_access_key', instantAccessKey);
      showToast('⚡ Dispositivo vinculado permanentemente');
      return true;
    }
  } catch (e) {
    console.error('Error procesando enlace de vinculación:', e);
  }
  return false;
}

async function callInstantScript(payload = {}, customUrl = null, customKey = null) {
  const targetUrl = (customUrl || instantScriptUrl || '').trim();
  const targetKey = customKey || instantAccessKey || '';
  if (!isValidScriptUrl(targetUrl) || targetKey.length < 8) {
    throw new Error('Configuración instantánea inválida');
  }

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      key: targetKey,
      ...payload
    })
  });

  if (!res.ok) {
    throw new Error(`Error de conexión (${res.status})`);
  }

  return res.json();
}

async function fetchInstantToken(customUrl = null, customKey = null) {
  if (!customUrl && tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  const execRequest = async () => {
    const data = await callInstantScript({ action: 'auth' }, customUrl, customKey);
    if (!data || !data.ok || !data.access_token) {
      throw new Error((data && data.error) || 'No se pudo obtener autorización de Drive');
    }

    accessToken = data.access_token;
    const expiresIn = parseInt(data.expires_in || '2400', 10);
    tokenExpiry = Date.now() + expiresIn * 1000;
    tokenSource = 'script';
    localStorage.setItem('airlink_drive_token', accessToken);
    localStorage.setItem('airlink_token_expiry', String(tokenExpiry));
    localStorage.setItem('airlink_token_source', 'script');

    if (data.folder_id && isValidDriveId(data.folder_id) && !isValidDriveId(airlinkFolderId)) {
      airlinkFolderId = data.folder_id;
      allAirlinkFolderIds = [airlinkFolderId];
      localStorage.setItem('airlink_folder_id', airlinkFolderId);
      updateDriveFolderLink();
    }

    if (Array.isArray(data.messages)) {
      scriptSupportsMessages = true;
      localStorage.setItem('airlink_script_v2', '1');
      writePermissionMissing = false;
    }

    return accessToken;
  };

  if (customUrl) {
    return execRequest();
  }

  tokenRefreshPromise = execRequest().finally(() => {
    tokenRefreshPromise = null;
  });
  return tokenRefreshPromise;
}

async function ensureValidToken() {
  if (isTokenValid()) return true;
  if (hasInstantConfig()) {
    try {
      await fetchInstantToken();
      updateAuthUI(true);
      return true;
    } catch (err) {
      console.error('Error renovando token instantáneo:', err);
      updateAuthUI(false);
      return false;
    }
  }
  return false;
}

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
          tokenSource = 'gis';
          writePermissionMissing = false;
          localStorage.setItem('airlink_drive_token', accessToken);
          localStorage.setItem('airlink_token_expiry', String(tokenExpiry));
          localStorage.setItem('airlink_token_source', 'gis');

          updateAuthUI(true);
          showToast('✅ Permiso de lectura y escritura activado en Google Drive');
          playChime();

          await initializeDriveFolder();
          startRealtimeSync();
          loadAllData({ silent: false });
        }
      }
    });
  } catch (err) {
    console.error('Error inicializando Google Auth:', err);
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
    tokenClient.requestAccessToken({ prompt: '' });
  } else {
    showToast('Cargando servicio de Google... intenta en unos segundos');
  }
}

function markWritePermissionNeeded() {
  writePermissionMissing = true;
  updateAuthUI(true);
  showToast('⚠️ Tu Code.gs actual solo tiene permiso de lectura. Actualízalo o pulsa "🔑 Autorizar Escritura" arriba.', 6000);
}

function openInstantSetupModal() {
  if (instantSetupError) {
    instantSetupError.style.display = 'none';
    instantSetupError.textContent = '';
  }
  if (scriptUrlInput && instantScriptUrl) scriptUrlInput.value = instantScriptUrl;
  if (accessKeyInput) accessKeyInput.value = '';
  if (instantSetupModal) instantSetupModal.style.display = 'flex';
}

function closeInstantSetupModal() {
  if (instantSetupModal) instantSetupModal.style.display = 'none';
}

function openShareDeviceModal() {
  if (!hasInstantConfig()) return;
  const payload = JSON.stringify({ u: instantScriptUrl, k: instantAccessKey });
  const base64 = btoa(unescape(encodeURIComponent(payload)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const magicLink = `${window.location.origin}${window.location.pathname}?v=7#link=${base64}`;
  if (shareDeviceLinkInput) shareDeviceLinkInput.value = magicLink;
  if (shareDeviceModal) shareDeviceModal.style.display = 'flex';
}

function disconnectDrive(unlinkInstant = false) {
  const tokenToRevoke = accessToken;
  const wasInstant = hasInstantConfig();
  stopRealtimeSync();
  clearStoredSession(true);

  if (unlinkInstant || wasInstant) {
    instantScriptUrl = null;
    instantAccessKey = null;
    scriptSupportsMessages = false;
    localStorage.removeItem('airlink_script_url');
    localStorage.removeItem('airlink_access_key');
    localStorage.removeItem('airlink_script_v2');
  }

  filesData = [];
  messagesData = [];
  hasRenderedFilesOnce = false;
  hasRenderedMessagesOnce = false;
  renderUnifiedStream();
  updateAuthUI(false);

  if (btnOpenDriveFolder) {
    btnOpenDriveFolder.href = 'https://drive.google.com';
  }

  if (tokenToRevoke && tokenSource === 'gis' && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
    try {
      google.accounts.oauth2.revoke(tokenToRevoke, () => {});
    } catch (e) {}
  }
  showToast('🔒 Dispositivo desvinculado de Google Drive');
}

function updateAuthUI(connected) {
  const instantActive = hasInstantConfig();

  if (connected) {
    if (btnDriveAuth) {
      btnDriveAuth.classList.add('connected');
      btnDriveAuth.title = 'Clic para desvincular este dispositivo';
    }
    if (driveAuthText) driveAuthText.textContent = instantActive ? '⚡ Drive Activo ✓' : 'Drive Conectado ✓';
    if (driveBanner) driveBanner.classList.add('connected');
    if (driveBannerIcon) driveBannerIcon.textContent = writePermissionMissing ? '⚠️' : (instantActive ? '⚡' : '☁️');
    if (driveBannerTitle) {
      if (writePermissionMissing) {
        driveBannerTitle.textContent = '⚠️ Permiso de Escritura Pendiente en Code.gs';
      } else {
        driveBannerTitle.textContent = instantActive
          ? '⚡ Conexión Instantánea Activa (Tiempo Real)'
          : '☁️ Google Drive Activo (1h)';
      }
    }
    if (driveBannerDesc) {
      if (writePermissionMissing) {
        driveBannerDesc.textContent = 'Tu script actual solo tiene permiso de lectura. Actualiza tu Code.gs o pulsa "🔑 Autorizar Escritura" para enviar.';
      } else {
        driveBannerDesc.textContent = instantActive
          ? 'Sincronizado como WhatsApp Web entre tu Laptop y Celular. Carpeta: "AirLink Express".'
          : 'Tus archivos y textos se guardan directamente en tu carpeta "AirLink Express" de Google Drive.';
      }
    }
    if (btnDriveAction) {
      btnDriveAction.classList.add('connected');
      btnDriveAction.textContent = '✓ Conectado';
    }
    if (btnGoogleFallback) {
      if (writePermissionMissing) {
        btnGoogleFallback.style.display = 'inline-flex';
        btnGoogleFallback.textContent = '🔑 Autorizar Escritura';
      } else {
        btnGoogleFallback.style.display = 'none';
      }
    }
    if (btnShareDevice) btnShareDevice.style.display = instantActive ? 'inline-flex' : 'none';
  } else {
    if (btnDriveAuth) {
      btnDriveAuth.classList.remove('connected');
      btnDriveAuth.title = 'Configurar o conectar Google Drive';
    }
    if (driveAuthText) driveAuthText.textContent = 'Vincular Drive';
    if (driveBanner) driveBanner.classList.remove('connected');
    if (driveBannerIcon) driveBannerIcon.textContent = '⚡';
    if (driveBannerTitle) driveBannerTitle.textContent = 'Acceso Instantáneo a Google Drive';
    if (driveBannerDesc) {
      driveBannerDesc.textContent = 'Vincula este dispositivo una sola vez con tu Apps Script privado para entrar directo sin iniciar sesión cada hora.';
    }
    if (btnDriveAction) {
      btnDriveAction.classList.remove('connected');
      btnDriveAction.textContent = '⚡ Configurar Acceso Rápido';
    }
    if (btnGoogleFallback) {
      btnGoogleFallback.style.display = 'inline-flex';
      btnGoogleFallback.textContent = 'Google (1h)';
    }
    if (btnShareDevice) btnShareDevice.style.display = 'none';
  }
}

if (btnDriveAuth) {
  btnDriveAuth.addEventListener('click', () => {
    if (isTokenValid() || hasInstantConfig()) {
      if (confirm('¿Deseas desvincular este dispositivo y cerrar la sesión de Google Drive?')) {
        disconnectDrive(true);
      }
    } else {
      openInstantSetupModal();
    }
  });
}

if (btnDriveAction) {
  btnDriveAction.addEventListener('click', () => {
    if (!isTokenValid() && !hasInstantConfig()) {
      openInstantSetupModal();
    }
  });
}

if (btnGoogleFallback) {
  btnGoogleFallback.addEventListener('click', requestDriveAccess);
}

if (btnShareDevice) {
  btnShareDevice.addEventListener('click', openShareDeviceModal);
}

if (btnCloseInstantModal) {
  btnCloseInstantModal.addEventListener('click', closeInstantSetupModal);
}

if (btnCloseShareModal) {
  btnCloseShareModal.addEventListener('click', () => {
    if (shareDeviceModal) shareDeviceModal.style.display = 'none';
  });
}

if (btnCopyShareLink && shareDeviceLinkInput) {
  btnCopyShareLink.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareDeviceLinkInput.value);
      showToast('📋 Enlace privado copiado. Ábrelo una vez en tu celular.');
    } catch (e) {
      shareDeviceLinkInput.select();
      showToast('Copia el enlace manualmente');
    }
  });
}

if (btnSaveInstantSetup) {
  btnSaveInstantSetup.addEventListener('click', async () => {
    const urlVal = (scriptUrlInput?.value || '').trim();
    const keyVal = accessKeyInput?.value || '';

    const showSetupError = (msg) => {
      if (instantSetupError) {
        instantSetupError.textContent = msg;
        instantSetupError.style.display = 'block';
      }
    };

    if (!isValidScriptUrl(urlVal)) {
      showSetupError('La URL debe empezar por https://script.google.com/macros/s/... y terminar en /exec');
      return;
    }
    if (keyVal.length < 8) {
      showSetupError('La clave secreta debe tener al menos 8 caracteres.');
      return;
    }

    if (instantSetupError) instantSetupError.style.display = 'none';
    btnSaveInstantSetup.disabled = true;
    const origText = btnSaveInstantSetup.textContent;
    btnSaveInstantSetup.textContent = 'Verificando conexión...';

    try {
      await fetchInstantToken(urlVal, keyVal);
      instantScriptUrl = urlVal;
      instantAccessKey = keyVal;
      localStorage.setItem('airlink_script_url', instantScriptUrl);
      localStorage.setItem('airlink_access_key', instantAccessKey);

      closeInstantSetupModal();
      updateAuthUI(true);
      playChime();
      showToast('⚡ ¡Acceso permanente activado!');
      await initializeDriveFolder();
      startRealtimeSync();
      loadAllData({ silent: false });
    } catch (err) {
      showSetupError(err.message || 'No se pudo conectar con Apps Script. Revisa la URL, la clave y que esté desplegado como "Cualquier usuario".');
    } finally {
      btnSaveInstantSetup.disabled = false;
      btnSaveInstantSetup.textContent = origText;
    }
  });
}

// -------------------------------------------------------------
// Operaciones con Google Drive API v3
// -------------------------------------------------------------
async function fetchWithAuth(url, options = {}) {
  const ready = await ensureValidToken();
  if (!ready) {
    clearStoredSession(false);
    updateAuthUI(false);
    showToast('Conecta tu acceso rápido o Google Drive primero.');
    throw new Error('Token expirado');
  }

  const send = () => fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${accessToken}`
    }
  });

  let res = await send();
  if ((res.status === 401 || res.status === 403) && hasInstantConfig()) {
    clearStoredSession(false);
    try {
      await fetchInstantToken();
      res = await send();
    } catch (e) {}
  }

  if (res.status === 401) {
    clearStoredSession(false);
    updateAuthUI(false);
    showToast('Sesión expirada. Renueva tu conexión.');
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
  try {
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='AirLink Express' and trashed=false");
    const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=createdTime%20asc&fields=files(id,name)`);
    if (res.ok) {
      const data = await res.json();
      const validIds = (data.files || []).map(f => f && f.id).filter(isValidDriveId).slice(0, 5);
      if (validIds.length > 0) {
        airlinkFolderId = validIds[0];
        allAirlinkFolderIds = validIds;
        localStorage.setItem('airlink_folder_id', airlinkFolderId);
        updateDriveFolderLink();
        return airlinkFolderId;
      }
    }

    if (isValidDriveId(airlinkFolderId)) {
      if (!allAirlinkFolderIds.includes(airlinkFolderId)) allAirlinkFolderIds = [airlinkFolderId];
      updateDriveFolderLink();
      return airlinkFolderId;
    }

    const createRes = await fetchWithAuth('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'AirLink Express',
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    if (createRes.status === 403) {
      markWritePermissionNeeded();
      return null;
    }
    const folder = await createRes.json();
    if (folder && isValidDriveId(folder.id)) {
      airlinkFolderId = folder.id;
      allAirlinkFolderIds = [airlinkFolderId];
      localStorage.setItem('airlink_folder_id', airlinkFolderId);
      updateDriveFolderLink();
      return airlinkFolderId;
    }
    return null;
  } catch (err) {
    console.error('Error buscando/creando carpeta AirLink Express:', err);
    return isValidDriveId(airlinkFolderId) ? airlinkFolderId : null;
  }
}

// Cargar lista de archivos de Google Drive (sin parpadeos)
async function loadDriveFiles(opts = {}) {
  if (isSyncingFiles && !opts.force) return;
  isSyncingFiles = true;

  try {
    if (!isValidDriveId(airlinkFolderId) || allAirlinkFolderIds.length === 0) await initializeDriveFolder();
    const parentsClause = buildParentsQuery();
    if (!parentsClause) return;

    const q = encodeURIComponent(`${parentsClause} and trashed=false and name != 'mensajes.json'`);
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
        const isDoc = mime.includes('word') || mime.includes('document') || mime.includes('sheet') || mime.includes('presentation');
        const isPdf = mime.includes('pdf');
        const parsedSize = parseInt(f.size || '0', 10);

        return {
          id: f.id,
          streamType: 'file',
          name: f.name,
          size: Number.isFinite(parsedSize) ? parsedSize : 0,
          formattedSize: formatBytes(Number.isFinite(parsedSize) ? parsedSize : 0),
          createdAt: f.createdTime || new Date(0).toISOString(),
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

    const currentIds = filesData.map(f => f.id).join(',');
    const newIds = newFiles.map(f => f.id).join(',');
    if (!hasRenderedFilesOnce || currentIds !== newIds) {
      if (hasRenderedFilesOnce && newFiles.length > filesData.length && !opts.suppressNewToast) {
        const prevSet = new Set(filesData.map(f => f.id));
        const hasGenuineNew = newFiles.some(f => !prevSet.has(f.id));
        if (hasGenuineNew) {
          playChime();
          showToast('📎 ¡Nuevo archivo recibido en el chat!');
        }
      }
      hasRenderedFilesOnce = true;
      filesData = newFiles;
      renderUnifiedStream();
    }
  } catch (e) {
    console.error('Error cargando archivos de Drive:', e);
  } finally {
    isSyncingFiles = false;
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

function createShareButtonContent(labelText = 'Compartir') {
  const frag = document.createDocumentFragment();
  frag.appendChild(createSvgIcon(14, 14, [
    ['circle', { cx: 18, cy: 5, r: 3 }],
    ['circle', { cx: 6, cy: 12, r: 3 }],
    ['circle', { cx: 18, cy: 19, r: 3 }],
    ['line', { x1: 8.59, y1: 13.51, x2: 15.42, y2: 17.49 }],
    ['line', { x1: 15.41, y1: 6.51, x2: 8.59, y2: 10.49 }]
  ]));
  const label = document.createElement('span');
  label.className = 'share-btn-label';
  label.textContent = labelText;
  frag.appendChild(label);
  return frag;
}

// Descargar archivo desde Google Drive
async function downloadDriveFile(fileId, fileName, mimeType) {
  if (!isValidDriveId(fileId)) return;
  try {
    showToast(`⬇️ Descargando ${fileName}...`);
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

// Compartir archivo directamente a WhatsApp u otras apps móviles (Web Share API)
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
  if (!confirm('¿Deseas eliminar este archivo del chat y de Google Drive?')) return;
  try {
    const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE'
    });
    let deletedOk = res.ok;

    if (!deletedOk && res.status === 403 && hasInstantConfig()) {
      try {
        const fallback = await callInstantScript({ action: 'delete_file', fileId });
        deletedOk = Boolean(fallback && fallback.ok);
      } catch (e) {}
    }

    if (deletedOk) {
      showToast('Archivo eliminado');
      filesData = filesData.filter(f => f.id !== fileId);
      renderUnifiedStream();
      notifyPeerDevices('files');
    } else if (res.status === 403) {
      markWritePermissionNeeded();
    } else {
      showToast('No se pudo eliminar el archivo');
    }
  } catch (err) {
    showToast('Error al eliminar archivo');
  }
}

// -------------------------------------------------------------
// Subida de Archivos al Chat (Con Verificación Real + Respaldo)
// -------------------------------------------------------------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = String(reader.result || '');
      const commaIdx = str.indexOf(',');
      resolve(commaIdx >= 0 ? str.slice(commaIdx + 1) : str);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadFiles(files) {
  const ready = await ensureValidToken();
  if (!ready) {
    showToast('Configura tu acceso rápido o conecta Google primero');
    if (!hasInstantConfig()) openInstantSetupModal();
    return;
  }
  if (!isValidDriveId(airlinkFolderId)) await initializeDriveFolder();
  if (!isValidDriveId(airlinkFolderId)) {
    showToast('No se pudo localizar la carpeta AirLink Express en Drive');
    return;
  }

  // Si había algún texto escrito en la caja al adjuntar, enviarlo también
  if (chatInput && chatInput.value.trim().length > 0) {
    sendMessage();
  }

  progressContainer.style.display = 'flex';
  const total = files.length;
  let completed = 0;
  let permissionDenied = false;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    progressTitle.textContent = `Enviando ${file.name}... (${i + 1}/${total})`;
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

      const upRes = await fetchWithAuth('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
        method: 'POST',
        body: form
      });

      if (upRes.ok) {
        completed++;
        writePermissionMissing = false;
        continue;
      }

      if (upRes.status === 403 && hasInstantConfig() && file.size <= 25 * 1024 * 1024) {
        try {
          const b64 = await fileToBase64(file);
          const scriptUp = await callInstantScript({
            action: 'upload_file',
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            base64: b64
          });
          if (scriptUp && scriptUp.ok && scriptUp.fileId) {
            completed++;
            writePermissionMissing = false;
            continue;
          }
        } catch (fallbackErr) {
          console.error('Respaldo Apps Script falló:', fallbackErr);
        }
      }

      if (upRes.status === 403) {
        permissionDenied = true;
        break;
      }
    } catch (e) {
      console.error('Error subiendo archivo:', file.name, e);
    }
  }

  fileInput.value = '';
  cameraInput.value = '';

  if (completed > 0) {
    progressBarFill.style.width = '100%';
    progressPercent.textContent = '100%';
    progressTitle.textContent = '¡Enviado al chat!';
    playChime();
    showToast(`📎 ¡${completed} archivo(s) enviado(s) al chat!`);

    await loadDriveFiles({ force: true, suppressNewToast: true });
    notifyPeerDevices('files');

    setTimeout(() => {
      progressContainer.style.display = 'none';
      progressBarFill.style.width = '0%';
    }, 900);
  } else {
    progressContainer.style.display = 'none';
    progressBarFill.style.width = '0%';
    if (permissionDenied) {
      markWritePermissionNeeded();
    } else {
      showToast('⚠️ Error al subir el archivo a Google Drive.');
    }
  }
}

// -------------------------------------------------------------
// Pegar Inteligente con Ctrl+V (Capturas, Archivos o Texto en el mismo Chat)
// -------------------------------------------------------------
window.addEventListener('paste', async (e) => {
  const clipboard = e.clipboardData || e.originalEvent?.clipboardData;
  if (!clipboard) return;

  // 1. Si el portapapeles trae una imagen/captura o un archivo copiado, subirlo directo al chat
  const items = clipboard.items || [];
  const filesToUpload = [];

  for (const item of items) {
    if (item.kind === 'file') {
      const blob = item.getAsFile();
      if (!blob) continue;

      if (item.type.startsWith('image/')) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        const ext = item.type.split('/')[1] || 'png';
        filesToUpload.push(new File([blob], `Captura_${timestamp}.${ext}`, { type: item.type }));
      } else {
        filesToUpload.push(blob);
      }
    }
  }

  if (filesToUpload.length > 0) {
    e.preventDefault();
    showToast('📋 Archivo/captura detectada en portapapeles. Enviando al chat...');
    await uploadFiles(filesToUpload);
    return;
  }

  // 2. Si es texto y el usuario no tenía el cursor en la caja de chat, pegarlo ahí automáticamente
  if (document.activeElement !== chatInput && chatInput) {
    const pastedText = clipboard.getData('text/plain');
    if (pastedText) {
      e.preventDefault();
      const current = chatInput.value;
      chatInput.value = current ? current + (current.endsWith('\n') ? '' : '\n') + pastedText : pastedText;
      if (chatCharCounter) chatCharCounter.textContent = `${chatInput.value.length} caracteres`;
      chatInput.focus();
      showToast('📋 Texto pegado en la caja. Pulsa Enter para enviar.');
    }
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
            showToast('📋 Enviando captura del portapapeles al chat...');
            await uploadFiles([file]);
            return;
          }
        }
      }
      showToast('Toma una captura con Win+Shift+S y presiona Ctrl+V');
    } catch (err) {
      showToast('Presiona Ctrl+V directamente para enviar tu captura');
    }
  });
}

// -------------------------------------------------------------
// Drag & Drop en Todo el Cuadro de Chat y Selección de Archivos
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

function triggerManualRefresh(btn) {
  if (btn) {
    btn.style.transform = 'rotate(180deg)';
    setTimeout(() => { btn.style.transform = ''; }, 400);
  }
  loadAllData({ silent: false, force: true });
  showToast('Sincronizando chat...');
}

if (btnRefresh) {
  btnRefresh.addEventListener('click', () => triggerManualRefresh(btnRefresh));
}

// -------------------------------------------------------------
// Mensajes de Texto y Enlaces (Doble Motor: Apps Script + Drive)
// -------------------------------------------------------------
function sanitizeMessagesArray(rawMsgs) {
  if (!Array.isArray(rawMsgs)) return [];
  return rawMsgs
    .filter(m => m && typeof m === 'object' && typeof m.text === 'string' && typeof m.id === 'string')
    .slice(0, 300)
    .map(m => ({
      id: m.id,
      streamType: 'message',
      text: m.text,
      sender: typeof m.sender === 'string' ? m.sender.slice(0, 40) : 'Dispositivo',
      device: m.device === 'mobile' ? 'mobile' : 'laptop',
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString()
    }));
}

function mergeMessageLists(listA, listB) {
  const seen = new Set();
  const combined = [];
  [...(listA || []), ...(listB || [])].forEach(m => {
    if (m && m.id && !seen.has(m.id)) {
      seen.add(m.id);
      combined.push({ ...m, streamType: 'message' });
    }
  });
  combined.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return combined.slice(0, 300);
}

function applyIncomingMessages(msgs, suppressToast = false) {
  if (!Array.isArray(msgs)) return;
  const currentSignature = messagesData.map(m => m.id).join(',');
  const newSignature = msgs.map(m => m.id).join(',');

  if (!hasRenderedMessagesOnce || currentSignature !== newSignature) {
    if (hasRenderedMessagesOnce && msgs.length > messagesData.length && !suppressToast) {
      const prevSet = new Set(messagesData.map(m => m.id));
      const hasNewMsg = msgs.some(m => !prevSet.has(m.id));
      if (hasNewMsg) {
        playChime();
        showToast('💬 Nuevo mensaje recibido en el chat');
      }
    }
    hasRenderedMessagesOnce = true;
    messagesData = msgs;
    renderUnifiedStream();
  }
}

async function resolveMessagesFilesInDrive() {
  const parentsClause = buildParentsQuery();
  if (!parentsClause) return [];
  const q = encodeURIComponent(`${parentsClause} and trashed=false and name = 'mensajes.json'`);
  const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime)`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.files || []).filter(f => f && isValidDriveId(f.id));
}

async function readMessagesFromFileId(fileId) {
  if (!isValidDriveId(fileId)) return null;
  const res = await fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
  if (!res.ok) return null;
  const raw = await res.json();
  return Array.isArray(raw) ? sanitizeMessagesArray(raw) : [];
}

async function fetchLatestDriveMessages() {
  if (!isValidDriveId(airlinkFolderId)) await initializeDriveFolder();
  if (!isValidDriveId(airlinkFolderId)) return null;

  const files = await resolveMessagesFilesInDrive();
  if (files.length === 0) {
    if (isValidDriveId(messagesFileId)) {
      const directMsgs = await readMessagesFromFileId(messagesFileId);
      if (Array.isArray(directMsgs)) return directMsgs;
    }
    messagesFileId = null;
    localStorage.removeItem('airlink_messages_file_id');
    return [];
  }

  messagesFileId = files[0].id;
  localStorage.setItem('airlink_messages_file_id', messagesFileId);

  const primaryMsgs = await readMessagesFromFileId(messagesFileId);
  if (files.length <= 1) {
    return primaryMsgs || [];
  }

  let merged = [...(primaryMsgs || [])];
  for (let i = 1; i < Math.min(files.length, 4); i++) {
    try {
      const extra = await readMessagesFromFileId(files[i].id);
      if (extra) merged = mergeMessageLists(merged, extra);
      fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(files[i].id)}`, { method: 'DELETE' }).catch(() => {});
    } catch (e) {}
  }
  return merged;
}

async function loadDriveMessages(opts = {}) {
  if (isSyncingMessages && !opts.force) return;
  isSyncingMessages = true;

  try {
    const [scriptRes, driveMsgs] = await Promise.all([
      hasInstantConfig()
        ? callInstantScript({ action: 'get_messages' }).catch(() => null)
        : Promise.resolve(null),
      fetchLatestDriveMessages().catch(() => null)
    ]);

    let scriptMsgs = null;
    if (scriptRes && scriptRes.ok && Array.isArray(scriptRes.messages)) {
      scriptSupportsMessages = true;
      localStorage.setItem('airlink_script_v2', '1');
      scriptMsgs = sanitizeMessagesArray(scriptRes.messages);
    }

    if (!Array.isArray(scriptMsgs) && !Array.isArray(driveMsgs)) return;

    const unified = mergeMessageLists(scriptMsgs || [], driveMsgs || []);

    if (Array.isArray(driveMsgs) && unified.length > driveMsgs.length) {
      saveDriveMessages(unified).catch(() => {});
    }
    if (Array.isArray(scriptMsgs) && unified.length > scriptMsgs.length && unified.length > 0) {
      callInstantScript({ action: 'send_message', message: unified[0] }).catch(() => {});
    }

    applyIncomingMessages(unified, Boolean(opts.suppressNewToast));
  } catch (e) {
    console.error('Error cargando mensajes:', e);
  } finally {
    isSyncingMessages = false;
  }
}

async function saveDriveMessages(msgs) {
  if (!isValidDriveId(airlinkFolderId)) await initializeDriveFolder();
  if (!isValidDriveId(airlinkFolderId)) return { ok: false, status: 0 };

  const content = JSON.stringify(msgs, null, 2);

  try {
    const existing = await resolveMessagesFilesInDrive();
    if (existing.length > 0) {
      messagesFileId = existing[0].id;
      localStorage.setItem('airlink_messages_file_id', messagesFileId);
      for (let i = 1; i < existing.length; i++) {
        fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existing[i].id)}`, { method: 'DELETE' }).catch(() => {});
      }
    }

    if (isValidDriveId(messagesFileId)) {
      const patchRes = await fetchWithAuth(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(messagesFileId)}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: content
      });
      if (patchRes.ok) {
        writePermissionMissing = false;
        return { ok: true, status: 200 };
      }
      if (patchRes.status === 404) {
        messagesFileId = null;
        localStorage.removeItem('airlink_messages_file_id');
      } else {
        return { ok: false, status: patchRes.status };
      }
    }

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
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    const data = await res.json();
    if (data && isValidDriveId(data.id)) {
      messagesFileId = data.id;
      localStorage.setItem('airlink_messages_file_id', messagesFileId);
      writePermissionMissing = false;
      return { ok: true, status: 200 };
    }
    return { ok: false, status: 500 };
  } catch (e) {
    console.error('Error guardando mensajes en Drive:', e);
    return { ok: false, status: 500 };
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

// -------------------------------------------------------------
// Renderizado del Flujo Único de Chat (Mensajes + Archivos + Multimedia)
// -------------------------------------------------------------
function getFileBadgeLabel(file) {
  if (file.isImage) return '🖼️ Imagen';
  if (file.isAudio) return '🎵 Audio';
  if (file.isVideo) return '🎥 Video';
  if (file.isPdf) return '📕 PDF';
  if (file.isDoc) return '📝 Documento';
  return '📎 Archivo';
}

function renderUnifiedStream() {
  if (!unifiedStreamList) return;

  const msgCount = messagesData.length;
  const fCount = filesData.length;
  const totalCount = msgCount + fCount;

  if (countAll) countAll.textContent = totalCount;
  if (countMsgs) countMsgs.textContent = msgCount;
  if (countFiles) countFiles.textContent = fCount;

  let combined = [];
  if (activeStreamFilter === 'all') {
    combined = [
      ...messagesData.map(m => ({ ...m, streamType: 'message' })),
      ...filesData.map(f => ({ ...f, streamType: 'file' }))
    ];
  } else if (activeStreamFilter === 'messages') {
    combined = messagesData.map(m => ({ ...m, streamType: 'message' }));
  } else {
    combined = filesData.map(f => ({ ...f, streamType: 'file' }));
  }

  combined.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (combined.length === 0) {
    if (emptyStreamState) unifiedStreamList.replaceChildren(emptyStreamState);
    else unifiedStreamList.replaceChildren();
    return;
  }

  const frag = document.createDocumentFragment();
  const myDevice = isMobile ? 'mobile' : 'laptop';

  combined.forEach(item => {
    const card = document.createElement('div');
    const date = new Date(item.createdAt);
    const timeFormatted = isNaN(date.getTime())
      ? ''
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (item.streamType === 'message') {
      const isMe = item.device === myDevice;
      const deviceClass = item.device === 'mobile' ? 'sender-mobile' : 'sender-laptop';
      card.className = `message-card ${deviceClass}`;

      const senderIcon = item.device === 'mobile' ? '📱' : '💻';
      const headerRow = document.createElement('div');
      headerRow.className = 'message-header';

      const senderInfo = document.createElement('div');
      senderInfo.className = 'message-sender-info';

      const senderBadge = document.createElement('span');
      senderBadge.className = 'message-sender-badge';
      senderBadge.textContent = `${senderIcon} ${item.sender}${isMe ? ' (Tú)' : ''}`;

      const timeEl = document.createElement('span');
      timeEl.className = 'message-time';
      timeEl.textContent = timeFormatted;

      senderInfo.append(senderBadge, timeEl);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'message-actions';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-msg-copy';
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
      copyBtn.addEventListener('click', () => copyMessageText(item.id, copyBtn));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-msg-delete';
      deleteBtn.type = 'button';
      deleteBtn.title = 'Eliminar mensaje';
      deleteBtn.appendChild(createSvgIcon(13, 13, [
        ['polyline', { points: '3 6 5 6 21 6' }],
        ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }]
      ]));
      deleteBtn.addEventListener('click', () => deleteMessage(item.id));

      actionsRow.append(copyBtn, deleteBtn);
      headerRow.append(senderInfo, actionsRow);

      const bodyEl = document.createElement('div');
      bodyEl.className = 'message-body';
      bodyEl.appendChild(linkifyToFragment(item.text));

      card.append(headerRow, bodyEl);
    } else {
      // Burbuja Multimedia / Archivo dentro del mismo Chat
      card.className = 'message-card sender-file';

      const headerRow = document.createElement('div');
      headerRow.className = 'message-header';

      const senderInfo = document.createElement('div');
      senderInfo.className = 'message-sender-info';

      const senderBadge = document.createElement('span');
      senderBadge.className = 'message-sender-badge';
      senderBadge.textContent = getFileBadgeLabel(item);

      const timeEl = document.createElement('span');
      timeEl.className = 'message-time';
      timeEl.textContent = timeFormatted ? `${item.formattedSize} • ${timeFormatted}` : item.formattedSize;

      senderInfo.append(senderBadge, timeEl);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'message-actions';

      const shareBtn = document.createElement('button');
      shareBtn.className = 'btn-msg-share';
      shareBtn.type = 'button';
      shareBtn.title = 'Compartir directo a WhatsApp u otra app';
      shareBtn.appendChild(createShareButtonContent('Compartir'));
      shareBtn.addEventListener('click', () => shareDriveFile(item.id, shareBtn));

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'btn-msg-copy';
      downloadBtn.type = 'button';
      downloadBtn.title = 'Descargar archivo';
      downloadBtn.appendChild(createSvgIcon(14, 14, [
        ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
        ['polyline', { points: '7 10 12 15 17 10' }],
        ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }]
      ]));
      const dlLabel = document.createElement('span');
      dlLabel.textContent = 'Descargar';
      downloadBtn.appendChild(dlLabel);
      downloadBtn.addEventListener('click', () => downloadDriveFile(item.id, item.name, item.mimeType));

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-msg-delete';
      deleteBtn.type = 'button';
      deleteBtn.title = 'Eliminar archivo';
      deleteBtn.appendChild(createSvgIcon(13, 13, [
        ['polyline', { points: '3 6 5 6 21 6' }],
        ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }]
      ]));
      deleteBtn.addEventListener('click', () => deleteDriveFile(item.id));

      actionsRow.append(shareBtn, downloadBtn, deleteBtn);
      headerRow.append(senderInfo, actionsRow);

      const fileBox = document.createElement('div');
      fileBox.className = 'chat-file-content';

      const thumb = document.createElement('div');
      thumb.className = 'chat-file-thumb';
      thumb.title = 'Clic para descargar';
      if (item.thumbnailLink) {
        const img = document.createElement('img');
        img.src = item.thumbnailLink;
        img.alt = item.name;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        thumb.appendChild(img);
      } else if (item.isImage) {
        thumb.textContent = '🖼️';
      } else if (item.isVideo) {
        thumb.textContent = '🎥';
      } else if (item.isAudio) {
        thumb.textContent = '🎵';
      } else if (item.isPdf) {
        thumb.textContent = '📕';
      } else if (item.isDoc) {
        thumb.textContent = '📝';
      } else {
        thumb.textContent = '📄';
      }
      thumb.addEventListener('click', () => downloadDriveFile(item.id, item.name, item.mimeType));

      const details = document.createElement('div');
      details.className = 'chat-file-details';

      const titleEl = document.createElement('div');
      titleEl.className = 'chat-file-title';
      titleEl.textContent = item.name;
      titleEl.title = 'Clic para descargar ' + item.name;
      titleEl.addEventListener('click', () => downloadDriveFile(item.id, item.name, item.mimeType));

      const metaEl = document.createElement('div');
      metaEl.className = 'chat-file-meta';
      metaEl.textContent = `${item.formattedSize} • Guardado en AirLink Express`;

      details.append(titleEl, metaEl);
      fileBox.append(thumb, details);
      card.append(headerRow, fileBox);
    }

    frag.appendChild(card);
  });

  unifiedStreamList.replaceChildren(frag);
}

// Filtros rápidos dentro del mismo chat
function setStreamFilter(filter) {
  activeStreamFilter = filter;
  if (filterAll) filterAll.classList.toggle('active', filter === 'all');
  if (filterMsgs) filterMsgs.classList.toggle('active', filter === 'messages');
  if (filterFiles) filterFiles.classList.toggle('active', filter === 'files');
  renderUnifiedStream();
}

if (filterAll) filterAll.addEventListener('click', () => setStreamFilter('all'));
if (filterMsgs) filterMsgs.addEventListener('click', () => setStreamFilter('messages'));
if (filterFiles) filterFiles.addEventListener('click', () => setStreamFilter('files'));

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
  renderUnifiedStream();

  await Promise.all([
    hasInstantConfig()
      ? callInstantScript({ action: 'delete_message', messageId: id }).catch(() => {})
      : Promise.resolve(),
    saveDriveMessages(messagesData).catch(() => {})
  ]);
  notifyPeerDevices('chat', { mfId: messagesFileId });
  showToast('Mensaje eliminado');
}

async function sendMessage() {
  const ready = await ensureValidToken();
  if (!ready) {
    showToast('Configura tu acceso rápido o conecta Google primero');
    if (!hasInstantConfig()) openInstantSetupModal();
    return;
  }
  const text = (chatInput.value || '').trim();
  if (!text) return;

  const myDevice = isMobile ? 'mobile' : 'laptop';
  const mySender = isMobile ? 'Celular' : 'Laptop';

  const newMsg = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    streamType: 'message',
    text,
    sender: mySender,
    device: myDevice,
    createdAt: new Date().toISOString()
  };

  const previousMessages = [...messagesData];
  chatInput.value = '';
  if (chatCharCounter) chatCharCounter.textContent = '0 caracteres';

  messagesData = [newMsg, ...messagesData.filter(m => m.id !== newMsg.id)].slice(0, 300);
  hasRenderedMessagesOnce = true;
  renderUnifiedStream();

  let savedScript = false;
  let savedDrive = false;
  let permissionError = false;

  if (hasInstantConfig()) {
    try {
      const res = await callInstantScript({
        action: 'send_message',
        message: newMsg
      });
      if (res && res.ok && Array.isArray(res.messages)) {
        scriptSupportsMessages = true;
        localStorage.setItem('airlink_script_v2', '1');
        messagesData = mergeMessageLists(messagesData, sanitizeMessagesArray(res.messages));
        renderUnifiedStream();
        savedScript = true;
      }
    } catch (e) {}
  }

  try {
    const remoteMsgs = await fetchLatestDriveMessages();
    if (Array.isArray(remoteMsgs) && remoteMsgs.length > 0) {
      messagesData = mergeMessageLists(messagesData, remoteMsgs);
      renderUnifiedStream();
    }
  } catch (e) {}

  const driveRes = await saveDriveMessages(messagesData);
  savedDrive = driveRes.ok;
  if (driveRes.status === 403 && !savedScript) {
    permissionError = true;
  }

  if (savedScript || savedDrive) {
    playChime();
    showToast('💬 Mensaje enviado al chat');
    notifyPeerDevices('chat', { mfId: messagesFileId });
  } else {
    messagesData = previousMessages;
    renderUnifiedStream();
    chatInput.value = text;
    if (chatCharCounter) chatCharCounter.textContent = `${text.length} caracteres`;

    if (permissionError) {
      markWritePermissionNeeded();
    } else {
      showToast('⚠️ No se pudo enviar el texto. Verifica tu conexión.');
    }
  }
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
    if (!confirm('¿Deseas limpiar los mensajes de texto del chat? (Tus archivos de Drive se mantienen intactos)')) return;
    messagesData = [];
    renderUnifiedStream();
    await Promise.all([
      hasInstantConfig()
        ? callInstantScript({ action: 'clear_messages' }).catch(() => {})
        : Promise.resolve(),
      saveDriveMessages([]).catch(() => {})
    ]);
    notifyPeerDevices('chat', { mfId: messagesFileId });
    showToast('Mensajes de texto limpiados');
  });
}

// Cargar datos (silenciosamente en segundo plano o al iniciar)
async function loadAllData(opts = {}) {
  if (await ensureValidToken()) {
    loadDriveFiles(opts);
    loadDriveMessages(opts);
  }
}

// -------------------------------------------------------------
// Instalar App (PWA) y Recibir Archivos Compartidos desde WhatsApp
// -------------------------------------------------------------
const btnInstallPwa = document.getElementById('btnInstallPwa');
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (btnInstallPwa) {
    btnInstallPwa.style.display = 'inline-flex';
  }
});

if (btnInstallPwa) {
  btnInstallPwa.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showToast('Abre el menú de Chrome (⋮) y pulsa "Instalar aplicación"');
      return;
    }
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (outcome === 'accepted') {
      btnInstallPwa.style.display = 'none';
      showToast('📲 ¡AirLink instalado! Ya aparecerá en el menú Compartir de WhatsApp.');
    }
  });
}

function readAndClearSharedQueue() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('airlink_share_db', 1);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('shared_queue')) {
          db.createObjectStore('shared_queue', { keyPath: 'id' });
        }
      };
      req.onsuccess = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('shared_queue')) {
          db.close();
          resolve(null);
          return;
        }
        const tx = db.transaction('shared_queue', 'readwrite');
        const store = tx.objectStore('shared_queue');
        const getReq = store.get('latest');
        getReq.onsuccess = () => {
          const data = getReq.result || null;
          if (data) store.delete('latest');
          tx.oncomplete = () => {
            db.close();
            resolve(data);
          };
        };
        getReq.onerror = () => {
          db.close();
          resolve(null);
        };
      };
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

async function consumeIncomingShareTarget() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('shared')) {
      history.replaceState(null, '', window.location.pathname);
    }

    const shared = await readAndClearSharedQueue();
    if (!shared) return;

    const sharedFiles = Array.isArray(shared.files) ? shared.files.filter(Boolean) : [];
    const textParts = [shared.title, shared.text, shared.url]
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean);
    const combinedText = textParts.join('\n');

    if ( combinedText && chatInput ) {
      chatInput.value = combinedText;
      if (chatCharCounter) chatCharCounter.textContent = `${combinedText.length} caracteres`;
    }

    if (sharedFiles.length > 0) {
      showToast(`📲 Enviando ${sharedFiles.length} archivo(s) desde WhatsApp al chat...`);
      await uploadFiles(sharedFiles);
    } else if (combinedText) {
      await sendMessage();
    }
  } catch (e) {
    console.error('Error procesando elemento compartido:', e);
  }
}

// Iniciar aplicación
window.addEventListener('DOMContentLoaded', async () => {
  processHashPairing();
  initGoogleAuth();

  if (hasInstantConfig()) {
    if (driveBannerTitle) driveBannerTitle.textContent = '⚡ Conectando al instante...';
    if (await ensureValidToken()) {
      updateAuthUI(true);
      await initializeDriveFolder();
      startRealtimeSync();
      await loadAllData({ suppressNewToast: true });
      await consumeIncomingShareTarget();
    } else {
      updateAuthUI(false);
    }
  } else if (isTokenValid()) {
    updateAuthUI(true);
    await initializeDriveFolder();
    startRealtimeSync();
    await loadAllData({ suppressNewToast: true });
    await consumeIncomingShareTarget();
  } else {
    clearStoredSession(false);
    updateAuthUI(false);
  }
});

// PWA Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js?v=9').then((reg) => {
    reg.update().catch(() => {});
  }).catch(() => {});
}
