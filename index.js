const { crearServidor } = require('./servicios/viajes/src/servidor');
const app = crearServidor();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.get('/', (req, res) => res.send('Bienvenido a Urbe, la mejor plataforma de viajes'));

const servidor = app.listen(PORT, HOST, () => {
    console.log(`Servidor escuchando en ${HOST}:${PORT}`);
});

async function cerrarGracefully(signal) {
    console.log(`Recibida señal ${signal}, cerrando servidor`);
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
