# Usamos CommonJS para organizar los módulos del backend

- **Estado:** Propuesto
- **Fecha:** 2026-10-29
- **Participantes:** Lovey Facundo y Vernengo Hipólito.

## Contexto

El backend de AppUrbe se ejecutará con Node.js 22 y Express. El repositorio
actual ya utiliza CommonJS:

```json
{
  "type": "commonjs"
}
```

Y el servidor inicial importa Express de la siguiente manera:

```js
const express = require('express');
```

El proyecto crecerá hasta tener varios módulos, adaptadores de persistencia,
consumidores y publicadores de mensajes, pruebas y servicios auxiliares. Por
eso es necesario elegir un único sistema de módulos antes de comenzar a
reorganizar el código.

Además, el enunciado exige Express y establece que la estructura debe ser una
decisión del grupo. No se debe incorporar un framework que imponga una
arquitectura por encima de Express.

## Opciones consideradas

### Opción A: CommonJS

**Ventajas:**

- Ambos integrantes tenemos más práctica con `require` y `module.exports`, por
  lo que podemos concentrarnos en entender el dominio y los requisitos del
  TP, en lugar de dedicar tiempo a aprender otro sistema de módulos.
- Permite reutilizar directamente el código inicial del proyecto y los
  ejemplos que ya probamos.
- Reduce los cambios de configuración en una etapa en la que todavía estamos
  aprendiendo a organizar el backend.
- Es más sencillo de explicar y depurar para nuestro nivel actual, especialmente
  cuando una dependencia no se encuentra o una ruta está mal importada.
- Facilita que ambos integrantes puedan revisar y modificar el código del
  otro sin tener que interpretar dos formas distintas de exportar módulos.
- Reduce el riesgo de perder tiempo resolviendo problemas de configuración de
  ESM que no están relacionados con los objetivos principales del trabajo.

**Desventajas:**

- Es una tecnología que debemos conocer, pero no es la opción más moderna del
  ecosistema JavaScript.
- Algunos tutoriales, ejemplos y paquetes actuales utilizan ESM, por lo que
  tendremos que adaptar ocasionalmente la sintaxis.
- Si en el futuro quisiéramos migrar a ESM, deberíamos modificar imports,
  exports, pruebas y configuración.
- La elección no nos permite practicar ESM en este proyecto, aunque podemos
  estudiarlo en ejercicios separados.
- Debemos prestar atención al formato de exportación para evitar confundir
  `module.exports` con las variantes de `exports`.

### Opción B: ESM

**Ventajas:**

- Es el sistema de módulos estándar de los proyectos modernos de JavaScript y
  nos permitiría aprender una herramienta vigente.
- La sintaxis `import` y `export` resulta clara cuando se trabaja con
  exportaciones nombradas y módulos bien separados.
- Muchos ejemplos recientes de Node.js utilizan ESM, lo que podría facilitar
  encontrar material actualizado para algunas dudas.
- Si el proyecto comenzara desde cero y ya tuviéramos experiencia suficiente,
  evitaría una migración posterior.

**Desventajas:**

- Tendríamos que dedicar tiempo a aprender sus reglas mientras también
  desarrollamos el dominio, las APIs, las pruebas y la infraestructura.
- Los imports locales requieren escribir correctamente las extensiones `.js`,
  algo que puede generar errores durante el desarrollo inicial.
- Habría que cambiar la configuración existente y adaptar el código inicial.
- La configuración de algunas pruebas, mocks o herramientas puede requerir
  más investigación por parte del equipo.
- Si encontramos un ejemplo basado en CommonJS, no podríamos copiarlo
  directamente sin entender primero cómo adaptarlo.
- Para un proyecto académico con tiempo limitado, el beneficio de aprender ESM
  no compensa el riesgo de agregar problemas de configuración ajenos al
  objetivo principal del TP.

### Opción C: mezclar CommonJS y ESM

**Ventajas:**

- Podría permitir reutilizar temporalmente un ejemplo o dependencia escrita
  con el otro sistema.
- Daría la posibilidad de migrar partes del proyecto de manera gradual.

**Desventajas:**

- Para dos estudiantes que todavía estamos consolidando la estructura del
  backend, aumenta la cantidad de conceptos que debemos dominar y mantener.
- Puede provocar errores de interoperabilidad que son difíciles de distinguir
  de errores propios de la aplicación.
- Las pruebas podrían comportarse de forma diferente al servidor si cada
  herramienta interpreta los módulos de manera distinta.
- Complicaría la ejecución en Docker y la explicación individual durante la
  defensa.
- La posible migración gradual no es necesaria para el tamaño actual del
  proyecto y no justifica la complejidad adicional.

## Decisión

Usaremos **CommonJS** en todo el backend:

```text
Node.js 22 + Express + JavaScript + CommonJS
```

Mantendremos `"type": "commonjs"` en `package.json` y no mezclaremos
CommonJS con ESM dentro del mismo proyecto.

Los módulos seguirán la siguiente convención:

```js
const express = require('express');
const { crearViaje } = require('./casos-uso/crear-viaje');

module.exports = { crearViaje };
```

La decisión no impide revisar ESM en el futuro, pero cualquier cambio deberá
realizarse como una nueva decisión documentada y acompañado por una migración
completa.

## Consecuencias

### Beneficios

- Se conserva la configuración y el código inicial del repositorio.
- Se reduce el tiempo necesario para comenzar el desarrollo.
- Ambos integrantes utilizarán una única convención.
- Se evita introducir problemas de interoperabilidad durante TP1.
- Las pruebas y los contenedores tendrán una configuración más simple.
- La estructura del proyecto queda definida por el equipo y no por un
  framework.

### Costos y dificultades

- Se utilizará una sintaxis menos moderna que ESM.
- Puede ser necesario adaptar ejemplos o paquetes que documenten únicamente
  ESM.
- La futura migración a ESM requeriría modificar imports, exports, pruebas y
  scripts.
- Algunas características modernas del ecosistema pueden requerir una
  configuración adicional.

## Qué nos haría cambiar de decisión

Revisaremos esta decisión únicamente si ocurre una de estas condiciones:

- La cátedra exige explícitamente ESM.
- Una dependencia esencial del proyecto no puede utilizarse correctamente con
  CommonJS.
- Las herramientas obligatorias de pruebas o build dejan de ser compatibles
  con CommonJS.
- El equipo decide migrar todo el proyecto a ESM y puede realizar una
  migración completa, probada y documentada antes de la siguiente entrega.

La adopción de ESM en un solo módulo o la preferencia personal por su sintaxis
no será suficiente para cambiar esta decisión.