const crypto = require('node:crypto');
const { ErrorDeDominio } = require('../../../dominio/errores/errores');
const { validarUuid } = require('../../../dominio/entidades/viaje');

function decodificarBase64Url(valor) {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(valor)) {
    throw new Error('Segmento JWT inválido');
  }
  return Buffer.from(valor, 'base64url');
}

function parsearJsonSegmento(segmento) {
  return JSON.parse(decodificarBase64Url(segmento).toString('utf8'));
}

function extraerTokenBearer(authorization) {
  if (typeof authorization !== 'string') return null;
  const partes = authorization.split(' ');
  return (partes.length === 2 && partes[0] === 'Bearer') ? partes[1] : null;
}

function verificarFirma(segmentoHeader, segmentoPayload, segmentoFirma, secret) {
  const firmaEsperada = crypto
    .createHmac('sha256', secret)
    .update(`${segmentoHeader}.${segmentoPayload}`)
    .digest();
  const firmaRecibida = decodificarBase64Url(segmentoFirma);
  if (firmaRecibida.length !== firmaEsperada.length ||
      !crypto.timingSafeEqual(firmaRecibida, firmaEsperada)) {
    throw new Error('Firma JWT inválida');
  }
}

function validarVigencia(claims) {
  const ahora = Date.now() / 1000;
  if (!Number.isFinite(claims.exp) || claims.exp <= ahora) {
    throw new Error('Token vencido o sin expiración');
  }
  if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > ahora)) {
    throw new Error('Token todavía no válido');
  }
}

function validarEstructuraClaims(claims) {
  validarUuid(claims.sub, 'sub');
  if (!Array.isArray(claims.roles) || claims.roles.some((rol) => typeof rol !== 'string')) {
    throw new Error('Roles JWT inválidos');
  }
  if (claims.permissions !== undefined &&
      (!Array.isArray(claims.permissions) || claims.permissions.some((p) => typeof p !== 'string'))) {
    throw new Error('Permisos JWT inválidos');
  }
}

function verificarYExtraerClaims(token, secret) {
  const segmentos = token.split('.');
  if (segmentos.length !== 3) throw new Error('JWT mal formado');

  const [segmentoHeader, segmentoPayload, segmentoFirma] = segmentos;
  const header = parsearJsonSegmento(segmentoHeader);
  if (header.alg !== 'HS256') throw new Error('Algoritmo JWT no permitido');

  verificarFirma(segmentoHeader, segmentoPayload, segmentoFirma, secret);

  const claims = parsearJsonSegmento(segmentoPayload);
  validarVigencia(claims);
  validarEstructuraClaims(claims);

  return claims;
}

function crearAutenticacionJwt(secret) {
  return function autenticarJwt(req, res, next) {
    if (!secret) {
      return next(new ErrorDeDominio(
        'SERVICE_UNAVAILABLE',
        'La autenticación no está configurada',
        503
      ));
    }

    const token = extraerTokenBearer(req.get('authorization'));
    if (!token) {
      return next(new ErrorDeDominio('UNAUTHORIZED', 'Se requiere un token Bearer', 401));
    }

    try {
      const claims = verificarYExtraerClaims(token, secret);
      req.actor = {
        identificador: claims.sub,
        roles: claims.roles,
        permisos: claims.permissions || []
      };
      return next();
    } catch {
      return next(new ErrorDeDominio('UNAUTHORIZED', 'El token Bearer es inválido', 401));
    }
  };
}

module.exports = { crearAutenticacionJwt };
