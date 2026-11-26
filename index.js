const { crearServidor } = require('./servicios/viajes/src/servidor');
const {
    RETENCION_UBICACION_MS
} = require('./servicios/conductores/src/politica-ubicaciones');
const app = crearServidor();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.get('/', (req, res) => res.send('Bienvenido a Urbe, la mejor plataforma de viajes'));

let servidor;
let limpiezaUbicaciones;

async function iniciar() {
    await app.locals.modulo?.iniciar?.();
    limpiezaUbicaciones = setInterval(() => {
        app.locals.servicioFlota.limpiarUbicacionesVencidas().catch((error) => {
            console.error('No se pudieron eliminar ubicaciones vencidas', error);
        });
    }, Math.min(5000, RETENCION_UBICACION_MS));
    limpiezaUbicaciones.unref();
    servidor = app.listen(PORT, HOST, () => {
        console.log(`Servidor escuchando en ${HOST}:${PORT}`);
    });
}

async function cerrarGracefully(signal) {
    console.log(`Recibida señal ${signal}, cerrando servidor`);
    if (limpiezaUbicaciones) clearInterval(limpiezaUbicaciones);
    if (!servidor) {
        await app.locals.modulo?.cerrar?.();
        return;
    }
    servidor.close(async (error) => {
        if (error) {
            console.error('Error al cerrar el servidor', error);
            process.exitCode = 1;
        }
        try {
            await app.locals.modulo?.cerrar?.();
            if (app.locals.verificadorPostgres?.pool !== app.locals.modulo?.pool) {
                await app.locals.verificadorPostgres?.cerrar?.();
            }
        } catch (closeError) {
            console.error('Error al cerrar recursos', closeError);
            process.exitCode = 1;
        }
        process.exit();
    });
}

process.once('SIGTERM', () => cerrarGracefully('SIGTERM'));
process.once('SIGINT', () => cerrarGracefully('SIGINT'));

iniciar().catch(async (error) => {
    console.error('No se pudo iniciar el servicio', error);
    process.exitCode = 1;
    if (limpiezaUbicaciones) clearInterval(limpiezaUbicaciones);
    try {
        await app.locals.modulo?.cerrar?.();
    } catch (closeError) {
        console.error('No se pudieron cerrar los recursos tras el fallo de inicio', closeError);
    }
});
