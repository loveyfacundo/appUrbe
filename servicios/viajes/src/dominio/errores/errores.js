class ErrorDeDominio extends Error {
  constructor(codigo, mensaje, estado = 400, detalles = []) {
    super(mensaje);
    this.name = 'ErrorDeDominio';
    this.codigo = codigo;
    this.estado = estado;
    this.detalles = detalles;
  }
}

class ErrorDeValidacion extends ErrorDeDominio {
  constructor(mensaje, detalles = []) {
    super('VALIDATION_ERROR', mensaje, 422, detalles);
    this.name = 'ErrorDeValidacion';
  }
}

class RecursoNoEncontrado extends ErrorDeDominio {
  constructor(mensaje = 'El viaje no existe') {
    super('NOT_FOUND', mensaje, 404);
    this.name = 'RecursoNoEncontrado';
  }
}

class OperacionNoPermitida extends ErrorDeDominio {
  constructor(mensaje = 'El actor no tiene permisos para esta operación') {
    super('FORBIDDEN', mensaje, 403);
    this.name = 'OperacionNoPermitida';
  }
}

class ConflictoDeEstado extends ErrorDeDominio {
  constructor(mensaje) {
    super('CONFLICT', mensaje, 409);
    this.name = 'ConflictoDeEstado';
  }
}

class DependenciaNoDisponible extends ErrorDeDominio {
  constructor(mensaje) {
    super('DEPENDENCY_UNAVAILABLE', mensaje, 503);
    this.name = 'DependenciaNoDisponible';
  }
}

module.exports = {
  ErrorDeDominio,
  ErrorDeValidacion,
  RecursoNoEncontrado,
  OperacionNoPermitida,
  ConflictoDeEstado,
  DependenciaNoDisponible
};
