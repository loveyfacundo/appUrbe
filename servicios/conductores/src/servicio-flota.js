const crypto = require('node:crypto');
const { RepositorioFlotaMemoria } = require('./repositorio-flota');
const {
  RADIO_BUSQUEDA_MAXIMO_METROS
} = require('./politica-ubicaciones');
const { exigirRol } = require('../../identidad/src/servicio-identidad');
const {
  ErrorDeValidacion,
  RecursoNoEncontrado,
  ConflictoDeEstado,
  OperacionNoPermitida
} = require('../../viajes/src/dominio/errores/errores');

function validarUuid(valor) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(valor || ''))) {
    throw new ErrorDeValidacion('id debe ser un UUID válido');
  }
}

class ServicioFlota {
  constructor({ repositorio = new RepositorioFlotaMemoria() } = {}) {
    this.repositorio = repositorio;
  }

  async crearPerfil({ actor, licenseNumber, licenseExpiresAt }) {
    exigirRol(actor, ['chofer']);
    if (!licenseNumber?.trim()) throw new ErrorDeValidacion('licenseNumber es obligatorio');
    if (!licenseExpiresAt || Number.isNaN(Date.parse(licenseExpiresAt))) throw new ErrorDeValidacion('licenseExpiresAt no es válido');
    if (new Date(licenseExpiresAt).getTime() <= Date.now()) throw new ErrorDeValidacion('La licencia está vencida');
    const existente = await this.repositorio.buscarPerfilPorUsuario(actor.identificador);
    if (existente) throw new ConflictoDeEstado('El chofer ya tiene perfil');
    const perfil = {
      id: actor.identificador,
      usuarioId: actor.identificador,
      licenseNumber: licenseNumber.trim(),
      licenseExpiresAt,
      habilitado: false,
      disponible: false
    };
    try {
      return await this.repositorio.guardarPerfil(perfil);
    } catch (error) {
      if (error.code === '23505') {
        throw new ConflictoDeEstado('El chofer ya tiene perfil o licencia registrada');
      }
      throw error;
    }
  }

  async registrarVehiculo({ actor, conductorId = actor?.identificador, plate, brand, model, year, capacity = 4 }) {
    exigirRol(actor, ['chofer', 'administrador']);
    if (!plate?.trim() || !brand?.trim() || !model?.trim()) throw new ErrorDeValidacion('plate, brand y model son obligatorios');
    if (!Number.isInteger(year) || year < 1950 || year > 2200) throw new ErrorDeValidacion('year no es válido');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) throw new ErrorDeValidacion('capacity no es válida');
    validarUuid(conductorId);
    if (actor.roles.includes('chofer') && conductorId !== actor.identificador) {
      throw new OperacionNoPermitida('El chofer solo puede registrar su propio vehículo');
    }
    const perfil = await this.repositorio.buscarPerfil(conductorId);
    if (!perfil) throw new RecursoNoEncontrado('El chofer no tiene perfil');
    const vehiculo = {
      id: crypto.randomUUID(),
      conductorId,
      plate: plate.trim().toUpperCase(),
      brand: brand.trim(),
      model: model.trim(),
      year,
      capacity
    };
    try {
      return await this.repositorio.guardarVehiculo(vehiculo);
    } catch (error) {
      if (error.code === '23505') {
        throw new ConflictoDeEstado('La patente ya está registrada');
      }
      throw error;
    }
  }

  async habilitar({ actor, conductorId, habilitado }) {
    exigirRol(actor, ['administrador']);
    validarUuid(conductorId);
    if (typeof habilitado !== 'boolean') throw new ErrorDeValidacion('enabled debe ser true o false');
    const perfil = await this.repositorio.buscarPerfil(conductorId);
    if (!perfil) throw new RecursoNoEncontrado('El chofer no existe');
    if (perfil.habilitado === habilitado) return perfil;
    const actualizado = await this.repositorio.establecerHabilitacion(conductorId, habilitado);
    if (!actualizado) throw new RecursoNoEncontrado('El chofer no existe');
    return actualizado;
  }

  async cambiarDisponibilidad({ actor, conductorId, disponible }) {
    exigirRol(actor, ['chofer']);
    validarUuid(conductorId);
    if (typeof disponible !== 'boolean') throw new ErrorDeValidacion('available debe ser true o false');
    if (actor.identificador !== conductorId) throw new OperacionNoPermitida('El chofer solo puede cambiar su propia disponibilidad');
    const perfil = await this.repositorio.buscarPerfil(conductorId);
    if (!perfil) throw new RecursoNoEncontrado('El chofer no tiene perfil');
    if (!perfil.habilitado) throw new ConflictoDeEstado('El chofer no está habilitado');
    if (!await this.repositorio.buscarVehiculo(conductorId)) throw new ConflictoDeEstado('El chofer no tiene vehículo registrado');
    const actualizado = await this.repositorio.establecerDisponibilidad(conductorId, disponible);
    if (!actualizado) {
      throw new ConflictoDeEstado('El chofer dejó de estar habilitado o no cuenta con un vehículo activo');
    }
    return actualizado;
  }

  async actualizarUbicacion({ actor, conductorId, latitude, longitude, accuracyMeters = null }) {
    exigirRol(actor, ['chofer']);
    validarUuid(conductorId);
    if (actor.identificador !== conductorId) throw new OperacionNoPermitida('El chofer solo puede reportar su propia ubicación');
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new ErrorDeValidacion('latitude no es válida');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new ErrorDeValidacion('longitude no es válida');
    if (accuracyMeters !== null && (!Number.isFinite(accuracyMeters) || accuracyMeters < 0)) throw new ErrorDeValidacion('accuracyMeters no es válido');
    const perfil = await this.repositorio.buscarPerfil(conductorId);
    if (!perfil) throw new RecursoNoEncontrado('El chofer no tiene perfil');
    if (!perfil.habilitado || !perfil.disponible) {
      throw new ConflictoDeEstado('El chofer debe estar habilitado y disponible para reportar ubicación');
    }
    const ubicacion = {
      conductorId,
      latitude,
      longitude,
      accuracyMeters,
      recordedAt: new Date().toISOString()
    };
    const guardada = await this.repositorio.guardarUbicacion(ubicacion);
    if (!guardada) throw new ConflictoDeEstado('El chofer debe estar disponible para reportar ubicación');
    return guardada;
  }

  async listarDisponibles({ actor }) {
    this._exigirConsultaDisponibilidad(actor);
    return this.repositorio.listarDisponibles();
  }

  async listarCercanos({ actor, latitude, longitude, radiusMeters = 5000 }) {
    this._exigirConsultaDisponibilidad(actor);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new ErrorDeValidacion('latitude no es válida');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new ErrorDeValidacion('longitude no es válida');
    }
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0 ||
        radiusMeters > RADIO_BUSQUEDA_MAXIMO_METROS) {
      throw new ErrorDeValidacion(
        `radiusMeters debe ser mayor que 0 y no superar ${RADIO_BUSQUEDA_MAXIMO_METROS}`
      );
    }
    return this.repositorio.buscarCercanos({ latitude, longitude, radiusMeters });
  }

  async limpiarUbicacionesVencidas() {
    if (typeof this.repositorio.eliminarUbicacionesVencidas === 'function') {
      await this.repositorio.eliminarUbicacionesVencidas();
    }
  }

  async validarHabilitacion(conductorId, actor) {
    validarUuid(conductorId);
    this._exigirConsultaDisponibilidad(actor, conductorId);
    const perfil = await this.repositorio.buscarPerfil(conductorId);
    if (!perfil) throw new RecursoNoEncontrado('El chofer no existe');
    const vehiculo = await this.repositorio.buscarVehiculo(conductorId);
    return {
      driverId: conductorId,
      enabled: perfil.habilitado,
      available: perfil.disponible,
      vehicleRegistered: Boolean(vehiculo)
    };
  }

  _exigirConsultaDisponibilidad(actor, conductorId = null) {
    if (!actor) throw new ErrorDeValidacion('Se requiere autenticación');
    const esConductorPropio = conductorId &&
      actor.roles?.includes('chofer') &&
      actor.identificador === conductorId;
    const tienePermiso = actor.roles?.some((rol) =>
      ['administrador', 'operador'].includes(rol)
    ) || actor.permisos?.includes('drivers:read:available');
    if (!esConductorPropio && !tienePermiso) {
      throw new OperacionNoPermitida('No tiene permiso para consultar la disponibilidad de conductores');
    }
  }
}

module.exports = { ServicioFlota };
