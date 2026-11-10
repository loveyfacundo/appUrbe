const crypto = require('node:crypto');
const { ErrorDeDominio } = require('../../../dominio/errores/errores');
const { validarUuid } = require('../../../dominio/entidades/viaje');

function decodificarBase64Url(valor) {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(valor)) {
    throw new Error('Segmento JWT inválido');
  }
  return Buffer.from(valor, 'base64url');
}

function crearAutenticacionJwt(secret) {
  return function autenticarJwt(req, res, next) {
    try {
      if (!secret) {
        return next(new ErrorDeDominio(
          'SERVICE_UNAVAILABLE',
          'La autenticación no está configurada',
          503
        ));
      }

      const authorization = req.get('authorization');
      const partes = typeof authorization === 'string' ? authorization.split(' ') : [];
      if (partes.length !== 2 || partes[0] !== 'Bearer') {
        return next(new ErrorDeDominio('UNAUTHORIZED', 'Se requiere un token Bearer', 401));
      }

      const segmentos = partes[1].split('.');
      if (segmentos.length !== 3) throw new Error('JWT mal formado');
      const [segmentoHeader, segmentoPayload, segmentoFirma] = segmentos;
      const header = JSON.parse(decodificarBase64Url(segmentoHeader).toString('utf8'));
      const claims = JSON.parse(decodificarBase64Url(segmentoPayload).toString('utf8'));
      if (header.alg !== 'HS256') throw new Error('Algoritmo JWT no permitido');

      const firmaEsperada = crypto
        .createHmac('sha256', secret)
        .update(`${segmentoHeader}.${segmentoPayload}`)
        .digest();
      const firmaRecibida = decodificarBase64Url(segmentoFirma);
      if (firmaRecibida.length !== firmaEsperada.length ||
          !crypto.timingSafeEqual(firmaRecibida, firmaEsperada)) {
        throw new Error('Firma JWT inválida');
      }
      if (!Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) {
        throw new Error('Token vencido o sin expiración');
      }
      if (claims.nbf !== undefined &&
          (!Number.isFinite(claims.nbf) || claims.nbf > Date.now() / 1000)) {
        throw new Error('Token todavía no válido');
      }
      validarUuid(claims.sub, 'sub');
      if (!Array.isArray(claims.roles) ||
          claims.roles.some((rol) => typeof rol !== 'string')) {
        throw new Error('Roles JWT inválidos');
      }
      if (claims.permissions !== undefined &&
          (!Array.isArray(claims.permissions) ||
           claims.permissions.some((permiso) => typeof permiso !== 'string'))) {
        throw new Error('Permisos JWT inválidos');
      }

      req.actor = {
        identificador: claims.sub,
        roles: claims.roles,
        permisos: claims.permissions || []
      };
      return next();
    } catch (error) {
      return next(new ErrorDeDominio('UNAUTHORIZED', 'El token Bearer es inválido', 401));
    }
  };
}

module.exports = { crearAutenticacionJwt };
