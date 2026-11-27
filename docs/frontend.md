# Frontend React

La demo web vive en `frontend/` y se compila con React y Vite. Express sirve
los archivos compilados desde el mismo origen que la API; no hace falta
configurar CORS.

## Estructura del código

```text
frontend/src/
├── components/       # Componentes reutilizables, como campos y notificaciones
│   └── trips/        # Mapa esquemático y seguimiento reutilizable
├── config/           # Claves de sesión y almacenamiento local de la demo
├── layout/
│   ├── header/       # Barra de navegación autenticada
│   ├── footer/       # Pie de página
│   └── AuthLayout.jsx
├── pages/
│   ├── login/        # Inicio de sesión y alta inicial de administrador
│   ├── register/     # Registro de pasajeros y choferes
│   ├── passenger/    # Solicitud y seguimiento de viajes
│   ├── driver/       # Perfil, disponibilidad y recorrido del chofer
│   ├── admin/        # Habilitación de choferes
│   ├── history/      # Historial de viajes
│   └── dashboard/    # Composición y navegación entre páginas
├── services/         # Cliente HTTP común para la API
├── utils/            # Formato y estados de viajes
├── App.jsx           # Sesión activa y selección de pantalla
└── main.jsx          # Punto de entrada de React
```

## Desarrollo local

1. Iniciá las dependencias del backend siguiendo las instrucciones del
   proyecto y levantá la API en `http://localhost:3000`.
2. En otra terminal, desde la raíz:

   ```powershell
   npm run dev
   ```

3. Abrí `http://localhost:5173`. Vite reenvía `/api` a
   `http://localhost:3000`. Para usar otro host, definí
   `APPURBE_API_URL` antes de iniciar Vite.

Para compilar la aplicación:

```powershell
npm run build
npm start
```

La interfaz compilada queda en `frontend/dist`; el servidor Node la entrega en
`http://localhost:3000`. La imagen Docker también compila el frontend durante
su etapa de build.

## Recorrido de demostración

- Creá una cuenta de pasajero, calculá la tarifa y confirmá el viaje.
- Copiá el ID del viaje para compartirlo con un chofer.
- Registrá una cuenta de chofer, completá su perfil y agregá un vehículo.
- Desde una cuenta administradora, consultá el perfil usando el ID de usuario
  del chofer y habilitalo. El primer administrador puede crearse con el token
  de alta inicial configurado en el backend.
- El chofer activa su disponibilidad, acepta el ID del viaje y avanza sus
  estados. La opción de simulación envía posiciones de ejemplo cada tres
  segundos; también puede permitirse el GPS real desde el navegador.

El seguimiento usa SSE autenticado. Al reconectar, vuelve a solicitar el viaje
para recuperar el estado completo y luego recibe actualizaciones. El mapa es
esquemático: no muestra calles ni calcula una ruta vial. El viaje se comparte
manualmente entre pasajero y chofer porque la API actual no los asigna
automáticamente desde la pantalla de solicitud.
