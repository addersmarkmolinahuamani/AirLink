// ============================================================================
// AirLink Express - Conector Permanente Tipo WhatsApp Web (Google Apps Script)
// ============================================================================
// INSTRUCCIONES PARA ACTIVAR ESCRITURA Y TEXTO EN TIEMPO REAL:
// 1. Pon tu clave secreta en ACCESS_KEY abajo (mínimo 8 caracteres).
// 2. Guarda (Ctrl+S), selecciona arriba "autorizarYProbar" y pulsa "Ejecutar".
//    -> ¡IMPORTANTE! Google te pedirá permiso de ESCRITURA en Drive. Acéptalo.
// 3. Pulsa "Implementar" -> "Gestionar implementaciones" -> icono Lápiz (Editar)
//    -> en Versión elige "Nueva versión" -> pulsa "Implementar".
//    (Así tu URL /exec se mantiene igual y no necesitas volver a vincular).
// ============================================================================

const ACCESS_KEY = 'CAMBIA_ESTA_CLAVE_POR_UNA_SEGURA';
const FOLDER_NAME = 'AirLink Express';
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_SECONDS = 300; // 5 minutos de bloqueo tras 8 intentos fallidos

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= (ca ^ cb);
  }
  return diff === 0;
}

// Garantiza que Apps Script solicite el permiso completo de LECTURA y ESCRITURA
// (https://www.googleapis.com/auth/drive) y devuelve el ID de "AirLink Express"
function ensureAirLinkFolder() {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('AIRLINK_FOLDER_ID');
  if (cachedId) {
    try {
      const existing = DriveApp.getFolderById(cachedId);
      if (existing && !existing.isTrashed()) {
        return existing.getId();
      }
    } catch (e) {}
  }

  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  while (folders.hasNext()) {
    const folder = folders.next();
    if (!folder.isTrashed()) {
      props.setProperty('AIRLINK_FOLDER_ID', folder.getId());
      return folder.getId();
    }
  }

  const created = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('AIRLINK_FOLDER_ID', created.getId());
  return created.getId();
}

// Almacenamiento instantáneo para Texto y Portapapeles (sin demoras de indexación)
function getStoredMessages() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('AIRLINK_MESSAGES');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveStoredMessages(msgs) {
  const clean = Array.isArray(msgs) ? msgs.slice(0, 80) : [];
  PropertiesService.getScriptProperties().setProperty('AIRLINK_MESSAGES', JSON.stringify(clean));
  return clean;
}

function doGet() {
  return jsonResponse({
    ok: true,
    service: 'AirLink Express Token & Sync Broker v2',
    message: 'Endpoint activo. Utiliza POST desde AirLink Express.'
  });
}

function doPost(e) {
  try {
    if (!ACCESS_KEY || ACCESS_KEY === 'CAMBIA_ESTA_CLAVE_POR_UNA_SEGURA' || ACCESS_KEY.length < 8) {
      return jsonResponse({
        ok: false,
        error: 'Debes configurar una ACCESS_KEY propia (mínimo 8 caracteres) en Code.gs.'
      });
    }

    const cache = CacheService.getScriptCache();
    const failCount = parseInt(cache.get('airlink_fails') || '0', 10);
    if (failCount >= MAX_FAILED_ATTEMPTS) {
      return jsonResponse({
        ok: false,
        error: 'Demasiados intentos fallidos. Espera 5 minutos.'
      });
    }

    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    const providedKey = typeof body.key === 'string' ? body.key : '';

    if (!constantTimeEquals(providedKey, ACCESS_KEY)) {
      cache.put('airlink_fails', String(failCount + 1), LOCKOUT_SECONDS);
      return jsonResponse({
        ok: false,
        error: 'Clave de acceso incorrecta.'
      });
    }

    cache.remove('airlink_fails');
    const action = body.action || 'auth';

    // Acción 1: Obtener mensajes de texto/portapapeles al instante
    if (action === 'get_messages') {
      return jsonResponse({
        ok: true,
        messages: getStoredMessages()
      });
    }

    // Acción 2: Enviar un nuevo texto/portapapeles de forma atómica
    if (action === 'send_message' && body.message) {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const current = getStoredMessages();
        const msg = body.message;
        const filtered = current.filter(function(m) { return m && m.id !== msg.id; });
        filtered.unshift({
          id: String(msg.id || ('msg_' + Date.now())),
          text: String(msg.text || '').slice(0, 10000),
          sender: String(msg.sender || 'Dispositivo').slice(0, 40),
          device: msg.device === 'mobile' ? 'mobile' : 'laptop',
          createdAt: String(msg.createdAt || new Date().toISOString())
        });
        const saved = saveStoredMessages(filtered);
        return jsonResponse({ ok: true, messages: saved });
      } finally {
        lock.releaseLock();
      }
    }

    // Acción 3: Eliminar un mensaje individual
    if (action === 'delete_message' && body.messageId) {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const current = getStoredMessages();
        const saved = saveStoredMessages(current.filter(function(m) { return m && m.id !== body.messageId; }));
        return jsonResponse({ ok: true, messages: saved });
      } finally {
        lock.releaseLock();
      }
    }

    // Acción 4: Vaciar historial de mensajes
    if (action === 'clear_messages') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        saveStoredMessages([]);
        return jsonResponse({ ok: true, messages: [] });
      } finally {
        lock.releaseLock();
      }
    }

    // Acción 5: Subida directa de respaldo mediante Apps Script
    if (action === 'upload_file' && body.base64 && body.name) {
      const folderId = ensureAirLinkFolder();
      const folder = DriveApp.getFolderById(folderId);
      const bytes = Utilities.base64Decode(body.base64);
      const blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', body.name);
      const createdFile = folder.createFile(blob);
      return jsonResponse({
        ok: true,
        fileId: createdFile.getId(),
        name: createdFile.getName()
      });
    }

    // Acción 6: Eliminar archivo de Drive
    if (action === 'delete_file' && body.fileId) {
      DriveApp.getFileById(body.fileId).setTrashed(true);
      return jsonResponse({ ok: true });
    }

    // Acción por defecto ('auth'): devolver token OAuth de lectura/escritura + carpeta + mensajes
    const folderId = ensureAirLinkFolder();
    const token = ScriptApp.getOAuthToken();

    return jsonResponse({
      ok: true,
      access_token: token,
      expires_in: 2400,
      folder_id: folderId,
      messages: getStoredMessages(),
      write_enabled: true
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'Error en Apps Script: ' + (err && err.message ? err.message : String(err))
    });
  }
}

// ¡EJECUTA ESTA FUNCIÓN UNA VEZ EN EL EDITOR PARA DAR PERMISO DE ESCRITURA!
function autorizarYProbar() {
  // Llamadas explícitas para que Google Apps Script active el permiso total de lectura/escritura
  if (false) {
    DriveApp.createFolder('temp');
    DriveApp.createFile('temp.txt', '');
  }
  const folderId = ensureAirLinkFolder();
  const folder = DriveApp.getFolderById(folderId);
  const token = ScriptApp.getOAuthToken();
  Logger.log('✅ Permisos de LECTURA y ESCRITURA activados correctamente.');
  Logger.log('📁 Carpeta AirLink Express lista (ID): ' + folder.getId());
  Logger.log('🔑 Token generado correctamente (longitud): ' + (token ? token.length : 0));
}
