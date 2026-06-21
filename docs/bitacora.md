---
title: Bitácora de Proyecto
nav_order: 3
---

# Bitácora de Proyecto

Registro cronológico del desarrollo de Bazaar: decisiones tomadas, correcciones recibidas y aprendizajes por checkpoint.

---

## Metodología de trabajo

- Reunión semanal obligatoria los **viernes**.
- Por cada épica nueva se creó un repositorio independiente dentro de la organización GitHub del equipo.
- Los repositorios se consolidaron bajo una **organización de GitHub** a partir del Checkpoint 2.
- Cobertura mínima de tests: **80%**, validada en CI/CD.

---

## Checkpoint 1

### Historias completadas

| Historia | Épica | Puntos |
|---|---|---|
| Registro de usuarios | Usuarios | 2 |
| Login con email y contraseña | Usuarios | 2 |
| Recupero de contraseña | Usuarios | 3 |
| Edición de perfil | Perfil | 3 |
| Visualización de perfil propio | Perfil | 1 |
| Home | Catálogo | 3 |
| Listado y búsqueda de productos | Catálogo | 3 |
| Publicar producto | Vendedor | 3 |
| Gestión de stock y publicaciones | Vendedor | 3 |
| Login con proveedor federado *(optativa)* | Usuarios | 3 |
| Visualización de perfil público *(optativa)* | Perfil | 2 |

### Correcciones recibidas durante el checkpoint

- Al hacer login, la app no redirigía a home correctamente → se corrigió el flujo de navegación post-autenticación.
- Al intentar registrarse con mail existente, el mensaje de email ya existente era demasiado explícito → se cambió por un mensaje de error genérico por seguridad.
- En la búsqueda, las imágenes no hacían resize → se implementó redimensionado de imágenes.

### Correcciones recibidas en la entrega

- Entregar la APK para la siguiente reunión semanal.
- Solucionar el layout visual en mobile.
- Implementar drag & drop en la carga de imágenes de productos.
- Para la presentación: enfocarse en **diagramas de flujo y tecnologías**, no en métodos de gestión.

---

## Checkpoint 2

### Historias completadas

| Historia | Épica | Puntos |
|---|---|---|
| Detalle de producto | Catálogo | 2 |
| Agregar producto al carrito | Carrito | 2 |
| Gestión del carrito | Carrito | 3 |
| Checkout e inicio de pago | Checkout y Órdenes | 8 |
| Estado y seguimiento de orden | Checkout y Órdenes | 5 |
| Historial de compras | Checkout y Órdenes | 2 |
| Historial de ventas | Vendedor | 3 |
| Compartir link de producto *(optativa)* | Catálogo | 2 |
| Productos populares en home *(optativa)* | Catálogo | 3 |
| Filtros avanzados de búsqueda *(optativa)* | Catálogo | 3 |
| Agregar / quitar de wishlist *(optativa)* | Wishlist | 2 |
| Visualización de wishlist *(optativa)* | Wishlist | 2 |

### Decisiones de diseño tomadas durante el checkpoint

**Carrito con fulfillments por vendedor**

Durante el sprint se debatió internamente cómo manejar un carrito con productos de múltiples vendedores. Se evaluaron dos opciones:

- Un carrito separado por vendedor.
- Un único carrito con fulfillments agrupados por vendedor.

Se optó por **un único carrito con fulfillments**: cada vendedor tiene su propio sub-historial dentro del carrito, el checkout se hace en un solo paso y el monto se distribuye por producto. Esto simplifica la experiencia del comprador y centraliza el flujo de pago.

### Correcciones recibidas en la entrega

- En mobile, al abrir el teclado virtual, tapaba el campo de texto que el usuario estaba completando → se ajustó el comportamiento del scroll para que la pantalla se acomode al teclado.

---

## Checkpoint 3

### Historias completadas

| Historia | Épica | Puntos |
|---|---|---|
| Listar usuarios del sistema | Administración | 1 |
| Bloquear y desbloquear usuario | Administración | 2 |
| Listar y moderar productos | Administración | 5 |
| Listar órdenes del sistema | Administración | 2 |
| Métricas del sistema | Métricas | 5 |
| Ordenamiento de resultados *(optativa)* | Catálogo | 2 |
| Calificar producto y vendedor *(optativa)* | Reviews | 5 |
| Reputación del vendedor en perfil público *(optativa)* | Reviews | 3 |
| Crear y gestionar cupones de descuento *(optativa)* | Vendedor | 5 |
| Aplicar cupón en checkout *(optativa)* | Checkout y Órdenes | 3 |
| Métricas por categoría *(optativa)* | Métricas | 3 |
| Exportar datos de métricas *(optativa)* | Métricas | 2 |

### Correcciones recibidas en la entrega

- Al bloquear un usuario, sus publicaciones seguían visibles en el catálogo → se implementó la propagación del bloqueo: al bloquear una cuenta de vendedor desde el backoffice, Catalog API oculta automáticamente todos sus productos.
- El CSV de exportación generaba un archivo por cada fila → se corrigió para que genere **un único archivo por período**.
- Se abrió la discusión sobre el manejo de cupones de código único: al no eliminarlos sino solo expirarlos, el código queda inutilizable permanentemente y no puede reutilizarse. Queda pendiente definir la política de reciclado de códigos.

---

## Checkpoint 4 - Entrega Final

### Historias completadas

| Historia | Épica | Puntos |
|---|---|---|
| #23 Registro con PIN | Usuarios | 2 |
| #42 Login con datos biométricos *(optativa)* | Usuarios | 3 |
| #35 Cancelar orden | Checkout y Órdenes | 5 |
| #36 Reembolso simulado al cancelar | Checkout y Órdenes | 2 |
| #37 Notificación de cambio de estado de orden | Notificaciones | 5 |
| #38 Notificación de stock bajo al vendedor *(optativa)* | Notificaciones | 3 |
| #39 Recomendaciones basadas en historial *(optativa)* | Recomendaciones | 5 |

### Requisitos no funcionales y mejoras de infraestructura

- **API Gateway** configurado como punto único de entrada: enrutamiento, validación de tokens y rate limiting. Se agregaron las rutas y endpoints para el servicio de Notifications.
- **Pruebas de carga/estrés** sobre endpoints críticos con k6/Artillery, con documentación de resultados.
- **AGENTS.md** documentando flujos estructurados con herramientas de IA.
- **SAST** integrado en el pipeline de CI (bandit / semgrep / CodeQL / Snyk).
- **Logs estructurados** con niveles Error/Warn/Info/Debug usando structlog.
- **APM** (o equivalente) en cada servicio para supervisión operativa.
- **Trazabilidad distribuida**: propagación de trace/correlation ID entre todos los microservicios.
- **Rate limiting** en login por IP y por cuenta.
- **Diagramas de arquitectura C4 Model**: contexto, contenedores y componentes.
- **Retry con backoff exponencial** en la comunicación entre microservicios.
- **Tests de contrato** entre frontends y backends.
- **Manual de Usuario** de Bazaar y del Backoffice.

### Fixes y correcciones

- **Login biométrico**: si el usuario se autenticaba con reconocimiento facial, el login por contraseña quedaba bloqueado y no se podía volver a usar sin biometría → se corrigió el flujo de autenticación para que ambos métodos coexistan.
- **Login federado (APK)**: ya no lanzaba error pero la app se tildaba → se corrigió el flujo de retorno de OAuth en mobile.
- **Cupones en PROD**: al aplicar un cupón y pasar a la pantalla de pago, el descuento no se trasladaba → se corrigió la propagación del cupón en el flujo de checkout.
- **Cupones en PROD**: la edición de fecha de vencimiento no funcionaba en producción → corregido.
- **Bloqueo de usuario**: los productos de un vendedor bloqueado seguían apareciendo en el home → se ocultan automáticamente del catálogo.
- **CSV de exportación**: se descarga un archivo separado por sección (no un único archivo global).
- **Populares / recomendaciones**: se revisó y rediseñó el cálculo según lo indicado por el tutor (ver sección de decisiones de diseño abajo).
- **Supabase**: se actualizaron las tablas de Payments y Orders para soportar reembolsos y cancelaciones.
- **APK**: se ajustó la pantalla para que se adapte correctamente cuando aparece el teclado virtual.
- **UI**: correcciones de elementos visuales que se veían desalineados o con estilos incorrectos.
- **Swagger**: se documentaron los endpoints del servicio de Notifications.
- **READMEs**: revisados y actualizados para que todos los repositorios tengan el mismo formato y contenido.

### Decisiones de diseño: cálculo de populares y recomendaciones

Durante el checkpoint el tutor señaló que la lógica de populares y recomendaciones necesitaba revisión, lo que derivó en un rediseño completo de ambos algoritmos.

**Productos populares**

Se optó por un enfoque basado en volumen de ventas real dentro de una ventana temporal de **30 días**. Catalog API consulta a Orders API los IDs de productos más vendidos (sumando cantidades por `product_id`, sobre órdenes en estado `confirmed`, `in_preparation`, `shipped` o `delivered`). Para usuarios autenticados, se agrega una capa de personalización opcional: se identifican las **3 categorías más compradas** por el usuario en los últimos 180 días y se filtran los populares globales a esas categorías. Si el filtro da lista vacía, se devuelve el ranking global como fallback. Siempre se solicita un excedente (mínimo 4× el límite pedido) para absorber productos sin stock o inactivos.

**Recomendaciones personalizadas**

Se implementó un sistema de scoring por categoría que combina dos señales:

1. **Historial de compras** (últimos 180 días): cada categoría comprada suma una bonificación fija de **5 puntos**, independientemente de cuándo ocurrió la compra.
2. **Historial de navegación** (últimos 30 días, guardado en MongoDB con TTL de 90 días): cada evento reciente suma puntos con **decaimiento exponencial** (`puntos = peso × e^(−0.1 × días_de_antigüedad)`, semivida ≈ 7 días). Los pesos por tipo de evento son: agregar al carrito → 2.5, agregar a wishlist → 2.0, ver producto → 1.0, explorar categoría → 0.5.

Las categorías se ordenan por score total y se van completando los resultados (mínimo 6, máximo 8 productos, ordenados por más recientes dentro de cada categoría). Si con las categorías puntuadas no se llega al mínimo de 6, se completa con productos populares globales evitando duplicados. Si el usuario no tiene ninguna señal, se devuelve lista vacía y el frontend muestra los populares como "Tendencias Populares".

La comunicación entre Catalog API y Orders API usa HTTP interno con header de autenticación `X-Internal-Key`; ante cualquier error de red, el servicio devuelve lista vacía sin propagar el error.

### Llamadas con el corrector

- **Demo final**: se discutió la dinámica de la presentación final: qué mostrar, el orden sugerido, qué aspectos iba a evaluar el corrector y en cuáles convenía profundizar (arquitectura, decisiones de diseño, requisitos no funcionales y el flujo end-to-end desde la APK).
- **Revisión del frontend**: se le mostró al corrector el frontend con las mejoras visuales acumuladas durante el checkpoint y dio el ok para continuar.
