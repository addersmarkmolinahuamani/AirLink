// ============================================================================
// AirLink Express - Conector Permanente Seguro (Google Apps Script)
// ============================================================================
// INSTRUCCIONES RÁPIDAS:
// 1. Cambia ACCESS_KEY abajo por una clave secreta tuya (mínimo 8 caracteres).
// 2. Guarda (Ctrl+S), selecciona arriba la función "autorizarYProbar" y pulsa "Ejecutar".
//    (Acepta los permisos de Google Drive una única vez).
// 3. Pulsa "Implementar" -> "Nueva implementación" -> tipo "Aplicación web":
//    - Ejecutar como: Yo (tu cuenta)
//    - Quién tiene acceso: Cualquier usuario
// 4. Copia la URL terminada en /exec y pégala en AirLink junto con tu clave.
// ============================================================================

const ACCESS_KEY = 'CAMBIA_ESTA_CLAVE_POR_UNA_SEGURA';
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

function doGet() {
  return jsonResponse({
    ok: true,
    service: 'AirLink Express Token Broker',
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
    const token = ScriptApp.getOAuthToken();

    return jsonResponse({
      ok: true,
      access_token: token,
      expires_in: 2400
    });
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: 'Solicitud inválida.'
    });
  }
}

// Ejecuta esta función UNA vez en el editor de Apps Script para conceder permiso de Drive
function autorizarYProbar() {
  const root = DriveApp.getRootFolder();
  const token = ScriptApp.getOAuthToken();
  Logger.log('Google Drive verificado: ' + root.getName());
  Logger.log('Token generado correctamente (longitud): ' + (token ? token.length : 0));
}
