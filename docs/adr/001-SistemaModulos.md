# Usamos CommonJS para organizar los módulos del backend

- **Estado:** Propuesto
- **Fecha:** 2026-10-29
- **Participantes:** Lovey Facundo y Vernengo Hipólito.

## Contexto

AppUrbe es un trabajo práctico realizado por dos estudiantes. El objetivo
principal es construir y poder defender un backend con Node.js y Express que 
cumpla los requisitos de la materia: contratos REST, persistencia, pruebas, 
contenedores, seguridad, concurrencia e integración con servicios auxiliares.

Ambos integrantes tenemos un poco más de experiencia trabajando con CommonJS
que con ESM. Por ese motivo, queremos aprovechar la familiaridad que ya
tenemos con su sintaxis y la simplicidad de su configuración para concentrar
el tiempo del proyecto en el dominio, las APIs, las pruebas y la
infraestructura.

El proyecto tendrá varios módulos, adaptadores de persistencia, consumidores y
publicadores de mensajes, pruebas y servicios auxiliares. Por eso necesitamos
elegir una única convención que sea fácil de aplicar, revisar y explicar
durante la defensa.

ESM también es una alternativa válida y más moderna, pero incorporarlo
implicaría que los dos integrantes aprendamos reglas y configuraciones nuevas
al mismo tiempo que desarrollamos el sistema. Para el alcance académico del
proyecto, consideramos más conveniente priorizar una opción que ya conocemos
y que nos permita avanzar con menor complejidad accidental.

## Opciones consideradas

### Opción A: CommonJS

**Ventajas:**

- Ambos integrantes tenemos más práctica con `require` y `module.exports`.
  Podemos usar esa experiencia para concentrarnos en el dominio y los
  requisitos del TP.
- Permite comenzar el desarrollo con una configuración sencilla, sin
  convertir la primera etapa en una migración de configuración.
- Es suficiente para separar el código en dominio, casos de uso,
  infraestructura y pruebas.
- Hace más sencilla la colaboración porque los dos vamos a leer y escribir
  imports y exports con la misma sintaxis.
- Si aparece un error de importación, tenemos más posibilidades de resolverlo
  con los conocimientos que ya tenemos.
- Reduce el riesgo de que una dificultad de configuración retrase el trabajo
  de persistencia, mensajería o pruebas.

**Desventajas:**

- No es la opción más moderna del ecosistema JavaScript.
- Algunos tutoriales y ejemplos actuales utilizan ESM, por lo que tendremos
  que adaptar ocasionalmente la sintaxis.
- Si en el futuro quisiéramos migrar a ESM, deberíamos modificar imports,
  exports, pruebas y configuración.
- Debemos mantener una convención clara para no confundir `module.exports` con
  las distintas formas de usar `exports`.

### Opción B: ESM

**Ventajas:**

- Es el sistema de módulos estándar de los proyectos modernos de JavaScript.
- La sintaxis `import` y `export` es clara cuando todos los archivos siguen la
  misma convención.
- Muchos ejemplos recientes de Node.js utilizan ESM, por lo que podríamos
  encontrar material actualizado.
- Si comenzáramos desde cero y ambos tuviéramos experiencia suficiente,
  evitaría una migración posterior.

**Desventajas:**

- Tendríamos que aprender sus reglas al mismo tiempo que desarrollamos el
  dominio, las APIs, las pruebas y la infraestructura.
- Habría que cambiar la configuración existente y adaptar el código inicial.
- Los imports locales requieren escribir correctamente las extensiones `.js`,
  lo que puede generar errores durante el desarrollo.
- Algunas pruebas, mocks o herramientas podrían requerir una configuración
  distinta a la que ya conocemos.
- Los ejemplos basados en CommonJS necesitarían una adaptación antes de poder
  utilizarlos.
- Para el alcance del TP, el beneficio de cambiar de sintaxis no compensa el
  tiempo y el riesgo adicional.

### Opción C: mezclar CommonJS y ESM

**Ventajas:**

- Permitiría reutilizar temporalmente un ejemplo o dependencia escrita con el
  otro sistema.
- Podría servir para una migración gradual en un proyecto que realmente
  necesitara cambiar de tecnología.

**Desventajas:**

- Para dos estudiantes que todavía estamos organizando la estructura del
  backend, aumenta la cantidad de conceptos que debemos dominar.
- Puede provocar errores de interoperabilidad difíciles de distinguir de los
  errores propios de la aplicación.
- Las pruebas podrían comportarse de forma diferente al servidor.
- Complicaría la ejecución en Docker y la explicación durante la defensa.
- La migración gradual no es necesaria para el tamaño actual del proyecto.

## Decisión

Usaremos **CommonJS** en todo el backend:  Node.js 22 + Express + JavaScript + CommonJS


Mantendremos CommonJS y no lo mezclaremos con ESM dentro del mismo proyecto.

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