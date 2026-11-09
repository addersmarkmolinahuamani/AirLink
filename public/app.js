// Estado de la Aplicación
let currentMode = 'internet'; // 'internet' o 'local'
let serverData = {
  localUrl: '',
  publicUrl: '',
  localPairUrl: '',
  publicPairUrl: '',
  localQrCode: '',
  publicQrCode: '',
  pairId: ''
};

// Detección de dispositivo (Móvil vs Laptop)
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 860;

// Detección de Vinculación Permanente Inicial (Estilo WhatsApp Web)
const urlParams = new URLSearchParams(window.location.search);
const incomingPairId = urlParams.get('pair');
if (incomingPairId) {
  localStorage.setItem('airlink_pair_id', incomingPairId);
  urlParams.delete('pair');
  const cleanUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
  window.history.replaceState({}, document.title, cleanUrl);
}

// Elementos DOM
const deviceBadge = document.getElementById('deviceBadge');
const deviceText = document.getElementById('deviceText');
const uploadTitle = document.getElementById('uploadTitle');
const uploadTargetBadge = document.getElementById('uploadTargetBadge');
const qrImage = document.getElementById('qrImage');
const qrLoading = document.getElementById('qrLoading');
const activeUrlInput = document.getElementById('activeUrlInput');
const btnCopyUrl = document.getElementById('btnCopyUrl');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const cameraInput = document.getElementById('cameraInput');
const btnSelectFiles = document.getElementById('btnSelectFiles');
const btnPasteCapture = document.getElementById('btnPasteCapture');
const btnCamera = document.getElementById('btnCamera');
const btnOpenFolder = document.getElementById('btnOpenFolder');
const progressContainer = document.getElementById('progressContainer');
const progressBarFill = document.getElementById('progressBarFill');
const progressPercent = document.getElementById('progressPercent');
const progressInfo = document.getElementById('progressInfo');
const filesList = document.getElementById('filesList');
const filesCount = document.getElementById('filesCount');
const btnRefresh = document.getElementById('btnRefresh');
const emptyState = document.getElementById('emptyState');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Elementos de Pestañas
const tabNavFiles = document.getElementById('tabNavFiles');
const tabNavChat = document.getElementById('tabNavChat');
const tabFilesBadge = document.getElementById('tabFilesBadge');
const tabChatBadge = document.getElementById('tabChatBadge');
const chatUnreadDot = document.getElementById('chatUnreadDot');
const filesTabSection = document.getElementById('filesTabSection');
const chatTabSection = document.getElementById('chatTabSection');
const chatTargetDeviceText = document.getElementById('chatTargetDeviceText');

// Elementos de Chat y Portapapeles
const chatInput = document.getElementById('chatInput');
const btnPasteText = document.getElementById('btnPasteText');
const chatCharCounter = document.getElementById('chatCharCounter');
const btnSendText = document.getElementById('btnSendText');
const btnClearChat = document.getElementById('btnClearChat');
const messagesCount = document.getElementById('messagesCount');
const chatMessagesList = document.getElementById('chatMessagesList');
const emptyChatState = document.getElementById('emptyChatState');

let activeMainTab = 'files';
let messagesData = [];
let filesData = [];
let pendingShareFileObj = null;

// Inferir MIME type por extensión para que WhatsApp y el sistema reconozcan el archivo
function getMimeTypeFromName(filename, fallbackType) {
  if (fallbackType && fallbackType !== 'application/octet-stream') return fallbackType;
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    txt: 'text/plain',
    csv: 'text/csv'
  };
  return map[ext] || 'application/octet-stream';
}

// Configuración visual según el dispositivo
const dropSubtext = document.getElementById('dropSubtext');
if (isMobile) {
  document.body.classList.add('is-mobile-device');
  deviceText.textContent = 'Celular';
  deviceBadge.querySelector('.device-icon').textContent = '📱';
  uploadTitle.textContent = 'Enviar a la Laptop';
  uploadTargetBadge.textContent = 'Destino: Tu Laptop 💻';
  if (chatTargetDeviceText) chatTargetDeviceText.textContent = 'Laptop';
  if (btnPasteCapture) btnPasteCapture.style.display = 'none'; // Ocultar Pegar Captura en celular
  if (dropSubtext) dropSubtext.textContent = 'Fotos, videos, documentos sin compresión ni límite';
} else {
  deviceText.textContent = 'Laptop';
  deviceBadge.querySelector('.device-icon').textContent = '💻';
  uploadTitle.textContent = 'Enviar al Celular';
  uploadTargetBadge.textContent = 'Destino: Tu Celular 📱';
  if (chatTargetDeviceText) chatTargetDeviceText.textContent = 'Celular';
  if (btnCamera) btnCamera.style.display = 'none'; // Ocultar botón de cámara en laptop
  if (btnPasteCapture) btnPasteCapture.style.display = 'inline-flex';
  if (dropSubtext) dropSubtext.innerHTML = 'Fotos, videos, documentos o presiona <strong style="color:var(--text-main);">Ctrl+V</strong> para pegar capturas';
}

// Reproducir sonido sutil de notificación con Web Audio API
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // Silencio si no está permitido
  }
}

// Mostrar Toast
function showToast(msg) {
  toastMessage.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Cambiar modo de red (Internet vs Wi-Fi Local)
function switchNetworkMode(mode) {
  currentMode = mode;
  document.getElementById('tabInternet').classList.toggle('active', mode === 'internet');
  document.getElementById('tabLocal').classList.toggle('active', mode === 'local');
  updateQrDisplay();
}

// Actualizar la visualización del código QR y enlace de vinculación permanente
function updateQrDisplay() {
  const pairStatusBadgeText = document.getElementById('pairStatusBadgeText');
  const permanentPairCard = document.getElementById('permanentPairCard');

  if (currentMode === 'internet') {
    const publicUrlToUse = serverData.publicPairUrl || serverData.publicUrl;
    if (publicUrlToUse && serverData.publicQrCode) {
      qrImage.src = serverData.publicQrCode;
      qrImage.style.display = 'block';
      qrLoading.style.display = 'none';
      activeUrlInput.value = publicUrlToUse;
      if (pairStatusBadgeText) pairStatusBadgeText.textContent = 'Código QR listo para escanear';
    } else {
      qrImage.style.display = 'none';
      qrLoading.style.display = 'flex';
      qrLoading.querySelector('span').textContent = 'Generando enlace seguro con Cloudflare...';
      activeUrlInput.value = 'Esperando túnel seguro...';
      if (pairStatusBadgeText) pairStatusBadgeText.textContent = 'Generando enlace seguro...';
    }
  } else {
    // Modo Local
    const localUrlToUse = serverData.localPairUrl || serverData.localUrl;
    if (localUrlToUse && serverData.localQrCode) {
      qrImage.src = serverData.localQrCode;
      qrImage.style.display = 'block';
      qrLoading.style.display = 'none';
      activeUrlInput.value = localUrlToUse;
      if (pairStatusBadgeText) pairStatusBadgeText.textContent = 'Código QR local (Wi-Fi) listo';
    }
  }
}

// Copiar URL al portapapeles
btnCopyUrl.addEventListener('click', async () => {
  const url = activeUrlInput.value;
  if (!url || url.startsWith('Cargando') || url.startsWith('Esperando')) return;
  try {
    await navigator.clipboard.writeText(url);
    showToast('¡Enlace copiado al portapapeles!');
  } catch (err) {
    activeUrlInput.select();
    document.execCommand('copy');
    showToast('¡Enlace copiado!');
  }
});

// Abrir carpeta en Windows (Solo Laptop)
if (btnOpenFolder) {
  btnOpenFolder.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/open-folder', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Carpeta abierta en tu explorador de archivos');
      }
    } catch (e) {
      showToast('No se pudo abrir la carpeta automáticamente');
    }
  });
}

// Actualizar estado visual de Google Drive
function updateDriveUI(connected) {
  const btnDriveBadge = document.getElementById('btnDriveBadge');
  const driveStatusText = document.getElementById('driveStatusText');
  const driveBanner = document.getElementById('driveBanner');
  const driveBannerTitle = document.getElementById('driveBannerTitle');
  const driveBannerDesc = document.getElementById('driveBannerDesc');
  const btnDriveAction = document.getElementById('btnDriveAction');

  if (connected) {
    if (btnDriveBadge) {
      btnDriveBadge.classList.add('connected');
      btnDriveBadge.title = 'Google Drive conectado: respaldo activo';
    }
    if (driveStatusText) driveStatusText.textContent = 'Drive Activo';
    if (driveBanner) {
      driveBanner.classList.add('connected');
    }
    if (driveBannerTitle) driveBannerTitle.textContent = '☁️ Google Drive Activo';
    if (driveBannerDesc) driveBannerDesc.textContent = 'Tus archivos se respaldan automáticamente en la carpeta "AirLink Express" de Google Drive.';
    if (btnDriveAction) {
      btnDriveAction.classList.add('connected');
      btnDriveAction.textContent = '✓ Conectado';
      btnDriveAction.removeAttribute('href');
      btnDriveAction.style.pointerEvents = 'none';
    }
  } else {
    if (btnDriveBadge) {
      btnDriveBadge.classList.remove('connected');
      btnDriveBadge.title = 'Conectar con Google Drive';
    }
    if (driveStatusText) driveStatusText.textContent = 'Conectar Drive';
    if (driveBanner) {
      driveBanner.classList.remove('connected');
    }
    if (driveBannerTitle) driveBannerTitle.textContent = 'Respaldo en Google Drive';
    if (driveBannerDesc) driveBannerDesc.textContent = 'Conecta tu cuenta para transferir sin límites ni caídas entre WhatsApp y Laptop.';
    if (btnDriveAction) {
      btnDriveAction.classList.remove('connected');
      btnDriveAction.textContent = 'Conectar Drive';
      btnDriveAction.setAttribute('href', '/auth/google');
      btnDriveAction.style.pointerEvents = 'auto';
    }
  }
}

async function checkDriveStatus() {
  try {
    const res = await fetch('/api/info');
    if (res.ok) {
      const data = await res.json();
      updateDriveUI(!!data.driveConnected);
    }
  } catch (e) {}
}

// Inicializar Conexión SSE en tiempo real
let sseReconnectAttempts = 0;
function initEventSource() {
  const evtSource = new EventSource('/api/events');

  evtSource.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    serverData = { ...serverData, ...data };
    updateQrDisplay();
    updateDriveUI(data.driveConnected);
    
    // Guardar pairId en móvil de forma permanente
    if (data.pairId) {
      localStorage.setItem('airlink_pair_id', data.pairId);
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SAVE_PAIR_ID', pairId: data.pairId });
      }
    }

    fetchFiles();
    if (data.messages) {
      renderMessages(data.messages);
    } else {
      fetchMessages();
    }
  });

  evtSource.addEventListener('drive_status_updated', (e) => {
    const data = JSON.parse(e.data);
    updateDriveUI(data.connected);
    if (data.connected) {
      playChime();
      showToast('☁️ ¡Google Drive vinculado exitosamente!');
    }
  });

  evtSource.addEventListener('tunnel_ready', (e) => {
    const data = JSON.parse(e.data);
    serverData = { ...serverData, ...data };
    updateQrDisplay();
    showToast('Túnel seguro de Internet activo');
  });

  evtSource.addEventListener('pair_reset', (e) => {
    const data = JSON.parse(e.data);
    serverData = { ...serverData, ...data };
    updateQrDisplay();
    showToast('Código de vinculación regenerado');
  });

  evtSource.addEventListener('files_updated', (e) => {
    const data = JSON.parse(e.data);
    playChime();
    showToast(data.message || 'Nuevo archivo transferido');
    if (data.totalFiles) {
      renderFiles(data.totalFiles);
    } else {
      fetchFiles();
    }
  });

  evtSource.addEventListener('new_message', (e) => {
    const data = JSON.parse(e.data);
    renderMessages(data.totalMessages);
    const myDevice = isMobile ? 'mobile' : 'laptop';
    if (data.message && data.message.device !== myDevice) {
      playChime();
      const snippet = data.message.text.length > 35 ? data.message.text.slice(0, 35) + '...' : data.message.text;
      showToast(`💬 ${data.message.sender}: ${snippet}`);
      if (activeMainTab !== 'chat' && chatUnreadDot) {
        chatUnreadDot.style.display = 'block';
      }
    }
  });

  evtSource.addEventListener('messages_updated', (e) => {
    const data = JSON.parse(e.data);
    renderMessages(data.totalMessages);
  });

  evtSource.onerror = async () => {
    document.getElementById('connectionStatus').textContent = 'Reconectando...';
    // Si estamos en el celular y la conexión falló, buscar automáticamente la nueva dirección de la laptop
    if (isMobile) {
      sseReconnectAttempts++;
      if (sseReconnectAttempts >= 2) {
        const pairId = localStorage.getItem('airlink_pair_id');
        if (pairId) {
          try {
            const res = await fetch(`https://ntfy.sh/airlink_hub_${pairId}/json?poll=1&since=24h`);
            if (res.ok) {
              const text = await res.text();
              const lines = text.trim().split('\n').filter(Boolean);
              for (let i = lines.length - 1; i >= 0; i--) {
                const parsed = JSON.parse(lines[i]);
                if (parsed.message) {
                  const d = JSON.parse(parsed.message);
                  if (d && d.publicUrl && d.publicUrl !== window.location.origin) {
                    window.location.href = d.publicUrl;
                    return;
                  }
                }
              }
            }
          } catch (err) {}
        }
      }
    }
  };

  evtSource.onopen = () => {
    sseReconnectAttempts = 0;
    document.getElementById('connectionStatus').textContent = 'Conectado en vivo';
  };
}

// Obtener lista de archivos del servidor
async function fetchFiles() {
  try {
    const res = await fetch('/api/files');
    const files = await res.json();
    renderFiles(files);
  } catch (err) {
    console.error('Error al obtener archivos:', err);
  }
}

// Renderizar la lista de archivos
function renderFiles(files) {
  filesData = files || [];
  const count = filesData.length;
  filesCount.textContent = count;
  if (tabFilesBadge) tabFilesBadge.textContent = count;

  if (!files || files.length === 0) {
    filesList.innerHTML = '';
    filesList.appendChild(emptyState);
    return;
  }

  filesList.innerHTML = '';

  files.forEach(file => {
    const card = document.createElement('div');
    card.className = 'file-card';

    // Determinar thumbnail o icono según tipo de archivo
    let thumbHtml = '📄';
    if (file.isImage) {
      thumbHtml = `<img src="${file.previewUrl}" alt="${file.name}" loading="lazy">`;
    } else if (file.isVideo) {
      thumbHtml = '🎥';
    } else if (file.isAudio) {
      thumbHtml = '🎵';
    } else if (file.isPdf) {
      thumbHtml = '📕';
    } else if (/\.(zip|rar|7z|tar|gz)$/i.test(file.name)) {
      thumbHtml = '📦';
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
        <button class="btn-file-action share" onclick="shareFile('${file.id}', this)" title="Compartir directo a WhatsApp u otra app">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
          <span class="share-btn-label">Compartir</span>
        </button>
        <a href="${file.url}" download class="btn-file-action" title="Descargar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </a>
        <button class="btn-file-action delete" onclick="deleteFile('${file.id}')" title="Eliminar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    filesList.appendChild(card);
  });
}

// Compartir archivo directamente a WhatsApp u otras apps del celular (Web Share API Level 2)
async function shareFile(id, btnEl) {
  const file = filesData.find(f => f.id === id);
  if (!file) return;

  if (!navigator.share) {
    showToast('Tu navegador no soporta compartir directo. Descargando archivo...');
    window.location.href = file.url;
    return;
  }

  const originalHtml = btnEl ? btnEl.innerHTML : '';
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.classList.add('loading');
    btnEl.innerHTML = `<span class="share-btn-label">⏳...</span>`;
  }

  try {
    const res = await fetch(file.previewUrl);
    if (!res.ok) throw new Error('No se pudo obtener el archivo');
    const blob = await res.blob();
    const mimeType = getMimeTypeFromName(file.name, blob.type);
    const fileObj = new File([blob], file.name, { type: mimeType });

    if (navigator.canShare && navigator.canShare({ files: [fileObj] })) {
      try {
        await navigator.share({
          files: [fileObj],
          title: file.name
        });
      } catch (shareErr) {
        if (shareErr.name === 'AbortError') return;
        // Si el archivo tardó varios segundos en prepararse y el navegador pide un toque adicional
        if (shareErr.name === 'NotAllowedError') {
          pendingShareFileObj = fileObj;
          const modal = document.getElementById('shareReadyModal');
          const nameEl = document.getElementById('shareReadyFileName');
          if (nameEl) nameEl.textContent = `"${file.name}" está listo. Toca el botón para enviarlo directo por WhatsApp.`;
          if (modal) modal.style.display = 'flex';
          return;
        }
        throw shareErr;
      }
    } else {
      // Fallback: compartir enlace si el navegador no soporta compartir archivos binarios
      await navigator.share({
        title: file.name,
        text: `Archivo: ${file.name}`,
        url: window.location.origin + file.url
      });
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('No se pudo compartir directamente');
    }
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.classList.remove('loading');
      btnEl.innerHTML = originalHtml;
    }
  }
}
window.shareFile = shareFile;

// Eliminar archivo
async function deleteFile(id) {
  if (!confirm('¿Deseas eliminar este archivo?')) return;
  try {
    const res = await fetch(`/api/files/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Archivo eliminado');
    }
  } catch (err) {
    showToast('Error al eliminar');
  }
}

// Subida de archivos con progreso en tiempo real
function uploadFiles(files) {
  if (!files || files.length === 0) return;

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  const senderType = isMobile ? 'mobile' : 'laptop';
  const xhr = new XMLHttpRequest();

  progressContainer.style.display = 'flex';
  progressBarFill.style.width = '0%';
  progressPercent.textContent = '0%';
  progressInfo.textContent = `Preparando ${files.length} archivo(s)...`;

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 100);
      progressBarFill.style.width = `${percent}%`;
      progressPercent.textContent = `${percent}%`;
      
      const loadedMb = (e.loaded / (1024 * 1024)).toFixed(1);
      const totalMb = (e.total / (1024 * 1024)).toFixed(1);
      progressInfo.textContent = `${loadedMb} MB de ${totalMb} MB transferidos`;
    }
  });

  xhr.addEventListener('load', () => {
    progressContainer.style.display = 'none';
    if (xhr.status >= 200 && xhr.status < 300) {
      playChime();
      showToast('¡Transferencia completada con éxito!');
      fileInput.value = '';
      cameraInput.value = '';
    } else {
      showToast('Hubo un error al transferir los archivos');
    }
  });

  xhr.addEventListener('error', () => {
    progressContainer.style.display = 'none';
    showToast('Error de red al transferir');
  });

  xhr.open('POST', `/api/upload?sender=${senderType}`);
  xhr.send(formData);
}

// Controladores de selección de archivos
btnSelectFiles.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

if (btnCamera) {
  btnCamera.addEventListener('click', (e) => {
    e.stopPropagation();
    cameraInput.click();
  });
}

// Generar nombre descriptivo con timestamp para la captura
function generateCaptureFilename(ext = '.png') {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `Captura_${dateStr}${ext}`;
}

// Subir una captura o imagen proveniente del portapapeles
function handlePastedImage(blob) {
  const ext = blob.type === 'image/jpeg' ? '.jpg' : '.png';
  const filename = generateCaptureFilename(ext);
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  showToast(`📸 Captura detectada: ${filename}`);
  uploadFiles([file]);
}

// Evento de clic en el botón "Pegar Captura"
if (btnPasteCapture) {
  btnPasteCapture.addEventListener('click', async (e) => {
    e.stopPropagation(); // Evitar abrir selector de archivos de dropZone
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const clipboardItems = await navigator.clipboard.read();
        let found = false;
        for (const item of clipboardItems) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              handlePastedImage(blob);
              found = true;
              return;
            }
          }
        }
        if (!found) {
          showToast('No hay una imagen copiada. Toma una captura y presiona Ctrl+V.');
        }
      } else {
        showToast('Presiona Ctrl+V para pegar tu captura de pantalla.');
      }
    } catch (err) {
      // Bloqueo de permisos o navegador incompatible con lectura async directa
      showToast('Presiona Ctrl+V para pegar la captura directamente.');
    }
  });
}

// Listener de atajo de teclado Ctrl+V (paste) en la pestaña "Archivos"
window.addEventListener('paste', (e) => {
  // Solo procesar si estamos en la pestaña Archivos
  if (activeMainTab !== 'files') return;

  // Evitar interferir si el usuario está enfocado en un campo de texto interactivo
  const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if (activeTag === 'input' || activeTag === 'textarea') return;

  const clipboardData = e.clipboardData || window.clipboardData;
  if (!clipboardData) return;

  // 1. Si se copiaron archivos en el explorador de Windows
  if (clipboardData.files && clipboardData.files.length > 0) {
    e.preventDefault();
    showToast(`Pegando ${clipboardData.files.length} archivo(s)...`);
    uploadFiles(clipboardData.files);
    return;
  }

  // 2. Si se copió una imagen o captura de pantalla
  const items = clipboardData.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type && item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          handlePastedImage(blob);
          return;
        }
      }
    }
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    uploadFiles(fileInput.files);
  }
});

cameraInput.addEventListener('change', () => {
  if (cameraInput.files.length > 0) {
    uploadFiles(cameraInput.files);
  }
});

// Drag and drop
dropZone.addEventListener('click', () => {
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
  const files = dt.files;
  if (files && files.length > 0) {
    uploadFiles(files);
  }
});

btnRefresh.addEventListener('click', async () => {
  btnRefresh.style.transform = 'rotate(180deg)';
  setTimeout(() => { btnRefresh.style.transform = ''; }, 400);
  fetchFiles();
  try {
    await fetch('/api/drive/sync', { method: 'POST' });
    fetchFiles();
  } catch (e) {}
});

// -------------------------------------------------------------
// Control de Pestañas (Archivos vs Texto & Portapapeles)
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
    if (chatTabSection) chatTabSection.style.display = 'flex';
    if (filesTabSection) filesTabSection.style.display = 'none';
    if (chatUnreadDot) chatUnreadDot.style.display = 'none'; // Quitar indicador de no leídos
    if (chatInput) {
      setTimeout(() => chatInput.focus(), 60);
    }
    if (chatMessagesList) {
      chatMessagesList.scrollTop = 0;
    }
  }
}
window.switchMainTab = switchMainTab;

// -------------------------------------------------------------
// Funciones de Chat y Portapapeles
// -------------------------------------------------------------
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function linkify(text) {
  const safeText = escapeHtml(text);
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return safeText.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="msg-url-link">${url}</a>`;
  });
}

// Renderizar la lista de mensajes
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
    const senderLabel = `${senderIcon} ${msg.sender}${isMe ? ' (Tú)' : ''}`;

    const formattedBody = linkify(msg.text);

    card.innerHTML = `
      <div class="message-header">
        <div class="message-sender-info">
          <span class="message-sender-badge">${senderLabel}</span>
          <span class="message-time">${timeFormatted}</span>
        </div>
        <div class="message-actions">
          <button class="btn-msg-share" title="Compartir directo a WhatsApp u otra app">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
            <span>Compartir</span>
          </button>
          <button class="btn-msg-copy" title="Copiar al portapapeles">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copiar</span>
          </button>
          <button class="btn-msg-delete" title="Eliminar este mensaje">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
      <div class="message-body">${formattedBody}</div>
    `;

    // Botón Compartir Texto (WhatsApp / Nativo)
    const shareBtn = card.querySelector('.btn-msg-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        if (navigator.share) {
          try {
            await navigator.share({ text: msg.text });
          } catch (e) {}
        } else {
          window.open(`https://wa.me/?text=${encodeURIComponent(msg.text)}`, '_blank');
        }
      });
    }

    // Botón Copiar
    const copyBtn = card.querySelector('.btn-msg-copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(msg.text);
      } catch (err) {
        const ta = document.createElement('textarea');
        ta.value = msg.text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      copyBtn.classList.add('copied');
      copyBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>¡Copiado!</span>
      `;
      showToast('¡Texto copiado al portapapeles!');
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <span>Copiar</span>
        `;
      }, 1800);
    });

    // Botón Eliminar
    const delBtn = card.querySelector('.btn-msg-delete');
    delBtn.addEventListener('click', () => {
      deleteMessage(msg.id);
    });

    chatMessagesList.appendChild(card);
  });

  if (activeMainTab === 'chat') {
    chatMessagesList.scrollTop = 0;
  }
}

// Enviar Mensaje
async function sendMessage() {
  if (!chatInput) return;
  const text = chatInput.value.trim();
  if (!text) {
    chatInput.focus();
    return;
  }

  if (btnSendText) btnSendText.disabled = true;
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        sender: isMobile ? 'Celular' : 'Laptop',
        device: isMobile ? 'mobile' : 'laptop'
      })
    });
    const data = await res.json();
    if (data.success) {
      chatInput.value = '';
      if (chatCharCounter) chatCharCounter.textContent = '0 caracteres';
      chatInput.focus();
    } else {
      showToast(data.error || 'Error al enviar texto');
    }
  } catch (err) {
    showToast('Error de conexión al enviar texto');
  } finally {
    if (btnSendText) btnSendText.disabled = false;
  }
}

// Eliminar Mensaje individual
async function deleteMessage(id) {
  try {
    const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Texto eliminado');
    }
  } catch (err) {
    showToast('Error al eliminar mensaje');
  }
}

// Obtener mensajes del servidor
async function fetchMessages() {
  try {
    const res = await fetch('/api/messages');
    const messages = await res.json();
    renderMessages(messages);
  } catch (err) {
    console.error('Error al obtener mensajes:', err);
  }
}

// Controles de entrada de texto
if (chatInput) {
  chatInput.addEventListener('input', () => {
    if (chatCharCounter) {
      const len = chatInput.value.length;
      chatCharCounter.textContent = `${len} caracter${len === 1 ? '' : 'es'}`;
    }
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault();
      sendMessage();
    }
  });
}

if (btnSendText) {
  btnSendText.addEventListener('click', sendMessage);
}

if (btnPasteText) {
  btnPasteText.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipText = await navigator.clipboard.readText();
        if (clipText) {
          const current = chatInput.value;
          chatInput.value = current ? current + (current.endsWith('\n') ? '' : '\n') + clipText : clipText;
          if (chatCharCounter) {
            chatCharCounter.textContent = `${chatInput.value.length} caracteres`;
          }
          chatInput.focus();
          showToast('Texto pegado del portapapeles');
        } else {
          showToast('El portapapeles está vacío');
          chatInput.focus();
        }
      } else {
        chatInput.focus();
        showToast('Presiona Ctrl+V o mantén presionado para pegar');
      }
    } catch (err) {
      chatInput.focus();
      showToast('Presiona Ctrl+V o mantén presionado para pegar');
    }
  });
}

if (btnClearChat) {
  btnClearChat.addEventListener('click', async () => {
    if (!messagesData || messagesData.length === 0) {
      showToast('No hay textos para vaciar');
      return;
    }
    if (!confirm('¿Deseas vaciar todo el historial de textos?')) return;
    try {
      const res = await fetch('/api/messages', { method: 'DELETE' });
      if (res.ok) {
        showToast('Historial de textos vaciado');
      }
    } catch (err) {
      showToast('Error al vaciar textos');
    }
  });
}

// Iniciar todo
initEventSource();
checkDriveStatus();
fetchFiles();
fetchMessages();

// Auto-refrescar estado al volver al navegador o desbloquear el celular
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkDriveStatus();
    fetchFiles();
  }
});
window.addEventListener('focus', () => {
  checkDriveStatus();
  fetchFiles();
});

// Registrar Service Worker para PWA (Instalar como App) y actualizarlo
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        reg.update();
      })
      .catch(() => {});
  });
}

// -------------------------------------------------------------
// Control de Vinculación / Escaneo de nuevo QR / Desvinculación
// -------------------------------------------------------------
const btnPairOptions = document.getElementById('btnPairOptions');
const reconnectModal = document.getElementById('reconnectModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnStartScan = document.getElementById('btnStartScan');
const btnUnpairDevice = document.getElementById('btnUnpairDevice');
const scannerContainer = document.getElementById('scannerContainer');
const modalActions = document.getElementById('modalActions');
const scannerVideo = document.getElementById('scannerVideo');
const btnStopScanner = document.getElementById('btnStopScanner');
const manualUrlInput = document.getElementById('manualUrlInput');
const btnConnectManual = document.getElementById('btnConnectManual');

let activeMediaStream = null;
let scanInterval = null;

function openReconnectModal() {
  if (reconnectModal) reconnectModal.style.display = 'flex';
}

function closeReconnectModal() {
  stopCamera();
  if (reconnectModal) reconnectModal.style.display = 'none';
}

if (btnPairOptions) {
  btnPairOptions.addEventListener('click', openReconnectModal);
}

if (btnCloseModal) {
  btnCloseModal.addEventListener('click', closeReconnectModal);
}

if (btnUnpairDevice) {
  btnUnpairDevice.addEventListener('click', () => {
    if (confirm('¿Deseas desvincular este dispositivo de tu Laptop? Tendrás que escanear el QR nuevamente para conectar.')) {
      localStorage.removeItem('airlink_pair_id');
      showToast('Dispositivo desvinculado');
      setTimeout(() => {
        window.location.href = '/conectar.html';
      }, 300);
    }
  });
}

window.addEventListener('offline', () => {
  showToast('Sin conexión de red');
});

function stopCamera() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  if (activeMediaStream) {
    activeMediaStream.getTracks().forEach(track => track.stop());
    activeMediaStream = null;
  }
  if (scannerContainer) scannerContainer.style.display = 'none';
  if (modalActions) modalActions.style.display = 'flex';
}

if (btnStopScanner) {
  btnStopScanner.addEventListener('click', stopCamera);
}

// Iniciar escáner con la cámara
if (btnStartScan) {
  btnStartScan.addEventListener('click', async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Tu navegador no permite acceso a la cámara. Por favor escribe o pega la dirección manualmente abajo.');
      return;
    }

    try {
      modalActions.style.display = 'none';
      scannerContainer.style.display = 'flex';

      activeMediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });

      scannerVideo.srcObject = activeMediaStream;
      await scannerVideo.play();

      if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        scanInterval = setInterval(async () => {
          try {
            const barcodes = await detector.detect(scannerVideo);
            if (barcodes && barcodes.length > 0) {
              const detected = barcodes[0].rawValue;
              if (detected.startsWith('http://') || detected.startsWith('https://')) {
                playChime();
                stopCamera();
                showToast('¡Código QR detectado! Vinculando...');
                window.location.href = detected;
              }
            }
          } catch (err) {}
        }, 250);
      } else {
        showToast('Apunta al QR de tu Laptop');
      }
    } catch (err) {
      stopCamera();
      alert('No se pudo acceder a la cámara. Puedes escribir la dirección IP o enlace abajo para conectar.');
    }
  });
}

// Conexión manual por IP o enlace
function connectToUrl(inputVal) {
  let url = inputVal.trim();
  if (!url) return;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.includes('trycloudflare.com')) {
      url = 'https://' + url;
    } else {
      url = 'http://' + url;
    }
  }

  showToast('Conectando a ' + url + '...');
  setTimeout(() => {
    window.location.href = url;
  }, 300);
}

if (btnConnectManual) {
  btnConnectManual.addEventListener('click', () => {
    connectToUrl(manualUrlInput.value);
  });
}

if (manualUrlInput) {
  manualUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      connectToUrl(manualUrlInput.value);
    }
  });
}

// -------------------------------------------------------------
// Modal de confirmación rápida para compartir archivos pesados
// -------------------------------------------------------------
const shareReadyModal = document.getElementById('shareReadyModal');
const btnCloseShareModal = document.getElementById('btnCloseShareModal');
const btnConfirmShareNow = document.getElementById('btnConfirmShareNow');

if (btnCloseShareModal && shareReadyModal) {
  btnCloseShareModal.addEventListener('click', () => {
    shareReadyModal.style.display = 'none';
    pendingShareFileObj = null;
  });
}

if (btnConfirmShareNow && shareReadyModal) {
  btnConfirmShareNow.addEventListener('click', async () => {
    const fileObj = pendingShareFileObj;
    shareReadyModal.style.display = 'none';
    pendingShareFileObj = null;
    if (fileObj && navigator.share) {
      try {
        await navigator.share({
          files: [fileObj],
          title: fileObj.name
        });
      } catch (e) {}
    }
  });
}

// -------------------------------------------------------------
// Instalación de PWA (Para aparecer en "Compartir" desde WhatsApp)
// -------------------------------------------------------------
let deferredInstallPrompt = null;
const btnInstallPwa = document.getElementById('btnInstallPwa');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (btnInstallPwa && isMobile) {
    btnInstallPwa.style.display = 'inline-flex';
  }
});

if (btnInstallPwa) {
  btnInstallPwa.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      btnInstallPwa.style.display = 'none';
      showToast('¡App instalada! Ya aparecerá en el menú Compartir de tu celular');
    }
    deferredInstallPrompt = null;
  });
}

// -------------------------------------------------------------
// Detectar cuando se abrió la app tras compartir desde WhatsApp u otra app
// -------------------------------------------------------------
(function checkSharedFromExternalApp() {
  const params = new URLSearchParams(window.location.search);
  const sharedType = params.get('shared');
  if (sharedType) {
    if (sharedType === 'files') {
      switchMainTab('files');
      setTimeout(() => {
        playChime();
        showToast('¡Archivo recibido desde la app externa y enviado a la Laptop!');
      }, 400);
    } else if (sharedType === 'text') {
      switchMainTab('chat');
      setTimeout(() => {
        playChime();
        showToast('¡Texto recibido y sincronizado con la Laptop!');
      }, 400);
    } else if (sharedType === 'error') {
      setTimeout(() => showToast('Error al recibir el archivo compartido'), 400);
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }
})();


