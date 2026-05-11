# ADR 0008: Gestión de Categorías — Catálogo Predefinido en Código

## Estado
Aceptado

## Contexto
La consigna exige que el vendedor pueda asignar una categoría al publicar un
producto, y que los usuarios puedan filtrar el catálogo por categoría. Las
categorías disponibles son responsabilidad del sistema, no del vendedor. La
consigna pide documentar explícitamente cómo se administra este catálogo.

Las alternativas evaluadas fueron:

- **Hardcodeadas en el código fuente**: la lista de categorías se define como
  una constante inmutable en la aplicación. El único mecanismo de modificación
  es un cambio de código y un nuevo despliegue.
- **Configuradas en base de datos** (colección o tabla de categorías): las
  categorías se almacenan como documentos en MongoDB y se consultan en runtime.
  Permiten modificaciones sin redespliegue a través de un panel de administración.
- **Gestionadas por el administrador mediante endpoints**: combinación de BD con
  un CRUD expuesto en el backoffice para que el administrador agregue, edite o
  deshabilite categorías.

## Decisión
Se adopta el modelo de **categorías predefinidas en código fuente** mediante una
tupla de constantes en `app/core/catalog.py`.

### Implementación
El módulo define `PREDEFINED_CATEGORIES` como una tupla inmutable de 8 categorías
(tecnologia, hogar, moda, deportes, libros, juguetes, coleccionables, herramientas),
cada una con los campos `slug` (identificador URL-friendly) y `label` (texto
legible). Un diccionario `PREDEFINED_CATEGORY_BY_SLUG` indexa las mismas entradas
para búsqueda O(1) por slug.

El endpoint `GET /categories/` expone la lista completa sin autenticación. Existe
un `POST /categories/` reservado para administradores que actualmente retorna
`501 Not Implemented`, dejando la extensión explícitamente señalizada en la API
sin habilitar la funcionalidad.

### Almacenamiento en productos
Cada documento de producto en MongoDB embebe un snapshot de la categoría en el
momento de su creación (`{ "slug": "...", "label": "..." }`). El filtrado del
catálogo usa un índice sobre `category.slug`. Al ser un snapshot embebido, un
cambio futuro en el label de una categoría no afecta retroactivamente a los
productos ya publicados.

## Alternativas descartadas

**Categorías en base de datos con CRUD de administrador**: descartada para el
alcance actual del proyecto. Introduce una colección adicional, lógica de
validación de referencias entre productos y categorías, y un panel de
administración para un conjunto de datos que no varía durante el desarrollo.
El `POST /categories/` con `501 Not Implemented` documenta que esta extensión
está prevista y señaliza el punto de extensión sin romper el contrato de API.

**Categorías en base de datos sin CRUD (seed al iniciar)**: descartada por
agregar complejidad de migración (script de seed, idempotencia del seed) sin
beneficio observable respecto a la constante en código para un catálogo fijo
en esta etapa.

## Consecuencias

### Positivas
- Sin latencia de consulta: la lista de categorías se resuelve en memoria sin
  llamadas a la base de datos.
- Sin riesgo de inconsistencia entre la lista de categorías válidas y los
  productos almacenados: la validación ocurre en código antes del insert.
- El contrato de API (`GET /categories/`) es estable y documentado; el frontend
  puede consumirlo sin acoplamientos adicionales.
- La extensión hacia categorías dinámicas está señalizada en el código
  (`POST /categories/` → 501) y en este ADR.

### Negativas y Riesgos
- **Agregar o renombrar una categoría requiere redespliegue**: no es posible
  que el administrador gestione categorías desde el backoffice sin un cambio
  de código. Para el alcance actual del proyecto esto es aceptable.
- **Snapshots embebidos no se actualizan**: si en el futuro se renombra el
  `label` de una categoría, los productos ya publicados conservarán el label
  anterior. Sería necesario una migración de datos en MongoDB.
- **8 categorías fijas pueden no cubrir todos los casos de uso**: los vendedores
  no pueden proponer categorías nuevas; deben ajustarse al conjunto predefinido.